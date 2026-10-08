'use strict';
// UX audit only: fresh browser storage, blocked service workers, no Firebase traffic.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.FLOW_TEST_URL || 'http://127.0.0.1:4173/';
const artifactDir = path.resolve(__dirname, '../artifacts/audit-ux-2026-10-07');
const out = { date: '2026-10-07', base, profiles: [], findings: [], special: {}, infrastructureErrors: [] };
const findings = new Map();
const pageProfiles = new WeakMap();
function finding(id, description, evidence, profile) {
  if (!findings.has(id)) findings.set(id, { id, description, profiles: [], examples: [] });
  const item = findings.get(id);
  if (profile && !item.profiles.includes(profile)) item.profiles.push(profile);
  if (item.examples.length < 8) item.examples.push(evidence);
}
function measureLayout() {
  const shown = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const outside = [...document.querySelectorAll('header button, header select, .page.active button, .page.active input, .page.active select, .page.active .transaction-amount, .page.active .settings-account, .page.active .hero-top strong')]
    .filter(shown).map(el => { const r=el.getBoundingClientRect(); return { selector: el.id ? '#'+el.id : el.className, text: el.textContent.trim().slice(0,85), x:Math.round(r.x), right:Math.round(r.right), width:Math.round(r.width) }; })
    .filter(r => r.x < -1 || r.right > innerWidth+1);
  return { page:document.body.dataset.page, width:innerWidth, clientWidth:document.documentElement.clientWidth, visualWidth:visualViewport.width, rootOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth, outside:outside.slice(0,12) };
}
async function seed(page, extreme=true) {
  await page.evaluate(extreme => {
    const state=FlowCore.getEmptyState(), today=FlowCore.isoDate(new Date());
    state.accounts[0].openingBalance=extreme?98765432.10:1800;
    state.accounts[0].name=extreme?'Compte principal avec un intitulé très long '.repeat(4):'Compte courant';
    for(let i=0;i<7;i++) state.accounts.push({id:'ux-account-'+i,name:extreme?'Épargne personnelle voyage et logement '.repeat(3):'Épargne '+i,type:'savings',openingBalance:12345678.90,includeInSpendable:false});
    state.settings.payday=28;
    state.settings.motion='reduced';
    state.transactions=Array.from({length:80},(_,i)=>({id:'ux-tx-'+i,type:i%8===0?'income':'expense',amount:extreme?1234567.89:12.34,label:extreme?'Libellétrèstrèslongsansespacement'.repeat(8):'Courses '+i,note:extreme?'Texte de note longue avec caractères français et emojis 🧭 '.repeat(12):'Note',date:today,accountId:'main',category:i%8===0?'autre':'courses',favorite:i%3===0}));
    state.recurring=Array.from({length:6},(_,i)=>({id:'ux-rec-'+i,type:'expense',amount:extreme?12345678.90:50,label:extreme?'Abonnementàintituléextrêmementlong'.repeat(8):'Abonnement '+i,nextDate:i<3?today:'2099-12-15',frequency:'monthly',category:'factures',accountId:'main'}));
    state.goals=Array.from({length:5},(_,i)=>({id:'ux-goal-'+i,name:extreme?'Nomdeprojetlongavecplusieursobjectifs'.repeat(5):'Voyage '+i,target:12345.67,saved:890.12,date:'2027-12-15',color:'sage',emoji:'🧭',accountId:'main'}));
    state.notifications=[{id:'ux-note',kind:'reminder',title:'Notification longue '.repeat(15),message:'Texte très long '.repeat(60),createdAt:Date.now(),read:false}];
    FlowApp.applyRemoteState(state);
  },extreme);
}
async function createPage(browser, profile, init) {
  const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},serviceWorkers:'block',reducedMotion:'reduce',colorScheme:profile.osTheme||'light',locale:'fr-FR',isMobile:profile.width<=700,hasTouch:profile.width<=700});
  // Abort every non-local request, including production APIs and remote font URLs.
  await context.route('**/*', route => {
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/flow-cloud.js'))return route.fulfill({contentType:'text/javascript',body:'window.FlowCloud={getCurrentUser:()=>null,getIdToken:async()=>null};'});
    if(url.protocol==='data:'||url.hostname==='127.0.0.1'||url.hostname==='localhost')return route.continue();
    return route.abort('blockedbyclient');
  });
  if(init) await context.addInitScript(init);
  const page=await context.newPage(), errors=[];
  pageProfiles.set(page,profile.id);
  page.setDefaultTimeout(6000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.FlowApp);
  await page.waitForTimeout(320);
  if(await page.locator('#tutorialModal').isVisible())await page.locator('#skipTutorial').click();
  return {context,page,errors};
}
async function navigate(page, name) {
  const link=page.locator(`[data-page="${name}"], [data-go="${name}"]`).filter({visible:true}).first();
  try { await link.click({timeout:1500}); }
  catch(error) {
    const evidence=await link.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {page:document.body.dataset.page,target:el.dataset.page||el.dataset.go,rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:hit?.outerHTML.slice(0,250),viewport:{width:innerWidth,height:innerHeight,visualWidth:visualViewport.width,visualHeight:visualViewport.height}};});
    finding('UX-NAVIGATION-UNCLICKABLE','Navigation control cannot receive a user click in this layout; audit continues via DOM activation.',evidence,pageProfiles.get(page));
    await link.evaluate(el=>el.click());
  }
  await page.waitForTimeout(120);
}
async function openDialog(page,opener,kind) {
  const modal=page.locator('#'+kind+'Modal');
  if(await modal.isVisible())return;
  try{await opener.click({timeout:1500});}catch(error){if(!await modal.isVisible()){
    const evidence=await opener.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {control:el.className,rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:hit?.closest('button')?.outerHTML.slice(0,220),quick:[...document.querySelectorAll('.quick')].map(b=>{const r=b.getBoundingClientRect();return {class:b.className,x:r.x,y:r.y,width:r.width,right:r.right};})};});
    finding('UX-CONTROL-OVERLAP','Visible control cannot receive a user click because a neighbouring control overlaps it; subsequent dialog checks use DOM activation.',evidence,pageProfiles.get(page));
    await page.screenshot({path:path.join(artifactDir,pageProfiles.get(page)+'-overlap.png')});
    await opener.evaluate(el=>el.click());
  }}
  await modal.waitFor({state:'visible'});
}
async function auditProfile(browser,profile) {
  const {context,page,errors}=await createPage(browser,profile);
  const result={...profile,layouts:[],errors};
  try {
    await seed(page,true);
    await page.evaluate(p=>{const s=FlowApp.getState();s.settings.mode=p.mode;s.settings.palette=p.palette;s.settings.density=p.density;FlowApp.applyRemoteState(s);if(p.zoom)document.documentElement.style.zoom=p.zoom;},profile);
    for(const name of ['dashboard','transactions','recurring','goals','settings']) {
      await navigate(page,name);
      const layout=await page.evaluate(measureLayout);result.layouts.push(layout);
      if(layout.rootOverflow>1||layout.outside.length)finding('UX-LAYOUT-OVERFLOW','Visible content exceeds the viewport with long names/large amounts.',{profile:profile.id,...layout},profile.id);
    }
    result.theme=await page.evaluate(()=>document.documentElement.dataset.theme);
    result.density=await page.evaluate(()=>document.documentElement.dataset.density);
    if(profile.screenshot)await page.screenshot({path:path.join(artifactDir,profile.id+'-settings.png'),fullPage:!profile.zoom});
    await navigate(page,'dashboard');
    await openDialog(page,page.locator('.quick.expense'),'transaction');
    result.transactionModal=await page.evaluate(()=>{const m=document.getElementById('transactionModal'),r=m.querySelector('.modal').getBoundingClientRect(),c=m.querySelector('.close').getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height),x:Math.round(r.x),right:Math.round(r.right),closeY:Math.round(c.y),focused:document.activeElement.id,formValid:m.querySelector('form').checkValidity()};});
    if(result.transactionModal.x< -1||result.transactionModal.right>profile.width+1||result.transactionModal.closeY<0)finding('UX-MODAL-CLIPPED','A modal or its close button falls outside the viewport.',{profile:profile.id,modal:result.transactionModal},profile.id);
    try{await page.locator('#transactionModal .close').click({timeout:1500});}catch(error){finding('UX-MODAL-CLOSE-UNREACHABLE','Modal X cannot be clicked in this stress layout.',{profile:profile.id,modal:result.transactionModal,cssZoom:profile.zoom||null},profile.id);await page.keyboard.press('Escape');}
    if(await page.locator('#transactionModal').isVisible())finding('UX-CLOSE-FAILED','Modal X did not close.',profile.id,profile.id);
    if(errors.length)finding('UX-RUNTIME','Browser runtime error during UX flows.',{profile:profile.id,errors},profile.id);
  } finally {out.profiles.push(result);await context.close();}
}
async function functionalAudit(browser,width) {
  const profile={id:'functional-'+width,width,height:width===1440?900:844};
  const {context,page,errors}=await createPage(browser,profile);
  const result={errors,modals:[],invalidAmounts:[]};out.special[profile.id]=result;
  try {
    await seed(page,false);
    for(const kind of ['transaction','recurring','goal','account','reminder','help','notifications']) {
      await navigate(page,kind==='recurring'?'recurring':kind==='goal'?'goals':kind==='transaction'?'dashboard':'settings');
      const opener=(kind==='transaction'?page.locator('.quick.expense'):kind==='reminder'?page.locator('#addReminderButton'):page.locator(`[data-open="${kind}"]`)).filter({visible:true}).first();
      await openDialog(page,opener,kind);
      const modal=page.locator('#'+kind+'Modal');
      const initial=await page.evaluate(()=>({id:document.activeElement.id,tag:document.activeElement.tagName,dialog:document.activeElement.closest('[role="dialog"]')?.id||null}));
      await modal.locator('.close').focus();await page.keyboard.press('Shift+Tab');
      const backwards=await page.evaluate(()=>({id:document.activeElement.id,tag:document.activeElement.tagName,dialog:document.activeElement.closest('[role="dialog"]')?.id||null}));
      const buttons=modal.locator('button');await buttons.last().focus();await page.keyboard.press('Tab');
      const forwards=await page.evaluate(()=>({id:document.activeElement.id,tag:document.activeElement.tagName,dialog:document.activeElement.closest('[role="dialog"]')?.id||null}));
      await page.keyboard.press('Escape');
      const restore=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id,hiddenParent:!!document.activeElement.closest('.hidden')}));
      const entry={kind,initial,backwards,forwards,restore,escapeCloses:!await modal.isVisible()};result.modals.push(entry);
      if(backwards.dialog!==kind+'Modal'||forwards.dialog!==kind+'Modal')finding('UX-MODAL-FOCUS-ESCAPES','Keyboard focus escapes modal dialogs despite aria-modal=true.',entry,profile.id);
      if(restore.hiddenParent||restore.tag==='BODY')finding('UX-MODAL-FOCUS-NOT-RESTORED','Closing the modal loses focus instead of returning to the opener.',entry,profile.id);
      if(initial.dialog!==kind+'Modal')finding('UX-MODAL-INITIAL-FOCUS','Opening an input-free dialog leaves keyboard focus behind the overlay.',entry,profile.id);
    }
    await navigate(page,'dashboard');
    await openDialog(page,page.locator('.quick.expense'),'transaction');await page.locator('#txLabel').fill('Audit montant');
    for(const value of ['0','-12.34','12.345','1000000001','1e309']) {
      await page.locator('#txAmount').fill(value);
      const before=await page.evaluate(()=>FlowApp.getState().transactions.length);
      const valid=await page.locator('#txAmount').evaluate(el=>({valid:el.validity.valid,stepMismatch:el.validity.stepMismatch,rangeUnderflow:el.validity.rangeUnderflow,rangeOverflow:el.validity.rangeOverflow,badInput:el.validity.badInput,value:el.value}));
      await page.locator('#transactionForm .primary').click();
      const after=await page.evaluate(()=>FlowApp.getState().transactions.length),visible=await page.locator('#transactionModal').isVisible();
      result.invalidAmounts.push({value,before,after,visible,valid});
      if(value==='1000000001'&&!visible&&after===before)finding('UX-AMOUNT-SILENT-DROP','A syntactically valid amount above 1 billion closes the form and claims addition, but normalization drops the transaction.',{width,value,before,after,toast:await page.locator('#toast').textContent()},profile.id);
      if(!visible){await openDialog(page,page.locator('.quick.expense'),'transaction');await page.locator('#txLabel').fill('Audit montant');}
    }
    await page.locator('#txAmount').fill('12.34');await page.locator('#txLabel').fill('Favori audit');await page.locator('#txFavorite').check();await page.locator('#transactionForm .primary').click();
    await navigate(page,'transactions');
    const fav=await page.evaluate(()=>FlowApp.getState().transactions.find(t=>t.label==='Favori audit'));
    await page.locator(`[data-reuse-tx="${fav.id}"]`).click();
    result.favorite={saved:!!fav.favorite,amount:await page.locator('#txAmount').inputValue(),label:await page.locator('#txLabel').inputValue(),date:await page.locator('#txDate').inputValue(),id:await page.locator('#txId').inputValue()};
    await page.keyboard.press('Escape');
    await navigate(page,'recurring');
    const due=page.locator('[data-confirm-rec="ux-rec-0"]'),future=page.locator('[data-confirm-rec="ux-rec-4"]');
    const n=await page.evaluate(()=>FlowApp.getState().transactions.length);await due.click();
    result.recurring={futureDisabled:await future.isDisabled(),before:n,after:await page.evaluate(()=>FlowApp.getState().transactions.length),dueLabel:await due.textContent(),dueDisabled:await due.isDisabled()};
    await navigate(page,'settings');await page.locator('[data-open="help"]').filter({visible:true}).first().click();await page.locator('#helpSearch').fill('salaire');
    result.wikiMatch=await page.locator('#helpTopics [data-help]:not(.hidden)').count();await page.locator('#helpSearch').fill('zzzzInexistant');result.wikiNoMatch=await page.locator('#helpEmpty').isVisible();await page.keyboard.press('Escape');
    await page.locator('#replayTutorial').click();result.tutorial=[];
    for(let i=0;i<5&&await page.locator('#tutorialModal').isVisible();i++){result.tutorial.push(await page.locator('#tutorialStepLabel').textContent());await page.locator('#tutorialNext').click();}
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(330);result.tutorialStaysDismissed=!await page.locator('#tutorialModal').isVisible();
  } finally {await context.close();}
}
async function faultAudit(browser,kind) {
  const profile={id:'storage-'+kind,width:390,height:844};
  const init=kind==='unreadable'?()=>{Storage.prototype.getItem=function(){throw new DOMException('Storage blocked for audit','SecurityError');};}:kind==='quota'?()=>{Storage.prototype.setItem=function(){throw new DOMException('Storage full for audit','QuotaExceededError');};}:()=>{localStorage.setItem('flow_v5:local','{broken-json');localStorage.setItem('flow_tutorial_seen_v1','1');};
  const {context,page,errors}=await createPage(browser,profile,init),result={errors};out.special[profile.id]=result;
  try {
    result.accounts=await page.locator('#activeAccountSelect option').count();result.page=await page.locator('.page.active').count();
    result.syncText=await page.locator('#syncIndicator').textContent();
    if(kind==='quota') {
      await openDialog(page,page.locator('.quick.expense'),'transaction');await page.locator('#txAmount').fill('42');await page.locator('#txLabel').fill('Quota audit');await page.locator('#transactionForm .primary').click();
      result.added=await page.evaluate(()=>FlowApp.getState().transactions.length);result.toast=await page.locator('#toast').textContent();result.syncText=await page.locator('#syncIndicator').textContent();
      await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(330);result.afterReload=await page.evaluate(()=>FlowApp.getState().transactions.length);
      if(result.added===1&&result.afterReload===0)finding('UX-STORAGE-WRITE-FALSE-SUCCESS','Local storage quota failure silently loses entered data on reload while UI claims success.',result,profile.id);
    }
    if(kind==='unreadable'&&errors.length)finding('UX-STORAGE-READ-CRASH','Denied localStorage reads abort initialization via unguarded notification read flags.',result,profile.id);
    if(kind==='corrupt')finding('UX-STORAGE-CORRUPT-SILENT-EMPTY','Malformed stored JSON presents an empty account without a recovery message.',result,profile.id);
  }finally{await context.close();}
}
async function accessibilityAudit(browser) {
  const {context,page,errors}=await createPage(browser,{id:'accessibility',width:1440,height:900});
  const result={errors,themes:[]};out.special.accessibility=result;
  try {
    await seed(page,false);
    await navigate(page,'settings');
    for(const palette of ['flow','neon-sakura','ocean-peace'])for(const mode of ['light','dark']) {
      await page.locator(`[data-palette="${palette}"]`).click();await page.locator(`[data-mode="${mode}"]`).click();await page.waitForTimeout(100);
      const contrasts=await page.evaluate(()=>{
        const rgb=s=>{const a=s.match(/[\d.]+/g)||[];return a.slice(0,3).map(Number);};
        const lum=c=>c.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
        const samples=[];
        for(const selector of ['#page-settings .card-kicker','#page-settings .field-help','#page-settings .button.primary','#page-settings .button.secondary','#page-settings .notification-row small','#page-settings .settings-account small']) {
          const el=document.querySelector(selector);if(!el)continue;const css=getComputedStyle(el);let parent=el,bg;
          while(parent){const c=getComputedStyle(parent).backgroundColor;if(!c.startsWith('rgba')&&c!=='transparent'){bg=c;break;}parent=parent.parentElement;}
          if(!bg)bg=getComputedStyle(document.body).backgroundColor;
          const a=lum(rgb(css.color)),b=lum(rgb(bg)),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
          samples.push({selector,text:el.textContent.trim().slice(0,60),color:css.color,background:bg,fontSize:css.fontSize,fontWeight:css.fontWeight,ratio:Number(ratio.toFixed(2))});
        }
        return samples;
      });
      result.themes.push({palette,mode,contrasts});
      for(const c of contrasts)if(c.ratio<4.5)finding('UX-TEXT-CONTRAST','Sampled normal-size text falls below 4.5:1 contrast on its solid background.',{palette,mode,...c},palette+'-'+mode);
    }
    await navigate(page,'dashboard');
    result.dashboardAria=await page.locator('#page-dashboard').ariaSnapshot();
    await page.locator('[data-open="notifications"]').filter({visible:true}).first().click();
    result.notificationsScreenshot=path.join(artifactDir,'notifications-accessibility.png');await page.screenshot({path:result.notificationsScreenshot});await page.keyboard.press('Escape');
    await navigate(page,'settings');await page.locator('#replayTutorial').click();
    result.tutorialInitialFocus=await page.evaluate(()=>({id:document.activeElement.id,dialog:document.activeElement.closest('[role="dialog"]')?.id||null}));
    if(result.tutorialInitialFocus.dialog!=='tutorialModal')finding('UX-TUTORIAL-INITIAL-FOCUS','Tutorial opens without moving keyboard focus to its dialog.',result.tutorialInitialFocus,'accessibility');
    await page.keyboard.press('Escape');
    result.motion=await page.evaluate(()=>({settings:FlowApp.getState().settings.motion,select:document.getElementById('motionSelect').value,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,transition:getComputedStyle(document.querySelector('.button')).transitionDuration}));
  } finally {await context.close();}
}
async function recurringVisibilityAudit(browser) {
  const {context,page,errors}=await createPage(browser,{id:'recurring-other-account',width:390,height:844});
  const result={errors};out.special.recurringOtherAccount=result;
  try {
    await seed(page,false);await navigate(page,'recurring');
    result.activeBefore=await page.locator('#activeAccountSelect').inputValue();
    await page.locator('#page-recurring [data-open="recurring"]').click();
    result.defaultFormAccount=await page.locator('#recAccount').inputValue();
    await page.locator('#recLabel').fill('Dépense à venir audit compte secondaire');await page.locator('#recAmount').fill('42.50');await page.locator('#recAccount').selectOption('ux-account-0');await page.locator('#recurringForm .primary').click();
    result.activeAfter=await page.locator('#activeAccountSelect').inputValue();result.modalClosed=!await page.locator('#recurringModal').isVisible();result.toast=await page.locator('#toast').textContent();
    result.saved=await page.evaluate(()=>FlowApp.getState().recurring.find(r=>r.label==='Dépense à venir audit compte secondaire'));
    result.visibleBeforeReload=await page.locator('#recurringList').getByText('Dépense à venir audit compte secondaire',{exact:true}).count();
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(350);
    result.savedAfterReload=await page.evaluate(()=>FlowApp.getState().recurring.find(r=>r.label==='Dépense à venir audit compte secondaire'));
    await navigate(page,'recurring');result.visibleAfterReload=await page.locator('#recurringList').getByText('Dépense à venir audit compte secondaire',{exact:true}).count();
    await page.locator('#activeAccountSelect').selectOption('ux-account-0');result.visibleAfterSwitch=await page.locator('#recurringList').getByText('Dépense à venir audit compte secondaire',{exact:true}).count();
    await page.screenshot({path:path.join(artifactDir,'recurring-visible-after-account-switch.png')});
    if(result.saved&&result.savedAfterReload&&!result.visibleBeforeReload&&!result.visibleAfterReload&&result.visibleAfterSwitch===1)finding('UX-RECURRING-SAVED-HIDDEN-ACCOUNT','Recurring form allows saving to another account, then closes with success while active account filter hides the saved item without guidance.',result,'recurring-other-account');
  }finally{await context.close();}
}
async function tabletStructureAudit(browser) {
  const {context,page,errors}=await createPage(browser,{id:'tablet-empty',width:768,height:1024});
  try {
    await navigate(page,'dashboard');
    const result=await page.evaluate(()=>{const grid=document.querySelector('.dashboard-grid'),hero=document.querySelector('.hero-card'),balance=document.querySelector('.breathing-card');return {accounts:FlowApp.getState().accounts.length,transactions:FlowApp.getState().transactions.length,viewport:innerWidth,gridWidth:grid.getBoundingClientRect().width,columns:getComputedStyle(grid).gridTemplateColumns,areas:getComputedStyle(grid).gridTemplateAreas,hero:{width:hero.getBoundingClientRect().width,column:getComputedStyle(hero).gridColumn,row:getComputedStyle(hero).gridRow},balance:{width:balance.getBoundingClientRect().width,column:getComputedStyle(balance).gridColumn,row:getComputedStyle(balance).gridRow}};});
    result.errors=errors;out.special.tabletEmpty=result;
    await page.screenshot({path:path.join(artifactDir,'tablet-empty-dashboard.png')});
    if(result.hero.width<100&&result.balance.width<100)finding('UX-TABLET-DASHBOARD-GRID','Dashboard cards collapse to one grid column each at 768px even in a fresh empty account.',result,'tablet-empty');
  }finally{await context.close();}
}
(async()=>{
  await fs.mkdir(artifactDir,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:process.env.FLOW_BROWSER_CHANNEL||'chrome'});
  try {
    const profiles=[];
    for(const v of [{width:320,height:640},{width:390,height:844},{width:768,height:1024},{width:1440,height:900},{width:844,height:390}])
      for(const palette of ['flow','neon-sakura','ocean-peace'])for(const mode of ['light','dark'])for(const density of ['comfortable','compact','wide'])profiles.push({...v,palette,mode,density,id:`ux-${v.width}x${v.height}-${palette}-${mode}-${density}`,screenshot:palette==='flow'&&mode==='light'&&density==='comfortable'});
    for(const v of [{width:640,height:320},{width:1024,height:768},{width:1440,height:900,zoom:2},{width:1440,height:900,zoom:4},{width:320,height:480},{width:390,height:300},{width:768,height:400},{width:1920,height:1080},{width:2560,height:1440},{width:390,height:844,mode:'auto',osTheme:'dark'}])profiles.push({palette:'flow',mode:'light',density:'comfortable',...v,id:`ux-extra-${profiles.length+1}`,screenshot:true});
    const selectedProfiles=['specials','tablet'].includes(process.env.FLOW_AUDIT_SECTIONS)?[]:profiles;
    for(let i=0;i<selectedProfiles.length;i+=2) {
      await Promise.all(selectedProfiles.slice(i,i+2).map(async profile=>{
        try{await auditProfile(browser,profile);}catch(e){out.infrastructureErrors.push({profile:profile.id,error:e.message});console.error(profile.id,e.message);}
      }));
      if(out.profiles.length%10===0)console.log(`UX profiles completed: ${out.profiles.length}/100`);
    }
    if(process.env.FLOW_AUDIT_SECTIONS==='tablet')await tabletStructureAudit(browser);
    else if(process.env.FLOW_AUDIT_SECTIONS!=='matrix') {
      for(const width of [320,390,768,1440])try{await functionalAudit(browser,width);}catch(e){out.infrastructureErrors.push({scenario:'functional-'+width,error:e.message});}
      for(const kind of ['quota','unreadable','corrupt'])try{await faultAudit(browser,kind);}catch(e){out.infrastructureErrors.push({scenario:'storage-'+kind,error:e.message});}
      try{await accessibilityAudit(browser);}catch(e){out.infrastructureErrors.push({scenario:'accessibility',error:e.message});}
      try{await recurringVisibilityAudit(browser);}catch(e){out.infrastructureErrors.push({scenario:'recurring-other-account',error:e.message});}
      try{await tabletStructureAudit(browser);}catch(e){out.infrastructureErrors.push({scenario:'tablet-empty',error:e.message});}
    }
  } finally {await browser.close();out.findings=[...findings.values()];const file=process.env.FLOW_AUDIT_SECTIONS==='specials'?'special-results.json':process.env.FLOW_AUDIT_SECTIONS==='matrix'?'matrix-results.json':process.env.FLOW_AUDIT_SECTIONS==='tablet'?'tablet-results.json':'results.json';await fs.writeFile(path.join(artifactDir,file),JSON.stringify(out,null,2));}
  console.log(JSON.stringify({profiles:out.profiles.length,findings:out.findings.map(f=>({id:f.id,profiles:f.profiles.length,example:f.examples[0]})),infrastructureErrors:out.infrastructureErrors},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
