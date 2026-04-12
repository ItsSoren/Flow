/* ── FLŌW – script.js ── */
'use strict';

// ── STATE ─────────────────────────────────────────────────────────────────
const S = {
  transactions: [],  // {id,type,amount,currency,cat,desc,date}
  revenus: [],       // {id,amount,currency,desc,recurrence,start,end}
  objectifs: [],     // {id,name,emoji,type,amount,color,cat,created}
  currency: 'EUR',
  cycle: 'month',
  statsPeriod: 'month',
  rates: { EUR:1, USD:1.08, GBP:0.86, JPY:160.5, CHF:0.98, CAD:1.46 },
  symbols: { EUR:'€', USD:'$', GBP:'£', JPY:'¥', CHF:'Fr', CAD:'C$' },
  catEmoji: { salaire:'💰', loyer:'🏠', courses:'🛒', loisirs:'🎮', transport:'🚗', sante:'🏥', epargne:'🏦', autre:'📦' },
  catColors: { loyer:'#ff3cac', courses:'#2979ff', loisirs:'#aa00ff', transport:'#ffab00', sante:'#00bcd4', epargne:'#00e676', autre:'#6a9070' },
};

// ── CHARTS (destroy before recreate) ─────────────────────────────────────
const charts = {};
function destroyChart(id) { if(charts[id]) { charts[id].destroy(); delete charts[id]; } }

// ── PERSISTENCE ───────────────────────────────────────────────────────────
function save() {
  const data = { transactions:S.transactions, revenus:S.revenus, objectifs:S.objectifs, currency:S.currency, cycle:S.cycle, rates:S.rates };
  localStorage.setItem('flow_v2', JSON.stringify(data));
}
function load() {
  try {
    const raw = localStorage.getItem('flow_v2');
    if(!raw) return;
    const d = JSON.parse(raw);
    if(d.transactions) S.transactions = d.transactions;
    if(d.revenus) S.revenus = d.revenus;
    if(d.objectifs) S.objectifs = d.objectifs;
    if(d.currency) S.currency = d.currency;
    if(d.cycle) S.cycle = d.cycle;
    if(d.rates) Object.assign(S.rates, d.rates);
  } catch(e) { console.warn('load error', e); }
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0,10); }
function inCycle(dateStr, cycle) {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  if(cycle === 'week') {
    const dow = now.getDay();
    const start = new Date(now); start.setDate(now.getDate() - dow); start.setHours(0,0,0,0);
    const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999);
    return d >= start && d <= end;
  }
  if(cycle === 'month') return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  if(cycle === 'year') return d.getFullYear()===now.getFullYear();
  return true;
}
function inPeriod(dateStr, period) { return inCycle(dateStr, period); }

// ── RECURRING INCOME ENGINE ───────────────────────────────────────────────
// Returns virtual income transactions for a given cycle
function getRecurringTxForCycle(cycle) {
  const result = [];
  const now = new Date();

  // Build all dates within cycle that a revenue recurrence covers
  S.revenus.forEach(rv => {
    const start = new Date(rv.start + 'T00:00:00');
    const end = rv.end ? new Date(rv.end + 'T00:00:00') : new Date('2099-12-31');

    // Get range for the cycle
    let rangeStart, rangeEnd;
    if(cycle === 'week') {
      rangeStart = new Date(now); rangeStart.setDate(now.getDate() - now.getDay()); rangeStart.setHours(0,0,0,0);
      rangeEnd = new Date(rangeStart); rangeEnd.setDate(rangeStart.getDate() + 6); rangeEnd.setHours(23,59,59,999);
    } else if(cycle === 'month') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
      rangeEnd = new Date(now.getFullYear(), now.getMonth()+1, 0, 23,59,59);
    } else {
      rangeStart = new Date(now.getFullYear(), 0, 1);
      rangeEnd = new Date(now.getFullYear(), 11, 31, 23,59,59);
    }

    const effectiveStart = start > rangeStart ? start : rangeStart;
    const effectiveEnd = end < rangeEnd ? end : rangeEnd;
    if(effectiveStart > effectiveEnd) return;

    const hits = getRecurrenceDatesInRange(rv.recurrence, rv.start, effectiveStart, effectiveEnd);
    hits.forEach(dateStr => {
      result.push({ id: 'rv_'+rv.id+'_'+dateStr, type:'income', amount:rv.amount, currency:rv.currency, cat:'salaire', desc:rv.desc, date:dateStr, isRecurring:true });
    });
  });
  return result;
}

function getRecurrenceDatesInRange(recurrence, startStr, rangeStart, rangeEnd) {
  if(recurrence === 'once') {
    const d = new Date(startStr + 'T00:00:00');
    if(d >= rangeStart && d <= rangeEnd) return [startStr];
    return [];
  }
  const dates = [];
  const cursor = new Date(startStr + 'T00:00:00');

  // Advance cursor to at least rangeStart
  while(cursor < rangeStart) advanceCursor(cursor, recurrence);
  while(cursor <= rangeEnd) {
    dates.push(cursor.toISOString().slice(0,10));
    advanceCursor(cursor, recurrence);
    if(dates.length > 100) break; // safety
  }
  return dates;
}

