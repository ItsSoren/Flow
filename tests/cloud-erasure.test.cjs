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
    deleteDoc: async uid => calls.push('delete:' + uid), clearQueue: () => calls.push('clear-queue'),
    localStorage: { removeItem: key => calls.push('remove:' + key) },
    window: { FlowApp: { getStorageKey: () => 'personal:test-user', getEmptyState: () => ({ accounts: [] }), applyRemoteState: () => calls.push('empty') } }
  });
  vm.runInContext(eraseSource, context);
  return { context, calls, settle };
}

test('personal deletion waits for an in-flight sync before deleting; preserves shared indexes', async () => {
  const h = harness();
  const deletion = h.context.erasePersonalFlowData();
  assert.equal(h.context.erasingUid, 'test-user');
  assert.deepEqual(h.calls, [], 'no deletion until the submitted write settles');
  await h.context.erasePersonalFlowData();
  assert.deepEqual(h.calls, [], 'double click does not start another deletion');
  h.calls.push('write-settled'); h.settle(); await deletion;
  assert.deepEqual(h.calls, ['write-settled', 'delete:test-user', 'clear-queue', 'remove:conflict:test-user', 'empty', 'remove:personal:test-user']);
  assert.equal(h.context.erasingUid, null);
  assert.equal(h.context.knownRevision, 0);
});

test('switching accounts while awaiting sync cannot delete or clear the new account', async () => {
  const h = harness(); const deletion = h.context.erasePersonalFlowData();
  h.context.user = { uid: 'another-user' }; h.settle(); await deletion;
  assert.deepEqual(h.calls, []);
  assert.equal(h.context.erasingUid, null);
});
