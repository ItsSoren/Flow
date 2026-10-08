'use strict';
// Local-only attack reproductions. These tests deliberately document accepted attacks.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, writeBatch, serverTimestamp, Timestamp, query, where, increment, arrayUnion, arrayRemove } = require('firebase/firestore');
const Core = require('../flow-core.js');
const host = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = Boolean(host);
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Audit refuses non-loopback Firestore hosts.');
const projectId = 'demo-flow-security-audit';
let env;
before(async () => {
  if (!enabled) return;
  const [hostname, port] = host.split(':');
  env = await initializeTestEnvironment({ projectId, firestore: { host: hostname, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8') } });
});
after(async () => env?.cleanup());
beforeEach(async () => { if (env) await env.clearFirestore(); });
const dbFor = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
const personal = (state = Core.getEmptyState(), revision = 1) => ({ personalState: state, revision, schemaVersion: 1, updatedAt: serverTimestamp() });
const liveInvite = (role = 'viewer') => ({ workspaceId: 'audit-space', role, createdBy: 'owner', expiresAt: Timestamp.fromMillis(Date.now() + 3600000) });
const codes = { viewer: 'audit-viewer-code-'.padEnd(32, 'v'), member: 'audit-member-code-'.padEnd(32, 'm'), expired: 'audit-expired-code-'.padEnd(32, 'e'), revoked: 'audit-revoked-code-'.padEnd(32, 'r') };
async function createSpace() {
  const owner = dbFor('owner'); const b = writeBatch(owner);
  b.set(doc(owner, 'flowWorkspaces/audit-space'), { ownerId: 'owner', name: 'Fictitious audit', kind: 'project', memberCount: 1, memberIds:['owner'], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.set(doc(owner, 'flowWorkspaces/audit-space/members/owner'), { uid: 'owner', role: 'admin', joinedAt: serverTimestamp() });
  await assertSucceeds(b.commit());
  await assertSucceeds(setDoc(doc(owner, 'flowWorkspaces/audit-space/goals/summary'), { ownerId: 'owner', title: 'Fictitious audit', kind: 'project', target: 100, saved: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(owner, 'flowInvites', codes.viewer), liveInvite()));
  await assertSucceeds(setDoc(doc(owner, 'flowInvites', codes.member), liveInvite('member')));
  return owner;
}
function join(db, uid, role, inviteCode) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'flowWorkspaces/audit-space'), { memberCount: increment(1), memberIds:arrayUnion(uid), updatedAt: serverTimestamp() });
  batch.set(doc(db, 'flowUsers', uid, 'joinProofs', 'audit-space'), { uid, workspaceId: 'audit-space', role, inviteCode });
  batch.set(doc(db, 'flowWorkspaces/audit-space/members', uid), { uid, role, joinedAt: serverTimestamp() });
  return batch.commit();
}

test('100 fictitious UIDs: own writes work; neighbor read/write/delete and anonymous access fail', { skip: !enabled, timeout: 180000 }, async t => {
  let refused = 0;
  for (let i = 0; i < 100; i++) {
    const uid = `audit-user-${i}`; const db = dbFor(uid); const other = `audit-user-${(i + 1) % 100}`;
    await assertSucceeds(setDoc(doc(db, 'flowUsers', uid), personal()));
    await assertFails(getDoc(doc(db, 'flowUsers', other)));
    await assertFails(setDoc(doc(db, 'flowUsers', other), personal()));
    await assertFails(deleteDoc(doc(db, 'flowUsers', other))); refused += 3;
  }
  await assertFails(getDoc(doc(dbFor(null), 'flowUsers/audit-user-0')));
  await assertFails(setDoc(doc(dbFor(null), 'flowUsers/audit-user-0'), personal()));
  t.diagnostic(`100 UID owners; ${refused + 2} denied attacks; no production project used.`);
});

test('correct UID checks enforce all nine list ceilings, unknown keys, schema and revisions', { skip: !enabled, timeout: 120000 }, async t => {
  const uid = 'shape-owner'; const db = dbFor(uid); const ref = doc(db, 'flowUsers', uid);
  const limits = { accounts: 100, transactions: 5000, recurring: 200, goals: 200, reservations: 2000, salaryTriggers: 5000, notifications: 1000, reminders: 500, importFingerprints: 10000 };
  for (const [field, ceiling] of Object.entries(limits)) {
    const s = Core.getEmptyState(); s[field] = Array(ceiling + 1).fill(field === 'accounts' ? { id: 'fake' } : 'fake');
    await assertFails(setDoc(ref, personal(s)));
    s[field] = {}; await assertFails(setDoc(ref, personal(s)));
  }
  await assertFails(setDoc(ref, personal({ ...Core.getEmptyState(), injected: true })));
  await assertFails(setDoc(ref, { ...personal(), secret: 'fictional' }));
  await assertFails(setDoc(ref, { ...personal(), schemaVersion: 2 }));
  await assertFails(setDoc(ref, { ...personal(), updatedAt: Timestamp.fromMillis(0) }));
  await assertSucceeds(setDoc(ref, personal()));
  await assertFails(updateDoc(ref, { revision: 3, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { revision: 1, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { revision: 2, updatedAt: serverTimestamp() }));
  t.diagnostic('These malformed shape writes target the authenticated UID; permission checks cannot mask validation failures.');
});

test('SEC-02 regression: null account is refused and the normalizer remains resilient', { skip: !enabled }, async t => {
  const db = dbFor('poison-self'); const s = Core.getEmptyState(); s.accounts = [null];
  await assertFails(setDoc(doc(db, 'flowUsers/poison-self'), personal(s)));
  assert.doesNotThrow(() => Core.normalizeState(s));
  assert.throws(() => require('../flow-backup.js').validate(s), /entrée invalide/);
  t.diagnostic('Malformed records are rejected at cloud and backup boundaries; the normalizer safely skips them.');
});

test('roles reject direct viewer edits, forged memberships, admin promotion and owner removal', { skip: !enabled }, async () => {
  const owner = await createSpace(); const viewer = dbFor('viewer'); const outsider = dbFor('outsider');
  await assertSucceeds(join(viewer, 'viewer', 'viewer', codes.viewer));
  await assertFails(updateDoc(doc(viewer, 'flowWorkspaces/audit-space/goals/summary'), { saved: 10, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(viewer, 'flowWorkspaces/audit-space/members/viewer'), { role: 'member' }));
  await assertFails(updateDoc(doc(viewer, 'flowWorkspaces/audit-space/members/viewer'), { role: 'admin' }));
  await assertFails(join(outsider, 'outsider', 'admin', codes.member));
  await assertFails(join(outsider, 'owner', 'member', codes.member));
  await assertFails(setDoc(doc(outsider, 'flowUsers/outsider/workspaces/audit-space'), { workspaceId: 'audit-space', role: 'admin', name: 'Forgery' }));
  await assertFails(deleteDoc(doc(owner, 'flowWorkspaces/audit-space/members/owner')));
  await assertFails(updateDoc(doc(owner, 'flowWorkspaces/audit-space/members/owner'), { role: 'viewer' }));
  await assertFails(setDoc(doc(owner, 'flowWorkspaces/audit-space/transactions/fictional'), { amount: 1 }));
  await assertFails(setDoc(doc(owner, 'flowWorkspaces/audit-space/recurring/fictional'), { amount: 1 }));
});

test('viewer cannot obtain private member invite from the roster or promote on rejoin', { skip: !enabled }, async t => {
  await createSpace(); const member = dbFor('member'); const viewer = dbFor('viewer');
  await assertSucceeds(join(member, 'member', 'member', codes.member));
  await assertSucceeds(join(viewer, 'viewer', 'viewer', codes.viewer));
  await assertFails(getDocs(collection(viewer, 'flowWorkspaces/audit-space/members')));
  const memberProfile = await assertSucceeds(getDoc(doc(viewer, 'flowWorkspaces/audit-space/members/member')));
  const leaked = memberProfile.data().inviteCode;
  assert.equal(leaked, undefined);
  await assertFails(getDoc(doc(viewer, 'flowUsers/member/joinProofs/audit-space')));
  await assertFails(getDocs(collection(viewer, 'flowUsers/member/joinProofs')));
  await assertFails(updateDoc(doc(viewer, 'flowWorkspaces/audit-space/goals/summary'), { saved: 10, updatedAt: serverTimestamp() }));
  const leave=writeBatch(viewer);leave.delete(doc(viewer,'flowWorkspaces/audit-space/members/viewer'));leave.update(doc(viewer,'flowWorkspaces/audit-space'),{memberIds:arrayRemove('viewer'),memberCount:increment(-1),updatedAt:serverTimestamp()});await assertSucceeds(leave.commit());
  await assertFails(join(viewer, 'viewer', 'member', codes.viewer));
  await assertSucceeds(join(viewer, 'viewer', 'viewer', codes.viewer));
  await assertFails(updateDoc(doc(viewer, 'flowWorkspaces/audit-space/goals/summary'), { saved: 10, updatedAt: serverTimestamp() }));
  assert.equal((await getDoc(doc(viewer, 'flowWorkspaces/audit-space/members/viewer'))).data().role, 'viewer');
  t.diagnostic('Roster has no invitation capability; private proofs reject cross-UID reads and forged role.');
});

test('invite expiry/revocation/list scopes work; knowledge of an active code is transferable', { skip: !enabled }, async () => {
  const owner = await createSpace(); const guest = dbFor('guest');
  await assertFails(setDoc(doc(owner, 'flowInvites/short'), liveInvite()));
  await assertFails(setDoc(doc(owner, 'flowInvites', codes.expired), { ...liveInvite(), expiresAt: Timestamp.fromMillis(1) }));
  await env.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), 'flowInvites', codes.expired), { ...liveInvite(), expiresAt: Timestamp.fromMillis(1) }));
  await assertFails(join(guest, 'guest', 'viewer', codes.expired));
  await assertSucceeds(setDoc(doc(owner, 'flowInvites', codes.revoked), liveInvite()));
  await assertSucceeds(deleteDoc(doc(owner, 'flowInvites', codes.revoked)));
  await assertFails(join(guest, 'guest', 'viewer', codes.revoked));
  await assertFails(getDocs(collection(guest, 'flowInvites')));
  await assertFails(getDocs(query(collection(guest, 'flowInvites'), where('workspaceId', '==', 'audit-space'))));
  await assertSucceeds(getDocs(query(collection(owner, 'flowInvites'), where('workspaceId', '==', 'audit-space'))));
  await assertSucceeds(getDoc(doc(guest, 'flowInvites', codes.member)));
  await assertSucceeds(join(guest, 'guest', 'member', codes.member));
});

test('legacy exposed invitations fail closed until cleanup and revocation; private proofs are bound to UID and workspace', { skip: !enabled }, async () => {
  const owner = await createSpace(), viewer = dbFor('viewer'), guest = dbFor('guest');
  await assertSucceeds(join(viewer, 'viewer', 'viewer', codes.viewer));
  await env.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'flowWorkspaces/audit-space/members/legacy'), { uid:'legacy',role:'member',inviteCode:codes.member,joinedAt:Timestamp.now() }));
  await assertFails(getDoc(doc(viewer, 'flowWorkspaces/audit-space/members/legacy')));
  await assertFails(getDocs(collection(viewer, 'flowWorkspaces/audit-space/members')));
  await assertFails(setDoc(doc(guest, 'flowUsers/guest/joinProofs/audit-space'), { uid:'viewer',workspaceId:'audit-space',role:'member',inviteCode:codes.member }));
  await assertFails(setDoc(doc(guest, 'flowUsers/guest/joinProofs/other-space'), { uid:'guest',workspaceId:'other-space',role:'member',inviteCode:codes.member }));
  await assertFails(setDoc(doc(guest, 'flowWorkspaces/audit-space/members/guest'), { uid:'guest',role:'member',inviteCode:codes.member,joinedAt:serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(owner, 'flowInvites', codes.member)));
  await assertSucceeds(updateDoc(doc(owner, 'flowWorkspaces/audit-space/members/legacy'), { inviteCode:deleteField() }));
  await assertFails(getDocs(collection(viewer, 'flowWorkspaces/audit-space/members')));
  await assertSucceeds(getDoc(doc(viewer, 'flowWorkspaces/audit-space/members/legacy')));
  await assertFails(join(guest, 'guest', 'member', codes.member));
});

