const PROJECT_ID = "novatasks-23d9d";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const REMINDER_KINDS = new Set(["payday", "bill", "goal"]);
let cachedJwks = null;
let cachedJwksUntil = 0;

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "vary": "Origin"
    }
  });
}
function b64urlBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function decodePart(value) { return JSON.parse(new TextDecoder().decode(b64urlBytes(value))); }
function base64url(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function getJwks() {
  if (cachedJwks && Date.now() < cachedJwksUntil) return cachedJwks;
  const response = await fetch(JWKS_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Could not load identity provider keys");
  cachedJwks = await response.json();
  cachedJwksUntil = Date.now() + 30 * 60 * 1000;
  return cachedJwks;
}
async function verifyIdToken(request) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length > 5000) throw new Error("unauthorized");
  const pieces = token.split(".");
  if (pieces.length !== 3) throw new Error("unauthorized");
  const header = decodePart(pieces[0]);
  const claims = decodePart(pieces[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("unauthorized");
  if (claims.aud !== PROJECT_ID || claims.iss !== `https://securetoken.google.com/${PROJECT_ID}`) throw new Error("unauthorized");
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128 || /[\/\\\u0000-\u001f]/.test(claims.sub)
    || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat)
    || !Number.isFinite(claims.auth_time) || claims.exp <= now || claims.iat > now + 60
    || claims.auth_time > now + 60 || (claims.nbf != null && claims.nbf > now + 60)) throw new Error("unauthorized");
  const jwks = await getJwks();
  const key = jwks.keys?.find(candidate => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!key) { cachedJwksUntil = 0; throw new Error("unauthorized"); }
  const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`);
  const valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, cryptoKey, b64urlBytes(pieces[2]), signed);
  if (!valid) throw new Error("unauthorized");
  return claims.sub;
}
function validSubscription(subscription) {
  return subscription && typeof subscription.endpoint === "string"
    && allowedPushEndpoint(subscription.endpoint) && subscription.endpoint.length <= 2048
    && subscription.keys && typeof subscription.keys.p256dh === "string"
    && /^[A-Za-z0-9_-]{40,140}$/.test(subscription.keys.p256dh)
    && typeof subscription.keys.auth === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(subscription.keys.auth);
}
function allowedPushEndpoint(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (host === "fcm.googleapis.com" || host === "web.push.apple.com"
        || host === "push.services.mozilla.com" || host === "updates.push.services.mozilla.com"
        || host.endsWith(".notify.windows.com"));
  } catch { return false; }
}
function subscriptionKey(uid) { return `u:${uid}:subscriptions`; }
function reminderKey(uid) { return `u:${uid}:reminders`; }
function goalCooldownKey(uid) { return `u:${uid}:goal-alert-cooldown`; }
async function endpointIndexKey(endpoint) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return `sub:${base64url(digest)}`;
}
async function readSubscriptions(store, uid) { return await store.get(subscriptionKey(uid), "json") || []; }
async function writeSubscriptions(store, uid, subscriptions) { await store.put(subscriptionKey(uid), JSON.stringify(subscriptions), { expirationTtl: 60 * 60 * 24 * 400 }); }
async function readReminders(store, uid) { return await store.get(reminderKey(uid), "json") || []; }
async function writeReminders(store, uid, reminders) { await store.put(reminderKey(uid), JSON.stringify(reminders), { expirationTtl: 60 * 60 * 24 * 400 }); }
async function requestBody(request, maximum = 64000) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maximum) throw new Error("invalid-body");
  if (!request.body) throw new Error("invalid-body");
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel().catch(() => {});
        throw new Error("invalid-body");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
  catch { throw new Error("invalid-body"); }
}
async function saveSubscription(request, env, uid) {
  const body = await requestBody(request, 12000);
  const subscription = body?.subscription;
  if (!validSubscription(subscription)) return json({ error: "invalid_subscription" }, 400, env.ALLOWED_ORIGIN);
  const indexKey = await endpointIndexKey(subscription.endpoint);
  const previousOwner = await env.PUSH_STORE.get(indexKey, "json");
  if (previousOwner?.uid && previousOwner.uid !== uid) {
    const previous = await readSubscriptions(env.PUSH_STORE, previousOwner.uid);
    await writeSubscriptions(env.PUSH_STORE, previousOwner.uid, previous.filter(item => item.endpoint !== subscription.endpoint));
  }
  let subscriptions = await readSubscriptions(env.PUSH_STORE, uid);
  subscriptions = subscriptions.filter(item => item.endpoint !== subscription.endpoint);
  subscriptions.push({ endpoint: subscription.endpoint, keys: subscription.keys, createdAt: Date.now() });
  subscriptions = subscriptions.slice(-5);
  await writeSubscriptions(env.PUSH_STORE, uid, subscriptions);
  await env.PUSH_STORE.put(indexKey, JSON.stringify({ uid }), { expirationTtl: 60 * 60 * 24 * 400 });
  return json({ ok: true }, 200, env.ALLOWED_ORIGIN);
}
async function removeSubscription(request, env, uid) {
  const body = await requestBody(request, 4096);
  if (typeof body?.endpoint !== "string" || !allowedPushEndpoint(body.endpoint) || body.endpoint.length > 2048) return json({ error: "invalid_endpoint" }, 400, env.ALLOWED_ORIGIN);
  const subscriptions = await readSubscriptions(env.PUSH_STORE, uid);
  await writeSubscriptions(env.PUSH_STORE, uid, subscriptions.filter(item => item.endpoint !== body.endpoint));
  const indexKey = await endpointIndexKey(body.endpoint);
  const indexed = await env.PUSH_STORE.get(indexKey, "json");
  if (indexed?.uid === uid) await env.PUSH_STORE.delete(indexKey);
  return json({ ok: true }, 200, env.ALLOWED_ORIGIN);
}
async function saveReminders(request, env, uid) {
  const body = await requestBody(request);
  if (!Array.isArray(body?.items) || body.items.length > 1000) return json({ error: "invalid_reminders" }, 400, env.ALLOWED_ORIGIN);
  const now = Date.now();
  const items = [];
  for (const item of body.items) {
    const at = Date.parse(item?.at);
    if (typeof item?.id !== "string" || !item.id.length || item.id.length > 160 || /[\u0000-\u001f]/.test(item.id)
      || !REMINDER_KINDS.has(item.kind) || !Number.isFinite(at)
      || at < now - 24 * 60 * 60 * 1000 || at > now + 366 * 24 * 60 * 60 * 1000) {
      return json({ error: "invalid_reminders" }, 400, env.ALLOWED_ORIGIN);
    }
    items.push({ id: item.id, kind: item.kind, at, sent: false });
  }
  const existing = await readReminders(env.PUSH_STORE, uid);
  const sent = new Set(existing.filter(item => item.sent).map(item => `${item.id}\u0000${item.at}`));
  const subscriptions = await readSubscriptions(env.PUSH_STORE, uid);
  let lastGoalAlert = Number(await env.PUSH_STORE.get(goalCooldownKey(uid))) || 0;
  const nextItems = [];
  for (const item of items) {
    const key = `${item.id}\u0000${item.at}`;
    let handled = sent.has(key);
    if (!handled && item.kind === "goal" && item.at <= now + 5000) {
      if (now - lastGoalAlert < 60_000) {
        handled = true;
      } else if (subscriptions.length && env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY && env.VAPID_SUBJECT) {
        const results = await Promise.all(subscriptions.map(subscription => sendGenericPush(subscription, env).catch(() => "failed")));
        const expired = subscriptions.filter((subscription, index) => results[index] === "expired");
        const remaining = subscriptions.filter((subscription, index) => results[index] !== "expired");
        if (expired.length) await writeSubscriptions(env.PUSH_STORE, uid, remaining);
        for (const subscription of expired) {
          const indexKey = await endpointIndexKey(subscription.endpoint);
          const indexed = await env.PUSH_STORE.get(indexKey, "json");
          if (indexed?.uid === uid) await env.PUSH_STORE.delete(indexKey);
        }
        if (results.some(result => result === "sent" || result === "expired")) {
          handled = true;
          lastGoalAlert = now;
          await env.PUSH_STORE.put(goalCooldownKey(uid), String(now), { expirationTtl: 60 * 60 * 24 });
        }
      }
    }
    nextItems.push({ ...item, sent: handled });
  }
  await writeReminders(env.PUSH_STORE, uid, nextItems);
  return json({ ok: true, count: items.length }, 200, env.ALLOWED_ORIGIN);
}
async function vapidAuthorization(endpoint, env) {
  const url = new URL(endpoint);
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(env.VAPID_SUBJECT || "")) throw new Error("Push contact is not configured");
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = base64url(JSON.stringify({ aud: url.origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: env.VAPID_SUBJECT }));
  const unsigned = `${header}.${claims}`;
  const privateKey = await crypto.subtle.importKey("pkcs8", b64urlBytes(env.VAPID_PRIVATE_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(unsigned)));
  return `vapid t=${unsigned}.${base64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}
async function sendGenericPush(subscription, env) {
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(subscription.endpoint, env),
      ttl: "3600",
      urgency: "low"
    }
  });
  return response.status === 404 || response.status === 410 ? "expired" : response.ok ? "sent" : "failed";
}
async function scheduled(env) {
  const now = Date.now();
  let cursor;
  do {
    const page = await env.PUSH_STORE.list({ prefix: "u:", cursor, limit: 1000 });
    cursor = page.cursor;
    await Promise.all(page.keys.map(async item => {
      if (!item.name.endsWith(":reminders")) return;
      const uid = item.name.slice(2, -":reminders".length);
      const reminders = await readReminders(env.PUSH_STORE, uid);
      let subscriptions = await readSubscriptions(env.PUSH_STORE, uid);
      if (!reminders.length || !subscriptions.length) return;
      let changed = false;
      for (const reminder of reminders) {
        if (reminder.sent || reminder.at > now) continue;
        if (reminder.kind === "goal" && reminder.at < now - 5 * 60 * 1000) {
          reminder.sent = true;
          changed = true;
          continue;
        }
        const results = await Promise.all(subscriptions.map(subscription => sendGenericPush(subscription, env).catch(() => "failed")));
        const expired = subscriptions.filter((subscription, index) => results[index] === "expired");
        const remaining = subscriptions.filter((subscription, index) => results[index] !== "expired");
        for (const subscription of expired) {
          const indexKey = await endpointIndexKey(subscription.endpoint);
          const indexed = await env.PUSH_STORE.get(indexKey, "json");
          if (indexed?.uid === uid) await env.PUSH_STORE.delete(indexKey);
        }
        await writeSubscriptions(env.PUSH_STORE, uid, remaining);
        subscriptions = remaining;
        if (results.some(result => result === "sent" || result === "expired")) {
          reminder.sent = true;
          changed = true;
        }
      }
      const unexpired = reminders.filter(reminder => !reminder.sent && reminder.at > now - 14 * 24 * 60 * 60 * 1000);
      if (changed || unexpired.length !== reminders.length) await writeReminders(env.PUSH_STORE, uid, unexpired);
    }));
  } while (cursor);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": env.ALLOWED_ORIGIN,
      "access-control-allow-methods": "POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "vary": "Origin"
    } });
    if (!env.PUSH_STORE) return json({ error: "push_unavailable" }, 503, env.ALLOWED_ORIGIN);
    let uid;
    try { uid = await verifyIdToken(request); }
    catch { return json({ error: "unauthorized" }, 401, env.ALLOWED_ORIGIN); }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/subscribe" && request.method === "POST") return await saveSubscription(request, env, uid);
      if (url.pathname === "/subscribe" && request.method === "DELETE") return await removeSubscription(request, env, uid);
      if (url.pathname === "/reminders" && request.method === "PUT") return await saveReminders(request, env, uid);
      return json({ error: "not_found" }, 404, env.ALLOWED_ORIGIN);
    } catch (error) {
      const status = error?.message === "invalid-body" ? 400 : 500;
      return json({ error: status === 400 ? "invalid_body" : "temporarily_unavailable" }, status, env.ALLOWED_ORIGIN);
    }
  },
  async scheduled(_controller, env, ctx) {
    if (env.PUSH_STORE && env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY) ctx.waitUntil(scheduled(env));
  }
};
