(() => {
  'use strict';
  const STORAGE_KEY = 'flow_v4_2';
  const TUTORIAL_SEEN_KEY = 'flow_tutorial_seen_v1';
  const CATEGORIES = {
    expense: [
      ['courses','Courses','🛒'],['restaurants','Restaurants','🍜'],['logement','Logement','🏠'],
      ['transport','Transport','🚆'],['loisirs','Loisirs','🎨'],['shopping','Shopping','🛍️'],
      ['sante','Santé','🌿'],['factures','Factures','🧾'],['autre','Autre','✨']
    ],
    income: [['salaire','Salaire','💼'],['cadeau','Cadeau','🎁'],['remboursement','Remboursement','↩️'],['vente','Vente','📦'],['autre','Autre','✨']]
  };
  const CATEGORY_MAP = Object.fromEntries([...CATEGORIES.expense,...CATEGORIES.income].map(c => [c[0],{label:c[1],emoji:c[2]}]));
  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
  const isoToday = () => new Date().toISOString().slice(0,10);
  const money = (n, compact=false) => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:compact?0:2}).format(Number(n)||0);
  const dateLabel = (value) => new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`));
  const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  const parseDate = (s) => new Date(`${s}T12:00:00`);
  const clamp = (n,min,max) => Math.min(max,Math.max(min,n));

  const defaultState = () => ({
    version: 4.2,
    activeAccountId: 'main',
    accounts: [{id:'main',name:'Compte principal',initialBalance:0,createdAt:Date.now()}],
    transactions: [], recurring: [], goals: [],
    settings: {mode:'auto',palette:'flow'}, migratedFrom:null
  });

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    const accounts = Array.isArray(raw.accounts) && raw.accounts.length ? raw.accounts.map((a,i) => ({
      id:String(a.id || `account-${i}`), name:String(a.name || a.nom || `Compte ${i+1}`),
      initialBalance:Number(a.initialBalance ?? a.balance ?? a.solde ?? 0), createdAt:Number(a.createdAt || Date.now())
    })) : base.accounts;
    const accountIds = new Set(accounts.map(a=>a.id));
    const fallbackAccount = accounts[0].id;
    const transactions = (Array.isArray(raw.transactions) ? raw.transactions : raw.operations || []).map(t => ({
      id:String(t.id || uid()), type:(t.type==='income'||t.type==='revenu'||t.type==='bonus')?'income':'expense',
      amount:Math.abs(Number(t.amount ?? t.montant ?? 0)), label:String(t.label || t.desc || t.description || t.nom || 'Opération'),
      category:String(t.category || t.cat || ((t.type==='income'||t.type==='revenu')?'salaire':'autre')),
      date:String(t.date || isoToday()).slice(0,10), accountId:accountIds.has(String(t.accountId))?String(t.accountId):fallbackAccount
    })).filter(t=>t.amount>0);
    const recurringSource = Array.isArray(raw.recurring) ? raw.recurring : (Array.isArray(raw.revenus)?raw.revenus:[]);
    const recurring = recurringSource.map(r => ({
      id:String(r.id || uid()), type:(r.type==='income'||r.type==='revenu')?'income':'expense',
      amount:Math.abs(Number(r.amount ?? r.montant ?? 0)), label:String(r.label || r.desc || r.description || 'Récurrent'),
      category:String(r.category || r.cat || ((r.type==='income'||r.type==='revenu')?'salaire':'factures')),
      nextDate:String(r.nextDate || r.start || r.date || isoToday()).slice(0,10),
      frequency:({mensuel:'monthly',monthly:'monthly',hebdomadaire:'weekly',weekly:'weekly',annuel:'yearly',yearly:'yearly',once:'once',unique:'once'}[r.frequency || r.recurrence] || 'monthly'),
      accountId:accountIds.has(String(r.accountId))?String(r.accountId):fallbackAccount
    })).filter(r=>r.amount>0);
    const goalSource = Array.isArray(raw.goals) ? raw.goals : (Array.isArray(raw.objectifs)?raw.objectifs:[]);
    const goals = goalSource.map((g,i) => ({
      id:String(g.id || uid()), name:String(g.name || g.nom || 'Mon projet'), emoji:String(g.emoji || '🌿'),
      target:Math.abs(Number(g.target ?? g.amount ?? g.montant ?? 0)), saved:Math.max(0,Number(g.saved ?? g.current ?? g.epargne ?? 0)),
      date:String(g.date || g.deadline || '').slice(0,10), color:String(g.color || ['sage','peach','lilac','blue'][i%4])
    })).filter(g=>g.target>0);
    const legacyTheme=raw.settings?.theme || raw.theme || localStorage.getItem('flow_theme') || 'auto';
    const mode=raw.settings?.mode || (['light','dark','auto'].includes(legacyTheme)?legacyTheme:(legacyTheme.endsWith('-light')?'light':'dark'));
    const palette=raw.settings?.palette || (legacyTheme.startsWith('neon-sakura')?'neon-sakura':legacyTheme.startsWith('ocean-peace')?'ocean-peace':'flow');
    return {version:4.2,accounts,transactions,recurring,goals,
      activeAccountId:accountIds.has(String(raw.activeAccountId))?String(raw.activeAccountId):fallbackAccount,
      settings:{mode,palette},migratedFrom:raw.migratedFrom || null};
  }

  function loadState() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) return normalizeState(JSON.parse(current));
      for (const key of ['flow_v4','flow_v3','flow_v2']) {
        const legacy = localStorage.getItem(key);
        if (!legacy) continue;
        const parsed = JSON.parse(legacy);
        const migrated = normalizeState(parsed);
        migrated.migratedFrom = key;
        // Older versions often stored a live balance plus all operations. Rebuild the initial value to preserve it.
        if (key !== 'flow_v4') migrated.accounts.forEach(account => {
          const source = (parsed.accounts || []).find(a=>String(a.id)===account.id);
          if (source && source.initialBalance == null && source.balance != null) {
            const net = migrated.transactions.filter(t=>t.accountId===account.id).reduce((s,t)=>s+(t.type==='income'?t.amount:-t.amount),0);
            account.initialBalance = Number(source.balance) - net;
          }
        });
        localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));
        return migrated;
      }
    } catch (error) { console.warn('Données Flow illisibles',error); }
    return defaultState();
  }

  let state = loadState();
  let selectedMonth = new Date(); selectedMonth.setDate(1);
  let transactionFilter = 'all';
  let transactionType = 'expense';
  let recurringType = 'expense';
  let tutorialStep = 0;
  const save = () => { localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); renderAll(); };

  function activeAccount() { return state.accounts.find(a=>a.id===state.activeAccountId) || state.accounts[0]; }
  function accountBalance(id) { const acc=state.accounts.find(a=>a.id===id); return (acc?.initialBalance||0)+state.transactions.filter(t=>t.accountId===id).reduce((s,t)=>s+(t.type==='income'?t.amount:-t.amount),0); }
  function monthTransactions(date=selectedMonth) { const key=monthKey(date); return state.transactions.filter(t=>t.date.startsWith(key) && t.accountId===state.activeAccountId); }
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

  function iconUse(id) { return `<svg aria-hidden="true"><use href="#${id}"/></svg>`; }
  function categoryMeta(key) { return CATEGORY_MAP[key] || CATEGORY_MAP.autre; }
  function empty(title,text,emoji='🌱') { return `<div class="empty"><span class="empty-icon">${emoji}</span><b>${title}</b><p>${text}</p></div>`; }
  function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2300); }

  function applyTheme() {
    state.settings.mode ||= 'auto'; state.settings.palette ||= 'flow';
    const resolvedMode=state.settings.mode==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):state.settings.mode;
    const resolvedTheme=state.settings.palette==='flow'?resolvedMode:(resolvedMode==='dark'?state.settings.palette:`${state.settings.palette}-light`);
    document.documentElement.dataset.theme=resolvedTheme;
    $$('[data-mode]', $('themeModeOptions')).forEach(b=>b.classList.toggle('active',b.dataset.mode===state.settings.mode));
    $$('[data-palette]', $('paletteOptions')).forEach(b=>b.classList.toggle('active',b.dataset.palette===state.settings.palette));
    const meta=document.querySelector('meta[name=theme-color]'); if(meta) meta.content=resolvedMode==='dark'?'#111713':'#f5f4ef';
  }
  function renderAccountSelects() {
    const options=state.accounts.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    ['activeAccountSelect','txAccount','recAccount'].forEach(id=>{ const el=$(id); if(el){el.innerHTML=options;el.value=id==='activeAccountSelect'?state.activeAccountId:(el.value||state.activeAccountId);}});
  }
  function renderDashboard() {
    const acc=activeAccount(), txs=monthTransactions(), planned=monthPlanned();
    const income=txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0), expense=txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
    const planIn=planned.filter(r=>r.type==='income').reduce((s,r)=>s+r.amount,0), planOut=planned.filter(r=>r.type==='expense').reduce((s,r)=>s+r.amount,0);
    const remaining=income-expense+planIn-planOut, totalResources=Math.max(1,income+planIn), ratio=clamp((expense+planOut)/totalResources*100,0,100);
    const mobileMonth=matchMedia('(max-width: 700px)').matches;
    $('monthLabel').querySelector('span').textContent=new Intl.DateTimeFormat('fr-FR',mobileMonth?{month:'short',year:'2-digit'}:{month:'long',year:'numeric'}).format(selectedMonth);
    $('accountBalance').textContent=money(accountBalance(acc.id)); $('heroAccountName').textContent=acc.name;
    $('incomeMonth').textContent=money(income); $('expenseMonth').textContent=money(expense); $('remainingMonth').textContent=money(remaining);
    $('spentMonth').textContent=money(expense,true); $('plannedMonth').textContent=money(planOut,true); $('monthProgress').style.width=`${ratio}%`;
    const status=$('budgetStatus'); status.textContent=remaining<0?'À surveiller':ratio>75?'Serré':'Serein';
    $('moneyMessage').textContent=txs.length ? (remaining>=0?`Tu gardes le cap : ${money(Math.max(0,remaining),true)} disponibles sur le mois.`:`Les sorties dépassent les entrées de ${money(Math.abs(remaining),true)}.`) : 'Ajoute tes premières opérations pour voir ton rythme.';
    renderFlowChart(txs); renderUpcoming(planned); renderCategories(txs); renderTransactionList($('recentTransactions'),txs.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5),true);
  }
  function renderFlowChart(txs) {
    const days=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,0).getDate(), buckets=Math.min(days,10), data=Array.from({length:buckets},()=>({in:0,out:0}));
    txs.forEach(t=>{const i=Math.min(buckets-1,Math.floor((Number(t.date.slice(-2))-1)/days*buckets));data[i][t.type==='income'?'in':'out']+=t.amount;});
    const max=Math.max(1,...data.flatMap(d=>[d.in,d.out]));
    $('flowChart').innerHTML=data.map(d=>`<span class="bar-day"><i class="in" style="height:${Math.max(2,d.in/max*100)}%"></i><i class="out" style="height:${Math.max(2,d.out/max*100)}%"></i></span>`).join('');
  }
  function renderUpcoming(planned) {
    const future=planned.filter(r=>r.occurrenceDate>=new Date(new Date().setHours(0,0,0,0))).sort((a,b)=>a.occurrenceDate-b.occurrenceDate).slice(0,4);
    $('upcomingList').innerHTML=future.length?future.map(r=>{const m=categoryMeta(r.category);return `<div class="list-row"><span class="row-icon">${m.emoji}</span><span class="row-info"><b>${escapeHtml(r.label)}</b><span>${dateLabel(r.occurrenceDate.toISOString().slice(0,10))}</span></span><strong class="row-amount ${r.type==='income'?'positive':'negative'}">${r.type==='income'?'+':'−'} ${money(r.amount)}</strong></div>`}).join(''):empty('Rien d’autre de prévu','Ton mois respire. Tu peux ajouter un récurrent dans “À venir”.','✓');
  }
  function renderCategories(txs) {
    const groups={};txs.filter(t=>t.type==='expense').forEach(t=>groups[t.category]=(groups[t.category]||0)+t.amount);
    const rows=Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,4),max=rows[0]?.[1]||1;
    $('categoryList').innerHTML=rows.length?rows.map(([key,val])=>{const m=categoryMeta(key);return `<div class="category-row"><span class="emoji">${m.emoji}</span><div class="category-main"><div class="category-label"><b>${m.label}</b><span>${Math.round(val/(Object.values(groups).reduce((a,b)=>a+b,0)||1)*100)}%</span></div><div class="category-track"><span style="width:${val/max*100}%"></span></div></div><strong>${money(val,true)}</strong></div>`}).join(''):empty('Pas encore de tendance','Tes catégories apparaîtront après quelques dépenses.','◔');
  }
  function transactionRow(t,withActions=true) { const m=categoryMeta(t.category);return `<div class="transaction-row"><span class="transaction-icon">${m.emoji}</span><span class="transaction-info"><b>${escapeHtml(t.label)}</b><span>${m.label} · ${dateLabel(t.date)}</span></span><strong class="transaction-amount ${t.type==='income'?'positive':'negative'}">${t.type==='income'?'+':'−'} ${money(t.amount)}</strong>${withActions?`<span class="row-actions"><button data-edit-tx="${t.id}" aria-label="Modifier">${iconUse('i-edit')}</button><button data-delete-tx="${t.id}" aria-label="Supprimer">${iconUse('i-trash')}</button></span>`:''}</div>`; }
  function renderTransactionList(root,list,compact=false) { root.innerHTML=list.length?list.map(t=>transactionRow(t,!compact)).join(''):empty('Aucune opération','Ajoute une dépense ou un revenu en quelques secondes.','↕'); }
  function renderTransactions() {
    const query=$('transactionSearch').value.trim().toLowerCase(); let list=state.transactions.filter(t=>t.accountId===state.activeAccountId);
    if(transactionFilter!=='all') list=list.filter(t=>t.type===transactionFilter); if(query) list=list.filter(t=>`${t.label} ${categoryMeta(t.category).label}`.toLowerCase().includes(query));
    renderTransactionList($('allTransactions'),list.sort((a,b)=>b.date.localeCompare(a.date)));bindTransactionActions();
  }
  function renderRecurring() {
    const list=state.recurring.filter(r=>r.accountId===state.activeAccountId).sort((a,b)=>a.nextDate.localeCompare(b.nextDate));
    const planned=monthPlanned(), pi=planned.filter(r=>r.type==='income').reduce((s,r)=>s+r.amount,0),pe=planned.filter(r=>r.type==='expense').reduce((s,r)=>s+r.amount,0);
    $('plannedIncome').textContent=money(pi);$('plannedExpense').textContent=money(pe);$('plannedNet').textContent=money(pi-pe);$('plannedNet').className=pi-pe>=0?'positive':'negative';
    $('recurringList').innerHTML=list.length?list.map(r=>{const d=parseDate(r.nextDate),m=categoryMeta(r.category);return `<div class="recurring-row"><span class="rec-date"><b>${d.getDate()}</b><span>${new Intl.DateTimeFormat('fr-FR',{month:'short'}).format(d)}</span></span><span class="transaction-icon">${m.emoji}</span><span class="transaction-info"><b>${escapeHtml(r.label)}</b><span>${frequencyLabel(r.frequency)} · ${m.label}</span></span><strong class="transaction-amount ${r.type==='income'?'positive':'negative'}">${r.type==='income'?'+':'−'} ${money(r.amount)}</strong><button class="confirm-button" data-confirm-rec="${r.id}">C’est passé</button><span class="row-actions"><button data-edit-rec="${r.id}" aria-label="Modifier">${iconUse('i-edit')}</button><button data-delete-rec="${r.id}" aria-label="Supprimer">${iconUse('i-trash')}</button></span></div>`}).join(''):empty('Aucune surprise prévue','Ajoute ton salaire, tes abonnements et tes factures.','↻');bindRecurringActions();
  }
  function renderGoals() {
    $('goalsList').innerHTML=state.goals.length?state.goals.map(g=>{const pct=clamp(g.saved/g.target*100,0,100);return `<article class="goal-card ${g.color}"><div class="goal-top"><span class="goal-emoji">${escapeHtml(g.emoji||'🌿')}</span><span class="goal-actions"><button data-edit-goal="${g.id}" aria-label="Modifier">${iconUse('i-edit')}</button><button data-delete-goal="${g.id}" aria-label="Supprimer">${iconUse('i-trash')}</button></span></div><h2>${escapeHtml(g.name)}</h2><p>${g.date?`Objectif pour le ${dateLabel(g.date)}`:'Avance à ton rythme'}</p><div class="goal-amounts"><strong>${money(g.saved,true)}</strong><span>sur ${money(g.target,true)}</span></div><div class="goal-track"><span style="width:${pct}%"></span></div><div class="goal-footer"><input type="number" min="1" step="1" placeholder="Montant"><button data-deposit="${g.id}">Ajouter</button></div></article>`}).join(''):empty('Un projet en tête ?','Crée un objectif doux et suis tes progrès sans pression.','🌤️');bindGoalActions();
  }
  function renderSettings() {
    $('accountsList').innerHTML=state.accounts.map(a=>`<div class="settings-account"><b>${escapeHtml(a.name)}</b><span>${money(accountBalance(a.id))}${state.accounts.length>1?` <button class="row-actions" data-delete-account="${a.id}" aria-label="Supprimer">×</button>`:''}</span></div>`).join('');applyTheme();bindAccountActions();
  }
  function bindTransactionActions(){$$('[data-edit-tx]',$('allTransactions')).forEach(b=>b.onclick=e=>{e.stopPropagation();editTransaction(b.dataset.editTx)});$$('[data-delete-tx]',$('allTransactions')).forEach(b=>b.onclick=e=>{e.stopPropagation();if(confirm('Supprimer cette opération ?')){state.transactions=state.transactions.filter(t=>t.id!==b.dataset.deleteTx);save();toast('Opération supprimée')}})}
  function bindRecurringActions(){$$('[data-edit-rec]',$('recurringList')).forEach(b=>b.onclick=e=>{e.stopPropagation();editRecurring(b.dataset.editRec)});$$('[data-delete-rec]',$('recurringList')).forEach(b=>b.onclick=e=>{e.stopPropagation();if(confirm('Supprimer ce récurrent ?')){state.recurring=state.recurring.filter(r=>r.id!==b.dataset.deleteRec);save()}});$$('[data-confirm-rec]',$('recurringList')).forEach(b=>b.onclick=e=>{e.stopPropagation();const r=state.recurring.find(x=>x.id===b.dataset.confirmRec);if(!r)return;state.transactions.push({id:uid(),type:r.type,amount:r.amount,label:r.label,category:r.category,date:r.nextDate,accountId:r.accountId});if(r.frequency==='once')state.recurring=state.recurring.filter(x=>x.id!==r.id);else r.nextDate=nextRecurringDate(r.nextDate,r.frequency);save();toast('Ajouté aux opérations')})}
  function bindGoalActions(){$$('[data-edit-goal]',$('goalsList')).forEach(b=>b.onclick=e=>{e.stopPropagation();editGoal(b.dataset.editGoal)});$$('[data-delete-goal]',$('goalsList')).forEach(b=>b.onclick=e=>{e.stopPropagation();if(confirm('Supprimer ce projet ?')){state.goals=state.goals.filter(g=>g.id!==b.dataset.deleteGoal);save()}});$$('[data-deposit]',$('goalsList')).forEach(b=>b.onclick=e=>{e.stopPropagation();const g=state.goals.find(x=>x.id===b.dataset.deposit),input=b.previousElementSibling,amount=Number(input.value);if(!g||amount<=0)return toast('Indique un montant');g.saved=Math.min(g.target,g.saved+amount);save();toast('Projet alimenté ✨')})}
  function bindAccountActions(){$$('[data-delete-account]',$('accountsList')).forEach(b=>b.onclick=e=>{e.stopPropagation();if(state.accounts.length>1&&confirm('Supprimer ce compte et ses opérations ?')){const id=b.dataset.deleteAccount;state.accounts=state.accounts.filter(a=>a.id!==id);state.transactions=state.transactions.filter(t=>t.accountId!==id);state.recurring=state.recurring.filter(r=>r.accountId!==id);if(state.activeAccountId===id)state.activeAccountId=state.accounts[0].id;save()}})}
  function renderAll(){renderAccountSelects();renderDashboard();renderTransactions();renderRecurring();renderGoals();renderSettings();}

  function navigate(page) { document.body.dataset.page=page;$$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${page}`));$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));history.replaceState(null,'',`#${page}`);window.scrollTo({top:0,behavior:'smooth'}); }
  function openModal(kind,preset={}) {
    const modal=$(`${kind}Modal`); if(!modal)return;
    if(kind==='transaction') resetTransaction(preset); if(kind==='recurring') resetRecurring(); if(kind==='goal') resetGoal(); if(kind==='account') $('accountForm').reset();
    if(kind==='help'){$('helpSearch').value='';filterHelp('');}
    modal.classList.remove('hidden'); setTimeout(()=>modal.querySelector('input:not([type=hidden])')?.focus(),30);
  }
  function closeModal(modal) { modal.closest('.modal-backdrop')?.classList.add('hidden'); }
  function fillCategories(select,type,value) { select.innerHTML=CATEGORIES[type].map(c=>`<option value="${c[0]}" ${c[0]===value?'selected':''}>${c[2]} ${c[1]}</option>`).join(''); }
  function setSegment(id,value){$$('button',$(id)).forEach(b=>b.classList.toggle('active',b.dataset.value===value));}
  function resetTransaction(preset={}) { $('transactionForm').reset();$('txId').value='';$('txDate').value=isoToday();$('txAccount').value=state.activeAccountId;transactionType=preset.type||'expense';setSegment('transactionType',transactionType);fillCategories($('txCategory'),transactionType);$('transactionTitle').textContent='Nouvelle opération'; }
  function resetRecurring(){ $('recurringForm').reset();$('recId').value='';$('recDate').value=isoToday();$('recAccount').value=state.activeAccountId;recurringType='expense';setSegment('recurringType',recurringType);fillCategories($('recCategory'),recurringType);$('recurringTitle').textContent='Nouveau récurrent'; }
  function resetGoal(){ $('goalForm').reset();$('goalId').value='';$('goalSaved').value=0;$('goalTitle').textContent='Nouveau projet'; }
  function editTransaction(id){const t=state.transactions.find(x=>x.id===id);if(!t)return;openModal('transaction');transactionType=t.type;setSegment('transactionType',t.type);fillCategories($('txCategory'),t.type,t.category);$('txId').value=t.id;$('txAmount').value=t.amount;$('txLabel').value=t.label;$('txDate').value=t.date;$('txAccount').value=t.accountId;$('transactionTitle').textContent='Modifier l’opération';}
  function editRecurring(id){const r=state.recurring.find(x=>x.id===id);if(!r)return;openModal('recurring');recurringType=r.type;setSegment('recurringType',r.type);fillCategories($('recCategory'),r.type,r.category);$('recId').value=r.id;$('recLabel').value=r.label;$('recAmount').value=r.amount;$('recDate').value=r.nextDate;$('recFrequency').value=r.frequency;$('recAccount').value=r.accountId;$('recurringTitle').textContent='Modifier le récurrent';}
  function editGoal(id){const g=state.goals.find(x=>x.id===id);if(!g)return;openModal('goal');$('goalId').value=g.id;$('goalName').value=g.name;$('goalEmoji').value=g.emoji;$('goalTarget').value=g.target;$('goalSaved').value=g.saved;$('goalDate').value=g.date;$('goalColor').value=g.color;$('goalTitle').textContent='Modifier le projet';}
  function nextRecurringDate(date,frequency){const d=parseDate(date);if(frequency==='weekly')d.setDate(d.getDate()+7);else if(frequency==='yearly')d.setFullYear(d.getFullYear()+1);else{const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+1);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));}return d.toISOString().slice(0,10);}
  function frequencyLabel(f){return {monthly:'Chaque mois',weekly:'Chaque semaine',yearly:'Chaque année',once:'Une seule fois'}[f]||'Chaque mois';}
  function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function toBase64Url(bytes){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function fromBase64Url(value){const base=value.replace(/-/g,'+').replace(/_/g,'/');const padded=base+'='.repeat((4-base.length%4)%4),binary=atob(padded),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
  async function createTransferCode(){const json=JSON.stringify({...state,exportedAt:new Date().toISOString()});if('CompressionStream' in window){const stream=new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));const bytes=new Uint8Array(await new Response(stream).arrayBuffer());return `FLOW42G-${toBase64Url(bytes)}`;}return `FLOW42J-${toBase64Url(new TextEncoder().encode(json))}`;}
  async function readTransferCode(input){const code=input.trim().replace(/\s+/g,'');const match=code.match(/^FLOW42([GJ])-([A-Za-z0-9_-]+)$/);if(!match)throw new Error('format');let bytes=fromBase64Url(match[2]);if(match[1]==='G'){if(!('DecompressionStream' in window))throw new Error('compression');const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));bytes=new Uint8Array(await new Response(stream).arrayBuffer());}return normalizeState(JSON.parse(new TextDecoder().decode(bytes)));}
  function filterHelp(query){const normalized=query.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');let visible=0;$$('[data-help]',$('helpTopics')).forEach(item=>{const haystack=`${item.dataset.help} ${item.textContent}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');const show=!normalized||haystack.includes(normalized);item.classList.toggle('hidden',!show);if(show)visible++;});$('helpEmpty').classList.toggle('hidden',visible>0);}

  const tutorials=[
    {title:'Bienvenue dans Flow',text:'Ici, pas de jargon bancaire. Ton solde, ton reste à vivre et ce qui arrive bientôt sont réunis au même endroit.',art:`<svg viewBox="0 0 240 240"><rect x="35" y="45" width="170" height="150" rx="30" fill="var(--surface)" stroke="var(--primary)" stroke-width="2"/><circle cx="82" cy="95" r="24" fill="var(--primary-soft)"/><path d="M70 98c10-18 20-21 34-19-3 18-12 28-28 27" stroke="var(--primary)" stroke-width="5" fill="none"/><rect x="122" y="78" width="57" height="10" rx="5" fill="var(--line)"/><rect x="122" y="96" width="41" height="8" rx="4" fill="var(--line)"/><rect x="62" y="137" width="116" height="24" rx="12" fill="var(--primary)"/></svg>`},
    {title:'Ajoute en quelques secondes',text:'Appuie sur “+”, choisis dépense ou revenu, saisis le montant et c’est terminé. Les catégories restent simples.',art:`<svg viewBox="0 0 240 240"><circle cx="120" cy="120" r="78" fill="var(--surface)"/><circle cx="120" cy="120" r="40" fill="var(--primary)"/><path d="M120 100v40m-20-20h40" stroke="#fff" stroke-width="6"/><circle cx="65" cy="72" r="16" fill="var(--peach-soft)"/><circle cx="181" cy="73" r="16" fill="var(--income-soft)"/><circle cx="66" cy="175" r="16" fill="var(--lilac-soft)"/><circle cx="180" cy="175" r="16" fill="var(--blue-soft)"/></svg>`},
    {title:'Anticipe sans te prendre la tête',text:'Ajoute les salaires, factures et abonnements dans “À venir”. Flow calcule ce qu’il restera réellement pour le mois.',art:`<svg viewBox="0 0 240 240"><rect x="44" y="46" width="152" height="150" rx="28" fill="var(--surface)"/><path d="M44 87h152" stroke="var(--line)" stroke-width="3"/><path d="M78 35v23m84-23v23" stroke="var(--primary)" stroke-width="7"/><circle cx="82" cy="121" r="9" fill="var(--primary)"/><circle cx="120" cy="121" r="9" fill="var(--peach)"/><circle cx="158" cy="121" r="9" fill="var(--lilac)"/><path d="m84 160 20 16 52-51" stroke="var(--income)" stroke-width="7" fill="none"/></svg>`},
    {title:'Une question ? L’aide reste là',text:'Le bouton “?” dans la barre du haut ouvre le wiki Flow. Recherche une fonction ou relance ce guide depuis les réglages.',art:`<svg viewBox="0 0 240 240"><circle cx="120" cy="112" r="72" fill="var(--surface)"/><circle cx="120" cy="112" r="43" fill="var(--primary-soft)" stroke="var(--primary)" stroke-width="3"/><path d="M102 99a19 19 0 1 1 28 17c-8 5-10 9-10 16" stroke="var(--primary)" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="120" cy="151" r="4" fill="var(--primary)"/><rect x="75" y="193" width="90" height="10" rx="5" fill="var(--line)"/></svg>`}
  ];
  function showTutorial(step=0){tutorialStep=step;try{localStorage.setItem(TUTORIAL_SEEN_KEY,'1');}catch{}$('tutorialModal').classList.remove('hidden');renderTutorial();}
  function renderTutorial(){const t=tutorials[tutorialStep];$('tutorialArt').innerHTML=t.art;$('tutorialTitle').textContent=t.title;$('tutorialText').textContent=t.text;$('tutorialStepLabel').textContent=`${tutorialStep+1} sur ${tutorials.length}`;$('tutorialDots').innerHTML=tutorials.map((_,i)=>`<i class="${i===tutorialStep?'active':''}"></i>`).join('');$('tutorialNext').textContent=tutorialStep===tutorials.length-1?'C’est parti':'Continuer';}
  function hasSeenTutorial(){try{return localStorage.getItem(TUTORIAL_SEEN_KEY)==='1';}catch{return false;}}
  function closeTutorial(){$('tutorialModal').classList.add('hidden');}

  document.addEventListener('click',e=>{
    const find=selector=>e.composedPath().find(node=>node?.matches?.(selector));
    const pageTarget=find('[data-page]')||find('[data-go]');const page=pageTarget?.dataset.page||pageTarget?.dataset.go;if(page){navigate(page);return;}
    const editTx=find('[data-edit-tx]');if(editTx)return editTransaction(editTx.dataset.editTx);
    const delTx=find('[data-delete-tx]');if(delTx&&confirm('Supprimer cette opération ?')){state.transactions=state.transactions.filter(t=>t.id!==delTx.dataset.deleteTx);save();toast('Opération supprimée');return;}
    const editRec=find('[data-edit-rec]');if(editRec)return editRecurring(editRec.dataset.editRec);
    const delRec=find('[data-delete-rec]');if(delRec&&confirm('Supprimer ce récurrent ?')){state.recurring=state.recurring.filter(r=>r.id!==delRec.dataset.deleteRec);save();toast('Récurrent supprimé');return;}
    const confirmRec=find('[data-confirm-rec]');if(confirmRec){const r=state.recurring.find(x=>x.id===confirmRec.dataset.confirmRec);if(!r)return;state.transactions.push({id:uid(),type:r.type,amount:r.amount,label:r.label,category:r.category,date:r.nextDate,accountId:r.accountId});if(r.frequency==='once')state.recurring=state.recurring.filter(x=>x.id!==r.id);else r.nextDate=nextRecurringDate(r.nextDate,r.frequency);save();toast('Ajouté aux opérations');return;}
    const editG=find('[data-edit-goal]');if(editG)return editGoal(editG.dataset.editGoal);
    const delG=find('[data-delete-goal]');if(delG&&confirm('Supprimer ce projet ?')){state.goals=state.goals.filter(g=>g.id!==delG.dataset.deleteGoal);save();return;}
    const deposit=find('[data-deposit]');if(deposit){const g=state.goals.find(x=>x.id===deposit.dataset.deposit),input=deposit.previousElementSibling,amount=Number(input.value);if(!g||amount<=0)return toast('Indique un montant');g.saved=Math.min(g.target,g.saved+amount);input.value='';save();toast('Projet alimenté ✨');return;}
    const delAcc=find('[data-delete-account]');if(delAcc&&state.accounts.length>1&&confirm('Supprimer ce compte et ses opérations ?')){const id=delAcc.dataset.deleteAccount;state.accounts=state.accounts.filter(a=>a.id!==id);state.transactions=state.transactions.filter(t=>t.accountId!==id);state.recurring=state.recurring.filter(r=>r.accountId!==id);if(state.activeAccountId===id)state.activeAccountId=state.accounts[0].id;save();return;}
  });
  $$('[data-open]').forEach(button=>button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openModal(button.dataset.open,{type:button.dataset.type});}));
  $$('[data-close]').forEach(button=>button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();closeModal(button);}));
  $$('[data-go]').forEach(button=>button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();navigate(button.dataset.go);}));
  $$('.nav-item[data-page]').forEach(button=>button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();navigate(button.dataset.page);}));
  $('transactionType').addEventListener('click',e=>{const b=e.target.closest('[data-value]');if(!b)return;transactionType=b.dataset.value;setSegment('transactionType',transactionType);fillCategories($('txCategory'),transactionType);});
  $('recurringType').addEventListener('click',e=>{const b=e.target.closest('[data-value]');if(!b)return;recurringType=b.dataset.value;setSegment('recurringType',recurringType);fillCategories($('recCategory'),recurringType);});
  $('transactionForm').addEventListener('submit',e=>{e.preventDefault();const item={id:$('txId').value||uid(),type:transactionType,amount:Number($('txAmount').value),label:$('txLabel').value.trim(),category:$('txCategory').value,date:$('txDate').value,accountId:$('txAccount').value};if(!item.amount||!item.label)return;const i=state.transactions.findIndex(t=>t.id===item.id);if(i>=0)state.transactions[i]=item;else state.transactions.push(item);save();closeModal(e.target);toast(i>=0?'Opération modifiée':'Opération ajoutée');});
  $('recurringForm').addEventListener('submit',e=>{e.preventDefault();const item={id:$('recId').value||uid(),type:recurringType,amount:Number($('recAmount').value),label:$('recLabel').value.trim(),category:$('recCategory').value,nextDate:$('recDate').value,frequency:$('recFrequency').value,accountId:$('recAccount').value};const i=state.recurring.findIndex(r=>r.id===item.id);if(i>=0)state.recurring[i]=item;else state.recurring.push(item);save();closeModal(e.target);toast(i>=0?'Récurrent modifié':'Prévision ajoutée');});
  $('goalForm').addEventListener('submit',e=>{e.preventDefault();const item={id:$('goalId').value||uid(),name:$('goalName').value.trim(),emoji:$('goalEmoji').value.trim()||'🌿',target:Number($('goalTarget').value),saved:Number($('goalSaved').value)||0,date:$('goalDate').value,color:$('goalColor').value};const i=state.goals.findIndex(g=>g.id===item.id);if(i>=0)state.goals[i]=item;else state.goals.push(item);save();closeModal(e.target);toast(i>=0?'Projet modifié':'Projet créé');});
  $('accountForm').addEventListener('submit',e=>{e.preventDefault();const acc={id:uid(),name:$('accountName').value.trim(),initialBalance:Number($('accountInitial').value)||0,createdAt:Date.now()};state.accounts.push(acc);state.activeAccountId=acc.id;save();closeModal(e.target);toast('Compte ajouté');});
  $('activeAccountSelect').addEventListener('change',e=>{state.activeAccountId=e.target.value;save();});
  $('prevMonth').addEventListener('click',()=>{selectedMonth.setMonth(selectedMonth.getMonth()-1);renderAll();});$('nextMonth').addEventListener('click',()=>{selectedMonth.setMonth(selectedMonth.getMonth()+1);renderAll();});
  $('transactionFilter').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;transactionFilter=b.dataset.filter;$$('button',$('transactionFilter')).forEach(x=>x.classList.toggle('active',x===b));renderTransactions();});$('transactionSearch').addEventListener('input',renderTransactions);
  $('themeToggle').addEventListener('click',()=>{const isDark=!document.documentElement.dataset.theme.endsWith('-light')&&document.documentElement.dataset.theme!=='light';state.settings.mode=isDark?'light':'dark';save();});
  $('themeModeOptions').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;state.settings.mode=b.dataset.mode;save();});
  $('paletteOptions').addEventListener('click',e=>{const b=e.target.closest('[data-palette]');if(!b)return;state.settings.palette=b.dataset.palette;save();});
  $('exportData').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`flow-sauvegarde-${isoToday()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('Sauvegarde téléchargée');});
  $('importData').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const incoming=normalizeState(JSON.parse(await file.text()));if(confirm('Remplacer les données actuelles par cette sauvegarde ?')){state=incoming;save();toast('Sauvegarde importée');}}catch{toast('Ce fichier n’est pas une sauvegarde Flow valide');}e.target.value='';});
  $('generateTransferCode').addEventListener('click',async()=>{const button=$('generateTransferCode');button.disabled=true;button.textContent='Génération…';try{const code=await createTransferCode(),formatted=(code.match(/.{1,64}/g)||[code]).join('\n');$('transferCodeOut').value=formatted;$('transferCodeOut').classList.remove('hidden');$('copyTransferCode').classList.remove('hidden');toast('Code prêt — blocs de 64 caractères');}catch{toast('Impossible de générer le code');}finally{button.disabled=false;button.textContent='Générer le code';}});
  $('copyTransferCode').addEventListener('click',async()=>{const field=$('transferCodeOut');try{await navigator.clipboard.writeText(field.value);toast('Code copié');}catch{field.classList.remove('hidden');field.focus();field.select();document.execCommand('copy');toast('Code sélectionné — copie-le avec Ctrl+C');}});
  $('importTransferCode').addEventListener('click',async()=>{const value=$('transferCodeIn').value;if(!value.trim())return toast('Colle d’abord un code Flow');try{const incoming=await readTransferCode(value);if(confirm('Importer ce code et remplacer les données actuelles ?')){state=incoming;save();$('transferCodeIn').value='';toast('Compte transféré avec succès');}}catch{toast('Ce code Flow est invalide ou incomplet');}});
  $('clearData').addEventListener('click',()=>{if(confirm('Tout effacer sur cet appareil ? Cette action est définitive.')){localStorage.removeItem(STORAGE_KEY);state=defaultState();save();toast('Flow a été remis à zéro');}});
  $('tutorialNext').addEventListener('click',()=>{if(tutorialStep<tutorials.length-1){tutorialStep++;renderTutorial();}else closeTutorial();});$('skipTutorial').addEventListener('click',closeTutorial);$('replayTutorial').addEventListener('click',()=>showTutorial(0));
  $('helpSearch').addEventListener('input',e=>filterHelp(e.target.value));
  $$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m && m!==$('tutorialModal'))m.classList.add('hidden');}));document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal-backdrop:not(.hidden)').forEach(m=>m.classList.add('hidden'));});
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(state.settings.mode==='auto')applyTheme();});
  let resizeTimer; addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderDashboard,100);});
  const hour=new Date().getHours();$('greeting').textContent=hour<12?'Bonjour':hour<18?'Bon après-midi':'Bonsoir';
  applyTheme();renderAll();navigate(location.hash.slice(1)||'dashboard');if(!hasSeenTutorial())setTimeout(()=>showTutorial(0),280);
})();
