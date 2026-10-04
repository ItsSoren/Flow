const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../flow-core.js');

test('overdue unconfirmed bills reduce spendable; confirmation changes balance immediately without double counting', () => {
  const state=Core.normalizeState({accounts:[{id:'main',openingBalance:1000}],recurring:[{id:'bill',type:'expense',amount:100,label:'Loyer',accountId:'main',nextDate:'2026-09-04',frequency:'monthly'}],settings:{payday:28}});
  const today=new Date('2026-10-04T12:00:00');
  assert.equal(Core.getSpendableBreakdown(state,today).spendable,800);
  assert.equal(Core.getSpendableBreakdown(state,today).overdueExpenseTotal,100);
  const first=Core.confirmRecurringOccurrence(state,'bill','2026-09-04',today);
  assert(first.ok);assert.equal(first.nextDate,'2026-10-04');
  assert.equal(Core.getAccountBalanceCents(state,'main',today),90000);
  assert.equal(Core.getSpendableBreakdown(state,today).spendable,800);
  assert.equal(Core.confirmRecurringOccurrence(state,'bill','2026-09-04',today).reason,'stale');
  assert.equal(state.transactions.length,1);
  assert(Core.confirmRecurringOccurrence(state,'bill','2026-10-04',today).ok);
  assert.equal(Core.getSpendableBreakdown(state,today).spendable,800);
  assert.equal(Core.confirmRecurringOccurrence(state,'bill','2026-11-04',today).reason,'future');
  assert.equal(state.transactions.length,2);
});

test('once-only confirmation removes the schedule and stale clicks cannot recreate it', () => {
  const state=Core.normalizeState({accounts:[{id:'main',openingBalance:1000}],recurring:[{id:'bill',type:'expense',amount:50,label:'Facture',accountId:'main',nextDate:'2026-10-03',frequency:'once'}]});
  const today=new Date('2026-10-04T12:00:00');
  assert(Core.confirmRecurringOccurrence(state,'bill','2026-10-03',today).ok);
  assert.equal(state.recurring.length,0);assert.equal(state.transactions.length,1);
  assert.equal(Core.confirmRecurringOccurrence(state,'bill','2026-10-03',today).reason,'stale');
});

test('migrates legacy Flow amounts and account balances to version 5 cents-safe values', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'daily', name: 'Courant', balance: 125.25 }, { id: 'book', name: 'Livret', initialBalance: 50, type: 'savings' }],
    transactions: [{ id: 'old-1', type: 'expense', amount: 1.15, accountId: 'daily', date: '2026-10-01' }],
    goals: [{ id: 'trip', name: 'Voyage', target: 1000, saved: 20 }]
  });
  assert.equal(state.version, 5);
  assert.equal(state.transactions[0].amountCents, 115);
  assert.equal(state.accounts[0].openingBalance, 125.25);
  assert.equal(state.accounts[1].includeInSpendable, false);
  assert.equal(state.goals[0].savedCents, 2000);
});

test('calculates current balances for income, expense and transfer without using savings in spendable', () => {
  const state = Core.normalizeState({
    accounts: [
      { id: 'checking', name: 'Courant', type: 'current', initialBalance: 500 },
      { id: 'savings', name: 'Livret', type: 'savings', initialBalance: 300 }
    ],
    transactions: [
      { id: 'rent', type: 'expense', amount: 50, accountId: 'checking', date: '2026-10-01' },
      { id: 'move', type: 'transfer', amount: 25, sourceAccountId: 'checking', targetAccountId: 'savings', date: '2026-10-02' }
    ],
    settings: { payday: 28 }
  });
  assert.equal(Core.getAccountBalance(state, 'checking'), 425);
  assert.equal(Core.getAccountBalance(state, 'savings'), 325);
  assert.equal(Core.getSpendableUntilSalary(state, new Date('2026-10-03T12:00:00')), 425);
});

