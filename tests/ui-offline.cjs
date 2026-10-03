'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.FLOW_BROWSER_CHANNEL || undefined });
  try {
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    await page.route('**/flow-cloud.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.FlowCloud={getCurrentUser:()=>null,getIdToken:async()=>null};' }));
    await page.goto(process.env.FLOW_TEST_URL || 'http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.FlowApp);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const state = FlowCore.getEmptyState(); state.accounts[0].openingBalance = 777.25;
      FlowApp.applyRemoteState(state); localStorage.setItem('flow_tutorial_seen_v1', '1');
    });
    await page.waitForFunction(async () => { const names = await caches.keys(); const cache = await caches.open(names.find(name => name.startsWith('flow-shell-'))); return (await cache.keys()).length >= 20; });
    await context.setOffline(true);
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => window.FlowApp && FlowApp.getState().accounts[0].openingBalance === 777.25);
    assert.equal(await page.locator('#accountBalance').textContent(), '777,25 €');
    await page.locator('#skipTutorial').click({ timeout: 1000 }).catch(() => {});
    await page.locator('.quick.expense').click();
    await page.locator('#txAmount').fill('7.25'); await page.locator('#txLabel').fill('Hors ligne');
    await page.locator('#transactionForm .modal-actions .primary').click();
    assert.equal(await page.evaluate(() => FlowCore.getAccountBalance(FlowApp.getState(), 'main')), 770);
    console.log('Offline installation/cache/reload/local transaction: PASS');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
