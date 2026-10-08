'use strict';
// Regression cases from the financial audit, exercising the corrected application.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../flow-core.js');
const CSV = require('../bank-import.js');
const NOW = new Date('2026-10-07T12:00:00').getTime();
const DATE = '2026-10-07';
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(extra = {}) { return Core.normalizeState({ accounts: [{ id: 'main', openingBalance: 1000 }], goals: [{ id: 'g', target: 1000 }], settings: { payday: 28 }, ...extra }); }
function evidence(t, code, values) { t.diagnostic('AUDIT_FINDING ' + JSON.stringify({ code, ...values })); }
function runDeletionHandler(state, functionName, selector, dataset) {
  // Execute the actual isolated application handler, not a transcription.
  const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  const line = source.split(/\r?\n/).find(line => line.trim().startsWith(`function ${functionName}()`));
  assert.ok(line && line.includes(selector));
  const button = { dataset };
  const sandbox = { state, $$: () => [button], $: () => ({}), confirm: () => true, save: () => { sandbox.state = Core.normalizeState(sandbox.state); } };
  vm.runInNewContext(line + `\n${functionName}();`, sandbox);
  button.onclick({ stopPropagation() {} });
  return sandbox.state;
}

test('F01: reconciledBalance remains in euros across save/reload', t => {
  let state = fixture(); Core.reconcileAccountBalance(state, 'main', 123.45, new Date(NOW));
  const before = state.accounts[0].reconciledBalance;
  state = Core.normalizeState(clone(state)); const first = state.accounts[0].reconciledBalance;
  state = Core.normalizeState(clone(state)); const second = state.accounts[0].reconciledBalance;
  evidence(t, 'F01', { before, first, second, actualLedger: Core.getAccountBalanceCents(state, 'main', DATE) });
  assert.equal(first, before);
  assert.equal(second, before);
});

test('F02: leap-day salary projection agrees with occurrence confirmation', t => {
  const state = fixture({ recurring: [{ id: 'salary', type: 'income', salary: true, amount: 1000, accountId: 'main', nextDate: '2024-02-29', frequency: 'yearly' }] });
  const projected = Core.getNextSalaryDate(state, '2025-02-27');
  const confirmed = Core.confirmRecurringOccurrence(clone(state), 'salary', '2024-02-29', '2025-02-27').nextDate;
  evidence(t, 'F02', { projected, confirmed }); assert.equal(projected, confirmed);
});

test('F03: confirming a bill recognized as already recorded cannot debit it twice', t => {
  const state = fixture({ recurring: [{ id: 'rent', type: 'expense', amount: 100, label: 'Loyer', accountId: 'main', nextDate: DATE, frequency: 'monthly' }], transactions: [{ id: 'bank-rent', type: 'expense', amount: 100, label: 'Loyer', accountId: 'main', date: DATE }] });
  const before = Core.getSpendableBreakdown(state, DATE);
  const result = Core.confirmRecurringOccurrence(state, 'rent', DATE, DATE);
  const after = Core.getSpendableBreakdown(state, DATE);
  evidence(t, 'F03', { before: before.spendable, after: after.spendable, alreadyCountedLiability: before.scheduledExpenseTotal, added: result.added, transactionCount: state.transactions.length });
  assert.equal(after.spendableCents, before.spendableCents);
  assert.equal(result.added, false);
  assert.equal(state.transactions.length, 1);
  assert.equal(Core.normalizeState(clone(state)).transactions[0].recurringOccurrence, 'rec:rent:2026-10-07');
});

test('F03: one existing payment cannot settle two distinct identical schedules after reload', () => {
  let state = fixture({ recurring: ['first', 'second'].map(id => ({ id, type: 'expense', amount: 100, label: 'Loyer', accountId: 'main', nextDate: DATE, frequency: 'once' })), transactions: [{ id: 'bank-rent', type: 'expense', amount: 100, label: 'Loyer', accountId: 'main', date: DATE }] });
  const first = Core.confirmRecurringOccurrence(state, 'first', DATE, DATE);
  assert.equal(first.added, false);
  state = Core.normalizeState(clone(state));
  const second = Core.confirmRecurringOccurrence(state, 'second', DATE, DATE);
  assert.equal(second.added, true);
  assert.equal(state.transactions.length, 2);
  assert.equal(Core.getAccountBalanceCents(state, 'main', DATE), 80000);
  assert.equal(Core.confirmRecurringOccurrence(state, 'second', DATE, DATE).reason, 'stale');
});

