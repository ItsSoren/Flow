'use strict';
// Local audit only. Independent integer ledger; fixed seeds and fixed dates.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../flow-core.js');
const CSV = require('../bank-import.js');
const Backup = require('../flow-backup.js');
const counts = {};
const count = key => counts[key] = (counts[key] || 0) + 1;
const TODAY = '2026-10-07';
const NOW = new Date(TODAY + 'T12:00:00').getTime();
const clone = value => JSON.parse(JSON.stringify(value));
function rng(seed) { let s = seed >>> 0; return max => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) % max; }; }
function base(profile) {
  return Core.normalizeState({ accounts: [
    { id: 'main', type: 'current', openingBalance: (50000 + profile * 137) / 100 },
    { id: 'book', type: 'savings', openingBalance: (30000 + profile * 19) / 100 },
    { id: 'cash', type: 'cash', openingBalance: 120.05 }
  ], goals: [{ id: 'goal', name: 'Projet ' + profile, targetCents: 1000000, savedCents: 0 }], settings: { payday: 28, safetyBuffer: profile / 100 } });
}
function independentBalance(model, account, cutoff = TODAY) {
  let value = model.openings[account];
  for (const tx of model.transactions) {
    if (tx.date > cutoff) continue;
    if (tx.type === 'transfer') { if (tx.from === account) value -= tx.cents; if (tx.to === account) value += tx.cents; }
    else if (tx.from === account) value += tx.type === 'income' ? tx.cents : -tx.cents;
  }
  return value;
}
function nextDate(value, frequency) {
  const [year, month, day] = value.split('-').map(Number);
  if (frequency === 'weekly') return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  const nextMonth = frequency === 'yearly' ? month - 1 : month;
  const nextYear = frequency === 'yearly' ? year + 1 : year;
  const last = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(nextYear, nextMonth, Math.min(day, last))).toISOString().slice(0, 10);
}

test('100 profiles x 120 deterministic sequential actions against an independent cents ledger', () => {
  for (let profile = 0; profile < 100; profile++) {
    const random = rng(0xF10A0000 + profile);
    let state = base(profile);
    const model = { openings: { main: 50000 + profile * 137, book: 30000 + profile * 19, cash: 12005 }, transactions: [], eligible: new Set(['main', 'cash']), reservations: new Map() };
    const accounts = ['main', 'book', 'cash'];
    for (let step = 0; step < 120; step++) {
      const action = random(9), account = accounts[random(3)], amount = 1 + random(25000);
      if (action <= 2) {
        const type = ['income', 'expense', 'transfer'][action], to = accounts[(accounts.indexOf(account) + 1 + random(2)) % 3];
        const tx = { id: `p${profile}-s${step}`, type, cents: amount, from: account, to, date: random(5) === 0 ? '2026-10-20' : '2026-10-01' };
        model.transactions.push(tx);
        state.transactions.push({ id: tx.id, type, amountCents: amount, amount: amount / 100, sourceAccountId: account, accountId: account, targetAccountId: type === 'transfer' ? to : null, date: tx.date, label: tx.id });
        count(type);
      } else if (action === 3 && model.transactions.length) {
        const i = random(model.transactions.length); model.transactions[i].cents = amount;
        state.transactions[i].amountCents = amount; state.transactions[i].amount = amount / 100; count('editTransaction');
      } else if (action === 4 && model.transactions.length) {
        const i = random(model.transactions.length); model.transactions.splice(i, 1); state.transactions.splice(i, 1); count('deleteTransaction');
      } else if (action === 5) {
        const desired = random(140000) - 20000;
        const previous = independentBalance(model, account);
        model.openings[account] += desired - previous;
        const result = Core.reconcileAccountBalance(state, account, desired / 100, new Date(NOW));
        assert.equal(result.previous, previous / 100, `profile=${profile}, step=${step}`);
        assert.equal(result.current, desired / 100); count('reconcile');
      } else if (action === 6) {
        // Reload only the finance invariants; reconciledBalance metadata has a separate regression probe.
        state = Core.normalizeState(clone(state)); count('reload');
      } else if (action === 7) {
        let available = 0;
        for (const id of model.eligible) available += independentBalance(model, id);
        let globalReserved = 0, accountReserved = 0;
        for (const reservation of model.reservations.values()) { globalReserved += reservation.amount; if (reservation.account === account) accountReserved += reservation.amount; }
        const enough = model.eligible.has(account) && amount <= independentBalance(model, account) - accountReserved && amount <= available - globalReserved - profile;
        const result = Core.makeManualReservation(state, 'goal', amount / 100, account, NOW);
        assert.equal(result.ok, enough, `manual profile=${profile}, step=${step}`);
        if (result.ok) model.reservations.set(result.reservation.id, { amount, account });
        count('manualReservationAttempt');
      } else if (action === 8 && model.reservations.size) {
        const id = [...model.reservations.keys()][random(model.reservations.size)];
        assert.equal(Core.resolveReservation(state, id, 'release', NOW).ok, true);
        assert.equal(Core.resolveReservation(state, id, 'release', NOW).ok, false);
        model.reservations.delete(id); count('release'); count('repeatRelease');
      } else count('emptyAction');
      let total = 0, eligible = 0, reserved = 0;
      for (const id of accounts) { const value = independentBalance(model, id); assert.equal(Core.getAccountBalanceCents(state, id, TODAY), value, `profile=${profile}, step=${step}, account=${id}`); total += value; if (model.eligible.has(id)) eligible += value; }
      for (const item of model.reservations.values()) reserved += item.amount;
      assert.equal(Core.getTotalBalanceCents(state, TODAY), total);
      assert.equal(Core.getSpendableBreakdown(state, TODAY).spendableCents, eligible - reserved - profile);
      count('sequentialAction'); count('invariantSnapshot');
    }
  }
});

