'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'styles.css', 'app.js', 'flow-core.js', 'flow-backup.js', 'bank-import.js', 'flow-pwa.js', 'service-worker.js', 'manifest.webmanifest', 'push-config.json']);

test('100 malicious fictitious backups render as text, never as executable DOM', { timeout: 120000 }, async t => {
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!files.has(p) && !/^assets\/[A-Za-z0-9._-]+$/.test(p)) { res.writeHead(404); res.end(); return; }
    const filename = path.join(root, p);
    if (!fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(filename); const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }[ext];
    res.writeHead(200, { 'content-type': type || 'application/octet-stream' }); fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.FLOW_BROWSER_CHANNEL || undefined });
    const page = await browser.newPage(); const errors = []; const attempts = [];
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/flow-cloud.js')) return route.fulfill({ contentType: 'text/javascript', body: 'window.FlowCloud={getCurrentUser:()=>null,getIdToken:async()=>null};' });
      if (url.startsWith(origin + '/')) return route.continue();
      attempts.push(url); return route.abort();
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.FlowApp);
    const outcome = await page.evaluate(async () => {
      window.auditExecuted = 0; let checked = 0;
      for (let i = 0; i < 100; i++) {
        const attack = `user-${i} \"><img data-audit-xss src=x onerror=\"window.auditExecuted++\"><svg onload=\"window.auditExecuted++\"></svg><script>window.auditExecuted++</script>`;
        const state = FlowCore.getEmptyState(); state.accounts[0].name = attack; state.accounts[0].id = attack; state.activeAccountId = attack;
        state.transactions = [{ id: attack, label: attack, note: attack, category: attack, amount: 1, date: '2026-10-07', type: 'expense', accountId: attack }];
        state.recurring = [{ id: attack, label: attack, category: attack, amount: 1, nextDate: '2026-10-08', type: 'expense', accountId: attack }];
        state.goals = [{ id: attack, name: attack, emoji: attack, color: attack, target: 100, saved: 1 }];
        state.notifications = [{ id: attack, title: attack, message: attack, createdAt: Date.now() }];
        state.reminders = [{ id: attack, title: attack, note: attack, date: '2026-10-08' }];
        const code = await FlowBackup.createCode(state); const normalized = FlowCore.normalizeState(await FlowBackup.readCode(code));
        FlowApp.applyRemoteState(normalized);
        if (document.querySelector('[data-audit-xss]')) throw new Error('Attacker DOM node created');
        if (normalized.accounts.some(a => !/^[A-Za-z0-9._:-]{1,128}$/.test(a.id))) throw new Error('Unsafe account id');
        if (!document.getElementById('accountsList').textContent.includes(`user-${i}`)) throw new Error('Text was not rendered');
        checked++;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      return { checked, executed: window.auditExecuted, nodes: document.querySelectorAll('[data-audit-xss]').length };
    });
    assert.equal(outcome.checked, 100); assert.equal(outcome.executed, 0); assert.equal(outcome.nodes, 0); assert.deepEqual(errors, []);
    t.diagnostic(`Chromium: ${outcome.checked} compressed backups and full renders; no executable injected DOM. All remote requests intercepted (${attempts.length} blocked resources).`);
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
});
