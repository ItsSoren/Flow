const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'test-key-1';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
function token(uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({ aud: 'novatasks-23d9d', iss: 'https://securetoken.google.com/novatasks-23d9d', sub: uid, iat: now, exp: now + 3600, auth_time: now, ...claims });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}
class MemoryKV {
  data = new Map();
  async get(key, type) { const value = this.data.get(key); return type === 'json' && value ? JSON.parse(value) : value ?? null; }
  async put(key, value) { this.data.set(key, String(value)); }
  async delete(key) { this.data.delete(key); }
  async list({ prefix }) { return { keys: [...this.data.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
}
const origin = 'https://itssoren.github.io';
const env = { ALLOWED_ORIGIN: origin, PUSH_STORE: new MemoryKV() };
const makeRequest = (path, { uid, method = 'POST', body, originValue = origin } = {}) => new Request(`https://worker.example${path}`, {
  method, headers: { origin: originValue, ...(uid ? { authorization: `Bearer ${token(uid)}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined
});

test('push worker validates Firebase identity and the exact allowed origin', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => String(url).includes('securetoken@system.gserviceaccount.com') ? Response.json({ keys: [jwk] }) : new Response(null, { status: 204 });
  try {
    const { default: worker } = await import('../push-server/worker.js');
    const noToken = await worker.fetch(makeRequest('/subscribe', { body: { subscription: {} } }), env);
    assert.equal(noToken.status, 401);
    const wrongOrigin = await worker.fetch(makeRequest('/subscribe', { uid: 'alice', body: { subscription: {} }, originValue: 'https://evil.example' }), env);
    assert.equal(wrongOrigin.status, 403);
    const badIdentity = await worker.fetch(makeRequest('/subscribe', { uid: 'bad', body: { subscription: {} } }), env);
    assert.equal(badIdentity.status, 400); // identity is valid; the malformed subscription is rejected
    const invalidToken = await worker.fetch(new Request('https://worker.example/subscribe', { method: 'POST', headers: { origin, authorization: `Bearer ${token('../alice')}`, 'content-type': 'application/json' }, body: JSON.stringify({ subscription: {} }) }), env);
    assert.equal(invalidToken.status, 401);
  } finally { global.fetch = originalFetch; }
});

test('a push endpoint is owned by one authenticated UID at a time and reminders store no labels', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => String(url).includes('securetoken@system.gserviceaccount.com') ? Response.json({ keys: [jwk] }) : new Response(null, { status: 204 });
  try {
    const { default: worker } = await import('../push-server/worker.js');
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint', expirationTime: null, keys: { p256dh: 'A'.repeat(65), auth: 'B'.repeat(24) } };
    assert.equal((await worker.fetch(makeRequest('/subscribe', { uid: 'alice', body: { subscription } }), env)).status, 200);
    assert.equal((await worker.fetch(makeRequest('/subscribe', { uid: 'bob', body: { subscription } }), env)).status, 200);
    assert.equal((await env.PUSH_STORE.get('u:alice:subscriptions', 'json')).length, 0);
    assert.equal((await env.PUSH_STORE.get('u:bob:subscriptions', 'json')).length, 1);
    const response = await worker.fetch(makeRequest('/reminders', { uid: 'bob', method: 'PUT', body: { items: [{ id: 'salary-id', kind: 'payday', at: new Date(Date.now() + 60000).toISOString(), label: 'Employer 2 000 EUR' }] } }), env);
    assert.equal(response.status, 200);
    const reminders = await env.PUSH_STORE.get('u:bob:reminders', 'json');
    assert.deepEqual(Object.keys(reminders[0]).sort(), ['at', 'id', 'kind', 'sent']);
    const cannotRemoveOtherOwner = await worker.fetch(makeRequest('/subscribe', { uid: 'alice', method: 'DELETE', body: { endpoint: subscription.endpoint } }), env);
    assert.equal(cannotRemoveOtherOwner.status, 200);
    assert.equal((await env.PUSH_STORE.get('u:bob:subscriptions', 'json')).length, 1);
  } finally { global.fetch = originalFetch; }
});