test('spendable until payday subtracts scheduled expenses, reservations and safety buffer exactly once', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'main', name: 'Courant', type: 'current', openingBalance: 1000 }],
    recurring: [{ id: 'rent', type: 'expense', amount: 300, label: 'Loyer', accountId: 'main', nextDate: '2026-10-10', frequency: 'monthly' }],
    reservations: [{ id: 'reserve', salaryTransactionId: 'salary-1', goalId: 'trip', amount: 100, status: 'confirmed' }],
    settings: { payday: 28, safetyBuffer: 50 }
  });
  const breakdown = Core.getSpendableBreakdown(state, new Date('2026-10-03T12:00:00'));
  assert.equal(breakdown.nextSalaryDate, '2026-10-28');
  assert.equal(breakdown.scheduledExpenseTotal, 300);
  assert.equal(breakdown.reservedTotal, 100);
  assert.equal(breakdown.spendable, 550);
});

test('salary trigger is idempotent and pending reservations confirm only after five minutes', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'main', name: 'Courant', type: 'current', openingBalance: 1000 }],
    goals: [{ id: 'trip', name: 'Voyage', target: 1000, saved: 0, autoContribution: { mode: 'fixed', value: 100 } }],
    settings: { payday: 28 }
  });
  const salary = { id: 'salary-10', type: 'income', amount: 2000, amountCents: 200000, label: 'Paie', salary: true, date: '2026-10-03', accountId: 'main' };
  const reservations = Core.makeReservationCandidates(state, salary, 1000);
  assert.equal(reservations.length, 1);
  assert.equal(Core.makeReservationCandidates(state, salary, 1000).length, 0);
  assert.equal(reservations[0].status, 'pending');
  assert.equal(Core.confirmDueReservations(state, 1000 + Core.RESERVATION_DELAY_MS - 1).length, 0);
  assert.equal(Core.confirmDueReservations(state, 1000 + Core.RESERVATION_DELAY_MS).length, 1);
  assert.equal(state.goals[0].saved, 0, 'reservation bookkeeping stays separate from manual saved balance');
});

test('insufficient salary reservations suspend, then resolve pro rata to the remaining available cents', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'main', name: 'Courant', type: 'current', openingBalance: 100 }],
    goals: [
      { id: 'a', name: 'A', target: 1000, autoContribution: { mode: 'fixed', value: 80 } },
      { id: 'b', name: 'B', target: 1000, autoContribution: { mode: 'fixed', value: 80 } }
    ],
    settings: { payday: 28 }
  });
  const items = Core.makeReservationCandidates(state, { id: 'salary-11', type: 'income', amount: 100, amountCents: 10000, salary: true, label: 'Paie', accountId: 'main' }, 1000);
  assert.deepEqual(items.map(item => item.status), ['suspended', 'suspended']);
  const result = Core.resolveReservation(state, items[0].id, 'prorata', 2000);
  assert.equal(result.ok, true);
  assert.equal(result.reservations.reduce((sum, item) => sum + item.amountCents, 0), 10000);
  assert.deepEqual(result.reservations.map(item => item.status), ['pending', 'pending']);
});

test('CSV import reports duplicates and invalid rows, and salary IDs cannot retrigger reservations', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'main', name: 'Courant', type: 'current', openingBalance: 0 }],
    goals: [{ id: 'trip', name: 'Voyage', target: 1000, autoContribution: { mode: 'percent', value: 10 } }]
  });
  const rows = [
    { id: 'csv-1', date: '2026-10-03', label: 'Salaire', amount: 2000, isSalary: true, source: 'csv' },
    { id: 'csv-1', date: '2026-10-03', label: 'Salaire', amount: 2000, isSalary: true, source: 'csv' },
    { date: 'bad', label: 'bad', amount: 10 }
  ];
  const result = Core.addImportedTransactions(state, rows, 'main');
  assert.deepEqual({ added: result.added, duplicates: result.duplicates, invalid: result.invalid }, { added: 1, duplicates: 1, invalid: 1 });
  assert.equal(state.reservations.length, 1);
  assert.equal(Core.addImportedTransactions(state, [rows[0]], 'main').duplicates, 1);
  assert.equal(state.reservations.length, 1);
});