test('F04: deleting a project resolves its active reservation lifecycle', t => {
  let state = fixture(); const reserved = Core.makeManualReservation(state, 'g', 100, 'main', NOW); assert.equal(reserved.ok, true);
  state = runDeletionHandler(state, 'bindGoalActions', '[data-delete-goal]', { deleteGoal: 'g' });
  const active = Core.activeReservedCents(state);
  evidence(t, 'F04', { goals: state.goals.length, activeCents: active, orphanGoalId: state.reservations[0].goalId });
  assert.equal(active, 0);
});

test('F05: deleting a funded account cannot move its virtual reservation onto a different account', t => {
  let state = fixture({ accounts: [{ id: 'main', openingBalance: 500 }, { id: 'second', openingBalance: 500 }] });
  assert.equal(Core.makeManualReservation(state, 'g', 100, 'second', NOW).ok, true);
  state = runDeletionHandler(state, 'bindAccountActions', '[data-delete-account]', { deleteAccount: 'second' });
  evidence(t, 'F05', { accounts: state.accounts.map(a => a.id), reservationAccount: state.reservations[0].accountId, activeCents: Core.activeReservedCents(state) });
  assert.equal(Core.activeReservedCents(state), 0);
  assert.equal(state.reservations[0].accountId, null);
  assert.equal(state.reservations[0].status, 'released');
  assert.match(state.reservations[0].note, /Compte supprimé/);
});

test('F06: distinct bank references survive a deterministic fingerprint collision', t => {
  const state = fixture();
  const rows = ['bank-1989051064', 'bank-267641678'].map(reference => ({ reference, date: '2026-10-01', label: 'Courses', amount: -10 }));
  const fingerprints = rows.map(r => Core.stableFingerprint(r, 'main'));
  const result = Core.addImportedTransactions(state, rows, 'main');
  evidence(t, 'F06', { references: rows.map(r => r.reference), fingerprints, added: result.added, duplicates: result.duplicates });
  assert.equal(result.added, 2);
  assert.equal(Core.addImportedTransactions(Core.normalizeState(clone(state)), rows, 'main').duplicates, 2);
  const legacy = fixture({ importFingerprints: ['fp-ce283479'] });
  const review = Core.addImportedTransactions(legacy, rows, 'main');
  assert.equal(review.legacyReview.length, 2);
  assert.equal(review.duplicates, 0);
  assert.equal(review.added, 0);
});

test('F07: automatic reservations honor chosen account funds as manual ones do', t => {
  const state = fixture({ accounts: [{ id: 'main', openingBalance: 0 }, { id: 'cash', type: 'cash', openingBalance: 1000 }], goals: [{ id: 'g', target: 1000, autoContribution: { mode: 'fixed', value: 200, accountId: 'main' } }] });
  const manual = Core.makeManualReservation(state, 'g', 200, 'main', NOW);
  const result = Core.makeReservationCandidates(state, { id: 'pay', type: 'income', salary: true, amountCents: 20000, accountId: 'cash', label: 'Salary' }, NOW);
  evidence(t, 'F07', { manualReason: manual.reason, chosenAccountBalance: Core.getAccountBalanceCents(state, 'main', DATE), automaticStatus: result[0].status, automaticCents: result[0].amountCents });
  assert.equal(result[0].status, 'suspended');
});

test('F08: excluded-account reservations cannot increase another account available funds', t => {
  const state = fixture({ accounts: [{ id: 'main', openingBalance: 10 }, { id: 'cash', type: 'cash', openingBalance: 1000 }, { id: 'book', type: 'savings', openingBalance: 900, includeInSpendable: true }] });
  assert.equal(Core.makeManualReservation(state, 'g', 500, 'book', NOW).ok, true);
  state.accounts.find(a => a.id === 'book').includeInSpendable = false;
  const result = Core.makeManualReservation(state, 'g', 100, 'main', NOW);
  evidence(t, 'F08', { mainBalanceCents: Core.getAccountBalanceCents(state, 'main', DATE), reservationAccepted: result.ok, reservationCents: result.reservation?.amountCents });
  assert.equal(result.ok, false);
});

