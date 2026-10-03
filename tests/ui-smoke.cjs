'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.FLOW_TEST_URL || 'http://127.0.0.1:4173/';
const artifactDir = path.resolve(__dirname, '../artifacts');
const today = new Date().toISOString().slice(0, 10);
(async () => {
  await fs.mkdir(artifactDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.FLOW_BROWSER_CHANNEL || undefined });
  const reports = []; let currentPage = null;
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = []; currentPage = page;
      // Deterministic local UX tests. Live Firebase is verified separately with its emulator suite.
      await page.route('**/flow-cloud.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.FlowCloud={getCurrentUser:()=>null,getIdToken:async()=>null};' }));
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept().catch(() => {}));
      console.log(`Testing viewport ${viewport.width}…`);
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.FlowApp && document.getElementById('heroAccountName').textContent);
      await page.waitForTimeout(400);
      if (await page.locator('#tutorialModal').isVisible()) await page.locator('#skipTutorial').click();
      assert.equal(await page.evaluate(() => FlowApp.listNotifications().filter(n => n.id === 'flow-v5-release').length), 1, 'one release notice');
      await page.evaluate(() => document.querySelector('[data-notification-read="flow-v5-release"]').click());
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.FlowApp);
      assert.equal(await page.evaluate(() => FlowApp.listNotifications().find(n => n.id === 'flow-v5-release').read), true, 'release read status survives reload');
      assert.equal(await page.locator('#releaseNotificationPreview .release-guide').count(), 1, 'mini guide is available from the bell');
      const duplicateIDs = await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(el => el.id); return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]; });
      assert.deepEqual(duplicateIDs, [], 'duplicate DOM IDs');
      await page.evaluate(() => { const state = FlowCore.getEmptyState(); state.accounts[0].openingBalance = 1800; state.accounts.push({ id: 'savings', name: 'Épargne', type: 'savings', openingBalance: 200, includeInSpendable: false }); FlowApp.applyRemoteState(state); });
      for (const name of ['transactions', 'recurring', 'goals', 'settings', 'dashboard']) {
        await page.locator(`[data-page="${name}"], [data-go="${name}"]`).filter({ visible: true }).first().click();
        assert(await page.locator(`#page-${name}`).isVisible(), `${name} navigates`);
        if (name === 'settings' && viewport.width <= 700) {
          await page.locator('#settingsSectionSelect').selectOption('settings-sharing');
          assert(await page.locator('#settings-sharing').isVisible(), 'mobile settings section is reachable without scrolling through all categories');
          await page.locator('#settingsSectionSelect').selectOption('settings-general');
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert(overflow <= 1, `${viewport.width}px ${name} overflows by ${overflow}px`);
      }
      // Main action and close X must both work on desktop and mobile.
      await page.locator('[data-open="transaction"]').filter({ visible: true }).first().click();
      assert(await page.locator('#transactionModal').isVisible());
      await page.locator('#transactionModal .close').click();
      assert(!(await page.locator('#transactionModal').isVisible()));
      await page.locator('.quick.expense').click();
      await page.locator('#txAmount').fill('12.34'); await page.locator('#txLabel').fill('Courses test'); await page.locator('#txDate').fill(today);
      await page.locator('#transactionForm button[type="submit"], #transactionForm .modal-actions .primary').click();
      assert.equal(await page.evaluate(() => FlowApp.getState().transactions.length), 1);
      assert.equal(await page.evaluate(() => FlowCore.getAccountBalance(FlowApp.getState(), 'main')), 1787.66);
      await page.locator('.quick.transfer').click(); await page.locator('#txAmount').fill('100'); await page.locator('#txLabel').fill('Vers épargne'); await page.locator('#txTargetAccount').selectOption('savings');
      await page.locator('#transactionForm .modal-actions .primary').click();
      const balances = await page.evaluate(() => { const state = FlowApp.getState(); return [FlowCore.getAccountBalance(state, 'main'), FlowCore.getAccountBalance(state, 'savings')]; });
      assert.deepEqual(balances, [1687.66, 300]);
      if (!(await page.locator('[data-open="help"]').filter({ visible: true }).count())) await page.locator('[data-page="settings"], [data-go="settings"]').filter({ visible: true }).first().click();
      await page.locator('[data-open="help"]').filter({ visible: true }).first().click();
      await page.locator('#helpSearch').fill('salaire');
      assert(await page.locator('#helpTopics [data-help]:not(.hidden)').count() > 0);
      await page.locator('#helpModal .close').click();
      assert(!(await page.locator('#helpModal').isVisible()));
      await page.locator('[data-page="settings"], [data-go="settings"]').filter({ visible: true }).first().click();
      await page.locator('[data-palette="neon-sakura"]').click(); await page.locator('[data-mode="light"]').click();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'neon-sakura-light');
      await page.locator('[data-mode="dark"]').click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'neon-sakura');
      await page.locator('[data-palette="ocean-peace"]').click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'ocean-peace');
      await page.locator('[data-mode="light"]').click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'ocean-peace-light');
      // CSV preview must not import until the explicit confirmation button is clicked.
      await page.locator('#bankImportFile').setInputFiles({ name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(`Date;Libellé;Montant\n${today};CSV test;-25,50`) });
      await page.waitForFunction(() => !document.getElementById('bankImportConfirm').disabled);
      assert.equal(await page.evaluate(() => FlowApp.getState().transactions.length), 2);
      await page.locator('#bankImportConfirm').click(); assert.equal(await page.evaluate(() => FlowApp.getState().transactions.length), 3);
      await page.locator('#bankImportFile').setInputFiles({ name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(`Date;Libellé;Montant\n${today};CSV test;-25,50`) });
      await page.waitForFunction(() => !document.getElementById('bankImportConfirm').disabled); await page.locator('#bankImportConfirm').click();
      assert.equal(await page.evaluate(() => FlowApp.getState().transactions.length), 3, 'CSV duplicates ignored');
      await page.locator('#generateTransferCode').click(); await page.waitForFunction(() => document.getElementById('transferCodeOut').value.startsWith('FLOW'));
      const code = await page.locator('#transferCodeOut').inputValue(); assert(code.length > 64, '64 characters is wrapping, not a false fixed-length capacity');
      await page.locator('#transferCodeIn').fill(code); await page.locator('#importTransferCode').click();
      await page.waitForFunction(() => document.getElementById('transferCodeIn').value === '');
      assert.equal(await page.evaluate(() => FlowApp.getState().transactions.length), 3);
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(700);
      assert(!(await page.locator('#tutorialModal').isVisible()), 'tutorial appears once');
      assert.equal(await page.evaluate(() => FlowApp.getState().transactions.length), 3, 'reload preserves state');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'ocean-peace-light');
      await page.locator('[data-page="dashboard"], [data-go="dashboard"]').filter({ visible: true }).first().click();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(artifactDir, `flow-${viewport.width}.png`), fullPage: true });
      assert.deepEqual(errors, [], 'no JavaScript runtime errors');
      reports.push({ width: viewport.width, flows: 'navigation, close X, expense, transfer, wiki, themes, CSV, backup code, reload', errors });
      await context.close();
    }
    await fs.writeFile(path.join(artifactDir, 'ui-results.json'), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify(reports, null, 2));
  } finally { if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(artifactDir, 'last-state.png'), fullPage: true }).catch(() => {}); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