function advanceCursor(cursor, recurrence) {
  switch(recurrence) {
    case 'weekly':    cursor.setDate(cursor.getDate() + 7); break;
    case 'biweekly':  cursor.setDate(cursor.getDate() + 14); break;
    case 'monthly':   cursor.setMonth(cursor.getMonth() + 1); break;
    case 'quarterly': cursor.setMonth(cursor.getMonth() + 3); break;
    case 'yearly':    cursor.setFullYear(cursor.getFullYear() + 1); break;
    default:          cursor.setFullYear(2100); // once → stop
  }
}

// ── CURRENCY ──────────────────────────────────────────────────────────────
function toBase(amount, from) { return amount / S.rates[from]; }
function toDisplay(base) { return base * S.rates[S.currency]; }
function fmt(amount) {
  const sym = S.symbols[S.currency];
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if(S.currency === 'JPY') return sign + sym + Math.round(abs).toLocaleString('fr-FR');
  return sign + sym + abs.toLocaleString('fr-FR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

// ── COMBINED TXNS FOR A CYCLE ─────────────────────────────────────────────
function getAllTxForCycle(cycle) {
  const manual = S.transactions.filter(t => inCycle(t.date, cycle));
  const recurring = getRecurringTxForCycle(cycle);
  return [...manual, ...recurring];
}
function getAllTxForPeriod(period) { return getAllTxForCycle(period); }

function calcTotals(txs) {
  let income=0, expense=0, bonus=0;
  txs.forEach(t => {
    const v = toDisplay(toBase(t.amount, t.currency));
    if(t.type==='income') income+=v;
    else if(t.type==='expense') expense+=v;
    else if(t.type==='bonus') bonus+=v;
  });
  return { income, expense, bonus, balance: income+bonus-expense };
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────
function updateDashboard() {
  const txs = getAllTxForCycle(S.cycle);
  const { income, expense, bonus, balance } = calcTotals(txs);

  const labels = { week:'cette semaine', month:'ce mois', year:'cette année' };
  document.getElementById('cycleLabel').textContent = labels[S.cycle];

  const heroAmt = document.getElementById('heroAmount');
  heroAmt.textContent = fmt(balance);
  heroAmt.className = 'hero-amount' + (balance < 0 ? ' negative' : '');

  document.getElementById('heroIncome').textContent = fmt(income);
  document.getElementById('heroExpense').textContent = fmt(expense);
  document.getElementById('heroBonus').textContent = fmt(bonus);

  const totalIn = income + bonus;
  document.getElementById('kpiSaved').textContent = fmt(Math.max(0, balance));
  document.getElementById('kpiSpent').textContent = fmt(expense);
  document.getElementById('kpiTxn').textContent = txs.length;

  // Mini chart (7 days)
  renderMiniChart();

  // Objectifs dashboard
  renderDashObjectifs();

  // Recent list
  const recent = [...S.transactions].sort((a,b) => b.date.localeCompare(a.date)).slice(0,5);
  renderTxList('recentList', recent, true);
}

// ── MINI CHART ────────────────────────────────────────────────────────────
function renderMiniChart() {
  destroyChart('mini');
  const ctx = document.getElementById('miniChart');
  if(!ctx) return;

  const days = [];
  for(let i=6;i>=0;i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    days.push(d.toISOString().slice(0,10));
  }
  const labels = days.map(d => { const dt=new Date(d+'T00:00:00'); return dt.toLocaleDateString('fr-FR',{weekday:'short'}); });

  const allTx = getAllTxForCycle('week');
  const incomeData = days.map(d => {
    const v = calcTotals(allTx.filter(t => t.date===d && (t.type==='income'||t.type==='bonus')));
    return v.income + v.bonus;
  });
  const expData = days.map(d => calcTotals(allTx.filter(t => t.date===d && t.type==='expense')).expense);

  // Also include manual txns from other weeks but same days
  const allManual = S.transactions;
  const incD = days.map(d => {
    const v = calcTotals(allManual.filter(t => t.date===d && (t.type==='income'||t.type==='bonus')));
    return v.income + v.bonus;
  });
  const expD = days.map(d => calcTotals(allManual.filter(t => t.date===d && t.type==='expense')).expense);

  charts['mini'] = new Chart(ctx, {
    type:'line',
    data:{
      labels,
      datasets:[
        { label:'Revenus', data:incomeData, borderColor:'#00e676', backgroundColor:'rgba(0,230,118,.07)', fill:true, tension:.4, pointBackgroundColor:'#00e676', pointRadius:4, pointHoverRadius:6 },
        { label:'Dépenses', data:expData, borderColor:'#ff3cac', backgroundColor:'rgba(255,60,172,.07)', fill:true, tension:.4, pointBackgroundColor:'#ff3cac', pointRadius:4, pointHoverRadius:6 },
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      animation:{ duration:600 },
      plugins:{ legend:{ labels:{ color:'#6a9070', font:{ family:'DM Sans' }, boxWidth:12 } } },
      scales:{
        x:{ ticks:{ color:'#6a9070', font:{size:11} }, grid:{ display:false } },
        y:{ ticks:{ color:'#6a9070', font:{size:11}, callback:v=>fmt(v) }, grid:{ color:'rgba(255,255,255,.04)' } }
      }
    }
  });
}

// ── RENDER TX LIST ────────────────────────────────────────────────────────
function renderTxList(containerId, txs, mini=false) {
  const el = document.getElementById(containerId);
  if(!txs.length) {
    el.innerHTML = '<div class="empty-state"><div class="ei">🌿</div>Aucune opération ici</div>';
    return;
  }
  el.innerHTML = '';
  txs.forEach(t => {
    const v = toDisplay(toBase(t.amount, t.currency));
    const div = document.createElement('div');
    div.className = 'tx-item';
    const sign = t.type==='expense' ? '-' : '+';
    div.innerHTML = `
      <div class="tx-ico ${t.type}">${S.catEmoji[t.cat]||'📦'}</div>
      <div class="tx-info">
        <div class="tx-desc">${escHtml(t.desc||t.cat)}</div>
        <div class="tx-meta">${fmtDate(t.date)} · ${t.cat}${t.currency!==S.currency?' · orig. '+S.symbols[t.currency]+t.amount:''}</div>
      </div>
      <div class="tx-amount ${t.type}">${sign}${fmt(v)}</div>
      ${!mini?`<button class="tx-del" data-id="${t.id}" title="Supprimer">🗑</button>`:''}
    `;
    el.appendChild(div);
  });
  if(!mini) {
    el.querySelectorAll('.tx-del').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); deleteTx(btn.dataset.id); });
    });
  }
}

