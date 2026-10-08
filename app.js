(() => {
  'use strict';
  const STORAGE_KEY = 'flow_v5';
  const LEGACY_STORAGE_KEYS = ['flow_v4_2','flow_v4','flow_v3','flow_v2'];
  const Core = window.FlowCore;
  let storageProblem = '';
  const unreadableKeys = new Set();
  // Storage access itself can throw in restricted browsers; auxiliary read flags
  // must never prevent initialization or overwrite a damaged financial backup.
  const localStorage = {
    getItem(key) { try { return window.localStorage.getItem(key); } catch { storageProblem='Stockage du navigateur inaccessible. Les changements restent en mémoire : exporte une sauvegarde avant de fermer.'; return null; } },
    setItem(key, value) {
      if (unreadableKeys.has(key)) return false;
      try { window.localStorage.setItem(key, value); return true; }
      catch { storageProblem='Sauvegarde locale impossible. Les changements restent en mémoire : exporte une sauvegarde avant de fermer ou recharger.'; return false; }
    }
  };
  if (!Core) throw new Error('FlowCore doit être chargé avant app.js');
  const TUTORIAL_SEEN_KEY = 'flow_tutorial_seen_v1';
  const RELEASE_ID = 'flow-v5-release';
  const releaseReadKey = () => `${RELEASE_ID}:read:${currentUserUid || 'local'}`;
  const releaseGuide = () => `<details class="release-guide"><summary>Découvrir les nouveautés de la V5</summary><p><strong>Ton budget, en clair.</strong> Le disponible jusqu’au prochain salaire déduit les charges prévues, ton coussin et tes réservations. Le solde réel reste affiché séparément.</p><p><strong>Des actions plus rapides.</strong> Ajoute une opération, retrouve tes favoris, transfère entre comptes et ajuste un solde. Dans À venir, confirme uniquement les paiements réellement passés.</p><p><strong>Des projets mieux suivis.</strong> Réserve une somme fixe ou un pourcentage à la réception d’un salaire. Tu peux refuser la proposition pendant cinq minutes avant sa confirmation automatique. Une réservation est virtuelle : aucun virement bancaire n’est effectué.</p><p><strong>PC et mobile.</strong> Connecte-toi au même compte pour synchroniser tes données avec Firebase. Le partage d’un projet est volontaire et ses permissions se règlent séparément ; tes opérations personnelles ne sont pas partagées automatiquement.</p><p><strong>À ton goût.</strong> Choisis la densité, les thèmes Sakura ou Ocean et le mode clair/sombre. Pour les animations : « Selon l’appareil » suit la préférence système, « Réduites » les atténue, « Amplifiées » ajoute un rebond aux menus. Sur mobile, ouvre Réglages depuis la navigation, puis sélectionne une section.</p><p><strong>Import et aide.</strong> Prévisualise un CSV, sauvegarde par fichier ou par code complet et retrouve le wiki avec le bouton d’aide. Le tutoriel est relançable dans Réglages. Les rappels internes sont disponibles ; les notifications en arrière-plan ne sont pas encore activées.</p></details>`;
  function allNotifications() {
    const syncReleaseId='flow-v5.0.1-sync';
return [{id:'flow-v5.0.3-settings-deeplinks',kind:'release',title:'V5.0.3 · Réglages accessibles directement',message:'Les liens directs vers Apparence et les autres rubriques ouvrent maintenant Réglages au bon endroit. Les liens des réglages restent utilisables sur ordinateur et mobile.',createdAt:new Date('2026-10-08T12:00:00Z').getTime(),read:localStorage.getItem(`flow-v5.0.3-settings-deeplinks:read:${currentUserUid || 'local'}`)==='1'},{id:'flow-v5.0.2-audit',kind:'release',title:'V5.0.2 · Budget et fiabilité',message:'Charges prévues et confirmations sans double débit, rapprochement des soldes corrigé, imports mieux dédoublonnés et réserves de projets fiabilisées. Formulaires, clavier et mobile améliorés. Tes comptes et historiques sont conservés. Le partage sécurisé nécessite les nouvelles règles Firebase : les anciens espaces restent lisibles, puis leur administrateur peut mettre à jour les accès sans supprimer les membres. Une notice de confidentialité et un contact sont disponibles dans les réglages.',createdAt:new Date('2026-10-08T10:00:00Z').getTime(),read:localStorage.getItem(`flow-v5.0.2-audit:read:${currentUserUid || 'local'}`)==='1'},{id:syncReleaseId,kind:'release',title:'V5.0.1 · Synchronisation fiabilisée',message:'Faux conflits V4/V5 corrigés. Les confirmations s’affichent immédiatement, avec une étiquette pendant la synchronisation. Le disponible déduit aussi les charges dépassées non confirmées, sans double déduction. Favoris et récurrents corrigés sur mobile ; bouton de mise à jour du signet réparé. Les vrais conflits restent soumis à ton choix. Les données manquantes ne sont pas restaurées automatiquement : garde une sauvegarde.',createdAt:new Date('2026-10-04T08:00:00Z').getTime(),read:localStorage.getItem(`${syncReleaseId}:read:${currentUserUid || 'local'}`)==='1'}, {id:RELEASE_ID,kind:'release',title:'Bienvenue dans Flōw V5',message:'Un budget plus clair, des actions rapides et tes comptes sur tous tes appareils. Ouvre le mini-guide pour découvrir ce qui change.',createdAt:new Date('2026-10-03T12:00:00Z').getTime(),read:localStorage.getItem(releaseReadKey())==='1'},...state.notifications];
  }
  const previousAllNotifications=allNotifications;
  allNotifications=function(){return [{id:'flow-v5.0.4-motion',kind:'release',title:'V5.0.4 · Menus plus vivants',message:'Transitions plus fluides, fenêtres avec un léger rebond et voile dynamique. Choisis « Selon l’appareil », « Réduites » ou « Amplifiées » dans Réglages → Apparence. Tes comptes et opérations ne changent pas.',createdAt:new Date('2026-10-08T14:00:00Z').getTime(),read:localStorage.getItem(`flow-v5.0.4-motion:read:${currentUserUid || 'local'}`)==='1'},...previousAllNotifications()];};
  const CATEGORIES = {
    expense: [
      ['courses','Courses','i-category-courses'],['restaurants','Restaurants','i-category-restaurants'],['logement','Logement','i-category-home'],
      ['transport','Transport','i-category-train'],['loisirs','Loisirs','i-category-leisure'],['shopping','Shopping','i-category-shopping'],
      ['sante','Santé','i-category-health'],['factures','Factures','i-category-bill'],['autre','Autre','i-category-other']
    ],
    income: [['salaire','Salaire','i-category-salary'],['cadeau','Cadeau','i-category-gift'],['remboursement','Remboursement','i-category-refund'],['vente','Vente','i-category-box'],['autre','Autre','i-category-other']]
  };
  const CATEGORY_MAP = Object.fromEntries([...CATEGORIES.expense,...CATEGORIES.income].map(c => [c[0],{label:c[1],icon:c[2]}]));
  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const uid = () => Core.makeId();
  const isoToday = (date=new Date()) => Core.isoDate(date);
  const money = (n, compact=false) => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:compact?0:2}).format(Number(n)||0);
  const dateLabel = (value) => new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`));
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  const parseDate = (s) => new Date(`${s}T12:00:00`);
  const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
  $$('input[type="number"]').forEach(input=>{if(!input.hasAttribute('max'))input.max='1000000000';if(!input.hasAttribute('min'))input.min='-1000000000';});
  document.addEventListener('submit',event=>{if(event.target.matches('form')&&!event.target.checkValidity()){event.preventDefault();event.stopImmediatePropagation();event.target.reportValidity();}},true);
  document.addEventListener('change',event=>{const input=event.target;if(input.matches('input[type="number"]')&&!input.checkValidity()){event.stopImmediatePropagation();input.reportValidity();}},true);

  const defaultState = () => Core.getEmptyState();
  const normalizeState = raw => Core.normalizeState(raw);
  const localKey = uid => uid ? `${STORAGE_KEY}:user:${uid}` : `${STORAGE_KEY}:local`;
  function loadState(key=localKey(null)) {
    try {
      const current = localStorage.getItem(key);
      if (current) return normalizeState(JSON.parse(current));
      if (!currentUserUid && key===localKey(null)) for (const oldKey of LEGACY_STORAGE_KEYS) {
        const legacy = localStorage.getItem(oldKey);
        if (!legacy) continue;
        const parsed = JSON.parse(legacy);
        const migrated = normalizeState(parsed);
        migrated.migratedFrom = oldKey;
        if(['flow_v3','flow_v2'].includes(oldKey))for(const account of migrated.accounts){
          const original=(parsed.accounts||[]).find(item=>String(item.id)===account.id);
          if(original&&original.initialBalance==null&&original.openingBalance==null&&(original.balance!=null||original.solde!=null)){
            let net=0;
            for(const transaction of migrated.transactions){const amount=transaction.amount; if(transaction.type==='transfer'){if(transaction.sourceAccountId===account.id)net-=amount;if(transaction.targetAccountId===account.id)net+=amount;}else if((transaction.sourceAccountId||transaction.accountId)===account.id)net+=transaction.type==='income'?amount:-amount;}
            account.openingBalance=Number(original.balance??original.solde)-net;
          }
        }
        localStorage.setItem(key,JSON.stringify(migrated));
        return migrated;
      }
    } catch (error) { unreadableKeys.add(key);storageProblem='Sauvegarde locale illisible : elle a été conservée sans être remplacée. Ne recharge pas après de nouvelles saisies sans exporter. Contacte l’éditeur pour récupérer la copie d’origine.';console.warn('Données Flow illisibles',error); }
    return defaultState();
  }

  let currentUserUid = null;
  let state = loadState();
  let selectedMonth = new Date(); selectedMonth.setDate(1);
  let transactionFilter = 'all';
  let transactionType = 'expense';
  let recurringType = 'expense';
  let tutorialStep = 0;
  const recentRecurringConfirmations = new Set();
  function save(notifyCloud=true) {
    state=Core.normalizeState(state);
    Core.confirmDueReservations(state);
    const persisted = localStorage.setItem(localKey(currentUserUid),JSON.stringify(state));
    if (persisted) storageProblem='';
    renderAll();
    window.dispatchEvent(new CustomEvent('flow:notifications-change'));
    if(notifyCloud)window.dispatchEvent(new CustomEvent('flow:state-change'));
    return persisted;
  }
  window.FlowApp = {
    getStorageProblem: () => storageProblem,
    getState: () => JSON.parse(JSON.stringify(state)),
    getEmptyState: () => defaultState(),
    hasUsefulData: value => { const s=normalizeState(value||state);return Boolean(s.transactions.length||s.recurring.length||s.goals.length||s.reservations.length||s.reminders.length||s.accounts.some(a=>a.openingBalance!==0)); },
    applyRemoteState: raw => { state=normalizeState(raw); save(false); },
    activateUser: async uid => { currentUserUid=String(uid);state=loadState(localKey(currentUserUid));renderAll();return JSON.parse(JSON.stringify(state)); },
    activateLocal: async () => { currentUserUid=null;state=loadState(localKey(null));renderAll(); },
    getStorageKey: () => localKey(currentUserUid),
    getAccounts: () => JSON.parse(JSON.stringify(state.accounts)),
    exportState: () => JSON.parse(JSON.stringify(state)),
    addImportedTransactions: (rows,accountId) => { const result=Core.addImportedTransactions(state,rows,accountId);if(result.added)save();return result; },
    reconcileAccountBalance: (accountId,amount,date) => { const result=Core.reconcileAccountBalance(state,accountId,amount,date);if(result.ok)save();return result; },
    listNotifications: () => JSON.parse(JSON.stringify(allNotifications())),
    notificationSettings: () => JSON.parse(JSON.stringify(state.settings.notifications)),
    addReminder: item => { const result=Core.addReminder(state,item);if(result.ok)save();return result; }
  };

  function activeAccount() { return state.accounts.find(a=>a.id===state.activeAccountId) || state.accounts[0]; }
  function accountBalance(id) { return Core.getAccountBalance(state,id); }
  function monthTransactions(date=selectedMonth) { const key=monthKey(date); return state.transactions.filter(t=>t.date.startsWith(key) && ((t.sourceAccountId||t.accountId)===state.activeAccountId||t.targetAccountId===state.activeAccountId)); }
  function occurrencesInMonth(rec,date=selectedMonth) {
    const start=parseDate(rec.nextDate), end=new Date(date.getFullYear(),date.getMonth()+1,0,12), begin=new Date(date.getFullYear(),date.getMonth(),1,12);
    if (start>end) return [];
    const list=[]; let cursor=new Date(start), guard=0;
    const add = () => { if(cursor>=begin && cursor<=end) list.push(new Date(cursor)); };
    while(cursor<=end && guard++<100) {
      add();
      if(rec.frequency==='once') break;
      if(rec.frequency==='weekly') cursor.setDate(cursor.getDate()+7);
      else if(rec.frequency==='yearly') cursor.setFullYear(cursor.getFullYear()+1);
      else { const wanted=cursor.getDate(); cursor.setDate(1); cursor.setMonth(cursor.getMonth()+1); cursor.setDate(Math.min(wanted,new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate())); }
    }
    return list;
  }
  function monthPlanned(date=selectedMonth) { return state.recurring.filter(r=>r.accountId===state.activeAccountId).flatMap(r=>occurrencesInMonth(r,date).map(d=>({...r,occurrenceDate:d}))); }

  function iconUse(id) { return `<svg aria-hidden="true"><use href="assets/icons.svg#${id}"/></svg>`; }
  function categoryMeta(key) { return CATEGORY_MAP[key] || CATEGORY_MAP.autre; }
  function empty(title,text,icon='i-spark') { return `<div class="empty"><span class="empty-icon">${iconUse(icon)}</span><b>${title}</b><p>${text}</p></div>`; }
  function toast(message) { const el=$('toast'); el.textContent=storageProblem ? `Attention : non enregistré sur cet appareil. ${message}` : message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),storageProblem?7000:2300); }

  function applyTheme() {
    state.settings.mode ||= 'auto'; state.settings.palette ||= 'flow';
    const resolvedMode=state.settings.mode==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):state.settings.mode;
    const resolvedTheme=state.settings.palette==='flow'?resolvedMode:(resolvedMode==='dark'?state.settings.palette:`${state.settings.palette}-light`);
    document.documentElement.dataset.theme=resolvedTheme;
    document.documentElement.dataset.density=state.settings.density||'comfortable';
    const motionSetting=['system','reduced','amplified'].includes(state.settings.motion)?state.settings.motion:'system';
    const systemPrefersReduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.dataset.motion=motionSetting==='system'?(systemPrefersReduced?'reduced':'full'):motionSetting;
    $$('[data-mode]', $('themeModeOptions')).forEach(b=>b.classList.toggle('active',b.dataset.mode===state.settings.mode));
    $$('[data-palette]', $('paletteOptions')).forEach(b=>b.classList.toggle('active',b.dataset.palette===state.settings.palette));
    const meta=document.querySelector('meta[name=theme-color]'); if(meta) meta.content=resolvedMode==='dark'?'#111713':'#f5f4ef';
  }
  function renderAccountSelects() {
    const options=state.accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    const eligible=state.accounts.filter(a=>a.includeInSpendable);
    const goalOptions=(eligible.length?state.accounts.map(a=>`<option value="${a.id}" ${a.includeInSpendable?'':'disabled'}>${escapeHtml(a.name)}${a.includeInSpendable?'':' · exclu du disponible'}</option>`).join(''):'<option value="" selected disabled>Ajoute un compte inclus dans le disponible</option>');
    ['activeAccountSelect','txAccount','recAccount','txTargetAccount','goalAccount','bankImportAccount'].forEach(id=>{ const el=$(id); if(el){const old=el.value;el.innerHTML=id==='goalAccount'?goalOptions:options;el.value=id==='activeAccountSelect'?state.activeAccountId:(id==='goalAccount'?(eligible.some(a=>a.id===old)?old:(eligible.some(a=>a.id===state.activeAccountId)?state.activeAccountId:eligible[0]?.id||'')):state.accounts.some(a=>a.id===old)?old:(id==='txTargetAccount'?state.accounts.find(a=>a.id!==$('txAccount')?.value)?.id:state.activeAccountId));}});
  }
  function renderDashboard() {
    const acc=activeAccount(), txs=monthTransactions(), planned=monthPlanned();
    const income=txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0), expense=txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
    const planIn=planned.filter(r=>r.type==='income').reduce((s,r)=>s+r.amount,0), planOut=planned.filter(r=>r.type==='expense').reduce((s,r)=>s+r.amount,0);
    const breakdown=Core.getSpendableBreakdown(state,new Date()), nextSalary=breakdown.nextSalaryDate;
    const mobileMonth=matchMedia('(max-width: 700px)').matches;
    const monthText=new Intl.DateTimeFormat('fr-FR',mobileMonth?{month:'short',year:'2-digit'}:{month:'long',year:'numeric'}).format(selectedMonth);
    $('monthLabel').querySelector('span').textContent=monthText;if($('monthLabelMini'))$('monthLabelMini').textContent=monthText;
    $('accountBalance').textContent=money(accountBalance(acc.id)); $('heroAccountName').textContent=acc.name;
    if($('heroAccountNameMirror'))$('heroAccountNameMirror').textContent=acc.name;
    if($('incomeMonth'))$('incomeMonth').textContent=money(income); if($('expenseMonth'))$('expenseMonth').textContent=money(expense);
    if($('spendableUntilSalary'))$('spendableUntilSalary').textContent=money(breakdown.spendable);
    if($('nextPayday'))$('nextPayday').textContent=dateLabel(nextSalary);
    if($('remainingCaption'))$('remainingCaption').textContent=`Solde réel · ${money(accountBalance(acc.id))}`;
    const status=$('budgetStatus'); if(status)status.textContent=breakdown.spendable<0?'À surveiller':'À jour';
    const message=$('moneyMessage'); if(message)message.textContent=state.transactions.length||breakdown.accountBalance||breakdown.scheduledExpenseTotal?`Après ${money(breakdown.scheduledExpenseTotal,true)} de charges prévues${breakdown.overdueExpenseTotal?` (dont ${money(breakdown.overdueExpenseTotal,true)} à confirmer)` : ''}, ${money(breakdown.reservedTotal,true)} réservés et un coussin de ${money(breakdown.safetyBuffer,true)}.`:'Ajoute le solde de tes comptes et tes prochaines charges pour commencer.';
    if($('spendableBreakdown'))$('spendableBreakdown').innerHTML=[
      `<div class="breakdown-row"><span>Comptes pris en compte</span><b>${money(breakdown.accountBalance)}</b></div>`,
      `<div class="breakdown-row"><span>Charges avant la paie</span><b>− ${money(breakdown.scheduledExpenseTotal)}</b></div>`,
      `<div class="breakdown-row"><span>Projets réservés</span><b>− ${money(breakdown.reservedTotal)}</b></div>`,
      `<div class="breakdown-row"><span>Coussin de sécurité</span><b>− ${money(breakdown.safetyBuffer)}</b></div>`,
      `<div class="breakdown-row total"><span>Disponible jusqu’au ${dateLabel(nextSalary)}</span><b>${money(breakdown.spendable)}</b></div>`
    ].join('');
    if($('activeReservations'))$('activeReservations').textContent=String(state.reservations.filter(item=>['pending','confirmed'].includes(item.status)&&(!item.accountId||state.accounts.some(account=>account.id===item.accountId&&account.includeInSpendable))).length);
    renderFlowChart(txs); renderUpcoming(planned); renderCategories(txs); renderTransactionList($('recentTransactions'),txs.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5),true); renderReservations();
  }
  function renderFlowChart(txs) {
    const days=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,0).getDate(), buckets=Math.min(days,10), data=Array.from({length:buckets},()=>({in:0,out:0}));
    txs.filter(t=>t.type==='income'||t.type==='expense').forEach(t=>{const i=Math.min(buckets-1,Math.floor((Number(t.date.slice(-2))-1)/days*buckets));data[i][t.type==='income'?'in':'out']+=t.amount;});
    const max=Math.max(1,...data.flatMap(d=>[d.in,d.out]));
    $('flowChart').innerHTML=data.map(d=>`<span class="bar-day"><i class="in" style="height:${Math.max(2,d.in/max*100)}%"></i><i class="out" style="height:${Math.max(2,d.out/max*100)}%"></i></span>`).join('');
  }
  function renderUpcoming(planned) {
    const future=planned.filter(r=>r.occurrenceDate>=new Date(new Date().setHours(0,0,0,0))).sort((a,b)=>a.occurrenceDate-b.occurrenceDate).slice(0,4);
    $('upcomingList').innerHTML=future.length?future.map(r=>{const m=categoryMeta(r.category);return `<div class="list-row"><span class="row-icon">${iconUse(m.icon)}</span><span class="row-info"><b>${escapeHtml(r.label)}</b><span>${dateLabel(r.occurrenceDate.toISOString().slice(0,10))}</span></span><strong class="row-amount ${r.type==='income'?'positive':'negative'}">${r.type==='income'?'+':'−'} ${money(r.amount)}</strong></div>`}).join(''):empty('Rien d’autre de prévu','Ton mois respire. Tu peux ajouter un récurrent dans “À venir”.','i-calendar');
  }
  function renderCategories(txs) {
    const groups={};txs.filter(t=>t.type==='expense').forEach(t=>groups[t.category]=(groups[t.category]||0)+t.amount);
    const rows=Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,4),max=rows[0]?.[1]||1;
    $('categoryList').innerHTML=rows.length?rows.map(([key,val])=>{const m=categoryMeta(key);return `<div class="category-row"><span class="emoji">${iconUse(m.icon)}</span><div class="category-main"><div class="category-label"><b>${m.label}</b><span>${Math.round(val/(Object.values(groups).reduce((a,b)=>a+b,0)||1)*100)}%</span></div><div class="category-track"><span style="width:${val/max*100}%"></span></div></div><strong>${money(val,true)}</strong></div>`}).join(''):empty('Pas encore de tendance','Tes catégories apparaîtront après quelques dépenses.','i-category-other');
  }
  function transactionRow(t,withActions=true) { const m=categoryMeta(t.category), sign=t.type==='income'?'+':t.type==='transfer'?'↔':'−';return `<div class="transaction-row"><span class="transaction-icon">${iconUse(t.type==='transfer'?'i-transfer':m.icon)}</span><span class="transaction-info"><b>${escapeHtml(t.label)}${t.favorite?' · ★':''}</b><span>${t.type==='transfer'?'Transfert':m.label} · ${dateLabel(t.date)}${t.note?` · ${escapeHtml(t.note)}`:''}</span></span><strong class="transaction-amount ${t.type==='income'?'positive':t.type==='transfer'?'':'negative'}">${sign} ${money(t.amount)}</strong>${withActions?`<span class="row-actions">${t.favorite?`<button data-reuse-tx="${escapeHtml(t.id)}" aria-label="Réutiliser comme modèle">${iconUse('i-repeat')}</button>`:''}<button data-edit-tx="${escapeHtml(t.id)}" aria-label="Modifier">${iconUse('i-edit')}</button><button data-delete-tx="${escapeHtml(t.id)}" aria-label="Supprimer">${iconUse('i-trash')}</button></span>`:''}</div>`; }
  function renderTransactionList(root,list,compact=false) { if(!root)return;root.innerHTML=list.length?list.map(t=>transactionRow(t,!compact)).join(''):empty('Aucune opération','Ajoute une dépense ou un revenu en quelques secondes.','i-transfer'); }
  function renderTransactions() {
    const query=$('transactionSearch').value.trim().toLowerCase(); let list=state.transactions.filter(t=>(t.sourceAccountId||t.accountId)===state.activeAccountId||t.targetAccountId===state.activeAccountId);
    if(transactionFilter!=='all') list=list.filter(t=>t.type===transactionFilter); if(query) list=list.filter(t=>`${t.label} ${categoryMeta(t.category).label} ${t.note||''}`.toLowerCase().includes(query));
    renderTransactionList($('allTransactions'),list.sort((a,b)=>Number(b.favorite)-Number(a.favorite)||b.date.localeCompare(a.date)));bindTransactionActions();
  }
  function renderRecurring() {
    const list=state.recurring.filter(r=>r.accountId===state.activeAccountId).sort((a,b)=>a.nextDate.localeCompare(b.nextDate));
    const planned=monthPlanned(), pi=planned.filter(r=>r.type==='income').reduce((s,r)=>s+r.amount,0),pe=planned.filter(r=>r.type==='expense').reduce((s,r)=>s+r.amount,0);
    $('plannedIncome').textContent=money(pi);$('plannedExpense').textContent=money(pe);$('plannedNet').textContent=money(pi-pe);$('plannedNet').className=pi-pe>=0?'positive':'negative';
    $('recurringList').innerHTML=list.length?list.map(r=>{const d=parseDate(r.nextDate),m=categoryMeta(r.category),due=r.nextDate<=isoToday(),last=state.transactions.filter(t=>t.id.startsWith(`rec:${r.id}:`)).sort((a,b)=>b.date.localeCompare(a.date))[0];return `<div class="recurring-row"><span class="rec-date"><b>${d.getDate()}</b><span>${new Intl.DateTimeFormat('fr-FR',{month:'short'}).format(d)}</span></span><span class="transaction-icon">${iconUse(m.icon)}</span><span class="transaction-info"><b>${escapeHtml(r.label)}</b><span>${frequencyLabel(r.frequency)} · ${due?'À confirmer':'Prochaine échéance'}${last?` · Dernière confirmée : ${dateLabel(last.date)}`:''}</span></span><strong class="transaction-amount ${r.type==='income'?'positive':'negative'}">${r.type==='income'?'+':'−'} ${money(r.amount)}</strong><button type="button" class="confirm-button" data-confirm-rec="${escapeHtml(r.id)}" data-occurrence-date="${r.nextDate}" ${due&&!recentRecurringConfirmations.has(r.id)?'':'disabled'}>${recentRecurringConfirmations.has(r.id)?'Enregistré ✓':due?`Confirmer le ${dateLabel(r.nextDate)}`:'À venir'}</button><span class="row-actions"><button data-edit-rec="${escapeHtml(r.id)}" aria-label="Modifier">${iconUse('i-edit')}</button><button data-delete-rec="${escapeHtml(r.id)}" aria-label="Supprimer">${iconUse('i-trash')}</button></span></div>`}).join(''):empty('Aucune surprise prévue','Ajoute ton salaire, tes abonnements et tes factures.','i-repeat');bindRecurringActions();
  }
  function renderGoals() {
    $('goalsList').innerHTML=state.goals.length?state.goals.map(g=>{const reserved=state.reservations.filter(r=>r.goalId===g.id&&['pending','confirmed'].includes(r.status)).reduce((sum,r)=>sum+r.amount,0),progress=g.saved+reserved,pct=clamp(progress/g.target*100,0,100);return `<article class="goal-card ${g.color}"><div class="goal-top"><span class="goal-emoji">${g.emoji && g.emoji!=='🌿'?escapeHtml(g.emoji):iconUse('i-target')}</span><span class="goal-actions"><button data-edit-goal="${g.id}" aria-label="Modifier">${iconUse('i-edit')}</button><button data-delete-goal="${g.id}" aria-label="Supprimer">${iconUse('i-trash')}</button></span></div><h2>${escapeHtml(g.name)}</h2><p>${g.date?`Objectif pour le ${dateLabel(g.date)}`:'Avance à ton rythme'}${reserved?` · ${money(reserved)} réservé`:''}</p><div class="goal-amounts"><strong>${money(progress,true)}</strong><span>sur ${money(g.target,true)}</span></div><div class="goal-track"><span style="width:${pct}%"></span></div><div class="goal-footer"><input type="number" min="1" step="0.01" placeholder="Montant"><button data-deposit="${g.id}">Réserver</button></div><small class="goal-reserve-note">Repère dans Flow, aucun virement bancaire.</small></article>`}).join(''):empty('Un projet en tête ?','Crée un objectif, choisis une contribution et suis tes progrès.','i-target');bindGoalActions();
  }
  function renderSettings() {
    $('accountsList').innerHTML=state.accounts.map(a=>`<div class="settings-account"><b>${escapeHtml(a.name)} <small>${{current:'Courant',savings:'Épargne',cash:'Espèces',other:'Autre'}[a.type]||'Courant'}</small></b><span>${money(accountBalance(a.id))}<button class="icon-button" data-edit-account="${a.id}" aria-label="Modifier ${escapeHtml(a.name)}">${iconUse('i-edit')}</button>${state.accounts.length>1?` <button class="icon-button" data-delete-account="${a.id}" aria-label="Supprimer ${escapeHtml(a.name)}">${iconUse('i-trash')}</button>`:''}</span></div>`).join('');
    if($('paycheckDay'))$('paycheckDay').value=state.settings.payday||'';if($('safetyBuffer'))$('safetyBuffer').value=state.settings.safetyBuffer||'';
    if($('densitySelect'))$('densitySelect').value=state.settings.density||'comfortable';if($('motionSelect'))$('motionSelect').value=['system','reduced','amplified'].includes(state.settings.motion)?state.settings.motion:'system';
    applyTheme();bindAccountActions();renderNotifications();
  }
  function reservationRow(r){const goal=state.goals.find(g=>g.id===r.goalId),active=['pending','confirmed'].includes(r.status),fundable=state.accounts.some(account=>account.id===r.accountId&&account.includeInSpendable),title=goal?.name||'Projet supprimé',action=active?(r.status==='pending'?'<button data-reservation-action="deny">Refuser</button>':'')+(r.status==='confirmed'?'<button data-reservation-action="release">Libérer</button>':''):(r.status==='suspended'?(fundable?'<button data-reservation-action="reduce">Réduire</button><button data-reservation-action="skip">Ignorer</button><button data-reservation-action="prorata">Au prorata</button>':'<button data-reservation-action="skip">Ignorer</button>'):'');return `<article class="reservation-row" data-reservation-id="${escapeHtml(r.id)}"><div><b>${escapeHtml(title)} · ${money(r.amount||r.requestedAmount)}</b><p>${escapeHtml(r.reason)}</p><small>${escapeHtml(r.note||'')}</small></div><div class="reservation-actions">${action}</div></article>`;}
  function renderReservations(){const root=$('reservationList');if(root){const rows=state.reservations.filter(r=>['pending','confirmed','suspended'].includes(r.status)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,5);if(rows.some(r=>r.status==='pending'))$('reservationDetails')?.setAttribute('open','');root.innerHTML=rows.length?rows.map(reservationRow).join(''):empty('Aucune réservation active','Les sommes choisies pour tes projets apparaîtront ici.','i-lock');}}
  function renderNotifications(){const root=$('notificationList');const notifications=allNotifications();const count=notifications.filter(n=>!n.read).length;if($('notificationUnreadCount'))$('notificationUnreadCount').textContent=String(count);if($('releaseNotificationPreview'))$('releaseNotificationPreview').innerHTML=releaseGuide();if(!root)return;const filter=state.settings.notificationFilters?.[0]||'all';const items=notifications.filter(n=>filter==='all'||(filter==='reminder'?n.kind==='reminder':n.kind!=='reminder'&&n.kind!=='release')).sort((a,b)=>b.createdAt-a.createdAt);$$('[data-notification-filter]',$('notificationFilters')).forEach(button=>button.classList.toggle('active',button.dataset.notificationFilter===filter));root.innerHTML=items.length?items.map(n=>`<article class="notification-row ${n.read?'is-read':''}"><div><b>${escapeHtml(n.title)}</b><p>${escapeHtml(n.message)}</p>${n.kind==='release'?releaseGuide():''}<small>${dateLabel(isoToday(new Date(n.createdAt)))}</small></div><button class="text-button" data-notification-read="${escapeHtml(n.id)}">${n.read?'Lu':'Marquer comme lu'}</button></article>`).join(''):empty('Aucune notification','Les rappels et les changements importants apparaîtront ici.','i-bell');}
  function bindTransactionActions(){$$('[data-edit-tx]',$('allTransactions')).forEach(b=>b.onclick=e=>{e.stopPropagation();editTransaction(b.dataset.editTx)});$$('[data-delete-tx]',$('allTransactions')).forEach(b=>b.onclick=e=>{e.stopPropagation();if(confirm('Supprimer cette opération ?')){state.transactions=state.transactions.filter(t=>t.id!==b.dataset.deleteTx);save();toast('Opération supprimée')}})}
  function bindRecurringActions(){$$('[data-edit-rec]',$('recurringList')).forEach(b=>b.onclick=e=>{e.stopPropagation();editRecurring(b.dataset.editRec)});$$('[data-delete-rec]',$('recurringList')).forEach(b=>b.onclick=e=>{e.stopPropagation();if(confirm('Supprimer ce récurrent ?')){state.recurring=state.recurring.filter(r=>r.id!==b.dataset.deleteRec);save()}})}
  function bindGoalActions(){$$('[data-edit-goal]',$('goalsList')).forEach(b=>b.onclick=e=>{e.stopPropagation();editGoal(b.dataset.editGoal)});$$('[data-delete-goal]',$('goalsList')).forEach(b=>b.onclick=e=>{e.stopPropagation();if(confirm('Supprimer ce projet ? Ses réserves seront libérées dans Flōw, sans déplacer d’argent bancaire.')){const goal=state.goals.find(g=>g.id===b.dataset.deleteGoal);state.reservations.filter(r=>r.goalId===b.dataset.deleteGoal&&['pending','confirmed','suspended'].includes(r.status)).forEach(r=>{r.status='released';r.resolvedAt=Date.now();r.reason=`Projet supprimé (${goal?.name||'projet'}) : réserve libérée, aucun transfert bancaire.`});state.goals=state.goals.filter(g=>g.id!==b.dataset.deleteGoal);save()}})}
  function bindAccountActions(){$$('[data-edit-account]',$('accountsList')).forEach(b=>b.onclick=e=>{e.stopPropagation();editAccount(b.dataset.editAccount)});$$('[data-delete-account]',$('accountsList')).forEach(b=>b.onclick=e=>{e.stopPropagation();if(state.accounts.length>1&&confirm('Supprimer ce compte et ses opérations ? Ses réserves seront libérées et ses contributions automatiques désactivées. Aucun argent bancaire ne sera déplacé.')){const id=b.dataset.deleteAccount,account=state.accounts.find(a=>a.id===id);state.reservations.filter(r=>r.accountId===id).forEach(r=>{if(['pending','confirmed','suspended'].includes(r.status)){r.status='released';r.resolvedAt=Date.now()}r.accountId=null;r.note=`${r.note||''}\nCompte supprimé : ${account?.name||id}.`;r.reason='Compte supprimé : aucune réserve transférée vers un autre compte.'});state.goals.filter(g=>g.autoContribution?.accountId===id).forEach(g=>{g.autoContribution=null});state.accounts=state.accounts.filter(a=>a.id!==id);state.transactions=state.transactions.filter(t=>t.accountId!==id&&t.sourceAccountId!==id&&t.targetAccountId!==id);state.recurring=state.recurring.filter(r=>r.accountId!==id);if(state.activeAccountId===id)state.activeAccountId=state.accounts[0].id;save()}})}
  function renderStorageStatus(){let banner=$('storageWarning');if(!banner){banner=document.createElement('p');banner.id='storageWarning';banner.setAttribute('role','alert');banner.style.cssText='padding:12px;border:1px solid var(--expense);border-radius:12px;color:var(--text);background:var(--expense-soft);overflow-wrap:anywhere';$('syncIndicator')?.after(banner);}banner.textContent=storageProblem;banner.hidden=!storageProblem;if(storageProblem&&$('syncIndicator'))$('syncIndicator').textContent='Copie locale non enregistrée · export recommandé';}
  function renderAll(){renderStorageStatus();renderAccountSelects();renderDashboard();renderTransactions();renderRecurring();renderGoals();renderSettings();}

  function navigate(destination) {
    const section=$(destination), settingsSection=section?.classList.contains('settings-card')?section:null;
    const page=settingsSection?'settings':destination;
    document.body.dataset.page=page;
    $$('.page').forEach(item=>item.classList.toggle('active',item.id===`page-${page}`));
    $$('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.page===page));
    history.replaceState(null,'',`#${settingsSection?.id||page}`);
    const sectionPicker=$('settingsSectionSelect');if(sectionPicker)sectionPicker.value=settingsSection?.id||'';
    if(settingsSection)requestAnimationFrame(()=>settingsSection.scrollIntoView({top:true,behavior:state.settings.motion==='reduced'?'auto':'smooth',block:'start'}));
    else window.scrollTo({top:0,behavior:state.settings.motion==='reduced'?'auto':'smooth'});
  }
  function openModal(kind,preset={}) {
    const modal=$(`${kind}Modal`); if(!modal)return;
    if(kind==='transaction') resetTransaction(preset); if(kind==='recurring') resetRecurring(); if(kind==='goal') resetGoal(); if(kind==='account') $('accountForm').reset();
    if(kind==='reminder'){$('reminderForm').reset();$('reminderDate').value=isoToday();}
    if(kind==='help'){$('helpSearch').value='';filterHelp('');}
    modal.classList.remove('hidden'); modal.querySelector('input:not([type=hidden])')?.focus({preventScroll:true});
  }
  function closeModal(modal) { modal.closest('.modal-backdrop')?.classList.add('hidden'); }
  function fillCategories(select,type,value) { if(select)select.innerHTML=(CATEGORIES[type]||CATEGORIES.expense).map(c=>`<option value="${c[0]}" ${c[0]===value?'selected':''}>${c[1]}</option>`).join(''); }
  function setSegment(id,value){$$('button',$(id)).forEach(b=>b.classList.toggle('active',b.dataset.value===value));}
  function resetTransaction(preset={}) { $('transactionForm').reset();$('txId').value='';$('txDate').value=isoToday();$('txAccount').value=state.activeAccountId;transactionType=preset.type||'expense';setSegment('transactionType',transactionType);fillCategories($('txCategory'),transactionType==='transfer'?'expense':transactionType);$('txSalary').value='';if($('txTargetAccount'))$('txTargetAccount').value=state.accounts.find(a=>a.id!==state.activeAccountId)?.id||state.activeAccountId;$('transactionTitle').textContent='Nouvelle opération';updateTransferFields(); }
  function resetRecurring(){ $('recurringForm').reset();$('recId').value='';$('recDate').value=isoToday();$('recAccount').value=state.activeAccountId;recurringType='expense';setSegment('recurringType',recurringType);fillCategories($('recCategory'),recurringType);$('recurringTitle').textContent='Nouveau récurrent'; }
  function resetGoal(){ $('goalForm').reset();$('goalId').value='';$('goalSaved').value=0;$('goalTitle').textContent='Nouveau projet'; }
  function editTransaction(id){const t=state.transactions.find(x=>x.id===id);if(!t)return;openModal('transaction');transactionType=t.type;setSegment('transactionType',t.type);fillCategories($('txCategory'),t.type==='transfer'?'expense':t.type,t.category);$('txId').value=t.id;$('txAmount').value=t.amount;$('txLabel').value=t.label;$('txDate').value=t.date;$('txAccount').value=t.sourceAccountId||t.accountId;if($('txTargetAccount'))$('txTargetAccount').value=t.targetAccountId||'';$('txNote').value=t.note||'';$('txFavorite').checked=Boolean(t.favorite);$('txSalary').value=t.salary?'1':'';$('transactionTitle').textContent='Modifier l’opération';updateTransferFields();}
  function editRecurring(id){const r=state.recurring.find(x=>x.id===id);if(!r)return;openModal('recurring');recurringType=r.type;setSegment('recurringType',r.type);fillCategories($('recCategory'),r.type,r.category);$('recId').value=r.id;$('recLabel').value=r.label;$('recAmount').value=r.amount;$('recDate').value=r.nextDate;$('recFrequency').value=r.frequency;$('recAccount').value=r.accountId;$('recurringTitle').textContent='Modifier le récurrent';}
  function editGoal(id){const g=state.goals.find(x=>x.id===id);if(!g)return;openModal('goal');$('goalId').value=g.id;$('goalName').value=g.name;$('goalEmoji').value=g.emoji;$('goalTarget').value=g.target;$('goalSaved').value=g.saved;$('goalDate').value=g.date;$('goalColor').value=g.color;$('goalAutoMode').value=g.autoContribution?.mode||'none';$('goalAutoValue').value=g.autoContribution?.value||'';$('goalAccount').value=g.autoContribution?.accountId||state.activeAccountId;$('goalTitle').textContent='Modifier le projet';}
  function editAccount(id){const a=state.accounts.find(x=>x.id===id);if(!a)return;openModal('account');$('accountId').value=a.id;$('accountName').value=a.name;$('accountType').value=a.type;$('accountInitial').value=accountBalance(a.id);$('accountInclude').checked=Boolean(a.includeInSpendable);$('accountTitle').textContent='Modifier le compte';}
  function updateTransferFields(){const target=$('txTargetAccount')?.closest('label');if(target)target.classList.toggle('hidden',transactionType!=='transfer');const category=$('txCategory')?.closest('label');if(category)category.classList.toggle('hidden',transactionType==='transfer');const salary=$('txSalary');if(salary)salary.value=transactionType==='income'&&$('txCategory')?.value==='salaire'?'1':'';}
  function frequencyLabel(f){return {monthly:'Chaque mois',weekly:'Chaque semaine',yearly:'Chaque année',once:'Une seule fois'}[f]||'Chaque mois';}
  function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  async function createTransferCode(){return window.FlowBackup.createCode({...state,exportedAt:new Date().toISOString()});}
  async function readTransferCode(input){return normalizeState(await window.FlowBackup.readCode(input));}
  function filterHelp(query){const normalized=query.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');let visible=0;$$('[data-help]',$('helpTopics')).forEach(item=>{const haystack=`${item.dataset.help} ${item.textContent}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');const show=!normalized||haystack.includes(normalized);item.classList.toggle('hidden',!show);if(show)visible++;});$('helpEmpty').classList.toggle('hidden',visible>0);}

  const tutorials=[
    {title:'Bienvenue dans Flōw',text:'Commence par renseigner tes comptes et leur solde. L’accueil distingue ton argent réel de ce que tu peux dépenser jusqu’au prochain salaire, après les charges prévues, les réservations et ta marge de sécurité.',art:`<svg viewBox="0 0 240 240"><rect x="35" y="45" width="170" height="150" rx="30" fill="var(--surface)" stroke="var(--primary)" stroke-width="2"/><circle cx="82" cy="95" r="24" fill="var(--primary-soft)"/><path d="M70 98c10-18 20-21 34-19-3 18-12 28-28 27" stroke="var(--primary)" stroke-width="5" fill="none"/><rect x="122" y="78" width="57" height="10" rx="5" fill="var(--line)"/><rect x="122" y="96" width="41" height="8" rx="4" fill="var(--line)"/><rect x="62" y="137" width="116" height="24" rx="12" fill="var(--primary)"/></svg>`},
    {title:'Ajoute en quelques secondes',text:'Appuie sur “+” pour saisir une dépense, un revenu ou un transfert entre tes comptes. Choisis le compte, le montant et un libellé. Le raccourci “Dépense” va directement au bon formulaire.',art:`<svg viewBox="0 0 240 240"><circle cx="120" cy="120" r="78" fill="var(--surface)"/><circle cx="120" cy="120" r="40" fill="var(--primary)"/><path d="M120 100v40m-20-20h40" stroke="#fff" stroke-width="6"/><circle cx="65" cy="72" r="16" fill="var(--peach-soft)"/><circle cx="181" cy="73" r="16" fill="var(--income-soft)"/><circle cx="66" cy="175" r="16" fill="var(--lilac-soft)"/><circle cx="180" cy="175" r="16" fill="var(--blue-soft)"/></svg>`},
    {title:'Anticipe sans te prendre la tête',text:'Dans “À venir”, programme salaires, factures et abonnements, puis confirme-les lorsqu’ils sont réellement passés. Un salaire prévu n’est pas encore disponible. Les réservations des projets mettent un budget de côté, sans effectuer de virement bancaire.',art:`<svg viewBox="0 0 240 240"><rect x="44" y="46" width="152" height="150" rx="28" fill="var(--surface)"/><path d="M44 87h152" stroke="var(--line)" stroke-width="3"/><path d="M78 35v23m84-23v23" stroke="var(--primary)" stroke-width="7"/><circle cx="82" cy="121" r="9" fill="var(--primary)"/><circle cx="120" cy="121" r="9" fill="var(--peach)"/><circle cx="158" cy="121" r="9" fill="var(--lilac)"/><path d="m84 160 20 16 52-51" stroke="var(--income)" stroke-width="7" fill="none"/></svg>`},
    {title:'Une question ? L’aide reste là',text:'Ouvre le wiki avec “?” sur ordinateur ou dans Réglages sur mobile. Recherche une fonction, règle tes comptes et ton prochain salaire, ou retrouve les sauvegardes. Tu peux relancer ce guide à tout moment depuis Réglages.',art:`<svg viewBox="0 0 240 240"><circle cx="120" cy="112" r="72" fill="var(--surface)"/><circle cx="120" cy="112" r="43" fill="var(--primary-soft)" stroke="var(--primary)" stroke-width="3"/><path d="M102 99a19 19 0 1 1 28 17c-8 5-10 9-10 16" stroke="var(--primary)" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="120" cy="151" r="4" fill="var(--primary)"/><rect x="75" y="193" width="90" height="10" rx="5" fill="var(--line)"/></svg>`}
  ];
  function showTutorial(step=0){tutorialStep=step;try{localStorage.setItem(TUTORIAL_SEEN_KEY,'1');}catch{}$('tutorialModal').classList.remove('hidden');renderTutorial();}
  function renderTutorial(){const t=tutorials[tutorialStep];$('tutorialArt').innerHTML=t.art;$('tutorialTitle').textContent=t.title;$('tutorialText').textContent=t.text;$('tutorialStepLabel').textContent=`${tutorialStep+1} sur ${tutorials.length}`;$('tutorialDots').innerHTML=tutorials.map((_,i)=>`<i class="${i===tutorialStep?'active':''}"></i>`).join('');$('tutorialNext').textContent=tutorialStep===tutorials.length-1?'C’est parti':'Continuer';}
  function hasSeenTutorial(){try{return localStorage.getItem(TUTORIAL_SEEN_KEY)==='1';}catch{return false;}}
  function closeTutorial(){$('tutorialModal').classList.add('hidden');}

  document.addEventListener('click',e=>{
    const find=selector=>e.composedPath().find(node=>node?.matches?.(selector));
    const pageTarget=find('[data-page]:not(body), [data-go]');const page=pageTarget?.dataset.page||pageTarget?.dataset.go;if(page){navigate(page);return;}
    const confirmRec=find('[data-confirm-rec]');if(confirmRec){if(recentRecurringConfirmations.has(confirmRec.dataset.confirmRec))return;const result=Core.confirmRecurringOccurrence(state,confirmRec.dataset.confirmRec,confirmRec.dataset.occurrenceDate);if(!result.ok)return toast(result.reason==='future'?'Cette échéance est encore à venir':'Cette échéance a déjà été traitée');if(result.added&&result.transaction.salary){Core.createNotification(state,'salary','Salaire enregistré',`${result.transaction.label} · ${money(result.transaction.amount)} ajouté aux opérations.`,result.transaction.id);Core.makeReservationCandidates(state,result.transaction);}recentRecurringConfirmations.add(confirmRec.dataset.confirmRec);save();setTimeout(()=>{recentRecurringConfirmations.delete(confirmRec.dataset.confirmRec);renderRecurring();},1000);toast(`Échéance du ${dateLabel(result.transaction.date)} enregistrée${result.nextDate?` · suivante : ${dateLabel(result.nextDate)}`:''}`);return;}
    const reuse=find('[data-reuse-tx]');if(reuse){const t=state.transactions.find(x=>x.id===reuse.dataset.reuseTx);if(!t)return;openModal('transaction',{type:t.type});$('txAmount').value=t.amount;$('txLabel').value=t.label;$('txCategory').value=t.category;$('txNote').value=t.note||'';$('txFavorite').checked=true;if(t.type==='transfer')$('txTargetAccount').value=t.targetAccountId||'';return;}
    const deposit=find('[data-deposit]');if(deposit){const g=state.goals.find(x=>x.id===deposit.dataset.deposit),input=deposit.previousElementSibling,amount=Number(input.value),accountId=g?.autoContribution?.accountId||state.activeAccountId;if(!g||amount<=0)return toast('Indique un montant valide');const result=Core.makeManualReservation(state,g.id,amount,accountId);if(!result.ok)return toast(result.reason==='excluded-account'?'Choisis un compte inclus dans le disponible':result.reason==='goal-complete'?'Ce projet a déjà atteint son objectif':result.reason==='insufficient-funds'?'Montant supérieur au disponible du compte':'Impossible de créer cette réserve');input.value='';save();toast(`Montant réservé dans Flōw · ${money(result.reservation.amount)}`);return;}
    const reservationAction=find('[data-reservation-action]');if(reservationAction){const card=reservationAction.closest('[data-reservation-id]');const result=Core.resolveReservation(state,card?.dataset.reservationId,reservationAction.dataset.reservationAction);if(result.ok){save();toast(reservationAction.dataset.reservationAction==='deny'?'Réservation refusée':reservationAction.dataset.reservationAction==='release'?'Réserve libérée dans Flōw':reservationAction.dataset.reservationAction==='prorata'?'Montants répartis au prorata':'Réservation mise à jour');}else toast('Cette réservation ne peut plus être modifiée');return;}
    const read=find('[data-notification-read]');if(read){if([RELEASE_ID,'flow-v5.0.1-sync','flow-v5.0.2-audit','flow-v5.0.3-settings-deeplinks','flow-v5.0.4-motion'].includes(read.dataset.notificationRead)){localStorage.setItem(`${read.dataset.notificationRead}:read:${currentUserUid || 'local'}`,'1');renderNotifications();return;}Core.markNotificationRead(state,read.dataset.notificationRead);save();return;}
  });
  $$('[data-open]').forEach(button=>button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openModal(button.dataset.open,{type:button.dataset.type});}));
  $$('[data-close]').forEach(button=>button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeModal(button);if(button.dataset.page)navigate(button.dataset.page);}));
  $('notificationOpenSettings')?.addEventListener('click',()=>{closeModal($('notificationOpenSettings'));navigate('settings');setTimeout(()=>$('settings-notifications')?.scrollIntoView({behavior:state.settings.motion==='reduced'?'auto':'smooth',block:'start'}),40);});
  $('settingsSectionSelect')?.addEventListener('change',e=>{if($(e.target.value)?.classList.contains('settings-card'))navigate(e.target.value);});
  navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='FLOW_OPEN_NOTIFICATIONS'){navigate('settings');setTimeout(()=>$('settings-notifications')?.scrollIntoView({behavior:'auto',block:'start'}),20);}});
  $('transactionType').addEventListener('click',e=>{const b=e.target.closest('[data-value]');if(!b)return;transactionType=b.dataset.value;setSegment('transactionType',transactionType);fillCategories($('txCategory'),transactionType==='transfer'?'expense':transactionType);updateTransferFields();});
  $('recurringType').addEventListener('click',e=>{const b=e.target.closest('[data-value]');if(!b)return;recurringType=b.dataset.value;setSegment('recurringType',recurringType);fillCategories($('recCategory'),recurringType);});
  $('transactionForm').addEventListener('submit',e=>{e.preventDefault();const id=$('txId').value||uid(),amount=Math.abs(Number($('txAmount').value)),accountId=$('txAccount').value,targetAccountId=$('txTargetAccount')?.value||null;if(!amount||!$('txLabel').value.trim())return;if(transactionType==='transfer'&&(!targetAccountId||targetAccountId===accountId))return toast('Choisis deux comptes différents');const item={id,type:transactionType,amount,label:$('txLabel').value.trim(),category:transactionType==='transfer'?'autre':$('txCategory').value,date:$('txDate').value,accountId,sourceAccountId:accountId,targetAccountId:transactionType==='transfer'?targetAccountId:null,note:$('txNote').value.trim(),favorite:$('txFavorite').checked,salary:transactionType==='income'&&($('txSalary').value==='1'||$('txCategory').value==='salaire')};const i=state.transactions.findIndex(t=>t.id===item.id);if(i>=0)state.transactions[i]=item;else state.transactions.push(item);if(i<0&&item.salary){Core.createNotification(state,'salary','Salaire enregistré',`${item.label} · ${money(item.amount)} ajouté aux opérations.`,item.id);Core.makeReservationCandidates(state,item);}save();closeModal(e.target);toast(i>=0?'Opération modifiée':'Opération ajoutée');});
  $('recurringForm').addEventListener('submit',e=>{e.preventDefault();const item={id:$('recId').value||uid(),type:recurringType,amount:Number($('recAmount').value),label:$('recLabel').value.trim(),category:$('recCategory').value,nextDate:$('recDate').value,frequency:$('recFrequency').value,accountId:$('recAccount').value};const i=state.recurring.findIndex(r=>r.id===item.id);if(i>=0)state.recurring[i]=item;else state.recurring.push(item);state.activeAccountId=item.accountId;save();closeModal(e.target);navigate('recurring');toast(`${i>=0?'Récurrent modifié':'Prévision ajoutée'} · ${state.accounts.find(a=>a.id===item.accountId)?.name||'compte sélectionné'}`);});
  $('goalForm').addEventListener('submit',e=>{e.preventDefault();const mode=$('goalAutoMode').value,value=Number($('goalAutoValue').value)||0,item={id:$('goalId').value||uid(),name:$('goalName').value.trim(),emoji:$('goalEmoji').value.trim()||'🌿',target:Number($('goalTarget').value),saved:Number($('goalSaved').value)||0,date:$('goalDate').value,color:$('goalColor').value,autoContribution:['fixed','percent'].includes(mode)&&value>0?{mode,value,accountId:$('goalAccount').value}:null};const i=state.goals.findIndex(g=>g.id===item.id);if(i>=0)state.goals[i]=item;else state.goals.push(item);save();closeModal(e.target);toast(i>=0?'Projet modifié':'Projet créé');});
  $('accountForm').addEventListener('submit',e=>{e.preventDefault();const id=$('accountId').value,name=$('accountName').value.trim(),type=$('accountType').value,balance=Number($('accountInitial').value)||0,includeInSpendable=$('accountInclude').checked;let acc;if(id){acc=state.accounts.find(a=>a.id===id);if(!acc)return;acc.name=name;acc.type=type;acc.includeInSpendable=includeInSpendable;Core.reconcileAccountBalance(state,id,balance);}else{acc={id:uid(),name,type,openingBalance:balance,createdAt:Date.now(),includeInSpendable};state.accounts.push(acc);state.activeAccountId=acc.id;}save();closeModal(e.target);toast(id?'Compte modifié':'Compte ajouté');});
  $('accountType').addEventListener('change',e=>{$('accountInclude').checked=e.target.value!=='savings';});
  $('activeAccountSelect').addEventListener('change',e=>{state.activeAccountId=e.target.value;save();});
  const changeMonth=delta=>{selectedMonth.setMonth(selectedMonth.getMonth()+delta);renderAll();};
  ['prevMonth','prevMonthMini'].forEach(id=>$(id)?.addEventListener('click',()=>changeMonth(-1)));['nextMonth','nextMonthMini'].forEach(id=>$(id)?.addEventListener('click',()=>changeMonth(1)));
  $('transactionFilter').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;transactionFilter=b.dataset.filter;$$('button',$('transactionFilter')).forEach(x=>x.classList.toggle('active',x===b));renderTransactions();});$('transactionSearch').addEventListener('input',renderTransactions);
  $('themeToggle').addEventListener('click',()=>{const isDark=!document.documentElement.dataset.theme.endsWith('-light')&&document.documentElement.dataset.theme!=='light';state.settings.mode=isDark?'light':'dark';save();});
  $('themeModeOptions').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;state.settings.mode=b.dataset.mode;save();});
  $('paletteOptions').addEventListener('click',e=>{const b=e.target.closest('[data-palette]');if(!b)return;state.settings.palette=b.dataset.palette;save();});
  $('paycheckDay')?.addEventListener('change',e=>{const value=Number(e.target.value);if(value<1||value>31)return toast('Choisis un jour entre 1 et 31');state.settings.payday=value;save();});
  $('safetyBuffer')?.addEventListener('change',e=>{state.settings.safetyBuffer=Math.max(0,Number(e.target.value)||0);save();});
  $('densitySelect')?.addEventListener('change',e=>{state.settings.density=e.target.value;save();});
  $('motionSelect')?.addEventListener('change',e=>{state.settings.motion=['system','reduced','amplified'].includes(e.target.value)?e.target.value:'system';save();});
  $('notificationFilters')?.addEventListener('click',e=>{const button=e.target.closest('[data-notification-filter]');if(!button)return;state.settings.notificationFilters=[button.dataset.notificationFilter];$$('[data-notification-filter]',$('notificationFilters')).forEach(item=>item.classList.toggle('active',item===button));renderNotifications();});
  $('notificationReadAll')?.addEventListener('click',()=>{localStorage.setItem(releaseReadKey(),'1');localStorage.setItem(`flow-v5.0.1-sync:read:${currentUserUid || 'local'}`,'1');localStorage.setItem(`flow-v5.0.2-audit:read:${currentUserUid || 'local'}`,'1');localStorage.setItem(`flow-v5.0.3-settings-deeplinks:read:${currentUserUid || 'local'}`,'1');localStorage.setItem(`flow-v5.0.4-motion:read:${currentUserUid || 'local'}`,'1');state.notifications.forEach(item=>item.read=true);save();toast('Toutes les notifications sont lues');});
  $('addReminderButton')?.addEventListener('click',()=>openModal('reminder'));
  $('reminderForm')?.addEventListener('submit',e=>{e.preventDefault();const result=Core.addReminder(state,{title:$('reminderTitle').value,date:$('reminderDate').value,kind:$('reminderKind').value,note:$('reminderNote').value});if(!result.ok)return toast('Ajoute un titre à ton rappel');save();closeModal(e.target);navigate('settings');toast('Rappel ajouté');});
  $('notificationPermissionButton')?.addEventListener('click',async()=>{if(!('Notification' in window))return toast('Les notifications système ne sont pas disponibles dans ce navigateur');try{const permission=await Notification.requestPermission();toast(permission==='granted'?'Notifications autorisées sur cet appareil':permission==='denied'?'Autorisation refusée dans les réglages du navigateur':'Tu pourras autoriser les notifications plus tard');}catch{toast('Impossible de demander l’autorisation');}});
  $('exportData').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`flow-sauvegarde-${isoToday()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('Sauvegarde téléchargée');});
  $('importData').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>window.FlowBackup.MAX_BYTES)throw new Error('Sauvegarde trop volumineuse : 4 Mo maximum.');const incoming=normalizeState(window.FlowBackup.parse(await file.text()));if(confirm('Remplacer les données actuelles par cette sauvegarde ?')){state=incoming;save();toast('Sauvegarde importée');}}catch(error){toast(error.message||'Ce fichier n’est pas une sauvegarde Flow valide');}e.target.value='';});
  $('generateTransferCode').addEventListener('click',async()=>{const button=$('generateTransferCode');button.disabled=true;button.textContent='Génération…';try{const code=await createTransferCode(),formatted=(code.match(/.{1,64}/g)||[code]).join('\n');$('transferCodeOut').value=formatted;$('transferCodeOut').classList.remove('hidden');$('copyTransferCode').classList.remove('hidden');toast('Code prêt — blocs de 64 caractères');}catch{toast('Impossible de générer le code');}finally{button.disabled=false;button.textContent='Générer le code';}});
  $('copyTransferCode').addEventListener('click',async()=>{const field=$('transferCodeOut');try{await navigator.clipboard.writeText(field.value);toast('Code copié');}catch{field.classList.remove('hidden');field.focus();field.select();document.execCommand('copy');toast('Code sélectionné — copie-le avec Ctrl+C');}});
  $('importTransferCode').addEventListener('click',async()=>{const value=$('transferCodeIn').value;if(!value.trim())return toast('Colle d’abord un code Flow');try{const incoming=await readTransferCode(value);if(confirm('Importer ce code et remplacer les données actuelles ?')){state=incoming;save();$('transferCodeIn').value='';toast('Compte transféré avec succès');}}catch{toast('Ce code Flow est invalide ou incomplet');}});
  $('clearData').addEventListener('click',()=>{if(confirm('Effacer la copie enregistrée sur cet appareil ? Les données en ligne ne seront pas modifiées.')){state=defaultState();save(false);toast('Copie locale réinitialisée');}});
  $('tutorialNext').addEventListener('click',()=>{if(tutorialStep<tutorials.length-1){tutorialStep++;renderTutorial();}else closeTutorial();});$('skipTutorial').addEventListener('click',closeTutorial);$('replayTutorial').addEventListener('click',()=>showTutorial(0));
  $('helpSearch').addEventListener('input',e=>filterHelp(e.target.value));
  $$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m && m!==$('tutorialModal'))m.classList.add('hidden');}));document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal-backdrop:not(.hidden)').forEach(m=>m.classList.add('hidden'));});
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(state.settings.mode==='auto')applyTheme();});
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change',()=>{if(!['reduced','amplified'].includes(state.settings.motion))applyTheme();});
  addEventListener('hashchange',()=>{const destination=location.hash.slice(1);if(destination&&destination!==document.body.dataset.page&&(document.getElementById(destination)||document.getElementById(`page-${destination}`)))navigate(destination);});
  function refreshDueReminders(){const today=isoToday();let changed=false;for(const reminder of state.reminders){if(!reminder.done&&reminder.date<=today&&!state.notifications.some(item=>item.relatedId===reminder.id&&item.kind==='reminder')){Core.createNotification(state,'reminder','Rappel',`${reminder.title}${reminder.note?` · ${reminder.note}`:''}`,reminder.id);changed=true;}}if(changed)save();}
  const settleReservations=()=>{const due=Core.confirmDueReservations(state);if(due.length)save();};
  let resizeTimer; addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderDashboard,100);});
  setInterval(settleReservations,15000);setInterval(refreshDueReminders,60000);
  const hour=new Date().getHours();$('greeting').textContent=hour<12?'Bonjour':hour<18?'Bon après-midi':'Bonsoir';
  settleReservations();refreshDueReminders();applyTheme();renderAll();navigate(location.hash.slice(1)||'dashboard');if(!hasSeenTutorial())setTimeout(()=>showTutorial(0),280);
})();