test('100 bank CSV datasets preserve exact cents and quoted Unicode; repeat imports are idempotent', () => {
  for (let p = 0; p < 100; p++) {
    const random = rng(0xC500 + p), lines = ['Date;Libellé;Montant;Référence'], expected = [];
    for (let row = 0; row < 12; row++) {
      const cents = (random(2) ? 1 : -1) * (1 + random(200000)); expected.push(cents);
      lines.push(`07/10/2026;"Courses; café ""${p}-${row}""\nligne 2";${(cents / 100).toFixed(2).replace('.', ',')};p${p}-${row}`);
    }
    lines.push('31/02/2026;Invalide;12,00;bad');
    const parsed = CSV.parseCSV('\ufeff' + lines.join('\r\n'));
    const converted = CSV.convertRows(parsed, CSV.guessMapping(parsed.headers));
    assert.equal(converted.errors.length, 1);
    assert.deepEqual(converted.rows.map(row => Math.round(row.amount * 100)), expected);
    assert.equal(converted.rows.every(row => !row.isSalary), true);
    const state = base(p), before = Core.getAccountBalanceCents(state, 'main', TODAY);
    const first = Core.addImportedTransactions(state, converted.rows, 'main');
    const second = Core.addImportedTransactions(state, converted.rows, 'main');
    const restored = Core.normalizeState(clone(state));
    const third = Core.addImportedTransactions(restored, converted.rows, 'main');
    assert.deepEqual([first.added, first.invalid, second.duplicates, third.duplicates], [12, 0, 12, 12]);
    assert.equal(Core.getAccountBalanceCents(restored, 'main', TODAY), before + expected.reduce((a, b) => a + b, 0));
    count('csvDataset'); for (let i = 0; i < 13; i++) count('csvInputRow'); for (let i = 0; i < 36; i++) count('importRowAttempt');
  }
});