function deleteTx(id) {
  S.transactions = S.transactions.filter(t => t.id!==id);
  save(); refreshAll(); toast('Transaction supprimée','err');
}

function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(str) { return new Date(str+'T00:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}); }

// ── REVENUS PAGE ──────────────────────────────────────────────────────────
function updateRevenuPage() {
  const el = document.getElementById('revenuList');
  if(!S.revenus.length) {
    el.innerHTML = '<div class="empty-state"><div class="ei">💚</div>Aucun revenu récurrent défini</div>';
    return;
  }
  const recurLabels = { once:'Une fois', weekly:'Chaque semaine', biweekly:'Toutes les 2 sem.', monthly:'Chaque mois', quarterly:'Chaque trimestre', yearly:'Chaque année' };
  el.innerHTML = '';
  S.revenus.forEach(rv => {
    const v = toDisplay(toBase(rv.amount, rv.currency));
    const div = document.createElement('div');
    div.className = 'rv-item';
    div.innerHTML = `
      <div class="rv-badge">${recurLabels[rv.recurrence]||rv.recurrence}</div>
      <div class="rv-info">
        <div class="rv-desc">${escHtml(rv.desc||'Revenu')}</div>
        <div class="rv-meta">Depuis ${fmtDate(rv.start)}${rv.end?' · jusqu\'au '+fmtDate(rv.end):''}</div>
      </div>
      <div class="rv-amount">${fmt(v)}</div>
      <button class="rv-del" data-id="${rv.id}" title="Supprimer">🗑</button>
    `;
    el.appendChild(div);
  });
  el.querySelectorAll('.rv-del').forEach(btn => {
    btn.addEventListener('click', () => { S.revenus=S.revenus.filter(r=>r.id!==btn.dataset.id); save(); refreshAll(); toast('Revenu supprimé','err'); });
  });
}

// ── TRANSACTIONS PAGE ─────────────────────────────────────────────────────
function updateTxPage() {
  let txs = [...S.transactions].sort((a,b) => b.date.localeCompare(a.date));
  const type = document.getElementById('filterType').value;
  const cat = document.getElementById('filterCat').value;
  const q = document.getElementById('searchTx').value.toLowerCase();
  if(type!=='all') txs=txs.filter(t=>t.type===type);
  if(cat!=='all') txs=txs.filter(t=>t.cat===cat);
  if(q) txs=txs.filter(t=>(t.desc||'').toLowerCase().includes(q)||t.cat.includes(q));
  renderTxList('txList', txs, false);
}

// ── OBJECTIFS PAGE ────────────────────────────────────────────────────────
function updateObjectifsPage() {
  renderObjectifsList('objectifsList', false);
  renderDashObjectifs();
}

function renderObjectifsList(containerId, mini) {
  const el = document.getElementById(containerId);
  if(!el) return;
  if(!S.objectifs.length) {
    el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="ei">🎯</div>Aucun objectif défini — créez-en un !</div>';
    return;
  }
  el.innerHTML = '';
  const allTx = getAllTxForCycle(S.cycle);
  const { income, bonus } = calcTotals(allTx);
  const totalIn = income + bonus;

  S.objectifs.forEach(obj => {
    let current = 0, pctRaw = 0;
    if(obj.type==='savings') {
      const { balance } = calcTotals(allTx);
      current = Math.max(0, toDisplay(toBase(balance, S.currency) * S.rates[S.currency]));
      // Actually current saved = balance in display currency
      current = Math.max(0, balance);
    } else if(obj.type==='spending_cap') {
      const filtered = allTx.filter(t => t.type==='expense' && (obj.cat==='all' || t.cat===obj.cat));
      current = calcTotals(filtered).expense;
    } else if(obj.type==='income_target') {
      current = totalIn;
    }
    const target = toDisplay(toBase(obj.amount, S.currency));
    pctRaw = target > 0 ? (current / target) * 100 : 0;
    const pct = Math.min(100, Math.max(0, pctRaw));
    const over = pctRaw > 100;

    const typeLabels = { savings:'Épargne', spending_cap:'Plafond dépense', income_target:'Revenu cible' };
    const typeClass = 'obj-type-'+obj.type;
    const barColor = over && obj.type==='spending_cap' ? '#ff4757' : obj.color;

    const div = document.createElement('div');
    div.className = 'obj-card';
    div.style.setProperty('--obj-color', obj.color);
    div.style.cssText += `--obj-color:${obj.color}`;
    div.querySelector = div.querySelector; // just reference
    div.innerHTML = `
      <div class="obj-card" style="--obj-color:${obj.color}"><!-- inner --></div>
    `;
    div.className = 'obj-card';
    div.style.borderTop = `4px solid ${obj.color}`;
    div.style.borderRadius = 'var(--radius)';
    div.innerHTML = `
      <button class="obj-del" data-id="${obj.id}">🗑</button>
      <div class="obj-header">
        <div class="obj-emoji">${obj.emoji||'🎯'}</div>
        <div class="obj-name">${escHtml(obj.name)}</div>
        <span class="obj-type-badge ${typeClass}">${typeLabels[obj.type]}</span>
      </div>
      <div class="obj-amounts">
        <div class="obj-current" style="color:${barColor}">${fmt(current)}</div>
        <div class="obj-target">/ ${fmt(toDisplay(toBase(obj.amount, S.currency)))}</div>
      </div>
      <div class="obj-bar-wrap"><div class="obj-bar" style="width:${pct}%;background:${barColor}"></div></div>
      <div class="obj-pct">${pct.toFixed(0)}% ${over && obj.type==='spending_cap' ? '⚠️ Dépassé !' : obj.type==='savings' && pct>=100 ? '🎉 Objectif atteint !' : 'accompli'}</div>
    `;
    el.appendChild(div);
  });
  el.querySelectorAll('.obj-del').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); S.objectifs=S.objectifs.filter(o=>o.id!==btn.dataset.id); save(); refreshAll(); toast('Objectif supprimé','err'); });
  });
}

