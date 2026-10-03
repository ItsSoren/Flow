'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const PWA = require('../flow-pwa.js');
test('reminders only export identifiers, kinds and dates, never financial labels', () => {
  const state = { settings: { payday: 31 }, recurring: [{ id: 'r1', label: 'PRIVATE', amount: 888, type: 'expense', frequency: 'monthly', nextDate: '2026-01-31' }], reminders: [{ id: 'custom1', title: 'PRIVATE2', date: '2026-03-03' }], reservations: [{ id: 'pending1', status: 'pending', confirmAt: new Date('2026-02-01T12:05:00').getTime() }] };
  const items = PWA.buildReminders(state, { payday: true, bill: true, goal: true, custom: true }, new Date('2026-02-01T12:00:00'));
  assert(items.some(item => item.kind === 'goal'));
  assert(items.some(item => item.id.startsWith('bill-r1-2026-2-28')));
  assert(items.some(item => item.id.startsWith('bill-r1-2026-3-31')));
  assert(!JSON.stringify(items).includes('PRIVATE'));
  assert(!JSON.stringify(items).includes('888'));
  assert(items.every(item => Object.keys(item).sort().join() === 'at,id,kind'));
});
test('filters, completed reminders and horizon bounds', () => {
  const state = { settings: { payday: 1 }, recurring: [], reservations: [], reminders: [{ id: 'x', done: true, date: '2026-02-04' }] };
  assert.deepEqual(PWA.buildReminders(state, {}, new Date('2026-02-01')), []);
  assert.equal(PWA.buildReminders(state, { custom: true }, new Date('2026-02-01')).length, 0);
});
test('push configuration refuses non-HTTPS or credentialed endpoints', () => {
  const key = 'A'.repeat(87);
  assert(PWA.validConfig({ endpoint: 'https://example.workers.dev', vapidPublicKey: key }));
  assert(!PWA.validConfig({ endpoint: 'http://example.com', vapidPublicKey: key }));
  assert(!PWA.validConfig({ endpoint: 'https://user:pass@example.com', vapidPublicKey: key }));
  assert(!PWA.validConfig({ endpoint: '', vapidPublicKey: key }));
});
