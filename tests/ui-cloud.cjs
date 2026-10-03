'use strict';
// Integration against local emulators only: real browser UI + Firebase SDK, no production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
assert(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Start via npm run test:cloud-ui');
const base = process.env.FLOW_TEST_URL || 'http://127.0.0.1:4173/';
assert.equal(new URL(base).hostname, '127.0.0.1');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:8080 http://127.0.0.1:9099");
const cloud = fs.readFileSync(path.join(root, 'flow-cloud.js'), 'utf8')
  .replace('getAuth, onAuthStateChanged', 'connectAuthEmulator, getAuth, onAuthStateChanged')
  .replace('getFirestore, doc,', 'connectFirestoreEmulator, getFirestore, doc,')
  .replace('setAuthError(authError(error));', 'setAuthError(error.code || error.stack || String(error));')
  .replace('const db = getFirestore(app);', 'const db = getFirestore(app); connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true}); connectFirestoreEmulator(db,"127.0.0.1",8080);');
const cfg = 'export const firebaseConfig={projectId:"demo-flow-v5",apiKey:"demo-key",authDomain:"demo-flow-v5.firebaseapp.com",appId:"demo-flow-v5-web"};';
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.FLOW_BROWSER_CHANNEL || undefined });
  const contexts = [];
  try {
    async function device(email, register = false, mobile = false) {
      const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' }); contexts.push(context);
      await context.grantPermissions(['local-network-access'], { origin: base });
      // Fail closed: test identities must never reach production Firebase APIs.
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (['127.0.0.1', 'www.gstatic.com', 'fonts.gstatic.com', 'fonts.googleapis.com'].includes(url.hostname)) return route.continue();
        return route.abort('blockedbyclient');
      });
      await context.route(base, route => route.fulfill({ contentType: 'text/html', body: html }));
      await context.route('**/firebase-config.js', route => route.fulfill({ contentType: 'text/javascript', body: cfg }));
      await context.route('**/flow-cloud.js*', route => route.fulfill({ contentType: 'text/javascript', body: cloud }));
      const page = await context.newPage();
      page.on('dialog', d => d.accept());
      page.on('pageerror', e => console.error('Browser error:', e.message));
      page.on('console', msg => { if (msg.type() === 'error' && /CORS|Content Security|connect-src/.test(msg.text())) console.error('Emulator browser policy:', msg.text()); });
      page.on('requestfailed', req => { if (req.url().includes('127.0.0.1:9099')) console.error('Auth emulator request:', req.failure()?.errorText); });
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.FlowCloud, { timeout: 45000 });
      await page.locator('#skipTutorial').waitFor({ state: 'visible' }); await page.locator('#skipTutorial').click();
      await page.locator('[data-page="settings"], [data-go="settings"]').filter({ visible: true }).first().click();
      await page.locator('#cloudSignIn').click();
      if (register) { await page.locator('#cloudAuthSwitch').click(); await page.locator('#cloudName').fill('Test Flōw'); }
      await page.locator('#cloudEmail').fill(email); await page.locator('#cloudPassword').fill('emulator-only-password');
      await page.locator('#cloudAuthSubmit').click();
      await page.waitForFunction(() => (FlowCloud.getCurrentUser() && document.getElementById('cloudAuthModal').classList.contains('hidden')) || document.getElementById('cloudAuthError').textContent).catch(async error => {
        console.error('Auth UI status:', await page.locator('#cloudAuthError').textContent()); throw error;
      });
      assert.equal(await page.locator('#cloudAuthError').textContent(), '', 'emulator auth must complete');
      await page.waitForTimeout(500);
      return page;
    }
    const suffix = Date.now(); const email = `owner-${suffix}@example.test`;
    const owner = await device(email, true);
    await owner.locator('[data-page="dashboard"], [data-go="dashboard"]').filter({ visible: true }).first().click();
    await owner.locator('.quick.income').click(); await owner.locator('#txAmount').fill('123'); await owner.locator('#txLabel').fill('Income emulator');
    await owner.locator('#transactionForm .primary').click();
    await owner.waitForFunction(() => FlowCloud.getKnownRevision() >= 1);
    const otherDevice = await device(email, false, true);
    await otherDevice.waitForFunction(() => FlowApp.getState().transactions.some(t => t.label === 'Income emulator'));
    assert.equal(await otherDevice.evaluate(() => FlowCore.getAccountBalance(FlowApp.getState(), 'main')), 123);
    await owner.locator('[data-page="settings"], [data-go="settings"]').filter({ visible: true }).first().click();
    const create = owner.locator('[data-share-form="create"]');
    await create.locator('[name="name"]').fill('Trip emulator'); await create.locator('[name="amount"]').fill('500'); await create.locator('button').click();
    await owner.locator('.sharing-space').waitFor();
    await owner.locator('.sharing-space').getByRole('button', { name: 'Inviter · lecture seule' }).click();
    await owner.waitForFunction(() => document.querySelector('[data-invite-output]')?.textContent.includes('Code valable'));
    const code = (await owner.locator('[data-invite-output]').textContent()).match(/Code valable 7 jours : ([A-Za-z0-9_-]+)/)[1];
    const guest = await device(`guest-${suffix}@example.test`, true, true);
    assert.equal(await guest.evaluate(() => FlowApp.getState().transactions.length), 0, 'another UID cannot inherit owner finance');
    const join = guest.locator('[data-share-form="join"]'); await join.locator('[name="code"]').fill(code); await join.locator('button').click();
    await guest.locator('.sharing-space').waitFor();
    assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile sharing has no horizontal overflow');
    assert.equal(await guest.locator('.sharing-space').getByRole('button', { name: 'Mettre à jour' }).count(), 0, 'viewer has no edit action');
    await owner.locator('[data-share="refresh"]').click();
    await owner.waitForFunction(() => [...document.querySelectorAll('.sharing-space details button')].some(b => b.textContent === 'Autoriser la modification'));
    const management = owner.locator('.sharing-space details'); await management.locator('summary').click();
    await management.getByRole('button', { name: 'Autoriser la modification' }).click();
    await owner.waitForFunction(() => [...document.querySelectorAll('.sharing-space details button')].some(b => b.textContent === 'Passer en lecture seule'));
    await guest.locator('[data-share="refresh"]').click();
    await guest.locator('.sharing-space').getByRole('button', { name: 'Mettre à jour' }).waitFor();
    await guest.locator('#settings-sharing').screenshot({ path: path.join(root, 'artifacts/cloud-sharing-mobile.png') });
    await guest.locator('.sharing-space input[name="saved"]').fill('25'); await guest.locator('.sharing-space').getByRole('button', { name: 'Mettre à jour' }).click();
    await guest.waitForFunction(() => document.querySelector('[data-share-status]')?.textContent.includes('mise à jour'));
    await owner.locator('[data-share="refresh"]').click();
    await owner.waitForFunction(() => [...document.querySelectorAll('.sharing-space p')].some(p => p.textContent.includes('25,00')));
    await owner.locator('.sharing-space details summary').click();
    await owner.locator('#settings-sharing').screenshot({ path: path.join(root, 'artifacts/cloud-sharing-desktop.png') });
    await owner.locator('.sharing-space').getByRole('button', { name: 'Révoquer le code' }).click();
    await owner.waitForFunction(() => ![...document.querySelectorAll('.sharing-space details button')].some(b => b.textContent === 'Révoquer le code'));
    await owner.locator('.sharing-space details summary').click();
    await owner.locator('.sharing-space').getByRole('button', { name: 'Retirer', exact: true }).click();
    await owner.waitForFunction(() => ![...document.querySelectorAll('.sharing-space details button')].some(b => b.textContent === 'Retirer'));
    await guest.locator('[data-share="refresh"]').click();
    await guest.waitForFunction(() => document.querySelector('[data-share-list]')?.textContent.includes('Aucun espace'));
    const liveDevice = await device(email);
    await liveDevice.waitForFunction(() => FlowApp.getState().transactions.length === 1);
    await otherDevice.context().setOffline(true);
    await otherDevice.locator('[data-page="dashboard"], [data-go="dashboard"]').filter({ visible: true }).first().click();
    await otherDevice.locator('.quick.expense').click(); await otherDevice.locator('#txAmount').fill('5'); await otherDevice.locator('#txLabel').fill('Offline edit before erasure');
    await otherDevice.locator('#transactionForm .primary').click();
    assert.equal(await otherDevice.evaluate(() => FlowApp.getState().transactions.length), 2);
    await owner.locator('#cloudDeleteAccount').click();
    await owner.waitForFunction(() => FlowApp.getState().transactions.length === 0);
    await liveDevice.waitForFunction(() => FlowApp.getState().transactions.length === 0);
    await otherDevice.context().setOffline(false);
    await otherDevice.waitForFunction(() => FlowApp.getState().transactions.length === 0);
    await owner.waitForTimeout(1500);
    assert.equal(await owner.evaluate(() => FlowApp.getState().transactions.length), 0, 'an offline queue cannot silently resurrect erased finance');
    assert(await owner.locator('.sharing-space').count(), 'personal erasure keeps shared space');
    await owner.locator('#cloudSignOut').click();
    await owner.waitForFunction(() => !FlowCloud.getCurrentUser());
    await owner.locator('#cloudSignIn').click();
    assert.equal(await owner.locator('#cloudAuthSubmit').textContent(), 'Se connecter', 'auth reopens in login mode, not stale signup mode');
    await owner.locator('#cloudEmail').fill(email); await owner.locator('#cloudResetPassword').click();
    await owner.waitForFunction(() => document.getElementById('cloudAuthError').classList.contains('is-success'));
    assert.equal(await owner.locator('#cloudAuthError').getAttribute('role'), 'status');
    await owner.locator('#cloudAuthModal .close').click();
    await owner.locator('#cloudSignIn').click();
    assert.equal(await owner.locator('#cloudAuthError').textContent(), '', 'a reopened dialog clears stale messages');
    console.log('Real SDK/local emulators: signup, two-device sync, UID isolation, shared viewer/member, progress, invite revocation, member removal, online/offline multi-device erasure, sign-out/login mode, password-reset UI: PASS');
  } finally { for (const context of contexts) await context.close(); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