test('balance reconciliation preserves transaction history and changes opening balance only', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'main', name: 'Courant', type: 'current', openingBalance: 200 }],
    transactions: [{ id: 'expense', type: 'expense', amount: 50, accountId: 'main', date: '2026-10-01' }]
  });
  const before = state.transactions.length;
  const result = Core.reconcileAccountBalance(state, 'main', 120, new Date('2026-10-02T12:00:00'));
  assert.equal(result.previous, 150);
  assert.equal(Core.getAccountBalance(state, 'main'), 120);
  assert.equal(state.transactions.length, before);
});

test('rejects hostile IDs and impossible imported dates while preserving saved cents', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'x" onfocus="alert(1)', name: 'Compte courant', openingBalance: 1.005 }],
    goals: [{ id: 'goal-ok', name: 'Épargne', target: 20.01, saved: 0.29 }]
  });
  assert.match(state.accounts[0].id, /^[A-Za-z0-9._:-]{1,128}$/);
  assert.equal(state.accounts[0].openingBalance, 1.01);
  assert.equal(state.goals[0].savedCents, 29);
  const result = Core.addImportedTransactions(state, [
    { id: 'safe-1', date: '2026-02-30', label: 'Invalide', amount: -10 },
    { id: '<img src=x onerror=alert(1)>', date: '2026-10-03', label: 'Valide', amount: -10 },
    { id: 'too-large', date: '2026-10-03', label: 'Énorme', amount: 1e12 }
  ], state.accounts[0].id);
  assert.deepEqual({ added: result.added, invalid: result.invalid }, { added: 1, invalid: 2 });
  assert.match(state.transactions[0].id, /^[A-Za-z0-9._:-]{1,128}$/);
});

test('a recurring salary occurrence has a stable ID and cannot be applied twice', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'main', name: 'Courant', openingBalance: 0 }],
    goals: [{ id: 'goal', name: 'Voyage', target: 1000, autoContribution: { mode: 'fixed', value: 25 } }]
  });
  const occurrenceId = 'rec:salary:2026-10-03';
  const salary = { id: occurrenceId, type: 'income', amount: 2000, salary: true, label: 'Salaire', accountId: 'main' };
  state.transactions.push(salary);
  const first = Core.makeReservationCandidates(state, salary, 1000);
  state.transactions.push({ ...salary });
  const second = Core.makeReservationCandidates(state, salary, 2000);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(state.reservations.length, 1);
});

test('moves the spending horizon forward when the salary due today is already recorded', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'main', name: 'Courant' }],
    recurring: [{ id: 'salary-plan', type: 'income', salary: true, category: 'salaire', amount: 2000, label: 'Paie', accountId: 'main', nextDate: '2026-10-03', frequency: 'monthly' }],
    transactions: [{ id: 'salary-today', type: 'income', salary: true, amount: 2000, label: 'Paie', accountId: 'main', date: '2026-10-03' }],
    settings: { payday: 3 }
  });
  assert.equal(Core.getNextSalaryDate(state, new Date('2026-10-03T12:00:00')), '2026-11-03');
});

test('caps automatic contributions at the project target remaining', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'main', name: 'Courant', openingBalance: 1000 }],
    goals: [{ id: 'goal', name: 'Voyage', target: 100, saved: 80, autoContribution: { mode: 'fixed', value: 50, accountId: 'main' } }]
  });
  const reservations = Core.makeReservationCandidates(state, { id: 'salary-target', type: 'income', amount: 2000, salary: true, accountId: 'main', label: 'Paie' }, 1000);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].amount, 20);
  assert.equal(reservations[0].requestedAmount, 20);
});

