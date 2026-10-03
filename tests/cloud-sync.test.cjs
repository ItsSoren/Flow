const { test } = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../flow-sync-core.mjs');

test('an edit made while an earlier generation is committing is rebased and flushed', () => {
  return helpers.then(({ reconcileCommittedQueue, shouldFlushAfterCommit }) => {
  const first = { state: { balance: 1 }, baseRevision: 4, generation: 8 };
  const newer = { state: { balance: 2 }, baseRevision: 4, generation: 9 };
  const reconciled = reconcileCommittedQueue(first, newer, 5);
  assert.equal(reconciled.action, 'rebase');
  assert.deepEqual(reconciled.queue, { ...newer, baseRevision: 5 });
  assert.equal(shouldFlushAfterCommit(first, reconciled.queue, 5), true);
  });
});

test('identical queued state is cleared; a queue based on another revision is preserved', () => {
  return helpers.then(({ reconcileCommittedQueue, shouldFlushAfterCommit }) => {
  const first = { state: { x: 1 }, baseRevision: 2, generation: 1 };
  assert.equal(reconcileCommittedQueue(first, { ...first }, 3).action, 'clear');
  const competing = { state: { x: 2 }, baseRevision: 8, generation: 2 };
  assert.deepEqual(reconcileCommittedQueue(first, competing, 3), { action: 'keep', queue: competing });
  assert.equal(shouldFlushAfterCommit(first, competing, 3), false);
  });
});

test('local queue, conflict copies, and application data are isolated by Firebase UID', () => {
  return helpers.then(({ queueKeyForUser, conflictKeyForUser, userStorageKey }) => {
  assert.notEqual(queueKeyForUser('alice'), queueKeyForUser('bob'));
  assert.notEqual(conflictKeyForUser('alice'), conflictKeyForUser('bob'));
  assert.notEqual(userStorageKey('flow_v5', 'alice'), userStorageKey('flow_v5', 'bob'));
  assert.equal(userStorageKey('flow_v5', null), 'flow_v5:local');
  });
});