function renderDashObjectifs() {
  const el = document.getElementById('dashObjectifs');
  if(!el) return;
  if(!S.objectifs.length) { el.innerHTML = '<div style="color:var(--muted);font-size:.85rem;padding:8px 0">Aucun objectif — créez-en un dans l\'onglet Objectifs.</div>'; return; }
  const allTx = getAllTxForCycle(S.cycle);
  const { income, bonus } = calcTotals(allTx);
  el.innerHTML = '';
  S.objectifs.slice(0,4).forEach(obj => {
    let current = 0;
    if(obj.type==='savings') { const { balance } = calcTotals(allTx); current = Math.max(0, balance); }
    else if(obj.type==='spending_cap') { current = calcTotals(allTx.filter(t=>t.type==='expense'&&(obj.cat==='all'||t.cat===obj.cat))).expense; }
    else { current = income + bonus; }
    const target = toDisplay(toBase(obj.amount, S.currency));
    const pct = target>0 ? Math.min(100, (current/target)*100) : 0;
    const div = document.createElement('div');
    div.className = 'dash-obj';
    div.innerHTML = `
      <div style="font-size:1.2rem">${obj.emoji||'🎯'}</div>
      <div class="dash-obj-info">
        <div class="dash-obj-name">${escHtml(obj.name)}</div>
        <div class="dash-obj-sub">${fmt(current)} / ${fmt(target)}</div>
      </div>
      <div class="dash-obj-bar-wrap"><div class="dash-obj-bar" style="width:${pct}%;background:${obj.color}"></div></div>
      <div class="dash-obj-pct" style="color:${obj.color}">${pct.toFixed(0)}%</div>
    `;
    el.appendChild(div);
  });
}

// ── STATS ─────────────────────────────────────────────────────────────────
function updateStats() {
  const period = S.statsPeriod;
  const txs = getAllTxForPeriod(period);
  renderBarChart(txs, period);
  renderPieChart(txs);
  renderCatBreakdown(txs);
}

