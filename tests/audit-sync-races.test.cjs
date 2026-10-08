'use strict';
// Deterministic interleavings of the actual queue/flush functions. No network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../flow-core.js');
const source = fs.readFileSync(require.resolve('../flow-cloud.js'), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
async function harness(uid) {
  const helpers = await import('../flow-sync-core.mjs');
  const store = new Map(), commits = [], timers = [], messages = [];
  const ctx = vm.createContext({
    user: { uid }, activeUid: uid, knownRevision: 0, flushing: false,
    erasingUid: null, syncIdle: null, retryDelay: 1500, retryTimer: 0, writeTimer: 0,
    navigator: { onLine: true }, MAX_STATE_BYTES: 850000, TextEncoder,
    window: { FlowCore: Core }, canonicalStateKey: helpers.canonicalStateKey,
    queueKey: helpers.queueKeyForUser, conflictKey: helpers.conflictKeyForUser,
    reconcileCommittedQueue: helpers.reconcileCommittedQueue,
    shouldFlushAfterCommit: helpers.shouldFlushAfterCommit,
    localStorage: { getItem: k => store.get(k) || null, setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k) },
    db: {}, stateRef: value => value, serverTimestamp: () => 'test-only-server-time',
    status: value => messages.push(value), console: { warn() {} },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {},
    runTransaction: (_db, callback) => new Promise((resolve, reject) => commits.push({ callback, resolve, reject })),
    displayConflict: () => { throw new Error('Unexpected conflict in same-device interleaving'); }
  });
  vm.runInContext(slice('function serialize(', 'function queueLocalState()') + '\n' + slice('async function flushQueue()', 'async function loadForUser('), ctx);
  async function complete(index, remoteRevision, remoteState = null) {
    let written = null;
    const job = commits[index];
    const result = await job.callback({
      get: async () => ({ exists: () => remoteRevision > 0, data: () => ({ revision: remoteRevision, personalState: remoteState }) }),
      set: (ref, value) => { assert.equal(ref, uid); written = value; }
    });
    job.resolve(result); return written;
  }
  return { ctx, store, commits, timers, messages, complete };
}
function stateFor(uid, count) {
  const state = Core.getEmptyState();
  state.transactions = Array.from({length:count}, (_,i)=>({id:`${uid}-${i}`,type:'expense',amount:i+0.01,label:`Fictitious ${i}`,accountId:'main',category:'autre',date:'2026-10-07'}));
  return Core.normalizeState(state);
}
test('100 delayed commits retain edits made during upload and flush the final generation', async t => {
  let edits = 0;
  for(let i=0;i<100;i++) {
    const uid=`sync-audit-${i}`, h=await harness(uid), initial=stateFor(uid,1), count=2+i%8;
    assert(h.ctx.saveQueue(initial)); const flight=h.ctx.flushQueue();
    for(let size=2;size<=count;size++){assert(h.ctx.saveQueue(stateFor(uid,size)));edits++;}
    const first=await h.complete(0,0); await flight;
    assert.equal(first.personalState.transactions.length,1);
    assert.equal(h.ctx.currentQueue().state.transactions.length,count);
    assert.equal(h.ctx.currentQueue().baseRevision,1);
    assert(h.timers.some(timer=>timer.delay===0),'new generation is scheduled');
    const next=h.ctx.flushQueue(); const second=await h.complete(1,1,initial); await next;
    assert.equal(second.personalState.transactions.length,count);
    assert.equal(second.revision,2); assert.equal(h.ctx.currentQueue(),null);
  }
  t.diagnostic(`100 synthetic queues, ${edits} edits during upload, 200 controlled commits; actual source functions, simulated transport.`);
});
test('100 failed/offline uploads retain durable state and commit once when connectivity returns', async t => {
  for(let i=0;i<100;i++){
    const uid=`offline-audit-${i}`, h=await harness(uid), state=stateFor(uid,1+i%7);
    assert(h.ctx.saveQueue(state)); h.ctx.navigator.onLine=false;
    await h.ctx.flushQueue(); assert.equal(h.commits.length,0);
    h.ctx.navigator.onLine=true; const attempt=h.ctx.flushQueue();
    h.commits[0].reject({code:'unavailable'}); await attempt;
    assert.equal(h.ctx.currentQueue().state.transactions.length,state.transactions.length);
    assert.equal(h.ctx.knownRevision,0); assert(h.timers.some(timer=>timer.delay===1500));
    const retry=h.ctx.flushQueue(); const written=await h.complete(1,0); await retry;
    assert.equal(written.personalState.transactions.length,state.transactions.length);
    assert.equal(written.revision,1); assert.equal(h.ctx.currentQueue(),null);
  }
  t.diagnostic('100 synthetic offline/retry profiles; no production or emulator connection.');
});