test('100 legacy migrations preserve balances, valid aliases, limits and saved project cents', () => {
  for (let p = 0; p < 100; p++) {
    const legacy = { accounts: [{ id: 'a', nom: 'Courant', [p % 2 ? 'solde' : 'balance']: p + 0.29 }, { id: 'b', nom: 'Livret épargne', initialBalance: 42.01 }], operations: [{ id: 'tx', type: 'revenu', montant: 10.01, accountId: 'a', date: TODAY }, { id: 'big', montant: 1e12, date: TODAY }], objectifs: [{ id: 'g', nom: 'Voyage', montant: 500, epargne: 0.29 }], revenus: [{ id: 'r', type: 'revenu', montant: 1000, date: TODAY, recurrence: 'mensuel' }] };
    const state = Core.normalizeState(legacy);
    assert.equal(Core.getAccountBalanceCents(state, 'a', TODAY), p * 100 + 1030);
    assert.equal(state.accounts[1].includeInSpendable, false);
    assert.equal(state.transactions.length, 1, 'oversize normalization intentionally drops zero-valued result');
    assert.equal(state.goals[0].savedCents, 29);
    assert.equal(state.recurring[0].frequency, 'monthly');
    assert.deepEqual(Core.normalizeState(clone(state)), state); count('legacyDataset');
  }
});

test('100 calendar datasets x 12 confirmations use independent calendar arithmetic and reject repeated/future actions', () => {
  const starts = ['2024-01-31', '2024-02-29', '2025-01-30', '2026-12-31'];
  for (let p = 0; p < 100; p++) {
    const frequency = ['monthly', 'weekly', 'yearly', 'once'][p % 4];
    let expected = starts[p % 4];
    const state = Core.normalizeState({ accounts: [{ id: 'main', openingBalance: 0 }], recurring: [{ id: 'bill', type: 'expense', amountCents: 101 + p, label: 'Bill', accountId: 'main', nextDate: expected, frequency }] });
    for (let i = 0; i < (frequency === 'once' ? 1 : 12); i++) {
      assert.equal(Core.confirmRecurringOccurrence(state, 'bill', expected, '1900-01-01').reason, 'future'); count('futureRecurringAttempt');
      const result = Core.confirmRecurringOccurrence(state, 'bill', expected, '2200-01-01');
      assert.equal(result.ok, true); assert.equal(result.added, true); count('recurringConfirmation');
      assert.equal(Core.confirmRecurringOccurrence(state, 'bill', expected, '2200-01-01').reason, 'stale'); count('staleRecurringAttempt');
      expected = frequency === 'once' ? null : nextDate(expected, frequency);
      assert.equal(result.nextDate, expected);
      assert.equal(Core.getAccountBalanceCents(state, 'main', '2200-01-01'), -(101 + p) * (i + 1));
    }
  }
});

test('100 salary horizon datasets: today recorded advances horizon; same-day bills excluded; savings excluded', () => {
  for (let p = 0; p < 100; p++) {
    const bill = 500 + p;
    const state = Core.normalizeState({ accounts: [{ id: 'main', openingBalance: 1000 }, { id: 'book', type: 'savings', openingBalance: 100000 }], recurring: [
      { id: 'salary', type: 'income', salary: true, amount: 2000, accountId: 'main', nextDate: TODAY, frequency: 'monthly' },
      { id: 'bill', type: 'expense', amountCents: bill, accountId: 'main', label: 'Bill', nextDate: '2026-10-10', frequency: 'once' },
      { id: 'same-day', type: 'expense', amount: 999, accountId: 'main', label: 'Same day', nextDate: '2026-11-07', frequency: 'once' },
      { id: 'book-bill', type: 'expense', amount: 5000, accountId: 'book', label: 'Savings', nextDate: '2026-10-10', frequency: 'once' }
    ] });
    assert.equal(Core.getNextSalaryDate(state, TODAY), TODAY);
    state.transactions.push({ id: 'paid', type: 'income', salary: true, amountCents: 200000, accountId: 'main', date: TODAY, label: 'Salary' });
    const result = Core.getSpendableBreakdown(state, TODAY);
    assert.equal(result.nextSalaryDate, '2026-11-07'); assert.equal(result.scheduledExpenseCents, bill); assert.equal(result.spendableCents, 300000 - bill);
    count('salaryHorizonDataset');
  }
});

