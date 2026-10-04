const { test } = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../flow-sync-core.mjs');
const Core = require('../flow-core.js');

test('canonical comparisons ignore map key order and a V4/V5 representation change, not money changes', async () => {
  const { canonicalStateKey } = await helpers;
  const legacy = {version:4.2,accounts:[{id:'main',name:'Courant',initialBalance:1000,createdAt:1}],transactions:[],recurring:[],goals:[],settings:{mode:'dark',palette:'flow'}};
  const current = Core.normalizeState(legacy);
  const key = value => canonicalStateKey(value, Core.normalizeState);
  assert.equal(key(legacy), key(current));
  assert.equal(canonicalStateKey({b:{y:2,x:1},a:[1,2]}), canonicalStateKey({a:[1,2],b:{x:1,y:2}}));
  const changed = structuredClone(current); changed.accounts[0].openingBalance = 999;
  assert.notEqual(key(current), key(changed), 'a real balance change is still a conflict');
  assert.notEqual(canonicalStateKey({list:[1,2]}), canonicalStateKey({list:[2,1]}), 'array order is preserved');
});

test('V5 preserves the V4 opening-balance alias on normalization and prioritizes the V5 value', () => {
  const state = Core.normalizeState({accounts:[{id:'main',openingBalance:1000,initialBalance:0,createdAt:1}],transactions:[]});
  assert.equal(state.accounts[0].openingBalance, 1000);
  assert.equal(state.accounts[0].initialBalance, 1000);
  assert.equal(Core.getAccountBalance(state, 'main'), 1000);
});

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