test('F09: resuming a suspended contribution reapplies the project remaining target', t => {
  const state = fixture({ accounts: [{ id: 'main', openingBalance: 10 }], goals: [{ id: 'g', target: 100, autoContribution: { mode: 'fixed', value: 80, accountId: 'main' } }] });
  const [suspended] = Core.makeReservationCandidates(state, { id: 'salary', type: 'income', salary: true, amountCents: 10000, accountId: 'main', label: 'Salary' }, NOW);
  assert.equal(suspended.status, 'suspended');
  state.transactions.push({ id: 'income', type: 'income', amountCents: 20000, accountId: 'main', date: DATE });
  assert.equal(Core.makeManualReservation(state, 'g', 80, 'main', NOW).ok, true);
  const result = Core.resolveReservation(state, suspended.id, 'reduce', NOW, 80);
  evidence(t, 'F09', { resumedCents: result.reservations[0].amountCents, activeCents: Core.activeReservedCents(state), targetCents: state.goals[0].targetCents });
  assert.ok(Core.activeReservedCents(state) <= state.goals[0].targetCents);
});

test('F10: old weekly liabilities are not silently limited to 120 occurrences', t => {
  const state = fixture({ recurring: [{ id: 'bill', type: 'expense', amount: 1, label: 'Bill', accountId: 'main', nextDate: '2020-01-01', frequency: 'weekly' }] });
  let expected = 0;
  for (let stamp = Date.UTC(2020, 0, 1); stamp < Date.UTC(2026, 9, 28); stamp += 7 * 86400000) expected++;
  const result = Core.getSpendableBreakdown(state, DATE);
  evidence(t, 'F10', { expectedOccurrences: expected, actualOccurrences: result.scheduledExpenses.length, expectedCents: expected * 100, actualCents: result.scheduledExpenseCents });
  assert.equal(result.scheduledExpenseCents, expected * 100);
});

test('F11: a 128-character recurring ID retains stable salary trigger identity on reload', t => {
  let state = fixture({ recurring: [{ id: 'a'.repeat(128), type: 'income', salary: true, amount: 1000, label: 'Salary', accountId: 'main', nextDate: DATE, frequency: 'monthly' }], goals: [{ id: 'g', target: 1000, autoContribution: { mode: 'fixed', value: 10, accountId: 'main' } }] });
  const result = Core.confirmRecurringOccurrence(state, state.recurring[0].id, DATE, DATE);
  Core.makeReservationCandidates(state, result.transaction, NOW);
  const before = state.transactions[0].id;
  const separateDevice = fixture({ recurring: [{ id: 'a'.repeat(128), type: 'income', salary: true, amount: 1000, label: 'Salary', accountId: 'main', nextDate: DATE, frequency: 'monthly' }] });
  assert.equal(Core.confirmRecurringOccurrence(separateDevice, 'a'.repeat(128), DATE, DATE).transaction.id, before);
  assert.equal(before, 'rec-' + require('node:crypto').createHash('sha256').update(`rec:${'a'.repeat(128)}:${DATE}`).digest('hex'));
  state = Core.normalizeState(clone(state));
  const after = state.transactions[0].id;
  const retriggered = Core.makeReservationCandidates(state, state.transactions[0], NOW);
  evidence(t, 'F11', { beforeLength: before.length, afterLength: after.length, sameId: before === after, retriggered: retriggered.length, totalReservations: state.reservations.length });
  assert.equal(after, before);
  assert.ok(before.length <= 128);
  assert.equal(retriggered.length, 0);
  assert.equal(state.reservations.length, 1);
  assert.equal(state.transactions[0].recurringOccurrence, `rec:${'a'.repeat(128)}:${DATE}`);
});

test('F12: CSV fractional cents use the same signed rounding policy as financial core', t => {
  const actual = ['1.005', '-1.005'].map(v => CSV.parseAmount(v));
  const expected = ['1.005', '-1.005'].map(v => Core.cents(v) / 100);
  evidence(t, 'F12', { input: ['1.005', '-1.005'], actual, expected });
  assert.deepEqual(actual, expected);
});
