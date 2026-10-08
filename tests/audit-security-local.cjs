'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');
const Core = require('../flow-core.js');
const Backup = require('../flow-backup.js');
const CSV = require('../bank-import.js');
const cloud = fs.readFileSync(require.resolve('../flow-cloud.js'), 'utf8');
const extract = (a, b) => cloud.slice(cloud.indexOf(a), cloud.indexOf(b));

test('100 UID queue/conflict namespaces stay independent while switching actual queue functions', async () => {
  const helpers = await import('../flow-sync-core.mjs'); const store = new Map();
  const ctx = vm.createContext({ user: null, knownRevision: 0, queueKey: helpers.queueKeyForUser, conflictKey: helpers.conflictKeyForUser,
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    serialize: helpers.canonicalStateKey, TextEncoder, MAX_STATE_BYTES: 850000, status: () => {} });
  vm.runInContext(extract('function currentQueue()', 'function queueLocalState()'), ctx);
  for (let i = 0; i < 100; i++) { ctx.user = { uid: `user-${i}` }; assert.equal(ctx.saveQueue({ marker: `private-${i}` }, i), true); ctx.saveConflictCopy({ marker: `conflict-${i}` }); }
  for (let i = 99; i >= 0; i--) {
    ctx.user = { uid: `user-${i}` }; assert.equal(ctx.currentQueue().state.marker, `private-${i}`);
    assert.equal(JSON.parse(store.get(helpers.conflictKeyForUser(ctx.user.uid)))[0].state.marker, `conflict-${i}`);
    ctx.clearQueue(); assert.equal(ctx.currentQueue(), null);
  }
  ctx.user = null; assert.equal(ctx.currentQueue(), null); assert.equal(ctx.saveQueue({ marker: 'guest' }), false);
});

test('in-flight Alice commit after switch cannot clear Bob queue or update Bob status', async () => {
  const helpers = await import('../flow-sync-core.mjs'); let resolveCommit; const messages = []; let clears = 0;
  const pending = { state: { marker: 'alice' }, generation: 1, baseRevision: 0 };
  const ctx = vm.createContext({ user: { uid: 'alice' }, flushing: false, erasingUid: null, navigator: { onLine: true },
    currentQueue: () => pending, db: {}, runTransaction: () => new Promise(resolve => { resolveCommit = resolve; }),
    syncIdle: null, knownRevision: 0, status: m => messages.push(m), clearQueue: () => { clears++; },
    reconcileCommittedQueue: helpers.reconcileCommittedQueue, shouldFlushAfterCommit: helpers.shouldFlushAfterCommit,
    setTimeout: () => 0, clearTimeout: () => {}, console });
  vm.runInContext(extract('async function flushQueue()', 'async function loadForUser('), ctx);
  const work = ctx.flushQueue(); ctx.user = { uid: 'bob' }; resolveCommit({ revision: 1 }); await work;
  assert.equal(clears, 0); assert.equal(messages.length, 0); assert.equal(ctx.knownRevision, 0);
});

test('late Alice snapshot after account change cannot apply Alice state to Bob', async () => {
  let resolveRead; let signalRead; let applied = 0; const readStarted = new Promise(resolve => { signalRead = resolve; });
  const ctx = vm.createContext({ user: { uid: 'alice' }, activeUid: null,
    window: { FlowApp: { activateUser: async () => {}, applyRemoteState: () => { applied++; } } },
    stateRef: uid => uid, getDoc: () => new Promise(resolve => { resolveRead = resolve; signalRead(); }) });
  vm.runInContext(extract('async function loadForUser(', 'async function submitAuth('), ctx);
  const work = ctx.loadForUser(); await readStarted; ctx.user = { uid: 'bob' };
  resolveRead({ exists: () => true, data: () => ({ personalState: { marker: 'alice' }, revision: 1 }) }); await work;
  assert.equal(applied, 0);
});

test('SEC-02 regression: backup rejects null records and normalization does not crash', () => {
  for (const field of ['accounts', 'transactions', 'recurring', 'goals', 'reservations', 'notifications', 'reminders']) {
    const s = Core.getEmptyState(); s[field] = [null];
    assert.throws(() => Backup.parse(JSON.stringify(s)), /entrée invalide/, `${field} null backup rejected`);
    assert.doesNotThrow(() => Core.normalizeState(s), `${field} normalization resilient`);
  }
  assert.equal({}.polluted, undefined);
  Core.normalizeState(Backup.parse('{"accounts":[{"id":"main"}],"__proto__":{"polluted":true}}'));
  assert.equal({}.polluted, undefined);
});

test('bounded backup decompression, UTF8, code and CSV attacks are rejected', async () => {
  const bomb = zlib.gzipSync(Buffer.from('x'.repeat(Backup.MAX_BYTES + 1)));
  await assert.rejects(Backup.readCode('FLOW50G-' + bomb.toString('base64url')), /volumineuse/);
  await assert.rejects(Backup.readCode('FLOW50J-' + Buffer.from([0xc0, 0xaf]).toString('base64url')));
  assert.throws(() => Backup.parse('{"accounts":[],"version":99}'));
  assert.throws(() => CSV.parseCSV('Date;Label;Amount\n"unterminated;1'));
  assert.throws(() => CSV.parseCSV('x'.repeat(2 * 1024 * 1024 + 1)), /volumineux/);
  for (const payload of ['=WEBSERVICE("https://invalid.example")', '+cmd|x', '<img src=x onerror=alert(1)>', 'NaN', 'Infinity', '1e300']) assert.equal(CSV.parseAmount(payload), null);
});
