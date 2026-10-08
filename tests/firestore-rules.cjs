const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const {
  initializeTestEnvironment, assertSucceeds, assertFails
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, limit, serverTimestamp, writeBatch, Timestamp, increment, arrayUnion, arrayRemove } = require('firebase/firestore');
const FlowCore = require('../flow-core.js');

const projectId = 'demo-flow-v5';
let environment;
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

before(async () => {
  if (!emulatorAvailable) return;
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
});
after(async () => environment?.cleanup());
beforeEach(async () => { if (environment) await environment.clearFirestore(); });

function personalDocument(state = FlowCore.getEmptyState(), revision = 1) {
  return { personalState: state, revision, schemaVersion: 1, updatedAt: serverTimestamp() };
}

test('Flow personal sync requires its own signed-in UID and accepts sequential revisions', { skip: !emulatorAvailable }, async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  const ref = doc(alice, 'flowUsers/alice');
  await assertSucceeds(setDoc(ref, personalDocument()));
  await assertSucceeds(updateDoc(ref, { revision: 2, updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(bob, 'flowUsers/alice')));
  await assertFails(setDoc(doc(bob, 'flowUsers/alice'), personalDocument()));
});

test('Flow sync rejects revision jumps and oversized or unexpected state shapes', { skip: !emulatorAvailable }, async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const ref = doc(alice, 'flowUsers/alice');
  await assertSucceeds(setDoc(ref, personalDocument()));
  await assertFails(updateDoc(ref, { revision: 3, updatedAt: serverTimestamp() }));
  const oversized = FlowCore.getEmptyState();
  oversized.transactions = Array.from({ length: 5001 }, (_, id) => ({ id }));
  await assertFails(setDoc(ref, personalDocument(oversized, 2)));
  const unexpected = { ...FlowCore.getEmptyState(), injected: '<script>alert(1)</script>' };
  await assertFails(setDoc(ref, personalDocument(unexpected, 2)));
});

test('Flow collections do not grant access to another user or Sōlo records', { skip: !emulatorAvailable }, async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await environment.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await setDoc(doc(admin, 'users/bob'), { private: true });
    await setDoc(doc(admin, 'flowWorkspaces/private-space/members/bob'), { uid: 'bob', role: 'admin' });
  });
  await assertFails(getDoc(doc(alice, 'users/bob')));
  await assertFails(getDoc(doc(alice, 'flowWorkspaces/private-space')));
});

test('Flow rules leave the same-user Sōlo namespace operational', { skip: !emulatorAvailable }, async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), { displayName: 'Alice' }));
});

test('first V5 save can migrate the legacy Flow document and removes legacy fields', { skip: !emulatorAvailable }, async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const ref = doc(alice, 'flowUsers/alice');
  const legacy = { personalState: FlowCore.getEmptyState(), clientUpdatedAt: '2026-01-01T00:00:00.000Z', schemaVersion: 4 };
  await environment.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'flowUsers/alice'), legacy));
  await assertSucceeds(setDoc(ref, personalDocument(legacy.personalState, 1)));
  const result = await getDoc(ref);
  if (result.exists()) {
    assert.equal(result.data().revision, 1);
    assert.equal('clientUpdatedAt' in result.data(), false);
  }
});

