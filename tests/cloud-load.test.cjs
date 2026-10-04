'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../flow-core.js');
const source = fs.readFileSync(require.resolve('../flow-cloud.js'), 'utf8');
const loader = source.slice(source.indexOf('async function loadForUser('), source.indexOf('async function submitAuth('));
const legacy = {version:4.2,activeAccountId:'main',accounts:[{id:'main',name:'Compte principal',initialBalance:1000,createdAt:1},{id:'savings',name:'Épargne',initialBalance:0,createdAt:1}],transactions:[{id:'saved',type:'income',amount:200,label:'Épargne',category:'autre',date:'2026-09-01',accountId:'savings'}],recurring:[],goals:[],settings:{mode:'dark',palette:'flow'},migratedFrom:null};

async function harness(remote, local = Core.normalizeState(remote.personalState), pending = null) {
  const { canonicalStateKey } = await import('../flow-sync-core.mjs');
  const calls = {conflicts:0,flushes:0,clears:0,applies:0};
  const context = vm.createContext({
    user:{uid:'test-only'},activeUid:null,knownRevision:0,erasingUid:null,
    window:{FlowApp:{activateUser:async()=>{},applyRemoteState:s=>{local=Core.normalizeState(s);calls.applies++;},getEmptyState:()=>Core.getEmptyState()}},
    getDoc:async()=>({exists:()=>Boolean(remote),data:()=>remote}),stateRef:uid=>uid,
    currentQueue:()=>pending,localState:()=>local,useful:()=>true,
    displayConflict:()=>{calls.conflicts++;},clearQueue:()=>{pending=null;calls.clears++;},
    flushQueue:()=>{calls.flushes++;},status:()=>{},unsubscribe:null,onSnapshot:()=>()=>{},navigator:{onLine:true},
    serialize:state=>canonicalStateKey(state,Core.normalizeState)
  });
  vm.runInContext(loader, context);
  return {context,calls,state:()=>local};
}

test('reloading normalized V5 data against an unchanged V4 cloud document never prompts', async () => {
  const h = await harness({personalState:legacy});
  await h.context.loadForUser(); await h.context.loadForUser();
  assert.equal(h.calls.conflicts,0); assert.equal(h.calls.flushes,0);
  assert.equal(Core.getAccountBalance(h.state(),'main'),1000);
  assert.equal(Core.getAccountBalance(h.state(),'savings'),200);
});

test('Firestore property reordering does not cause a login conflict', async () => {
  const sort = x => Array.isArray(x) ? x.map(sort) : x && typeof x==='object' ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])) : x;
  const local=Core.normalizeState(legacy), h=await harness({personalState:sort(local),revision:3},local);
  await h.context.loadForUser(); assert.equal(h.calls.conflicts,0);
});

test('a genuine local/cloud difference still requires a decision, never overwrites automatically', async () => {
  const local=Core.normalizeState(legacy); local.accounts[0].openingBalance=999;
  const h=await harness({personalState:legacy,revision:3},local);
  await h.context.loadForUser(); assert.equal(h.calls.conflicts,1); assert.equal(h.calls.flushes,0); assert.equal(h.calls.applies,0);
});

test('same-revision queued offline edits resume without a false conflict', async () => {
  const changed=Core.normalizeState(legacy);changed.accounts[0].openingBalance=995;
  const h=await harness({personalState:legacy,revision:3},Core.normalizeState(legacy),{state:changed,baseRevision:3,generation:1});
  await h.context.loadForUser(); assert.equal(h.calls.conflicts,0); assert.equal(h.calls.flushes,1);
  assert.equal(Core.getAccountBalance(h.state(),'main'),995);
});

test('stale-revision offline edits still require a conflict decision', async () => {
  const changed=Core.normalizeState(legacy); changed.accounts[0].openingBalance=995;
  const h=await harness({personalState:legacy,revision:4},changed,{state:changed,baseRevision:3,generation:1});
  await h.context.loadForUser(); assert.equal(h.calls.conflicts,1);assert.equal(h.calls.flushes,0);
});

test('a semantically committed queue is cleared and the local cache is refreshed', async () => {
  const h=await harness({personalState:legacy,revision:4},Core.getEmptyState(),{state:Core.normalizeState(legacy),baseRevision:3,generation:1});
  await h.context.loadForUser();assert.equal(h.calls.conflicts,0);assert.equal(h.calls.clears,1);assert.equal(h.calls.applies,1);
  assert.equal(Core.getAccountBalance(h.state(),'main'),1000);
});
