'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const Backup = require('../flow-backup.js');
test('round-trips Unicode and accepts old FLOW42 autonomous codes', async () => {
  const state = { version: 5, accounts: [{ id: 'main', name: 'Épargne 🌸' }], transactions: [] };
  const code = await Backup.createCode(state);
  assert(code.startsWith('FLOW50'));
  assert.deepEqual(await Backup.readCode(code.replace('FLOW50', 'FLOW42')), state);
  assert.deepEqual(await Backup.readCode(code.match(/.{1,64}/g).join('\n')), state);
});
test('rejects unrelated JSON and unbounded payloads', async () => {
  assert.throws(() => Backup.parse('{}'));
  assert.throws(() => Backup.parse('[]'));
  assert.throws(() => Backup.parse(JSON.stringify({ version: 99, accounts: [] })));
  await assert.rejects(Backup.readCode('FLOW50J-not-a-valid-code'));
  const bomb = gzipSync(Buffer.from('x'.repeat(Backup.MAX_BYTES + 100)));
  await assert.rejects(Backup.readCode('FLOW50G-' + bomb.toString('base64url')), /volumineuse/);
});