function renderBarChart(txs, period) {
  destroyChart('bar');
  const ctx = document.getElementById('barChart');
  if(!ctx) return;

  const slots = getPeriodSlots(period);
  const incomeData = slots.map(slot => {
    const stxs = txs.filter(t => matchSlot(t.date, slot, period));
    const { income, bonus } = calcTotals(stxs);
    return income + bonus;
  });
  const expData = slots.map(slot => calcTotals(txs.filter(t => matchSlot(t.date, slot, period))).expense);

  charts['bar'] = new Chart(ctx, {
    type:'bar',
    data:{
      labels: slots.map(s => s.label),
      datasets:[
        { label:'Revenus', data:incomeData, backgroundColor:'rgba(0,230,118,.75)', borderRadius:7, borderSkipped:false },
        { label:'Dépenses', data:expData, backgroundColor:'rgba(255,60,172,.7)', borderRadius:7, borderSkipped:false },
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false, animation:{ duration:500 },
      plugins:{ legend:{ labels:{ color:'#6a9070', font:{ family:'DM Sans' } } } },
      scales:{
        x:{ ticks:{ color:'#6a9070' }, grid:{ color:'rgba(255,255,255,.03)' } },
        y:{ ticks:{ color:'#6a9070', callback:v=>fmt(v) }, grid:{ color:'rgba(255,255,255,.04)' } }
      }
    }
  });
}

function getPeriodSlots(period) {
  const now = new Date();
  const slots = [];
  if(period==='week') {
    const dnames = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    for(let i=0;i<7;i++) {
      const d=new Date(now); d.setDate(now.getDate()-now.getDay()+i);
      slots.push({ label:dnames[i], date:d.toISOString().slice(0,10) });
    }
  } else if(period==='month') {
    const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    for(let i=1;i<=daysInMonth;i+=5) {
      const end=Math.min(i+4,daysInMonth);
      slots.push({ label:i+(end>i?'-'+end:''), from:i, to:end });
    }
  } else {
    const mnames=['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    for(let i=0;i<12;i++) slots.push({ label:mnames[i], month:i });
  }
  return slots;
}

function matchSlot(dateStr, slot, period) {
  const d=new Date(dateStr+'T00:00:00'), now=new Date();
  if(period==='week') return dateStr===slot.date;
  if(period==='month') { const day=d.getDate(); return day>=slot.from&&day<=slot.to&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); }
  return d.getMonth()===slot.month&&d.getFullYear()===now.getFullYear();
}

function renderPieChart(txs) {
  destroyChart('pie');
  const ctx = document.getElementById('pieChart');
  if(!ctx) return;
  const expTxs = txs.filter(t=>t.type==='expense');
  const bycat = {};
  expTxs.forEach(t => { const v=toDisplay(toBase(t.amount,t.currency)); bycat[t.cat]=(bycat[t.cat]||0)+v; });
  const cats = Object.keys(bycat);
  if(!cats.length) return;
  charts['pie'] = new Chart(ctx, {
    type:'doughnut',
    data:{
      labels: cats.map(c=>(S.catEmoji[c]||'📦')+' '+c),
      datasets:[{ data:cats.map(c=>bycat[c]), backgroundColor:cats.map(c=>S.catColors[c]||'#6a9070'), borderWidth:2, borderColor:'#111e13', hoverOffset:8 }]
    },
    options:{
      cutout:'62%', responsive:true, maintainAspectRatio:false, animation:{ duration:500 },
      plugins:{ legend:{ position:'bottom', labels:{ color:'#6a9070', font:{family:'DM Sans'}, padding:14 } } }
    }
  });
}

function renderCatBreakdown(txs) {
  const expTxs = txs.filter(t=>t.type==='expense');
  const bycat = {};
  expTxs.forEach(t=>{ const v=toDisplay(toBase(t.amount,t.currency)); bycat[t.cat]=(bycat[t.cat]||0)+v; });
  const total = Object.values(bycat).reduce((a,b)=>a+b,0);
  const el = document.getElementById('catBreakdown');
  if(!total) { el.innerHTML='<div class="empty-state"><div class="ei">📊</div>Aucune dépense sur cette période</div>'; return; }
  el.innerHTML='';
  Object.entries(bycat).sort((a,b)=>b[1]-a[1]).forEach(([cat,val])=>{
    const pct=total>0?((val/total)*100).toFixed(1):0;
    const div=document.createElement('div');
    div.className='cat-item';
    div.innerHTML=`
      <div style="font-size:1.3rem;width:26px">${S.catEmoji[cat]||'📦'}</div>
      <div class="cat-bar-wrap">
        <div class="cat-label"><span>${cat}</span><span>${fmt(val)} · ${pct}%</span></div>
        <div style="background:var(--bg3);border-radius:7px;height:7px;overflow:hidden"><div class="cat-bar" style="width:${pct}%;background:${S.catColors[cat]||'#6a9070'}"></div></div>
      </div>
    `;
    el.appendChild(div);
  });
}

// ── SETTINGS ──────────────────────────────────────────────────────────────
function updateSettings() {
  document.querySelectorAll('.cur-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.currency===S.currency));
  const el = document.getElementById('ratesGrid');
  el.innerHTML='';
  Object.entries(S.rates).forEach(([cur,rate])=>{
    if(cur==='EUR') return;
    const div=document.createElement('div'); div.className='rate-item';
    div.innerHTML=`<label>1€ → ${S.symbols[cur]} ${cur}</label><input type="number" step="0.01" value="${rate}" data-cur="${cur}"/>`;
    el.appendChild(div);
  });
  el.querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('input',()=>{ S.rates[inp.dataset.cur]=parseFloat(inp.value)||1; save(); refreshAll(); });
  });
}

