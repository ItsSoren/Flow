(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FlowCSV = api; api.mount(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 2 * 1024 * 1024, MAX_ROWS = 10000;
  const canonical = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function parseCSV(text, separator) {
    if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error('Relevé trop volumineux : 2 Mo maximum.');
    text = text.replace(/^\uFEFF/, '');
    if (!separator) {
      const first = text.split(/\r?\n/).find(line => line.trim()) || '';
      const counts = [';', '\t', ','].map(s => [s, (first.match(new RegExp(s === '\t' ? '\t' : s, 'g')) || []).length]);
      separator = counts.sort((a, b) => b[1] - a[1])[0][0];
    }
    if (![';', ',', '\t'].includes(separator)) throw new Error('Séparateur non reconnu.');
    const records = []; let row = [], field = '', quoted = false;
    const finishRow = () => { row.push(field); field = ''; if (row.some(v => v.trim())) records.push(row); row = []; if (records.length > MAX_ROWS + 1) throw new Error('10 000 opérations maximum par import.'); };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; }
        else if (quoted || field.length === 0) quoted = !quoted;
        else field += char;
      } else if (char === separator && !quoted) { row.push(field); field = ''; }
      else if ((char === '\r' || char === '\n') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i++; finishRow(); }
      else field += char;
    }
    if (quoted) throw new Error('Le CSV contient un champ entre guillemets incomplet.');
    if (field.length || row.length) finishRow();
    if (records.length < 2) throw new Error('Le relevé doit contenir un en-tête et au moins une opération.');
    const headers = records.shift().map((value, i) => value.trim() || `Colonne ${i + 1}`);
    if (headers.length > 60) throw new Error('Trop de colonnes dans ce relevé.');
    return { headers, records, separator };
  }
  function parseAmount(value) {
    let s = String(value ?? '').trim().replace(/[\s\u00a0\u202f€$£]/g, '');
    if (!s) return null;
    if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
    if (/^[0-9.,]+-$/.test(s)) s = '-' + s.slice(0, -1);
    if (!/^[+-]?[\d.,]+$/.test(s)) return null;
    const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (comma >= 0) s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) && Math.abs(n) <= 1e9 ? Math.round(n * 100) / 100 : null;
  }
  function parseDate(value) {
    const text = String(value || '').trim();
    let year, month, day, match;
    if ((match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/.exec(text))) [, year, month, day] = match;
    else if ((match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text))) [, day, month, year] = match;
    else return null;
    year = Number(year); month = Number(month); day = Number(day);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function guessMapping(headers) {
    const aliases = { date: ['date', 'dateoperation', 'datecomptabilisation', 'bookingdate', 'transactiondate'], label: ['libelle', 'description', 'label', 'operation', 'details', 'nom'], amount: ['montant', 'amount', 'montanteur', 'montanteneur', 'valeur'], debit: ['debit', 'debits', 'sortie'], credit: ['credit', 'credits', 'entree'], reference: ['reference', 'id', 'transactionid'] };
    const result = {};
    for (const [key, names] of Object.entries(aliases)) result[key] = headers.findIndex(header => names.includes(canonical(header)));
    return result;
  }
  function convertRows(parsed, mapping) {
    if (mapping.date < 0 || mapping.label < 0 || (mapping.amount < 0 && mapping.debit < 0 && mapping.credit < 0)) throw new Error('Choisis les colonnes date, libellé et montant (ou débit / crédit).');
    const rows = [], errors = [];
    parsed.records.forEach((cells, index) => {
      const date = parseDate(cells[mapping.date]), label = String(cells[mapping.label] || '').trim().slice(0, 500);
      let amount = mapping.amount >= 0 ? parseAmount(cells[mapping.amount]) : null;
      if (mapping.amount < 0) {
        const debit = mapping.debit >= 0 ? parseAmount(cells[mapping.debit]) : 0;
        const credit = mapping.credit >= 0 ? parseAmount(cells[mapping.credit]) : 0;
        if ((debit || 0) && (credit || 0)) { errors.push({ line: index + 2, reason: 'débit et crédit simultanés' }); return; }
        if ((mapping.debit >= 0 && cells[mapping.debit]?.trim() && debit === null) || (mapping.credit >= 0 && cells[mapping.credit]?.trim() && credit === null)) amount = null;
        else amount = Math.abs(credit || 0) - Math.abs(debit || 0);
      }
      if (!date || !label || amount === null || amount === 0) { errors.push({ line: index + 2, reason: !date ? 'date invalide' : !label ? 'libellé vide' : 'montant invalide ou nul' }); return; }
      rows.push({ date, label, amount, reference: mapping.reference >= 0 ? String(cells[mapping.reference] || '').slice(0, 200) : '', source: 'csv', isSalary: false });
    });
    return { rows, errors };
  }
  function mount() {
    const $ = id => document.getElementById(id);
    const file = $('bankImportFile'); if (!file) return;
    let parsed = null, converted = null, selectedAccount = '';
    const status = text => { if ($('bankImportStatus')) $('bankImportStatus').textContent = text; };
    const refreshAccounts = () => {
      const select = $('bankImportAccount'); if (!select || !window.FlowApp) return;
      const old = select.value; select.replaceChildren();
      (window.FlowApp.getAccounts?.() || window.FlowApp.getState().accounts).forEach(account => { const option = document.createElement('option'); option.value = account.id; option.textContent = account.name; select.append(option); });
      if ([...select.options].some(o => o.value === old)) select.value = old;
    };
    const renderPreview = () => {
      converted = null; $('bankImportConfirm').disabled = true;
      const preview = $('bankImportPreview'); preview.replaceChildren();
      if (!parsed) return;
      const mapping = {};
      document.querySelectorAll('[data-csv-column]').forEach(el => mapping[el.dataset.csvColumn] = Number(el.value));
      try { converted = convertRows(parsed, mapping); } catch (error) { status(error.message); return; }
      selectedAccount = $('bankImportAccount').value;
      const summary = document.createElement('p'); summary.textContent = `${converted.rows.length} opérations valides · ${converted.errors.length} lignes ignorées. Aperçu des 8 premières :`; preview.append(summary);
      converted.rows.slice(0, 8).forEach(row => { const p = document.createElement('p'); p.className = 'csv-preview-row'; p.textContent = `${row.date} · ${row.label} · ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(row.amount)}`; preview.append(p); });
      if (converted.errors.length) { const p = document.createElement('p'); p.textContent = 'À vérifier : ' + converted.errors.slice(0, 5).map(e => `ligne ${e.line} (${e.reason})`).join(', '); preview.append(p); }
      status('Vérifie les signes : positif = revenu, négatif = dépense. Aucun salaire n’est confirmé automatiquement par cet import. Les doublons déjà importés seront ignorés.');
      $('bankImportConfirm').disabled = !converted.rows.length || !selectedAccount;
    };
    file.addEventListener('change', async () => {
      parsed = null; converted = null; $('bankImportConfirm').disabled = true;
      const chosen = file.files?.[0]; if (!chosen) return;
      if (chosen.size > MAX_BYTES) { status('Relevé trop volumineux : 2 Mo maximum.'); return; }
      try {
        const bytes = await chosen.arrayBuffer();
        let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) { text = new TextDecoder('windows-1252').decode(bytes); }
        parsed = parseCSV(text); const guess = guessMapping(parsed.headers), mount = $('bankImportMapping'); mount.replaceChildren();
        for (const [key, title] of Object.entries({ date: 'Date', label: 'Libellé', amount: 'Montant signé', debit: 'Débit', credit: 'Crédit', reference: 'Référence (facultatif)' })) {
          const label = document.createElement('label'); label.textContent = title;
          const select = document.createElement('select'); select.dataset.csvColumn = key;
          const none = document.createElement('option'); none.value = '-1'; none.textContent = 'Non utilisée'; select.append(none);
          parsed.headers.forEach((header, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = header; select.append(option); });
          select.value = String(guess[key]); select.addEventListener('change', renderPreview); label.append(select); mount.append(label);
        }
        $('bankImportConfirm').classList.remove('hidden');
        renderPreview();
      } catch (error) { status(error.message); }
    });
    $('bankImportAccount').addEventListener('change', renderPreview);
    $('bankImportConfirm').disabled = true;
    $('bankImportConfirm').addEventListener('click', () => {
      if (!converted?.rows.length || selectedAccount !== $('bankImportAccount').value) return;
      const result = window.FlowApp.addImportedTransactions(converted.rows, selectedAccount);
      status(`${result.added} opérations ajoutées · ${result.duplicates} doublons ignorés · ${result.invalid} lignes invalides. Ton relevé n’a pas été envoyé à un service bancaire.`);
      converted = null; $('bankImportConfirm').disabled = true;
    });
    $('bankImportApplyBalance')?.classList.remove('hidden');
    $('bankImportApplyBalance')?.addEventListener('click', () => {
      const amount = parseAmount($('bankImportBalance').value), accountId = $('bankImportAccount').value;
      if (amount === null || !accountId) { status('Saisis un solde bancaire valide.'); return; }
      if (!confirm('Ajuster le solde de départ pour que le solde calculé corresponde au solde bancaire saisi ? L’historique des opérations sera conservé.')) return;
      const result = window.FlowApp.reconcileAccountBalance(accountId, amount, Date.now());
      status(result?.ok ? 'Solde rapproché. L’historique a été conservé.' : 'Le rapprochement n’a pas pu être effectué.');
    });
    refreshAccounts(); window.addEventListener('flow:state-change', refreshAccounts); window.addEventListener('flow:auth-state', refreshAccounts);
  }
  return { parseCSV, parseAmount, parseDate, guessMapping, convertRows, mount, MAX_ROWS, MAX_BYTES };
});