test('SEC-02: malformed record entries are rejected at backup, normalizer and Firestore boundaries', { skip: !enabled }, async () => {
  for (const key of ['accounts','transactions','recurring','goals','reservations','notifications','reminders']) {
    const raw={...Core.getEmptyState(),[key]:[null]};
    assert.doesNotThrow(()=>Core.normalizeState(raw),`${key} normalization must not crash`);
    assert.throws(()=>require('../flow-backup.js').validate(raw),/entrée invalide/,`${key} backup must be rejected clearly`);
    const uid=`malformed-${key}`; const db=dbFor(uid);
    await assertFails(setDoc(doc(db,'flowUsers',uid),personal(raw)));
  }
});

test('SEC-03: workspace invite joins stop at 100 and a failed join cannot alter the counter', { skip: !enabled, timeout: 180000 }, async t => {
  const owner = await createSpace();
  for (let i = 0; i < 99; i++) { const uid = `capacity-${i}`; await assertSucceeds(join(dbFor(uid), uid, 'viewer', codes.viewer)); }
  const fullSpaceJoin = join(dbFor('capacity-overflow'), 'capacity-overflow', 'viewer', codes.viewer);
  await assertFails(fullSpaceJoin);
  const members = await getDocs(collection(owner, 'flowWorkspaces/audit-space/members'));
  assert.equal(members.size, 100); assert.equal((await getDoc(doc(owner, 'flowWorkspaces/audit-space'))).data().memberCount, 100);
  await assertFails(updateDoc(doc(owner,'flowWorkspaces/audit-space'),{memberCount:99,updatedAt:serverTimestamp()}));
  const leavingDb=dbFor('capacity-0'),departure=writeBatch(leavingDb);
  departure.delete(doc(leavingDb,'flowWorkspaces/audit-space/members/capacity-0'));
  departure.update(doc(leavingDb,'flowWorkspaces/audit-space'),{memberIds:arrayRemove('capacity-0'),memberCount:increment(-1),updatedAt:serverTimestamp()});
  await assertSucceeds(departure.commit());
  await assertFails(getDoc(doc(dbFor('capacity-0'),'flowWorkspaces/audit-space/goals/summary')));
  await assertSucceeds(join(dbFor('replacement'),'replacement','viewer',codes.viewer));
  assert.equal((await getDocs(collection(owner,'flowWorkspaces/audit-space/members'))).size,100);
  t.diagnostic('Exact roster + atomic membership prevent the 101st join and permit replacement after departure.');
});

