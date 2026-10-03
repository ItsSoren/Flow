'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
test('HTML has unique IDs, script order, explicit mobile settings and legal links', () => {
  const html = read('index.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  assert(html.indexOf('src="flow-core.js') < html.indexOf('src="app.js'));
  assert(html.includes('data-go="settings"'));
  for (const required of ['bankImportFile', 'bankImportAccount', 'bankImportMapping', 'bankImportPreview', 'bankImportConfirm', 'pushSettingsMount', 'cloudResetPassword', 'notificationUnreadCount', 'spendableBreakdown']) assert(ids.includes(required), required);
  assert(html.includes('href="privacy.html"') && html.includes('href="credits.html"'));
});
test('all custom SVG icon references exist and use theme-aware colors', () => {
  const sprite = read('assets/icons.svg');
  const ids = [...sprite.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const used = new Set([...`${read('index.html')}\n${read('app.js')}`.matchAll(/\bi-[a-z][a-z-]+/g)].map(match => match[0]));
  for (const id of used) assert(ids.includes(id), `missing icon ${id}`);
  assert(sprite.includes('currentColor') || /svg\s*\{[^}]*stroke:currentColor/.test(read('styles.css')));
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(sprite), 'UI sprite must not have fixed hex colors');
});
test('service-worker shell entries all exist; no financial API or secrets cached', () => {
  const worker = read('service-worker.js');
  const array = worker.match(/const SHELL = \[([^\]]+)\]/)[1];
  for (const match of array.matchAll(/'([^']+)'/g)) assert(fs.existsSync(path.join(root, match[1])), match[1]);
  assert(worker.includes('url.origin !== self.location.origin'));
  assert(!worker.includes('VAPID_PRIVATE'));
  assert(worker.includes('aucun') || worker.includes('Never display'));
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.scope, './');
  assert(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose.includes('maskable')));
});
