'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../flow-cloud.js'), 'utf8');
const eraseSource = source.slice(source.indexOf('async function erasePersonalFlowData()'), source.indexOf('\nfunction randomCode('));

function harness() {
  let settle;
  const calls = [];
  const context = vm.createContext({
    user: { uid: 'test-user' }, erasingUid: null, writeTimer: 1, retryTimer: 2, knownRevision: 7,
    syncIdle: new Promise(resolve => { settle = resolve; }),
    confirm: () => true, clearTimeout: () => {}, status: () => {}, console,
    stateRef: uid => uid, conflictKey: uid => 'conflict:' + uid,
    db: {}, serverTimestamp: () => 'server-time',
    runTransaction: async (_db, callback) => callback({
      get: async () => ({ exists: () => true, data: () => ({ revision: 7 }) }),
      set: (uid, data) => { calls.push('erase:' + uid); assert.equal(data.revision, 8); assert.deepEqual(Object.keys(data.personalState), ['accounts']); }
    }),
    clearQueue: () => calls.push('clear-queue'),
    localStorage: { removeItem: key => calls.push('remove:' + key) },
    window: { FlowApp: { getStorageKey: () => 'personal:test-user', getEmptyState: () => ({ accounts: [] }), applyRemoteState: () => calls.push('empty') } }
  });
  vm.runInContext(eraseSource, context);
  return { context, calls, settle };
}

test('personal erasure waits for an in-flight sync, keeps a revision barrier and preserves shared indexes', async () => {
  const h = harness();
  const deletion = h.context.erasePersonalFlowData();
  assert.equal(h.context.erasingUid, 'test-user');
  assert.deepEqual(h.calls, [], 'no deletion until the submitted write settles');
  await h.context.erasePersonalFlowData();
  assert.deepEqual(h.calls, [], 'double click does not start another deletion');
  h.calls.push('write-settled'); h.settle(); await deletion;
  assert.deepEqual(h.calls, ['write-settled', 'erase:test-user', 'clear-queue', 'remove:conflict:test-user', 'empty', 'remove:personal:test-user']);
  assert.equal(h.context.erasingUid, null);
  assert.equal(h.context.knownRevision, 8);
});

test('switching accounts while awaiting sync cannot delete or clear the new account', async () => {
  const h = harness(); const deletion = h.context.erasePersonalFlowData();
  h.context.user = { uid: 'another-user' }; h.settle(); await deletion;
  assert.deepEqual(h.calls, []);
  assert.equal(h.context.erasingUid, null);
});

test('new local edits keep the pending base revision after a newer remote snapshot', () => {
  let record = { state: { value: 'old edit' }, baseRevision: 3, generation: 2 };
  const context = vm.createContext({
    user: { uid: 'alice' }, knownRevision: 5, MAX_STATE_BYTES: 850000, TextEncoder,
    serialize: JSON.stringify, currentQueue: () => record, queueKey: uid => uid,
    status: () => {}, localStorage: { setItem: (_key, value) => { record = JSON.parse(value); } }
  });
  vm.runInContext(source.slice(source.indexOf('function saveQueue('), source.indexOf('function clearQueue(')), context);
  assert.equal(context.saveQueue({ value: 'new edit' }), true);
  assert.equal(record.baseRevision, 3, 'remote revision does not silently authorize an overwrite');
  assert.equal(record.generation, 3);
  context.saveQueue({ value: 'explicit choice' }, 5);
  assert.equal(record.baseRevision, 5, 'an explicit conflict choice can rebase');
});

test('an absent remote document does not silently upload an old device cache', async () => {
  let conflict; let writes = 0;
  const local = { accounts: [{ openingBalance: 1000 }] };
  const empty = { accounts: [{ openingBalance: 0 }] };
  const context = vm.createContext({
    user: { uid: 'alice' }, activeUid: null, knownRevision: 9, erasingUid: null,
    window: { FlowApp: { activateUser: async () => {}, getEmptyState: () => empty } },
    getDoc: async () => ({ exists: () => false }), stateRef: uid => uid,
    currentQueue: () => ({ state: local, baseRevision: 9 }), localState: () => local,
    useful: () => true, displayConflict: value => { conflict = value; },
    saveQueue: () => { writes++; }, flushQueue: () => { writes++; },
    unsubscribe: null, onSnapshot: () => () => {}, serialize: JSON.stringify
  });
  vm.runInContext(source.slice(source.indexOf('async function loadForUser('), source.indexOf('async function submitAuth(')), context);
  await context.loadForUser();
  assert.equal(writes, 0); assert.equal(conflict.remoteState, empty); assert.equal(conflict.revision, 0);
});