test('legacy roster migration preserves every existing member, roles and summary', {skip:!enabled}, async()=>{
  const owner=await createSpace();
  await assertSucceeds(join(dbFor('old-viewer'),'old-viewer','viewer',codes.viewer));
  await env.withSecurityRulesDisabled(async ctx=>updateDoc(doc(ctx.firestore(),'flowWorkspaces/audit-space'),{memberIds:deleteField(),memberCount:67}));
  await assertSucceeds(getDoc(doc(dbFor('old-viewer'),'flowWorkspaces/audit-space/goals/summary')));
  await assertFails(join(dbFor('new-guest'),'new-guest','viewer',codes.viewer));
  await assertSucceeds(updateDoc(doc(owner,'flowWorkspaces/audit-space'),{memberIds:['owner','old-viewer'],memberCount:2,updatedAt:serverTimestamp()}));
  assert.equal((await getDoc(doc(dbFor('old-viewer'),'flowWorkspaces/audit-space/members/old-viewer'))).data().role,'viewer');
  assert.equal((await getDoc(doc(dbFor('old-viewer'),'flowWorkspaces/audit-space/goals/summary'))).data().target,100);
  await assertSucceeds(join(dbFor('new-guest'),'new-guest','viewer',codes.viewer));
});

test('grandfathered legacy spaces keep 101 existing members but cannot admit another', {skip:!enabled},async()=>{
  const owner=await createSpace(),ids=['owner',...Array.from({length:100},(_,i)=>`legacy-${i}`)];
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore(),batch=writeBatch(db);
    batch.update(doc(db,'flowWorkspaces/audit-space'),{memberIds:deleteField(),memberCount:1});
    for(const uid of ids.slice(1))batch.set(doc(db,'flowWorkspaces/audit-space/members',uid),{uid,role:'viewer',joinedAt:Timestamp.now()});
    await batch.commit();
  });
  await assertSucceeds(updateDoc(doc(owner,'flowWorkspaces/audit-space'),{memberIds:ids,memberCount:101,updatedAt:serverTimestamp()}));
  for(const uid of [ids[1],ids[100]])await assertSucceeds(getDoc(doc(dbFor(uid),'flowWorkspaces/audit-space/goals/summary')));
  await assertFails(join(dbFor('overflow'),'overflow','viewer',codes.viewer));
  assert.equal((await getDocs(collection(owner,'flowWorkspaces/audit-space/members'))).size,101);
});