test('100 pro-rata allocations conserve exact cents against BigInt largest-remainder oracle', () => {
  for (let p = 0; p < 100; p++) {
    const random = rng(0xAAA000 + p), requests = Array.from({ length: 2 + random(7) }, () => 1 + random(20000));
    const total = requests.reduce((a, b) => a + b, 0), budget = 1 + random(total - 1);
    const state = Core.normalizeState({ accounts: [{ id: 'main', openingBalance: budget / 100 }], goals: requests.map((n, i) => ({ id: 'g' + i, targetCents: 1000000, autoContribution: { mode: 'fixed', value: n / 100, accountId: 'main' } })), settings: { payday: 28 } });
    const salary = { id: 'salary-' + p, type: 'income', salary: true, amountCents: 200000, accountId: 'main', label: 'Salary' };
    const items = Core.makeReservationCandidates(state, salary, NOW); count('automaticSalaryTrigger');
    assert.equal(items.every(r => r.status === 'suspended'), true);
    assert.deepEqual(Core.makeReservationCandidates(state, salary, NOW), []); count('repeatSalaryTrigger');
    const shares = requests.map((n, i) => ({ i, value: Number(BigInt(budget) * BigInt(n) / BigInt(total)), remainder: BigInt(budget) * BigInt(n) % BigInt(total) }));
    let remaining = budget - shares.reduce((a, b) => a + b.value, 0);
    [...shares].sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.i - b.i).forEach(item => { if (remaining > 0) { shares[item.i].value++; remaining--; } });
    const result = Core.resolveReservation(state, items[0].id, 'prorata', NOW);
    assert.deepEqual(result.reservations.map(r => r.amountCents), shares.map(s => s.value)); count('prorata');
    assert.equal(Core.activeReservedCents(state), budget);
    assert.equal(Core.confirmDueReservations(state, NOW + Core.RESERVATION_DELAY_MS - 1).length, 0); count('earlyAutoConfirm');
    const active = items.filter(r => r.amountCents > 0).length;
    assert.equal(Core.confirmDueReservations(state, NOW + Core.RESERVATION_DELAY_MS).length, active); count('dueAutoConfirm');
    assert.equal(Core.confirmDueReservations(state, NOW + Core.RESERVATION_DELAY_MS).length, 0); count('repeatAutoConfirm');
    assert.equal(state.goals.every(g => g.savedCents === 0), true);
  }
});

test('100 project edit lifecycles: fixed/percent capped to target, pending denial and skip stay idempotent', () => {
  for (let p = 0; p < 100; p++) {
    let state = base(p);
    state.goals[0].target = 100; state.goals[0].targetCents = 10000;
    state.goals[0].saved = 20; state.goals[0].savedCents = 2000;
    state.goals[0].autoContribution = { mode: p % 2 ? 'percent' : 'fixed', value: p % 2 ? 25 : 90, accountId: 'main' };
    const salary = { id: 'p' + p, type: 'income', salary: true, accountId: 'main', amountCents: 40000 + p, label: 'Salary' };
    const [reservation] = Core.makeReservationCandidates(state, salary, NOW);
    assert.equal(reservation.amountCents, 8000); count('cappedAutomaticTrigger');
    const action = p % 2 ? 'deny' : 'skip';
    assert.equal(Core.resolveReservation(state, reservation.id, action, NOW).ok, true); count('denyOrSkip');
    assert.equal(Core.resolveReservation(state, reservation.id, action, NOW).ok, false); count('repeatDenyOrSkip');
    assert.equal(Core.activeReservedCents(state), 0);
    // Application form replaces goal objects; normalization recalculates cents.
    state.goals[0] = { id: 'goal', name: 'Edited project', target: 500, saved: 100, autoContribution: { mode: p % 2 ? 'percent' : 'fixed', value: p % 2 ? 10 : 50, accountId: 'main' } };
    state = Core.normalizeState(clone(state)); count('projectEdit');
    const second = { ...salary, id: 'p' + p + '-second' };
    const [next] = Core.makeReservationCandidates(state, second, NOW);
    const expected = p % 2 ? Math.round(salary.amountCents / 10) : 5000;
    assert.equal(next.amountCents, expected); count('editedAutomaticTrigger');
    assert.equal(state.goals[0].savedCents, 10000);
    const bank = Core.getAccountBalanceCents(state, 'main', TODAY);
    assert.equal(Core.resolveReservation(state, next.id, 'release', NOW).ok, true); count('pendingRelease');
    assert.equal(Core.getAccountBalanceCents(state, 'main', TODAY), bank);
  }
});

