'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

test('dashboard named cards retain their grid areas on desktop, tablet and mobile', async () => {
  const server = spawn(process.execPath, [path.resolve(__dirname, '../scripts/audit-browser-preview.cjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Isolated preview startup timed out')), 10000);
      server.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Preview exited: ${code}`)); });
    });
    browser = await chromium.launch({ headless: true, channel: process.env.FLOW_BROWSER_CHANNEL || 'chrome' });
    for (const width of [1440, 1024, 900, 768, 701, 700, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await page.goto('http://127.0.0.1:4181/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.FlowApp);
      const cards = await page.evaluate(() => {
        const grid = document.querySelector('.dashboard-grid').getBoundingClientRect();
        return ['hero', 'breathing', 'upcoming', 'recent', 'insights', 'reservations'].map(name => {
          const element = document.querySelector(`.dashboard-grid>.${name}-card`);
          const rect = element.getBoundingClientRect();
          return { name, area: getComputedStyle(element).gridArea, width: rect.width, left: rect.left, right: rect.right, gridLeft: grid.left, gridRight: grid.right };
        });
      });
      for (const card of cards) {
        const area = card.name === 'breathing' ? 'balance' : card.name;
        assert.equal(card.area.split(' / ')[0], area, `${width}px: ${card.name} placement`);
        assert(card.width >= 200, `${width}px: ${card.name} collapsed to ${card.width}px`);
        assert(card.left >= card.gridLeft - 1 && card.right <= card.gridRight + 1, `${width}px: ${card.name} escapes grid`);
      }
      await page.close();
    }
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.setViewportSize({width:320,height:640});
    await page.addInitScript(() => localStorage.setItem('flow_tutorial_seen_v1', '1'));
    await page.goto('http://127.0.0.1:4181/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.FlowApp);
    await page.evaluate(()=>{const state=FlowCore.getEmptyState();state.accounts[0].name='Compte'.repeat(50);state.accounts[0].openingBalance=-12345678;state.recurring=[{id:'long',type:'expense',amount:987654321,label:'Prélèvement'.repeat(40),accountId:'main',nextDate:'2026-10-01',frequency:'monthly'}];FlowApp.applyRemoteState(state);});
    for(const destination of ['dashboard','recurring']){
      await page.locator(`[data-page="${destination}"]`).filter({visible:true}).first().click();
      const overflow = await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,offenders:[...document.querySelectorAll('.page.active *')].filter(element=>element.getBoundingClientRect().right>innerWidth+1).map(element=>({tag:element.tagName,class:element.className,id:element.id,right:element.getBoundingClientRect().right})).slice(0,12)}));
      assert(overflow.width<=overflow.viewport+1,`${destination}: long data overflows mobile viewport ${JSON.stringify(overflow)}`);
      const selector=destination==='dashboard'?'.hero-top strong, .breathing-card>strong':'.recurring-row>.transaction-amount';
      for(const rectangle of await page.locator(selector).evaluateAll(elements=>elements.map(element=>{const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right,scroll:element.scrollWidth,width:element.clientWidth};}))) {
        assert(rectangle.left>=0&&rectangle.right<=321,'amount extends beyond viewport');
        assert(rectangle.scroll<=rectangle.width+1,'amount clipped inside its container');
      }
    }
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>FlowApp.applyRemoteState(FlowCore.getEmptyState()));
    await page.waitForTimeout(350);
    if (await page.locator('#tutorialModal').isVisible()) await page.locator('#skipTutorial').click();
    const trigger = page.locator('[data-open="transaction"]').filter({ visible: true }).first();
    await trigger.focus();
    await trigger.click();
    await page.locator('#txAmount').fill('1000000001');
    assert.equal(await page.locator('#txAmount').evaluate(element=>element.checkValidity()), false, 'oversized amount must fail HTML validation');
    await page.locator('#txLabel').fill('Must not save');
    await page.locator('#transactionForm').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(await page.evaluate(()=>FlowApp.getState().transactions.length), 0, 'synthetic submission must not bypass amount bounds');
    await page.keyboard.press('Escape');
    for (const id of await page.locator('.modal-backdrop[role="dialog"]').evaluateAll(elements => elements.map(element => element.id))) {
      await page.evaluate(id => document.getElementById(id).classList.remove('hidden'), id);
      await page.waitForFunction(id => document.getElementById(id).contains(document.activeElement), id);
      for (let index = 0; index < 25; index++) {
        await page.keyboard.press(index < 15 ? 'Tab' : 'Shift+Tab');
        assert(await page.evaluate(id => document.getElementById(id).contains(document.activeElement), id), `${id}: keyboard focus escaped`);
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.activeElement.closest('.modal-backdrop'));
      assert(await trigger.evaluate(element => element === document.activeElement), `${id}: original focus not restored`);
    }
    await page.evaluate(()=>{const state=FlowCore.getEmptyState();state.accounts.push({id:'secondary',name:'Compte secondaire',openingBalance:100});FlowApp.applyRemoteState(state);});
    await page.locator('[data-page="recurring"]').filter({visible:true}).first().click();
    await page.locator('[data-open="recurring"]').filter({visible:true}).first().click();
    await page.locator('#recLabel').fill('Visible sur le bon compte');
    await page.locator('#recAmount').fill('42.50');
    await page.locator('#recAccount').selectOption('secondary');
    await page.locator('#recurringForm').evaluate(form=>form.requestSubmit());
    assert.equal(await page.evaluate(()=>FlowApp.getState().activeAccountId),'secondary');
    assert(await page.locator('#recurringList').innerText().then(text=>text.includes('Visible sur le bon compte')));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.FlowApp);
    assert.equal(await page.evaluate(()=>FlowApp.getState().activeAccountId),'secondary');
    assert(await page.locator('#recurringList').innerText().then(text=>text.includes('Visible sur le bon compte')));
    await page.close();
    for (const fault of ['blocked', 'quota', 'corrupt']) {
      const faultPage = await browser.newPage({ reducedMotion: 'reduce' });
      const errors = [];
      faultPage.on('pageerror', error => errors.push(error.message));
      await faultPage.addInitScript(fault => {
        if (fault === 'corrupt') localStorage.setItem('flow_v5:local', '{broken financial backup');
        if (fault === 'blocked') Storage.prototype.getItem = () => { throw new DOMException('Denied', 'SecurityError'); };
        if (fault !== 'corrupt') Storage.prototype.setItem = () => { throw new DOMException('Not writable', fault === 'quota' ? 'QuotaExceededError' : 'SecurityError'); };
      }, fault);
      await faultPage.goto('http://127.0.0.1:4181/', { waitUntil: 'domcontentloaded' });
      await faultPage.waitForFunction(() => window.FlowApp);
      await faultPage.evaluate(() => {
        const state = FlowCore.getEmptyState(); state.accounts[0].openingBalance = 123;
        FlowApp.applyRemoteState(state);
      });
      assert.equal(await faultPage.evaluate(() => FlowApp.getState().accounts[0].openingBalance), 123, `${fault}: in-memory data unavailable`);
      assert(await faultPage.locator('#storageWarning').isVisible(), `${fault}: missing persistent warning`);
      assert.match(await faultPage.locator('#syncIndicator').textContent(), /non enregistrée/);
      if (fault === 'corrupt') assert.equal(await faultPage.evaluate(() => localStorage.getItem('flow_v5:local')), '{broken financial backup', 'damaged original must not be overwritten');
      assert.deepEqual(errors, [], `${fault}: initialization errors`);
      await faultPage.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