// ── DATA TRANSFER ─────────────────────────────────────────────────────────
function exportData() {
  const data = { transactions:S.transactions, revenus:S.revenus, objectifs:S.objectifs, currency:S.currency, cycle:S.cycle, rates:S.rates, exported: new Date().toISOString(), version:2 };
  const json = JSON.stringify(data);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  // Split into chunks of 60 chars for readability
  const chunks = b64.match(/.{1,60}/g)||[];
  const code = 'FLOW2:' + chunks.join('\n');
  document.getElementById('exportCode').value = code;
  document.getElementById('exportArea').classList.remove('hidden');
  const meta = `${S.transactions.length} transactions · ${S.revenus.length} revenus · ${S.objectifs.length} objectifs`;
  document.getElementById('exportMeta').textContent = meta;
}

function importData(code) {
  try {
    const clean = code.trim().replace(/\n/g,'').replace(/^FLOW2:/,'');
    const json = decodeURIComponent(escape(atob(clean)));
    const data = JSON.parse(json);
    if(!data.transactions) throw new Error('Format invalide');
    if(data.transactions) S.transactions = data.transactions;
    if(data.revenus) S.revenus = data.revenus;
    if(data.objectifs) S.objectifs = data.objectifs;
    if(data.currency) S.currency = data.currency;
    if(data.cycle) S.cycle = data.cycle;
    if(data.rates) Object.assign(S.rates, data.rates);
    save(); refreshAll();
    toast('Données importées avec succès ! 🎉','ok');
    document.getElementById('importCode').value='';
  } catch(e) {
    toast('Code invalide — vérifie le contenu collé','err');
  }
}

function downloadJSON() {
  const data = { transactions:S.transactions, revenus:S.revenus, objectifs:S.objectifs, currency:S.currency, cycle:S.cycle, rates:S.rates };
  const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flow-backup-'+todayStr()+'.json';
  a.click();
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if(data.transactions) S.transactions=data.transactions;
      if(data.revenus) S.revenus=data.revenus;
      if(data.objectifs) S.objectifs=data.objectifs;
      if(data.currency) S.currency=data.currency;
      if(data.cycle) S.cycle=data.cycle;
      if(data.rates) Object.assign(S.rates,data.rates);
      save(); refreshAll();
      toast('Fichier restauré ! ✓','ok');
    } catch { toast('Fichier JSON invalide','err'); }
  };
  reader.readAsText(file);
}

// ── REFRESH ALL ────────────────────────────────────────────────────────────
function refreshAll() {
  updateDashboard();
  updateRevenuPage();
  updateTxPage();
  updateObjectifsPage();
  updateStats();
  updateSettings();
  // Sync cycle select
  document.getElementById('cycleSelect').value = S.cycle;
}

// ── TOAST ─────────────────────────────────────────────────────────────────
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.className='toast', 3000);
}

// ── MODAL HELPERS ─────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ── RECURRENCE PREVIEW ────────────────────────────────────────────────────
function updateRvPreview() {
  const amount = parseFloat(document.getElementById('rvAmount').value)||0;
  const currency = document.getElementById('rvCurrency').value;
  const recurrence = document.getElementById('rvRecurrence').value;
  const start = document.getElementById('rvStart').value;
  const end = document.getElementById('rvEnd').value;
  const el = document.getElementById('rvPreview');
  if(!amount||!start) { el.className='recur-preview hidden'; return; }

  const labels = { once:'Versement unique', weekly:'Chaque semaine', biweekly:'Toutes les 2 semaines', monthly:'Chaque mois', quarterly:'Chaque trimestre', yearly:'Chaque année' };
  const sym = S.symbols[currency]||currency;
  let txt = `${sym}${amount} · ${labels[recurrence]||recurrence} à partir du ${fmtDate(start)}`;
  if(end) txt += ` jusqu'au ${fmtDate(end)}`;

  // monthly annual total
  const mults = { once:1, weekly:52, biweekly:26, monthly:12, quarterly:4, yearly:1 };
  const annual = amount * (mults[recurrence]||1);
  txt += `\n≈ ${sym}${annual.toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:0})} / an`;

  el.textContent = txt;
  el.className = 'recur-preview';
}

// ── NAVIGATE ──────────────────────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(n=>n.classList.remove('active'));
  const p = document.getElementById('page-'+page);
  if(p) p.classList.add('active');
  const n = document.querySelector(`.nav-link[data-page="${page}"]`);
  if(n) n.classList.add('active');
  if(window.innerWidth<=720) closeSidebar();
  if(page==='stats') updateStats();
  if(page==='objectifs') updateObjectifsPage();
  if(page==='settings') updateSettings();
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