test('100 hostile import datasets: impossible dates, enormous amounts and unknown account reject; unsafe IDs regenerate', () => {
  for (let p = 0; p < 100; p++) {
    const state = base(p);
    const rows = [
      { id: 'bad-date', amount: -10, date: '2026-02-30', label: 'Bad' },
      { id: 'huge', amount: 1e12, date: TODAY, label: 'Huge' },
      { id: 'nan', amount: NaN, date: TODAY, label: 'NaN' },
      { id: 'zero', amount: 0.001, date: TODAY, label: 'Subcent' },
      { id: '<img onerror=alert(1)>', amount: -0.29, date: TODAY, label: 'Valid hostile ID ' + p }
    ];
    const result = Core.addImportedTransactions(state, rows, 'main');
    assert.deepEqual([result.added, result.invalid], [1, 4]);
    assert.match(state.transactions[0].id, /^[A-Za-z0-9._:-]{1,128}$/);
    assert.equal(Core.addImportedTransactions(state, rows, 'unknown').invalid, 5);
    for (let i = 0; i < 10; i++) count('adversarialImportRowAttempt');
    count('hostileImportDataset');
  }
});

test('100 backups round-trip raw data, Unicode, J/G codes and legacy prefix; truncation rejected', async () => {
  for (let p = 0; p < 100; p++) {
    const state = base(p); state.accounts[0].name = 'Épargne 日本 🌸 ' + p;
    state.transactions.push({ id: 'tx' + p, type: 'expense', amountCents: p + 1, accountId: 'main', date: TODAY, label: 'Café\nété' });
    assert.deepEqual(Backup.parse(JSON.stringify(state)), state); count('jsonBackupRead');
    const code = await Backup.createCode(state); count('backupCodeCreate');
    assert.deepEqual(await Backup.readCode(code), state); count('gzipBackupRead');
    assert.deepEqual(await Backup.readCode(code.replace('FLOW50', 'FLOW42').match(/.{1,64}/g).join('\n')), state); count('legacyWrappedCodeRead');
    const j = 'FLOW50J-' + Buffer.from(JSON.stringify(state)).toString('base64url');
    assert.deepEqual(await Backup.readCode(j), state); count('jsonCodeRead');
    await assert.rejects(Backup.readCode(code.slice(0, -12))); count('truncatedGzipRejected');
    await assert.rejects(Backup.readCode(j.slice(0, -12))); count('truncatedJsonRejected');
  }
});

test('oversize and malformed limits reject without touching live data', async () => {
  const { gzipSync } = require('node:zlib');
  const cases = [
    () => CSV.parseCSV('x'.repeat(CSV.MAX_BYTES + 1)),
    () => CSV.parseCSV('Date;Libellé;Montant\n' + '2026-10-01;X;1\n'.repeat(CSV.MAX_ROWS + 1)),
    () => CSV.parseCSV('Date;Libellé\n"unterminated'),
    () => Backup.parse('x'.repeat(Backup.MAX_BYTES + 1)),
    () => Backup.parse(JSON.stringify({ version: 99, accounts: [] })),
    () => Backup.parse('{}'),
    () => Backup.validate({ accounts: Array(20001).fill({ id: 'a' }) })
  ];
  cases.forEach(fn => { assert.throws(fn); count('limitRejection'); });
  await assert.rejects(Backup.readCode('FLOW50G-' + gzipSync('x'.repeat(Backup.MAX_BYTES + 1)).toString('base64url')), /volumineuse/); count('limitRejection');
  await assert.rejects(Backup.readCode('x'.repeat(Backup.MAX_BYTES * 1.5 + 1))); count('limitRejection');
});

after(() => console.log('AUDIT_FINANCE_COUNTS ' + JSON.stringify({ seedFamily: '0xF10A0000+profile, 0xC500+profile, 0xAAA000+profile', uniqueProfiles: 100, ...counts })));