test('does not count or subtract an automatic reservation funded by an excluded savings account', () => {
  const state = Core.normalizeState({
    accounts: [
      { id: 'main', name: 'Courant', openingBalance: 500, includeInSpendable: true },
      { id: 'savings', name: 'Livret', type: 'savings', openingBalance: 900, includeInSpendable: false }
    ],
    goals: [{ id: 'goal', name: 'Voyage', target: 200, autoContribution: { mode: 'fixed', value: 50, accountId: 'savings' } }]
  });
  const before = Core.getSpendableUntilSalary(state, new Date('2026-10-03T12:00:00'));
  const reservations = Core.makeReservationCandidates(state, { id: 'salary-savings', type: 'income', amount: 2000, salary: true, accountId: 'main', label: 'Paie' }, 1000);
  assert.equal(reservations[0].status, 'suspended');
  assert.match(reservations[0].reason, /n’est pas inclus/);
  assert.equal(Core.getSpendableUntilSalary(state, new Date('2026-10-03T12:00:00')), before);
  assert.equal(Core.activeReservedCents(state), 0);
});

test('future-dated confirmed transactions stay out of today’s actual and spendable balance', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'main', name: 'Courant', openingBalance: 250 }],
    transactions: [
      { id: 'future-pay', type: 'income', amount: 1800, salary: true, accountId: 'main', date: '2026-10-05' },
      { id: 'future-bill', type: 'expense', amount: 60, accountId: 'main', date: '2026-10-06' },
      { id: 'today-coffee', type: 'expense', amount: 4, accountId: 'main', date: '2026-10-02' }
    ],
    settings: { payday: 28 }
  });
  assert.equal(Core.getAccountBalanceCents(state, 'main', '2026-10-02'), 24600);
  const breakdown = Core.getSpendableBreakdown(state, '2026-10-02');
  assert.equal(breakdown.accountBalance, 246);
  assert.equal(breakdown.spendable, 246);
});

test('manual project contributions reserve spendable only, cap at remaining target, and release cleanly', () => {
  const state = Core.normalizeState({
    accounts: [{ id: 'main', name: 'Courant', openingBalance: 500 }],
    goals: [{ id: 'trip', name: 'Voyage', target: 100, saved: 20 }]
  });
  const beforeBalance = Core.getAccountBalance(state, 'main');
  const beforeSpendable = Core.getSpendableUntilSalary(state, new Date('2026-10-02T12:00:00'));
  const result = Core.makeManualReservation(state, 'trip', 90, 'main', new Date('2026-10-02T12:00:00').getTime());
  assert.equal(result.ok, true);
  assert.equal(result.capped, true);
  assert.equal(result.reservation.amount, 80);
  assert.equal(result.reservation.status, 'confirmed');
  assert.match(result.reservation.note, /solde réel.*ne change pas/i);
  assert.equal(state.goals[0].saved, 20, 'manual reservation must not overwrite already-saved history');
  assert.equal(Core.getAccountBalance(state, 'main'), beforeBalance, 'virtual reserve does not move bank money');
  assert.equal(Core.getSpendableUntilSalary(state, new Date('2026-10-02T12:00:00')), beforeSpendable - 80);
  const released = Core.resolveReservation(state, result.reservation.id, 'release', new Date('2026-10-02T12:01:00').getTime());
  assert.equal(released.ok, true);
  assert.equal(Core.getAccountBalance(state, 'main'), beforeBalance);
  assert.equal(Core.getSpendableUntilSalary(state, new Date('2026-10-02T12:00:00')), beforeSpendable);
});

test('manual project reservation rejects an excluded account and insufficient amount', () => {
  const state = Core.normalizeState({
    accounts: [
      { id: 'main', name: 'Courant', openingBalance: 60 },
      { id: 'book', name: 'Livret épargne', type: 'savings', openingBalance: 900, includeInSpendable: false }
    ],
    goals: [{ id: 'goal', name: 'Ordinateur', target: 1000, saved: 0 }]
  });
  assert.equal(Core.makeManualReservation(state, 'goal', 10, 'book').reason, 'excluded-account');
  assert.equal(Core.makeManualReservation(state, 'goal', 61, 'main').reason, 'insufficient-funds');
  assert.equal(state.reservations.length, 0);
});