// ── INIT ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  load();

  // Nav
  document.querySelectorAll('.nav-link').forEach(l => {
    l.addEventListener('click', e => { e.preventDefault(); navigateTo(l.dataset.page); });
  });
  document.querySelectorAll('.lnk').forEach(l => {
    l.addEventListener('click', e => { e.preventDefault(); navigateTo(l.dataset.page); });
  });

  // Sidebar mobile
  document.getElementById('menuBtn').addEventListener('click', openSidebar);
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

  // Cycle
  document.getElementById('cycleSelect').addEventListener('change', function() { S.cycle=this.value; save(); refreshAll(); });

  // Add buttons → modals
  document.getElementById('btnAddDash').addEventListener('click', ()=>{ document.getElementById('txDate').value=todayStr(); openModal('modalTx'); });
  document.getElementById('fabMini').addEventListener('click', ()=>{ document.getElementById('txDate').value=todayStr(); openModal('modalTx'); });
  document.getElementById('btnAddTx').addEventListener('click', ()=>{ document.getElementById('txDate').value=todayStr(); openModal('modalTx'); });
  document.getElementById('btnAddRevenu').addEventListener('click', ()=>{ document.getElementById('rvStart').value=todayStr(); updateRvPreview(); openModal('modalRevenu'); });
  document.getElementById('btnAddObj').addEventListener('click', ()=>{ openModal('modalObj'); });

  // Close buttons
  document.querySelectorAll('.close-btn,[data-close]').forEach(btn => {
    const target = btn.dataset.close;
    if(target) btn.addEventListener('click', ()=>closeModal(target));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.classList.add('hidden'); });
  });
  document.addEventListener('keydown', e => { if(e.key==='Escape') document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m=>m.classList.add('hidden')); });

  // Type tabs (tx modal)
  document.querySelectorAll('#typeTabs .ttab').forEach(btn => {
    btn.addEventListener('click', ()=>{ document.querySelectorAll('#typeTabs .ttab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); });
  });

  // Currency change in tx modal
  document.getElementById('txCurrency').addEventListener('change', function() {
    document.getElementById('txSymbol').textContent = S.symbols[this.value]||this.value;
    updateConvertHint();
  });
  document.getElementById('txAmount').addEventListener('input', updateConvertHint);
  function updateConvertHint() {
    const amt=parseFloat(document.getElementById('txAmount').value)||0;
    const from=document.getElementById('txCurrency').value;
    const el=document.getElementById('convertHint');
    if(amt&&from!==S.currency) {
      const conv=toDisplay(toBase(amt,from));
      el.textContent=`≈ ${fmt(conv)} (1 ${from} = ${(S.rates[S.currency]/S.rates[from]).toFixed(4)} ${S.currency})`;
      el.classList.remove('hidden');
    } else el.classList.add('hidden');
  }

  // Save tx
  document.getElementById('saveTxBtn').addEventListener('click', ()=>{
    const amt=parseFloat(document.getElementById('txAmount').value);
    if(!amt||amt<=0){ toast('Montant invalide','err'); return; }
    const type=document.querySelector('#typeTabs .ttab.active').dataset.type;
    const tx = { id:Date.now().toString()+Math.random().toString(36).slice(2), type, amount:amt, currency:document.getElementById('txCurrency').value, cat:document.getElementById('txCat').value, desc:document.getElementById('txDesc').value.trim(), date:document.getElementById('txDate').value||todayStr() };
    S.transactions.unshift(tx);
    save(); refreshAll(); closeModal('modalTx');
    toast('Transaction enregistrée ✓','ok');
    // Reset
    document.getElementById('txAmount').value='';
    document.getElementById('txDesc').value='';
  });

  // Revenu recurrence
  ['rvAmount','rvCurrency','rvRecurrence','rvStart','rvEnd'].forEach(id => {
    const el=document.getElementById(id);
    if(el) el.addEventListener('input',updateRvPreview), el.addEventListener('change',updateRvPreview);
  });
  document.getElementById('rvCurrency').addEventListener('change', function() { document.getElementById('rvSymbol').textContent=S.symbols[this.value]||this.value; });

  // Save revenu
  document.getElementById('saveRvBtn').addEventListener('click', ()=>{
    const amt=parseFloat(document.getElementById('rvAmount').value);
    const desc=document.getElementById('rvDesc').value.trim();
    if(!amt||amt<=0){ toast('Montant invalide','err'); return; }
    if(!desc){ toast('Ajoute un libellé','err'); return; }
    const rv = { id:Date.now().toString()+Math.random().toString(36).slice(2), amount:amt, currency:document.getElementById('rvCurrency').value, desc, recurrence:document.getElementById('rvRecurrence').value, start:document.getElementById('rvStart').value||todayStr(), end:document.getElementById('rvEnd').value||null };
    S.revenus.push(rv);
    save(); refreshAll(); closeModal('modalRevenu');
    toast('Revenu ajouté ✓','ok');
  });

  // Objectif type tabs
  document.querySelectorAll('#objTypeTabs .ottab').forEach(btn => {
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#objTypeTabs .ottab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      // Show cat only for spending_cap
      document.getElementById('objCatWrap').classList.toggle('hidden', btn.dataset.otype!=='spending_cap');
    });
  });

  // Color picker
  document.querySelectorAll('.cpick').forEach(el => {
    el.addEventListener('click', ()=>{ document.querySelectorAll('.cpick').forEach(c=>c.classList.remove('active')); el.classList.add('active'); });
  });

  // Save objectif
  document.getElementById('saveObjBtn').addEventListener('click', ()=>{
    const name=document.getElementById('objName').value.trim();
    const amt=parseFloat(document.getElementById('objAmount').value);
    if(!name){ toast('Donne un nom à l\'objectif','err'); return; }
    if(!amt||amt<=0){ toast('Montant cible invalide','err'); return; }
    const otype=document.querySelector('#objTypeTabs .ottab.active').dataset.otype;
    const color=document.querySelector('.cpick.active')?.dataset.color||'#00e676';
    const obj = { id:Date.now().toString()+Math.random().toString(36).slice(2), name, emoji:document.getElementById('objEmoji').value.trim()||'🎯', type:otype, amount:amt, color, cat:document.getElementById('objCat').value };
    S.objectifs.push(obj);
    save(); refreshAll(); closeModal('modalObj');
    toast('Objectif créé ! 🎯','ok');
    document.getElementById('objName').value=''; document.getElementById('objAmount').value=''; document.getElementById('objEmoji').value='';
  });

  // Currency settings
  document.querySelectorAll('.cur-btn').forEach(btn => {
    btn.addEventListener('click', ()=>{ S.currency=btn.dataset.currency; save(); updateSettings(); refreshAll(); toast('Devise : '+btn.dataset.currency,'ok'); });
  });

  // Filters
  ['filterType','filterCat','searchTx'].forEach(id => {
    const el=document.getElementById(id);
    el.addEventListener('input',updateTxPage); el.addEventListener('change',updateTxPage);
  });

  // Stats period
  document.querySelectorAll('.ptab').forEach(btn => {
    btn.addEventListener('click', ()=>{ document.querySelectorAll('.ptab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); S.statsPeriod=btn.dataset.period; updateStats(); });
  });

  // Transfer
  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnCopyCode').addEventListener('click', ()=>{ document.getElementById('exportCode').select(); document.execCommand('copy'); toast('Code copié dans le presse-papier !','ok'); });
  document.getElementById('btnImport').addEventListener('click', ()=>{ const code=document.getElementById('importCode').value.trim(); if(!code){ toast('Code vide','err'); return; } if(confirm('Cela va remplacer TOUTES tes données actuelles. Continuer ?')) importData(code); });
  document.getElementById('btnDownload').addEventListener('click', downloadJSON);
  document.getElementById('fileInput').addEventListener('change', e=>{ if(e.target.files[0]) importJSON(e.target.files[0]); });

  // Clear
  document.getElementById('clearDataBtn').addEventListener('click', ()=>{ if(confirm('Effacer toutes les données ? Cette action est irréversible.')) { S.transactions=[]; S.revenus=[]; S.objectifs=[]; save(); refreshAll(); toast('Données effacées','err'); } });

  // Seed demo if empty
  if(!S.transactions.length && !S.revenus.length) seedDemo();

  refreshAll();
});

// ── DEMO DATA ─────────────────────────────────────────────────────────────
function seedDemo() {
  const m = todayStr().slice(0,7);
  S.revenus.push({ id:'rv1', amount:2800, currency:'EUR', desc:'Salaire CDI', recurrence:'monthly', start:m+'-01', end:null });
  S.revenus.push({ id:'rv2', amount:300, currency:'EUR', desc:'Freelance mensuel', recurrence:'monthly', start:m+'-15', end:null });
  S.transactions.push(...[
    { id:'t1', type:'expense', amount:900, currency:'EUR', cat:'loyer', desc:'Loyer appartement', date:m+'-02' },
    { id:'t2', type:'expense', amount:145, currency:'EUR', cat:'courses', desc:'Courses semaine', date:m+'-06' },
    { id:'t3', type:'expense', amount:48, currency:'EUR', cat:'transport', desc:'Navigo mensuel', date:m+'-03' },
    { id:'t4', type:'expense', amount:89, currency:'EUR', cat:'loisirs', desc:'Netflix + Spotify', date:m+'-05' },
    { id:'t5', type:'bonus', amount:300, currency:'EUR', cat:'autre', desc:'Prime exceptionnelle', date:m+'-10' },
    { id:'t6', type:'expense', amount:67, currency:'EUR', cat:'sante', desc:'Pharmacie', date:m+'-08' },
    { id:'t7', type:'expense', amount:195, currency:'USD', cat:'loisirs', desc:'Achats jeux en ligne', date:m+'-12' },
  ]);
  S.objectifs.push(
    { id:'o1', name:'Vacances été', emoji:'🏖', type:'savings', amount:1500, color:'#00e676', cat:'all' },
    { id:'o2', name:'Plafond courses', emoji:'🛒', type:'spending_cap', amount:200, color:'#ff3cac', cat:'courses' },
    { id:'o3', name:'Revenu cible', emoji:'💚', type:'income_target', amount:3500, color:'#2979ff', cat:'all' },
  );
  save();
}
