(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FlowCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 5;
  const RESERVATION_DELAY_MS = 5 * 60 * 1000;
  const MAX_AMOUNT_EUR = 1_000_000_000;
  const cents = value => { const number=Number(value);return Number.isFinite(number)&&Math.abs(number)<=MAX_AMOUNT_EUR?Math.sign(number)*Math.round((Math.abs(number)+Number.EPSILON)*100):0; };
  const euros = value => Math.round((Number(value) || 0)) / 100;
  const roundEuro = value => cents(value) / 100;
  const isoDate = value => {
    if (isIsoDate(value)) return value;
    const d = value instanceof Date ? value : new Date(value || Date.now());
    if (!Number.isFinite(d.getTime())) return isoDate(new Date());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  function isIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    return Number.isFinite(date.getTime()) && `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` === value;
  }
  const makeId = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  // Synchronous SHA-256 for deterministic identifiers in both browser and Node.
  function identifierDigest(value) {
    const bytes = new TextEncoder().encode(value), size = Math.ceil((bytes.length + 9) / 64) * 64;
    const data = new Uint8Array(size); data.set(bytes); data[bytes.length] = 128;
    const view = new DataView(data.buffer); view.setUint32(size - 4, bytes.length * 8);
    const initial = [], constants = [];
    for (let candidate = 2; constants.length < 64; candidate++) {
      let prime = true;
      for (let divisor = 2; divisor * divisor <= candidate; divisor++) if (candidate % divisor === 0) { prime = false; break; }
      if (prime) {
        if (initial.length < 8) initial.push((Math.sqrt(candidate) % 1 * 4294967296) >>> 0);
        constants.push((Math.cbrt(candidate) % 1 * 4294967296) >>> 0);
      }
    }
    const rotate = (word, bits) => (word >>> bits) | (word << (32 - bits));
    const words = new Uint32Array(64), hash = initial.slice();
    for (let offset = 0; offset < size; offset += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = words[i - 15], y = words[i - 2];
        words[i] = words[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + words[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
      }
      let [a,b,c,d,e,f,g,h] = hash;
      for (let i = 0; i < 64; i++) {
        const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) >>> 0;
        const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h=g;g=f;f=e;e=(d+first)>>>0;d=c;c=b;b=a;a=(first+second)>>>0;
      }
      [a,b,c,d,e,f,g,h].forEach((word, i) => { hash[i] = (hash[i] + word) >>> 0; });
    }
    return hash.map(word => word.toString(16).padStart(8, '0')).join('');
  }
  function safeId(value, prefix, used) {
    let id = String(value || '');
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id) || used.has(id)) id = makeId(prefix);
    while (used.has(id)) id = makeId(prefix);
    used.add(id); return id;
  }
  const safeArray = value => Array.isArray(value) ? value : [];
  const safeRecords = value => safeArray(value).filter(item => item && typeof item === 'object' && !Array.isArray(item));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const positiveAmountCents = value => Math.min(100_000_000_000, Math.abs(Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0));

  function getEmptyState() {
    return {
      version: VERSION,
      activeAccountId: 'main',
      accounts: [{ id: 'main', name: 'Compte courant', type: 'current', openingBalance: 0, createdAt: Date.now(), includeInSpendable: true }],
      transactions: [], recurring: [], goals: [], reservations: [], salaryTriggers: [],
      notifications: [], reminders: [], importFingerprints: [],
      settings: {
        mode: 'auto', palette: 'flow', payday: 1, safetyBuffer: 0,
        notifications: { salary: true, reservations: true, recurring: true, reminders: true },
        notificationFilters: ['all'], density: 'comfortable', motion: 'full'
      },
      migratedFrom: null
    };
  }

  function normalizeState(raw) {
    const empty = getEmptyState();
    if (!raw || typeof raw !== 'object') return empty;
    const sourceAccounts = safeRecords(raw.accounts);
    const usedAccountIds = new Set();
    const accounts = (sourceAccounts.length ? sourceAccounts : empty.accounts).map((account, index) => {
      const legacyBalance = account.currentBalance ?? account.balance ?? account.solde;
      const opening = account.openingBalance ?? account.initialBalance ?? legacyBalance ?? 0;
      const inferred = /livret|épargne|epargne|savings/i.test(String(account.name || account.nom || '')) ? 'savings' : /espèces|especes|cash|liquide/i.test(String(account.name || account.nom || '')) ? 'cash' : 'current';
      const type = ['current', 'savings', 'cash', 'other'].includes(account.type) ? account.type : inferred;
      return {
        id: safeId(account.id || `account-${index + 1}`, 'account', usedAccountIds),
        name: String(account.name || account.nom || `Compte ${index + 1}`).slice(0, 100),
        type,
        openingBalance: roundEuro(opening),
        // Read-only compatibility for a V4 tab that has not refreshed yet.
        // V5 always uses openingBalance; the alias never overrides it.
        initialBalance: roundEuro(opening),
        createdAt: Number(account.createdAt || Date.now()),
        includeInSpendable: account.includeInSpendable == null ? type !== 'savings' : Boolean(account.includeInSpendable),
        reconciledAt: account.reconciledAt ? Number(account.reconciledAt) : null,
        reconciledBalance: account.reconciledBalance == null ? null : roundEuro(account.reconciledBalance)
      };
    });
    const accountIds = new Set(accounts.map(account => account.id));
    const defaultAccountId = accounts[0].id;
    const normalizeAccount = id => accountIds.has(String(id)) ? String(id) : defaultAccountId;
    const usedTransactionIds = new Set();
    const transactions = safeRecords(raw.transactions || raw.operations).map((transaction, index) => {
      const legacyType = String(transaction.type || '').toLowerCase();
      const type = legacyType === 'transfer' || legacyType === 'transfert' ? 'transfer'
        : ['income', 'revenu', 'bonus'].includes(legacyType) ? 'income' : 'expense';
      const amountCents = transaction.amountCents != null
        ? positiveAmountCents(transaction.amountCents)
        : positiveAmountCents(cents(transaction.amount ?? transaction.montant ?? 0));
      const sourceAccountId = normalizeAccount(transaction.sourceAccountId || transaction.accountId);
      const targetAccountId = transaction.targetAccountId ? normalizeAccount(transaction.targetAccountId) : null;
      const category = String(transaction.category || transaction.cat || (type === 'income' ? 'salaire' : 'autre'));
      return {
        id: safeId(transaction.id || `tx-${index + 1}-${makeId()}`, 'tx', usedTransactionIds), type,
        amount: euros(amountCents), amountCents,
        label: String(transaction.label || transaction.desc || transaction.description || transaction.nom || 'Opération').slice(0, 140),
        category,
        date: isoDate(transaction.date || Date.now()),
        accountId: sourceAccountId,
        sourceAccountId,
        targetAccountId: type === 'transfer' && targetAccountId && targetAccountId !== sourceAccountId ? targetAccountId : null,
        salary: type === 'income' && Boolean(transaction.salary ?? transaction.isSalary ?? category === 'salaire'),
        note: String(transaction.note || transaction.notes || ''),
        favorite: Boolean(transaction.favorite),
        reconciled: Boolean(transaction.reconciled),
        importFingerprint: transaction.importFingerprint ? String(transaction.importFingerprint) : null,
        source: transaction.source ? String(transaction.source) : null,
        recurringOccurrence: transaction.recurringOccurrence ? String(transaction.recurringOccurrence) : null
      };
    }).filter(transaction => transaction.amountCents > 0 && (transaction.type !== 'transfer' || transaction.targetAccountId));

    const usedRecurringIds = new Set();
    const recurring = safeRecords(raw.recurring || raw.revenus).map((item, index) => {
      const legacyType = String(item.type || '').toLowerCase();
      const type = ['income', 'revenu'].includes(legacyType) ? 'income' : 'expense';
      const amountCents = item.amountCents != null ? positiveAmountCents(item.amountCents) : positiveAmountCents(cents(item.amount ?? item.montant ?? 0));
      const category = String(item.category || item.cat || (type === 'income' ? 'salaire' : 'factures'));
      const frequencyMap = { mensuel: 'monthly', monthly: 'monthly', hebdomadaire: 'weekly', weekly: 'weekly', annuel: 'yearly', yearly: 'yearly', once: 'once', unique: 'once' };
      return {
        id: safeId(item.id || `rec-${index + 1}-${makeId()}`, 'rec', usedRecurringIds), type,
        amount: euros(amountCents), amountCents,
        label: String(item.label || item.desc || item.description || 'Récurrent').slice(0, 140), category,
        nextDate: isoDate(item.nextDate || item.start || item.date || Date.now()),
        frequency: frequencyMap[item.frequency || item.recurrence] || 'monthly',
        accountId: normalizeAccount(item.accountId),
        salary: type === 'income' && Boolean(item.salary ?? item.isSalary ?? category === 'salaire')
      };
    }).filter(item => item.amountCents > 0);

    const usedGoalIds = new Set();
    const goals = safeRecords(raw.goals || raw.objectifs).map((goal, index) => {
      const targetCents = goal.targetCents != null ? positiveAmountCents(goal.targetCents) : positiveAmountCents(cents(goal.target ?? goal.amount ?? goal.montant ?? 0));
      const savedCents = goal.savedCents != null ? positiveAmountCents(goal.savedCents) : positiveAmountCents(cents(goal.saved ?? goal.current ?? goal.epargne ?? 0));
      const auto = goal.autoContribution || goal.auto || null;
      const mode = auto?.mode || auto?.type || goal.autoMode || 'none';
      const value = auto?.value ?? goal.autoValue ?? 0;
      return {
        id: safeId(goal.id || `goal-${index + 1}-${makeId()}`, 'goal', usedGoalIds), name: String(goal.name || goal.nom || 'Mon projet').slice(0, 100),
        emoji: String(goal.emoji || '🌿'), target: euros(targetCents), targetCents,
        saved: euros(savedCents), savedCents,
        date: goal.date || goal.deadline ? isoDate(goal.date || goal.deadline) : '',
        color: ['sage', 'peach', 'lilac', 'blue'].includes(goal.color) ? goal.color : ['sage', 'peach', 'lilac', 'blue'][index % 4],
        autoContribution: ['fixed', 'percent'].includes(mode) && Number(value) > 0
          ? { mode, value: mode === 'fixed' ? euros(cents(value)) : clamp(Number(value), 0, 100), accountId: normalizeAccount(auto?.accountId || goal.accountId) }
          : null
      };
    }).filter(goal => goal.targetCents > 0);

    const usedReservationIds = new Set();
    const reservations = safeRecords(raw.reservations || raw.reservedContributions).map((reservation, index) => {
      const amountCents = positiveAmountCents(reservation.amountCents ?? cents(reservation.amount ?? 0));
      const requestedCents = positiveAmountCents(reservation.requestedCents ?? cents(reservation.requestedAmount ?? reservation.amount ?? 0));
      const status = ['pending', 'confirmed', 'suspended', 'denied', 'released', 'skipped'].includes(reservation.status) ? reservation.status : 'pending';
      return {
        id: safeId(reservation.id || `reservation-${index + 1}-${makeId()}`, 'reservation', usedReservationIds), salaryTransactionId: String(reservation.salaryTransactionId || '').slice(0,128),
        goalId: String(reservation.goalId || '').slice(0,128), accountId: reservation.accountId ? normalizeAccount(reservation.accountId) : null,
        amount: euros(amountCents), amountCents, requestedAmount: euros(requestedCents), requestedCents,
        status, createdAt: Number(reservation.createdAt || Date.now()), confirmAt: Number(reservation.confirmAt || Date.now() + RESERVATION_DELAY_MS),
        confirmedAt: reservation.confirmedAt ? Number(reservation.confirmedAt) : null,
        resolvedAt: reservation.resolvedAt ? Number(reservation.resolvedAt) : null,
        reason: String(reservation.reason || ''), note: String(reservation.note || '')
      };
    });

    const settings = raw.settings || {};
    const oldTheme = settings.theme || raw.theme || 'auto';
    const mode = settings.mode || (['light', 'dark', 'auto'].includes(oldTheme) ? oldTheme : String(oldTheme).endsWith('-light') ? 'light' : 'dark');
    const palette = settings.palette || (String(oldTheme).startsWith('neon-sakura') ? 'neon-sakura' : String(oldTheme).startsWith('ocean-peace') ? 'ocean-peace' : 'flow');
    const notif = settings.notifications || {};
    const usedNotificationIds = new Set();
    const notifications = safeRecords(raw.notifications).map((item, index) => ({
      id: safeId(item.id || `notification-${index + 1}-${makeId()}`, 'notification', usedNotificationIds), kind: String(item.kind || 'general').slice(0,40),
      title: String(item.title || 'Flow').slice(0,100), message: String(item.message || '').slice(0,500), createdAt: Number(item.createdAt || Date.now()),
      read: Boolean(item.read), relatedId: item.relatedId ? String(item.relatedId) : null
    }));
    const usedReminderIds = new Set();
    const reminders = safeRecords(raw.reminders).map((item, index) => ({
      id: safeId(item.id || `reminder-${index + 1}-${makeId()}`, 'reminder', usedReminderIds), title: String(item.title || 'Rappel').slice(0,100),
      date: isoDate(item.date || Date.now()), note: String(item.note || ''), kind: String(item.kind || 'custom'),
      createdAt: Number(item.createdAt || Date.now()), done: Boolean(item.done)
    }));
    return {
      version: VERSION,
      activeAccountId: accountIds.has(String(raw.activeAccountId)) ? String(raw.activeAccountId) : defaultAccountId,
      accounts, transactions, recurring, goals, reservations,
      salaryTriggers: [...new Set(safeArray(raw.salaryTriggers).map(String).concat(reservations.map(r => r.salaryTransactionId).filter(Boolean)))],
      notifications, reminders,
      importFingerprints: [...new Set(safeArray(raw.importFingerprints).map(String).concat(transactions.map(t => t.importFingerprint).filter(Boolean)))],
      settings: {
        mode: ['auto', 'light', 'dark'].includes(mode) ? mode : 'auto',
        palette: ['flow', 'neon-sakura', 'ocean-peace'].includes(palette) ? palette : 'flow',
        payday: clamp(Number(settings.payday ?? settings.paycheckDay ?? 1) || 1, 1, 31),
        safetyBuffer: euros(cents(settings.safetyBuffer || 0)),
        density: ['comfortable', 'compact', 'wide'].includes(settings.density) ? settings.density : 'comfortable',
        motion: ['system', 'full', 'reduced'].includes(settings.motion) ? settings.motion : 'system',
        notificationFilters: safeArray(settings.notificationFilters).length ? settings.notificationFilters.map(String) : ['all'],
        notifications: {
          salary: notif.salary !== false,
          reservations: notif.reservations !== false,
          recurring: notif.recurring !== false,
          reminders: notif.reminders !== false
        }
      },
      migratedFrom: raw.migratedFrom || null
    };
  }

  function getAccountBalanceCents(state, accountId, asOf = new Date()) {
    const account = state.accounts.find(item => item.id === accountId);
    if (!account) return 0;
    const cutoff = isoDate(asOf);
    let balance = cents(account.openingBalance);
    for (const transaction of state.transactions) {
      // Future-dated entries are plans until their date; never present them as money available now.
      if (transaction.date > cutoff) continue;
      const amount = transaction.amountCents ?? cents(transaction.amount);
      if (transaction.type === 'transfer') {
        if (transaction.sourceAccountId === accountId || transaction.accountId === accountId) balance -= amount;
        if (transaction.targetAccountId === accountId) balance += amount;
      } else if ((transaction.sourceAccountId || transaction.accountId) === accountId) {
        balance += transaction.type === 'income' ? amount : -amount;
      }
    }
    return balance;
  }
  const getAccountBalance = (state, accountId) => euros(getAccountBalanceCents(state, accountId));
  function getTotalBalanceCents(state, asOf = new Date()) { return state.accounts.reduce((sum, account) => sum + getAccountBalanceCents(state, account.id, asOf), 0); }
  function activeReservedCents(state) { const eligible=new Set(state.accounts.filter(account=>account.includeInSpendable).map(account=>account.id));return state.reservations.filter(item => (item.status === 'pending' || item.status === 'confirmed')&&(!item.accountId||eligible.has(item.accountId))).reduce((sum, item) => sum + item.amountCents, 0); }

  function monthlyOccurrences(recurring, from, through) {
    const occurrences = [];
    let date = new Date(`${recurring.nextDate}T12:00:00`);
    const end = new Date(`${through}T12:00:00`);
    // Dates advance strictly: do not silently drop older unpaid occurrences.
    while (date <= end) {
      if (date >= new Date(`${from}T00:00:00`)) occurrences.push(isoDate(date));
      if (recurring.frequency === 'once') break;
      if (recurring.frequency === 'weekly') date.setDate(date.getDate() + 7);
      else if (recurring.frequency === 'yearly') {
        const day = date.getDate(), month = date.getMonth();
        date.setDate(1); date.setFullYear(date.getFullYear() + 1); date.setMonth(month);
        date.setDate(Math.min(day, new Date(date.getFullYear(), month + 1, 0).getDate()));
      }
      else {
        const day = date.getDate(); date.setDate(1); date.setMonth(date.getMonth() + 1);
        date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
      }
    }
    return occurrences;
  }

  function getNextSalaryDate(state, todayValue = new Date()) {
    const today = isoDate(todayValue);
    const plannedSalary = state.recurring.filter(item => item.type === 'income' && (item.salary || item.category === 'salaire'))
      .flatMap(item => monthlyOccurrences(item, today, `${new Date(new Date(`${today}T12:00:00`).getFullYear() + 2, 11, 31).getFullYear()}-12-31`).map(date => ({ date, id: item.id })))
      .filter(item => item.date >= today && !state.transactions.some(transaction => transaction.type === 'income' && transaction.salary && transaction.date === item.date && (transaction.sourceAccountId || transaction.accountId) === state.recurring.find(recurring => recurring.id === item.id)?.accountId)).sort((a, b) => a.date.localeCompare(b.date));
    if (plannedSalary.length) return plannedSalary[0].date;
    const now = new Date(`${today}T12:00:00`);
    let year = now.getFullYear(), month = now.getMonth();
    const payday = clamp(Number(state.settings.payday) || 1, 1, 31);
    let candidate = new Date(year, month, Math.min(payday, new Date(year, month + 1, 0).getDate()), 12);
    if (isoDate(candidate) < today || state.transactions.some(transaction => transaction.type === 'income' && transaction.salary && transaction.date === isoDate(candidate))) {
      month += 1; if (month > 11) { month = 0; year += 1; }
      candidate = new Date(year, month, Math.min(payday, new Date(year, month + 1, 0).getDate()), 12);
    }
    return isoDate(candidate);
  }

  function getSpendableBreakdown(state, todayValue = new Date()) {
    const today = isoDate(todayValue);
    const nextSalary = getNextSalaryDate(state, today);
    const eligibleAccounts = state.accounts.filter(account => account.includeInSpendable);
    const balanceCents = eligibleAccounts.reduce((sum, account) => sum + getAccountBalanceCents(state, account.id, today), 0);
    const expenses = [];
    for (const recurring of state.recurring) {
      if (recurring.type !== 'expense' || !eligibleAccounts.some(account => account.id === recurring.accountId)) continue;
      // Unconfirmed overdue bills are still liabilities, not free spending money.
      for (const date of monthlyOccurrences(recurring, recurring.nextDate, nextSalary)) {
        const alreadyRecorded = state.transactions.some(transaction => transaction.type === 'expense' && (transaction.sourceAccountId || transaction.accountId) === recurring.accountId && transaction.date === date && (transaction.amountCents ?? cents(transaction.amount)) === (recurring.amountCents ?? cents(recurring.amount)) && transaction.label.trim().toLowerCase() === recurring.label.trim().toLowerCase());
        if (date < nextSalary && !alreadyRecorded) expenses.push({ id: recurring.id, label: recurring.label, date, overdue:date < today, amountCents: recurring.amountCents ?? cents(recurring.amount) });
      }
    }
    const scheduledExpenseCents = expenses.reduce((sum, item) => sum + item.amountCents, 0);
    const reservedCents = activeReservedCents(state);
    const bufferCents = cents(state.settings.safetyBuffer || 0);
    const availableCents = balanceCents - scheduledExpenseCents - reservedCents - bufferCents;
    return {
      today, nextSalaryDate: nextSalary, accountBalance: euros(balanceCents), accountBalanceCents: balanceCents,
      scheduledExpenses: expenses, scheduledExpenseTotal: euros(scheduledExpenseCents), scheduledExpenseCents,
      overdueExpenseTotal: euros(expenses.filter(item=>item.overdue).reduce((sum,item)=>sum+item.amountCents,0)),
      reservations: state.reservations.filter(item => item.status === 'pending' || item.status === 'confirmed'),
      reservedTotal: euros(reservedCents), reservedCents, safetyBuffer: euros(bufferCents), safetyBufferCents: bufferCents,
      spendable: euros(availableCents), spendableCents: availableCents
    };
  }
  const getSpendableUntilSalary = (state, today) => getSpendableBreakdown(state, today).spendable;

  function createNotification(state, kind, title, message, relatedId, at = Date.now()) {
    const notification = { id: makeId('notification'), kind, title, message, createdAt: at, read: false, relatedId: relatedId || null };
    state.notifications.unshift(notification);
    if (state.notifications.length > 300) state.notifications.length = 300;
    return notification;
  }

  function makeReservationCandidates(state, salaryTransaction, now = Date.now()) {
    if (!salaryTransaction || salaryTransaction.type !== 'income' || !salaryTransaction.salary) return [];
    const triggerId = String(salaryTransaction.id);
    if (state.salaryTriggers.includes(triggerId)) return [];
    state.salaryTriggers.push(triggerId);
    const goals = state.goals.filter(goal => goal.autoContribution?.mode && goal.autoContribution.mode !== 'none');
    if (!goals.length) return [];
    const requested = goals.map(goal => {
      const rule = goal.autoContribution;
      const amount = rule.mode === 'percent'
        ? Math.round((salaryTransaction.amountCents ?? cents(salaryTransaction.amount)) * clamp(Number(rule.value), 0, 100) / 100)
        : cents(rule.value);
      const alreadyReserved=state.reservations.filter(item=>item.goalId===goal.id&&(item.status==='pending'||item.status==='confirmed')).reduce((sum,item)=>sum+item.amountCents,0);
      const remaining=Math.max(0,(goal.targetCents??cents(goal.target))-(goal.savedCents??cents(goal.saved))-alreadyReserved);
      const accountId=rule.accountId||salaryTransaction.sourceAccountId||salaryTransaction.accountId||null;
      const account=state.accounts.find(item=>item.id===accountId);
      return { goal, accountId, eligible:Boolean(account?.includeInSpendable), amountCents: Math.min(Math.max(0, amount), remaining) };
    }).filter(item => item.amountCents > 0);
    if (!requested.length) return [];
    const available = getSpendableBreakdown(state, new Date(now)).spendableCents;
    const eligibleRequests=requested.filter(item=>item.eligible),totalRequested=eligibleRequests.reduce((sum,item)=>sum+item.amountCents,0);
    const accountRequests = new Map();
    eligibleRequests.forEach(item => accountRequests.set(item.accountId, (accountRequests.get(item.accountId) || 0) + item.amountCents));
    const enough = available >= totalRequested && [...accountRequests].every(([accountId, amount]) => amount <= reservationAccountAvailable(state, accountId, now));
    const reservations = requested.map(({ goal, accountId, eligible, amountCents }) => ({
      id: makeId('reservation'), salaryTransactionId: triggerId, goalId: goal.id,
      accountId,
      amountCents: eligible&&enough ? amountCents : 0, amount: eligible&&enough ? euros(amountCents) : 0,
      requestedCents: amountCents, requestedAmount: euros(amountCents),
      status: eligible&&enough ? 'pending' : 'suspended', createdAt: now,
      confirmAt: now + RESERVATION_DELAY_MS, confirmedAt: null, resolvedAt: null,
      reason: !eligible ? `Réservation suspendue : le compte choisi n’est pas inclus dans le calcul du disponible. Choisis un compte courant, espèces ou autre inclus, ou ignore cette réservation.`
        : enough ? `Réservation automatique après le salaire « ${salaryTransaction.label} » : ${moneyText(euros(amountCents))} prévus pour « ${goal.name} ».`
        : `Réservation suspendue : les contributions dépassent le disponible global ou celui du compte choisi, après les charges et réserves existantes.`,
      note: `Calcul : ${goal.autoContribution.mode === 'percent' ? `${goal.autoContribution.value}% de ${moneyText(euros(salaryTransaction.amountCents ?? cents(salaryTransaction.amount)))}` : 'montant fixe'} pour le projet « ${goal.name} ».`
    }));
    state.reservations.push(...reservations);
    if (enough&&eligibleRequests.length) createNotification(state, 'reservation', 'Réservations proposées', `Flow a préparé ${eligibleRequests.length} réservation(s) de projet. Elles seront confirmées dans 5 minutes si tu ne les refuses pas.`, triggerId, now);
    else if(eligibleRequests.length) createNotification(state, 'reservation', 'Réservation en attente de choix', `Le salaire est enregistré, mais les contributions dépassent le disponible. Choisis réduire, ignorer ou répartir au prorata.`, triggerId, now);
    else createNotification(state, 'reservation', 'Compte à modifier', `Les contributions automatiques de ce salaire sont suspendues, car les projets utilisent un compte exclu du disponible.`, triggerId, now);
    return reservations;
  }

  function reservationAccountAvailable(state, accountId, now) {
    const today = isoDate(new Date(now)), nextSalaryDate = getNextSalaryDate(state, today);
    const reserved = state.reservations.filter(item => ['pending', 'confirmed'].includes(item.status) && item.accountId === accountId).reduce((sum, item) => sum + item.amountCents, 0);
    const scheduled = state.recurring.filter(item => item.type === 'expense' && item.accountId === accountId)
      .flatMap(item => monthlyOccurrences(item, item.nextDate, nextSalaryDate).filter(date => date < nextSalaryDate).map(date => ({ item, date })))
      .filter(({ item, date }) => !state.transactions.some(transaction => transaction.type === 'expense' && (transaction.sourceAccountId || transaction.accountId) === accountId && transaction.date === date && (transaction.amountCents ?? cents(transaction.amount)) === (item.amountCents ?? cents(item.amount)) && transaction.label.trim().toLowerCase() === item.label.trim().toLowerCase()))
      .reduce((sum, { item }) => sum + (item.amountCents ?? cents(item.amount)), 0);
    return Math.max(0, getAccountBalanceCents(state, accountId, today) - reserved - scheduled);
  }

  function makeManualReservation(state, goalId, amountValue, accountId, now = Date.now()) {
    const goal = state.goals.find(item => item.id === goalId);
    if (!goal) return { ok: false, reason: 'missing-goal' };
    const account = state.accounts.find(item => item.id === accountId);
    if (!account || !account.includeInSpendable) return { ok: false, reason: 'excluded-account' };
    const requestedCents = cents(amountValue);
    if (requestedCents <= 0) return { ok: false, reason: 'invalid-amount' };
    const active = state.reservations.filter(item => item.goalId === goalId && ['pending', 'confirmed'].includes(item.status));
    const alreadyReserved = active.reduce((sum, item) => sum + item.amountCents, 0);
    const remaining = Math.max(0, (goal.targetCents ?? cents(goal.target)) - (goal.savedCents ?? cents(goal.saved)) - alreadyReserved);
    const amountCents = Math.min(requestedCents, remaining);
    if (!amountCents) return { ok: false, reason: 'goal-complete' };
    const today = isoDate(new Date(now));
    const nextSalaryDate = getNextSalaryDate(state, today);
    const accountReservations = state.reservations.filter(item => ['pending', 'confirmed'].includes(item.status) && item.accountId === accountId).reduce((sum, item) => sum + item.amountCents, 0);
    const accountScheduledExpenses = state.recurring.filter(item => item.type === 'expense' && item.accountId === accountId)
      .flatMap(item => monthlyOccurrences(item, item.nextDate, nextSalaryDate).filter(date => date < nextSalaryDate).map(date => ({ item, date })))
      .filter(({ item, date }) => !state.transactions.some(transaction => transaction.type === 'expense' && (transaction.sourceAccountId || transaction.accountId) === accountId && transaction.date === date && (transaction.amountCents ?? cents(transaction.amount)) === (item.amountCents ?? cents(item.amount)) && transaction.label.trim().toLowerCase() === item.label.trim().toLowerCase()))
      .reduce((sum, { item }) => sum + (item.amountCents ?? cents(item.amount)), 0);
    const accountAvailable = getAccountBalanceCents(state, accountId, today) - accountReservations - accountScheduledExpenses;
    const globalAvailable = getSpendableBreakdown(state, new Date(now)).spendableCents;
    if (amountCents > accountAvailable || amountCents > globalAvailable) return { ok: false, reason: 'insufficient-funds', availableCents: Math.max(0, Math.min(accountAvailable, globalAvailable)) };
    const reservation = {
      id: makeId('reservation'), salaryTransactionId: `manual:${makeId('goal')}`, goalId, accountId,
      amountCents, amount: euros(amountCents), requestedCents, requestedAmount: euros(requestedCents),
      status: 'confirmed', createdAt: now, confirmAt: now, confirmedAt: now, resolvedAt: null,
      manual: true,
      reason: `Réservé dans Flow : ${moneyText(euros(amountCents))} mis de côté pour « ${goal.name} ». Aucun virement bancaire n’a été effectué.`,
      note: 'Réserve virtuelle Flow ; le solde réel du compte bancaire ne change pas.'
    };
    state.reservations.push(reservation);
    createNotification(state, 'reservation', 'Montant réservé pour un projet', reservation.reason, reservation.id, now);
    return { ok: true, reservation, capped: amountCents < requestedCents };
  }

  function allocateProRata(items, availableCents) {
    const total = items.reduce((sum, item) => sum + item.requestedCents, 0);
    const budget = Math.max(0, Math.min(availableCents, total));
    if (!total || !budget) return items.map(() => 0);
    const shares = items.map(item => ({ raw: budget * item.requestedCents / total, value: Math.floor(budget * item.requestedCents / total) }));
    let remainder = budget - shares.reduce((sum, item) => sum + item.value, 0);
    shares.map((share, index) => ({ index, fraction: share.raw - share.value })).sort((a, b) => b.fraction - a.fraction).forEach(item => { if (remainder-- > 0) shares[item.index].value++; });
    return shares.map(item => item.value);
  }

  function resolveReservation(state, reservationId, action, now = Date.now(), amountValue) {
    const target = state.reservations.find(item => item.id === reservationId);
    if (!target) return { ok: false, reason: 'missing' };
    if (action === 'deny' || action === 'skip') {
      if (!['pending', 'suspended'].includes(target.status)) return { ok: false, reason: 'already-resolved' };
      target.status = action === 'deny' ? 'denied' : 'skipped'; target.amountCents = 0; target.amount = 0; target.resolvedAt = now;
      target.reason = action === 'deny' ? 'Refusée avant confirmation ; aucun montant n’a été réservé.' : 'Ignorée ; aucun montant n’a été réservé.';
      createNotification(state, 'reservation', action === 'deny' ? 'Réservation refusée' : 'Réservation ignorée', target.reason, target.id, now);
      return { ok: true, reservations: [target] };
    }
    if (action === 'release') {
      if (!['pending', 'confirmed'].includes(target.status)) return { ok: false, reason: 'not-active' };
      target.status = 'released'; target.resolvedAt = now; target.reason = state.accounts.some(account=>account.id===target.accountId&&account.includeInSpendable)?`Réserve libérée manuellement : ${moneyText(euros(target.amountCents))} rendus au disponible Flow.`:`Réserve levée : ${moneyText(euros(target.amountCents))} libérés. Le disponible reste inchangé, car le compte est exclu de son calcul.`;
      createNotification(state, 'reservation', 'Réserve libérée', target.reason, target.id, now);
      return { ok: true, reservations: [target] };
    }
    if (target.status !== 'suspended') return { ok: false, reason: 'not-suspended' };
    if (action!=='skip'&&!state.accounts.some(account=>account.id===target.accountId&&account.includeInSpendable)) return { ok:false,reason:'excluded-account' };
    const group = state.reservations.filter(item => item.salaryTransactionId === target.salaryTransactionId && item.status === 'suspended'&&state.accounts.some(account=>account.id===item.accountId&&account.includeInSpendable));
    const available = getSpendableBreakdown(state, new Date(now)).spendableCents;
    const remainingFor = item => {
      const goal = state.goals.find(goal => goal.id === item.goalId);
      if (!goal) return 0;
      const reserved = state.reservations.filter(other => other.goalId === goal.id && ['pending', 'confirmed'].includes(other.status)).reduce((sum, other) => sum + other.amountCents, 0);
      return Math.max(0, (goal.targetCents ?? cents(goal.target)) - (goal.savedCents ?? cents(goal.saved)) - reserved);
    };
    if (action === 'reduce') {
      const desired = amountValue == null ? Math.min(target.requestedCents, Math.max(0, available)) : Math.min(target.requestedCents, Math.max(0, cents(amountValue)));
      const alloc = Math.min(desired, Math.max(0, available), remainingFor(target), reservationAccountAvailable(state, target.accountId, now));
      target.amountCents = alloc; target.amount = euros(alloc); target.status = alloc ? 'pending' : 'skipped'; target.confirmAt = now + RESERVATION_DELAY_MS; target.resolvedAt = null;
      target.reason = alloc ? `Montant réduit manuellement à ${moneyText(euros(alloc))}. Confirmation automatique dans 5 minutes si tu ne refuses pas.` : 'Aucun montant disponible : réservation ignorée.';
      createNotification(state, 'reservation', 'Réservation ajustée', target.reason, target.id, now);
      return { ok: true, reservations: [target] };
    }
    if (action === 'prorata') {
      const allocation = allocateProRata(group.map(item => ({ requestedCents: Math.min(item.requestedCents, remainingFor(item)) })), available);
      group.forEach((item, index) => {
        const amount = Math.min(allocation[index], remainingFor(item), reservationAccountAvailable(state, item.accountId, now)); item.amountCents = amount; item.amount = euros(amount);
        item.status = amount ? 'pending' : 'skipped'; item.confirmAt = now + RESERVATION_DELAY_MS; item.resolvedAt = null;
        item.reason = amount ? `Répartie au prorata du disponible : ${moneyText(euros(amount))} affectés à ce projet. Confirmation dans 5 minutes si tu ne refuses pas.` : 'Part allouée nulle au prorata : aucun montant réservé.';
      });
      createNotification(state, 'reservation', 'Répartition au prorata', `Le disponible a été réparti au prorata entre ${group.length} projet(s). Chaque montant attend 5 minutes avant confirmation.`, target.salaryTransactionId, now);
      return { ok: true, reservations: group };
    }
    return { ok: false, reason: 'unknown-action' };
  }

  function confirmDueReservations(state, now = Date.now()) {
    const confirmed = [];
    for (const reservation of state.reservations) {
      if (reservation.status !== 'pending' || reservation.confirmAt > now) continue;
      reservation.status = 'confirmed'; reservation.confirmedAt = now;
      reservation.reason = `Confirmée automatiquement après 5 minutes sans refus : ${moneyText(euros(reservation.amountCents))} restent réservés à ce projet.`;
      createNotification(state, 'reservation', 'Réservation confirmée', reservation.reason, reservation.id, now);
      confirmed.push(reservation);
    }
    return confirmed;
  }

  function moneyText(value) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
  }

  function reconcileAccountBalance(state, accountId, currentBalance, date = new Date()) {
    const account = state.accounts.find(item => item.id === accountId);
    if (!account) return { ok: false, reason: 'missing-account' };
    if (!Number.isFinite(Number(currentBalance)) || Math.abs(Number(currentBalance)) > MAX_AMOUNT_EUR) return { ok: false, reason: 'invalid-amount' };
    const desired = cents(currentBalance);
    let ledgerNet = 0;
    const cutoff = isoDate(date);
    for (const transaction of state.transactions) {
      if (transaction.date > cutoff) continue;
      const amount = transaction.amountCents ?? cents(transaction.amount);
      if (transaction.type === 'transfer') {
        if (transaction.sourceAccountId === accountId || transaction.accountId === accountId) ledgerNet -= amount;
        if (transaction.targetAccountId === accountId) ledgerNet += amount;
      } else if ((transaction.sourceAccountId || transaction.accountId) === accountId) ledgerNet += transaction.type === 'income' ? amount : -amount;
    }
    const previousCents = getAccountBalanceCents(state, accountId, cutoff);
    account.openingBalance = euros(desired - ledgerNet);
    account.reconciledAt = date instanceof Date ? date.getTime() : Number(date) || Date.now();
    account.reconciledBalance = euros(desired);
    return { ok: true, previous: euros(previousCents), current: euros(desired), openingBalance: account.openingBalance };
  }

  function legacyFingerprint(row, accountId) {
    const source = [String(row.date || ''), String(row.label || row.description || '').trim().toLowerCase(), String(cents(row.amount)).replace('-', ''), String(row.amount < 0 ? 'expense' : 'income'), String(row.reference || row.id || ''), String(accountId || '')].join('|');
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return `fp-${(hash >>> 0).toString(16)}`;
  }

  function stableFingerprint(row, accountId) {
    // Structured encoding avoids delimiter ambiguity as well as 32-bit collisions.
    return `fp2-${identifierDigest(JSON.stringify([String(row.date || ''), String(row.label || row.description || '').trim().toLowerCase(), cents(row.amount), String(row.reference || row.id || ''), String(accountId || '')]))}`;
  }

  function addImportedTransactions(state, rows, accountId) {
    const accounts = new Set(state.accounts.map(account => account.id));
    if (!accounts.has(String(accountId))) return { added: 0, duplicates: 0, invalid: safeArray(rows).length, transactions: [] };
    const fingerprints = new Set(state.importFingerprints);
    const transactionIds = new Set(state.transactions.map(transaction => transaction.id));
    let added = 0, duplicates = 0, invalid = 0;
    const transactions = [], legacyReview = [];
    for (const row of safeArray(rows)) {
      const rawAmount = Number(row.amount);
      if (!Number.isFinite(rawAmount) || Math.abs(rawAmount) > MAX_AMOUNT_EUR || cents(rawAmount) === 0 || !isIsoDate(String(row.date || ''))) { invalid++; continue; }
      const fingerprint = String(row.fingerprint || row.importFingerprint || stableFingerprint(row, accountId));
      const rawId=String(row.id||'');
      if (/^[A-Za-z0-9._:-]{1,128}$/.test(rawId) && transactionIds.has(rawId)) { duplicates++; continue; }
      const id = safeId(row.id || makeId('import'), 'import', new Set(transactionIds));
      if (fingerprints.has(fingerprint) || transactionIds.has(id)) { duplicates++; continue; }
      // Older backups did not retain bank references. An old hash alone cannot
      // prove equality: report uncertainty instead of silently losing or doubling data.
      if (!row.fingerprint && !row.importFingerprint && fingerprints.has(legacyFingerprint(row, accountId))) {
        legacyReview.push({ date: row.date, label: String(row.label || row.description || ''), amount: rawAmount, reference: String(row.reference || row.id || '') });
        continue;
      }
      const amountCents = Math.abs(cents(rawAmount));
      const type = rawAmount < 0 ? 'expense' : 'income';
      const transaction = {
        id, type, amount: euros(amountCents), amountCents,
        label: String(row.label || row.description || 'Import bancaire').trim() || 'Import bancaire',
        category: String(row.category || (type === 'income' ? 'autre' : 'autre')),
        date: String(row.date), accountId: String(accountId), sourceAccountId: String(accountId), targetAccountId: null,
        salary: type === 'income' && Boolean(row.isSalary ?? row.salary), note: String(row.note || ''), favorite: false,
        reconciled: false, importFingerprint: fingerprint, source: String(row.source || 'csv')
      };
      state.transactions.push(transaction); fingerprints.add(fingerprint); transactionIds.add(id); transactions.push(transaction); added++;
    }
    state.importFingerprints = [...fingerprints];
    for (const transaction of transactions) if (transaction.salary) makeReservationCandidates(state, transaction);
    return { added, duplicates, invalid, transactions, legacyReview };
  }

  function markNotificationRead(state, notificationId, read = true) {
    const notification = state.notifications.find(item => item.id === notificationId);
    if (!notification) return false;
    notification.read = Boolean(read); return true;
  }

  function confirmRecurringOccurrence(state, recurringId, occurrenceDate, todayValue = new Date()) {
    const recurring=state.recurring.find(item=>item.id===recurringId);
    if(!recurring || recurring.nextDate!==occurrenceDate) return {ok:false,reason:'stale'};
    if(occurrenceDate>isoDate(todayValue)) return {ok:false,reason:'future'};
    const occurrenceKey=`rec:${recurring.id}:${occurrenceDate}`;
    let transaction=state.transactions.find(item=>item.id===occurrenceKey || item.recurringOccurrence===occurrenceKey);
    // Keep the complete occurrence association separately from the bounded ID.
    // Existing short IDs remain compatible with previously saved triggers.
    const id = transaction?.id || (occurrenceKey.length <= 128 ? occurrenceKey : `rec-${identifierDigest(occurrenceKey)}`);
    // Use the same evidence as the spending forecast, but never consume a
    // payment already associated with another recurring occurrence.
    if (!transaction && recurring.type === 'expense') {
      transaction = state.transactions.find(item => item.type === 'expense' && !item.recurringOccurrence && item.source !== 'recurring' &&
        (item.sourceAccountId || item.accountId) === recurring.accountId && item.date === occurrenceDate &&
        (item.amountCents ?? cents(item.amount)) === (recurring.amountCents ?? cents(recurring.amount)) &&
        item.label.trim().toLowerCase() === recurring.label.trim().toLowerCase());
    }
    const added=!transaction;
    if(added){transaction={id,type:recurring.type,amount:recurring.amount,amountCents:recurring.amountCents??cents(recurring.amount),label:recurring.label,category:recurring.category,date:occurrenceDate,accountId:recurring.accountId,sourceAccountId:recurring.accountId,salary:recurring.type==='income'&&(recurring.salary||recurring.category==='salaire'),source:'recurring'};state.transactions.push(transaction);}
    transaction.recurringOccurrence = occurrenceKey;
    if(recurring.frequency==='once')state.recurring=state.recurring.filter(item=>item.id!==recurringId);
    else {
      const date=new Date(`${occurrenceDate}T12:00:00`),day=date.getDate();
      if(recurring.frequency==='weekly')date.setDate(day+7);
      else if(recurring.frequency==='yearly'){const month=date.getMonth();date.setDate(1);date.setFullYear(date.getFullYear()+1);date.setMonth(month);date.setDate(Math.min(day,new Date(date.getFullYear(),month+1,0).getDate()));}
      else {date.setDate(1);date.setMonth(date.getMonth()+1);date.setDate(Math.min(day,new Date(date.getFullYear(),date.getMonth()+1,0).getDate()));}
      recurring.nextDate=isoDate(date);
    }
    return {ok:true,added,transaction,nextDate:recurring.frequency==='once'?null:recurring.nextDate};
  }

  function addReminder(state, item) {
    if (!item || !String(item.title || '').trim()) return { ok: false, reason: 'missing-title' };
    const reminder = { id: makeId('reminder'), title: String(item.title).trim(), date: isoDate(item.date || Date.now()), note: String(item.note || ''), kind: String(item.kind || 'custom'), createdAt: Date.now(), done: false };
    state.reminders.push(reminder);
    createNotification(state, 'reminder', 'Rappel créé', `${reminder.title} · ${reminder.date}`, reminder.id);
    return { ok: true, reminder };
  }

  return {
    VERSION, RESERVATION_DELAY_MS, cents, euros, isoDate, isIsoDate, makeId,
    getEmptyState, normalizeState, getAccountBalance, getAccountBalanceCents, getTotalBalanceCents,
    getSpendableUntilSalary, getSpendableBreakdown, getNextSalaryDate, activeReservedCents,
    makeReservationCandidates, makeManualReservation, confirmDueReservations, resolveReservation, reconcileAccountBalance,
    addImportedTransactions, stableFingerprint, markNotificationRead, addReminder, createNotification, confirmRecurringOccurrence
  };
});