test('Flow owner can create a scoped shared space and invite a read-only member', { skip: !emulatorAvailable }, async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  const guest = environment.authenticatedContext('guest').firestore();
  const workspaceId = 'flow-workspace-random-123456';
  const inviteCode = 'abcdefghijklmnopqrstuvwxyzABCDEF';
  const batch = writeBatch(owner);
  batch.set(doc(owner, `flowWorkspaces/${workspaceId}`), { ownerId: 'owner', name: 'Trip', kind: 'project', memberCount: 1, memberIds:['owner'], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(owner, `flowWorkspaces/${workspaceId}/members/owner`), { uid: 'owner', role: 'admin', joinedAt: serverTimestamp() });
  batch.set(doc(owner, `flowUsers/owner/workspaces/${workspaceId}`), { workspaceId, role: 'admin', name: 'Trip' });
  await assertSucceeds(batch.commit());
  await assertSucceeds(setDoc(doc(owner, `flowWorkspaces/${workspaceId}/goals/summary`), { title: 'Trip', kind: 'project', target: 500, saved: 0, ownerId: 'owner', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(owner, `flowInvites/${inviteCode}`), { workspaceId, role: 'viewer', createdBy: 'owner', expiresAt: Timestamp.fromDate(new Date(Date.now() + 3600000)) }));
  const join = writeBatch(guest);
  join.update(doc(guest, `flowWorkspaces/${workspaceId}`), { memberCount: increment(1), memberIds:arrayUnion('guest'), updatedAt: serverTimestamp() });
  join.set(doc(guest, `flowUsers/guest/joinProofs/${workspaceId}`), { uid: 'guest', workspaceId, role: 'viewer', inviteCode });
  join.set(doc(guest, `flowWorkspaces/${workspaceId}/members/guest`), { uid: 'guest', role: 'viewer', joinedAt: serverTimestamp() });
  join.set(doc(guest, `flowUsers/guest/workspaces/${workspaceId}`), { workspaceId, role: 'viewer', name: 'Trip' });
  await assertSucceeds(join.commit());
  await assertSucceeds(getDoc(doc(guest, `flowWorkspaces/${workspaceId}/goals/summary`)));
  await assertFails(updateDoc(doc(guest, `flowWorkspaces/${workspaceId}/goals/summary`), { target: 1000 }));
  await assertFails(updateDoc(doc(guest, `flowWorkspaces/${workspaceId}/goals/summary`), { saved: 100, updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(guest, 'flowUsers/owner')));
});

test('Flow sharing roles, scoped invite listing, removal and code revocation enforce real membership', { skip: !emulatorAvailable }, async () => {
  const owner = environment.authenticatedContext('owner').firestore();
  const guest = environment.authenticatedContext('guest').firestore();
  const outsider = environment.authenticatedContext('outsider').firestore();
  const workspaceId = 'managed-space'; const code = 'abcdefghijklmnopqrstuvwxyzABCDEF';
  const base = `flowWorkspaces/${workspaceId}`;
  const batch = writeBatch(owner);
  batch.set(doc(owner, base), { ownerId: 'owner', name: 'Shared', kind: 'project', memberCount: 1, memberIds:['owner'], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(owner, `${base}/members/owner`), { uid: 'owner', role: 'admin', joinedAt: serverTimestamp() });
  batch.set(doc(owner, `flowUsers/owner/workspaces/${workspaceId}`), { workspaceId, role: 'admin', name: 'Shared' });
  await assertSucceeds(batch.commit());
  const invitation = { workspaceId, role: 'viewer', createdBy: 'owner', expiresAt: Timestamp.fromDate(new Date(Date.now() + 3600000)) };
  await assertSucceeds(setDoc(doc(owner, 'flowInvites', code), invitation));
  await assertFails(setDoc(doc(owner, 'flowInvites', code + 'bad'), { ...invitation, expiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 86400000)) }));
  await assertSucceeds(getDocs(query(collection(owner, 'flowInvites'), where('workspaceId', '==', workspaceId), limit(25))));
  await assertFails(getDocs(collection(owner, 'flowInvites')));
  await assertFails(getDocs(query(collection(guest, 'flowInvites'), where('workspaceId', '==', workspaceId), limit(25))));
  await assertFails(setDoc(doc(outsider, `flowUsers/outsider/workspaces/${workspaceId}`), { workspaceId, role: 'admin', name: 'Forged' }));
  const join = writeBatch(guest);
  join.update(doc(guest, base), { memberCount: increment(1), memberIds:arrayUnion('guest'), updatedAt: serverTimestamp() });
  join.set(doc(guest, `flowUsers/guest/joinProofs/${workspaceId}`), { uid: 'guest', workspaceId, role: 'viewer', inviteCode: code });
  join.set(doc(guest, `${base}/members/guest`), { uid: 'guest', role: 'viewer', joinedAt: serverTimestamp() });
  join.set(doc(guest, `flowUsers/guest/workspaces/${workspaceId}`), { workspaceId, role: 'viewer', name: 'Shared' });
  await assertSucceeds(join.commit());
  await assertFails(updateDoc(doc(guest, `${base}/members/guest`), { role: 'admin' }));
  await assertFails(updateDoc(doc(owner, `${base}/members/owner`), { role: 'viewer' }));
  await assertFails(updateDoc(doc(owner, `${base}/members/guest`), { uid: 'owner', role: 'member' }));
  await assertSucceeds(updateDoc(doc(owner, `${base}/members/guest`), { role: 'member' }));
  await assertFails(deleteDoc(doc(outsider, `flowUsers/guest/workspaces/${workspaceId}`)));
  await assertSucceeds(deleteDoc(doc(owner, 'flowInvites', code)));
  const remove = writeBatch(owner);
  remove.update(doc(owner,base),{memberCount:increment(-1),memberIds:arrayRemove('guest'),updatedAt:serverTimestamp()});
  remove.delete(doc(owner, `${base}/members/guest`)); remove.delete(doc(owner, `flowUsers/guest/workspaces/${workspaceId}`));
  await assertSucceeds(remove.commit());
  await assertFails(getDoc(doc(guest, base)));
  await assertFails(setDoc(doc(guest, `${base}/members/guest`), { uid: 'guest', role: 'viewer', inviteCode: code, joinedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(owner, `${base}/members/owner`)));
});

test('Flow erasure advances revision so an old offline state cannot restore without conflict', { skip: !emulatorAvailable }, async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const ref = doc(alice, 'flowUsers/alice');
  const old = FlowCore.getEmptyState(); old.accounts[0].openingBalance = 1000;
  await assertSucceeds(setDoc(ref, personalDocument(old, 1)));
  await assertSucceeds(setDoc(ref, personalDocument(FlowCore.getEmptyState(), 2)));
  await assertFails(setDoc(ref, personalDocument(old, 2)));
  assert.equal((await getDoc(ref)).data().personalState.accounts[0].openingBalance, 0);
});
