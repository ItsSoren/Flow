(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FlowPWA = api; api.mount(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  function buildReminders(state, prefs, now = new Date()) {
    const result = [], horizon = new Date(now.getTime() + 60 * DAY);
    const add = (id, kind, date) => { const at = date instanceof Date ? date : new Date(date); if (Number.isFinite(at.getTime()) && at > now && at <= horizon) result.push({ id: String(id).slice(0, 160), kind, at: at.toISOString() }); };
    const settings = state.settings?.notifications || {};
    if (prefs.payday && settings.salary !== false) {
      const wanted = Math.min(31, Math.max(1, Number(state.settings?.payday) || 1));
      for (let offset = 0; offset < 3; offset++) {
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1, 9);
        d.setDate(Math.min(wanted, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
        add(`payday-${d.getFullYear()}-${d.getMonth() + 1}`, 'payday', d);
      }
    }
    if (prefs.bill && settings.recurring !== false) for (const rec of state.recurring || []) {
      if (rec.type !== 'expense') continue;
      const start = new Date(`${rec.nextDate}T09:00:00`); if (!Number.isFinite(start.getTime())) continue;
      const anchor = start.getDate(); let d = new Date(start), guard = 0;
      while (d <= horizon && guard++ < 5000) {
        add(`bill-${rec.id}-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, 'bill', d);
        if (rec.frequency === 'once') break;
        if (rec.frequency === 'weekly') d.setDate(d.getDate() + 7);
        else if (rec.frequency === 'yearly') { const year = d.getFullYear() + 1, month = start.getMonth(); d = new Date(year, month, Math.min(anchor, new Date(year, month + 1, 0).getDate()), 9); }
        else { const year = d.getFullYear(), month = d.getMonth() + 1; d = new Date(year, month, Math.min(anchor, new Date(year, month + 1, 0).getDate()), 9); }
      }
    }
    if (prefs.goal && settings.reservations !== false) for (const reservation of state.reservations || []) {
      if (reservation.status === 'pending' && Number(reservation.confirmAt) > now.getTime()) {
        // A stable timestamp lets the relay deduplicate the initial proposal, not alert after confirmation.
        const at = Number(reservation.createdAt || Number(reservation.confirmAt) - 5 * 60000) + 1000;
        if (Number.isFinite(at)) result.push({ id: `goal-${reservation.id}`.slice(0, 160), kind: 'goal', at: new Date(at).toISOString() });
      }
    }
    if (prefs.custom && settings.reminders !== false) for (const reminder of state.reminders || []) {
      if (!reminder.done) add(`custom-${reminder.id}`, 'bill', new Date(`${reminder.date}T09:00:00`));
    }
    return result.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 200);
  }
  function validConfig(config) {
    try { const url = new URL(config?.endpoint); return url.protocol === 'https:' && !url.username && !url.password && typeof config.vapidPublicKey === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(config.vapidPublicKey); } catch (_) { return false; }
  }
  function publicKeyBytes(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const raw = atob(base64); return Uint8Array.from(raw, char => char.charCodeAt(0));
  }
  async function mount() {
    const mount = document.getElementById('pushSettingsMount'); if (!mount) return;
    let registration = null, deferredInstall = null, config = {}, token = null, currentUid = null, timer = null, lastSchedule = '';
    const defaults = { enabled: false, payday: true, bill: true, goal: true, custom: true };
    let prefs = { ...defaults };
    const add = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; mount.append(el); return el; };
    const intro = add('p', 'Installe Flōw pour un accès rapide. Les rappels sur écran verrouillé restent discrets : aucun montant ni libellé financier.');
    const status = add('p', 'Vérification des options de cet appareil…'); status.setAttribute('role', 'status');
    const install = add('button', 'Installer Flōw', 'button secondary'); install.type = 'button';
    const enable = add('button', 'Activer les rappels sur cet appareil', 'button primary'); enable.type = 'button';
    const disable = add('button', 'Désactiver les rappels', 'button ghost'); disable.type = 'button';
    const checkboxes = {};
    for (const [key, label] of Object.entries({ payday: 'Paie prévue', bill: 'Échéances à venir', goal: 'Réservations de projets', custom: 'Mes rappels' })) {
      const container = add('label', '', 'push-filter'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.dataset.pushKind = key; container.append(input, document.createTextNode(label)); checkboxes[key] = input;
      input.addEventListener('change', () => { prefs[key] = input.checked; persist(); queueSchedule(); });
    }
    function persist() { if (currentUid) localStorage.setItem(`flow_push_${currentUid}`, JSON.stringify(prefs)); }
    function refresh() {
      enable.hidden = prefs.enabled; disable.hidden = !prefs.enabled;
      for (const [key, input] of Object.entries(checkboxes)) input.checked = prefs[key];
      enable.disabled = !registration || !validConfig(config) || !currentUid || !('PushManager' in window) || Notification.permission === 'denied';
      if (!window.isSecureContext || location.protocol === 'file:') status.textContent = 'L’installation et les notifications nécessitent le site en HTTPS (ou localhost pour les tests).';
      else if (!('PushManager' in window)) status.textContent = 'Ce navigateur ne prend pas encore en charge les rappels en arrière-plan. Sur iPhone, installe Flōw sur l’écran d’accueil puis ouvre cette version.';
      else if (!validConfig(config)) status.textContent = 'Installation disponible. Les rappels en arrière-plan ne sont pas encore activés sur ce déploiement : le service d’envoi doit être configuré.';
      else if (!currentUid) status.textContent = 'Connecte-toi pour activer les rappels sur cet appareil.';
      else if (Notification.permission === 'denied') status.textContent = 'Les notifications sont bloquées. Tu peux les autoriser dans les réglages de ton navigateur.';
      else status.textContent = prefs.enabled ? 'Rappels activés sur cet appareil. Ils ne confirment aucune opération bancaire.' : 'Les rappels sont facultatifs. Leur activation demandera ton accord au navigateur.';
    }
    async function request(path, method, body, authToken = token) {
      if (!validConfig(config) || !authToken) throw new Error('Service de rappels indisponible ou connexion requise.');
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`${config.endpoint.replace(/\/$/, '')}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify(body), signal: controller.signal, credentials: 'omit' });
        if (!response.ok) throw new Error('Le service de rappels n’a pas accepté la demande. Réessaie plus tard.');
        return response.json();
      } finally { clearTimeout(timeout); }
    }
    async function syncSchedule() {
      if (!prefs.enabled || !currentUid || !registration || !window.FlowApp) return;
      token = await window.FlowCloud?.getIdToken(); if (!token) return;
      const items = buildReminders(window.FlowApp.getState(), prefs), serialized = JSON.stringify(items);
      if (serialized === lastSchedule) return;
      await request('/reminders', 'PUT', { items }); lastSchedule = serialized;
    }
    function queueSchedule() { clearTimeout(timer); timer = setTimeout(() => syncSchedule().catch(() => { status.textContent = 'Les rappels n’ont pas pu être actualisés. Une nouvelle tentative aura lieu à la prochaine ouverture ou modification.'; }), 2000); }
    enable.addEventListener('click', async () => {
      if (enable.disabled) return; enable.disabled = true;
      try {
        const permission = await Notification.requestPermission(); if (permission !== 'granted') { refresh(); return; }
        token = await window.FlowCloud.getIdToken();
        let subscription = await registration.pushManager.getSubscription();
        subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(config.vapidPublicKey) });
        await request('/subscribe', 'POST', { subscription: subscription.toJSON() });
        prefs.enabled = true; persist(); lastSchedule = ''; await syncSchedule(); refresh();
      } catch (error) { status.textContent = error.message || 'Impossible d’activer les rappels.'; enable.disabled = false; }
    });
    disable.addEventListener('click', async () => {
      disable.disabled = true;
      try { const subscription = await registration.pushManager.getSubscription(); if (subscription) { token = await window.FlowCloud.getIdToken(); await request('/subscribe', 'DELETE', { endpoint: subscription.endpoint }); await subscription.unsubscribe(); } prefs.enabled = false; persist(); refresh(); }
      catch (error) { status.textContent = 'La désactivation du service a échoué. Réessaie avec une connexion ; tu peux aussi bloquer les notifications dans ton navigateur.'; }
      finally { disable.disabled = false; }
    });
    install.addEventListener('click', async () => {
      if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; }
      else status.textContent = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'Dans Safari : Partager → Ajouter à l’écran d’accueil. Ouvre ensuite Flōw depuis son icône.' : 'Dans le menu du navigateur : Installer l’application ou Ajouter à l’écran d’accueil (si proposé).';
    });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; install.hidden = false; });
    window.addEventListener('appinstalled', () => { install.hidden = true; status.textContent = 'Flōw est installé sur cet appareil.'; });
    async function onAuth(detail) {
      const oldUid = currentUid, oldToken = token;
      currentUid = detail?.uid || null; token = currentUid ? await window.FlowCloud.getIdToken().catch(() => null) : null;
      if (oldUid && oldUid !== currentUid && registration) {
        try { const sub = await registration.pushManager.getSubscription(); if (sub) { if (oldToken) await request('/subscribe', 'DELETE', { endpoint: sub.endpoint }, oldToken); await sub.unsubscribe(); } } catch (_) { /* Generic reminders never expose financial data; next login replaces device subscription. */ }
      }
      try { prefs = { ...defaults, ...JSON.parse(localStorage.getItem(`flow_push_${currentUid}`) || '{}') }; } catch (_) { prefs = { ...defaults }; }
      lastSchedule = ''; refresh();
      if (prefs.enabled && registration && token) { try { const sub = await registration.pushManager.getSubscription(); if (sub) { await request('/subscribe', 'POST', { subscription: sub.toJSON() }); queueSchedule(); } else { prefs.enabled = false; persist(); refresh(); } } catch (_) { status.textContent = 'Rappels à reconnecter : réessaie avec une connexion.'; } }
    }
    window.addEventListener('flow:auth-state', event => onAuth(event.detail).catch(() => refresh()));
    window.addEventListener('flow:state-change', queueSchedule);
    window.addEventListener('online', queueSchedule);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) queueSchedule(); });
    try { const response = await fetch('push-config.json', { cache: 'no-cache' }); if (response.ok) config = await response.json(); } catch (_) { /* Optional service remains disabled. */ }
    if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
      try {
        registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
        const offerUpdate = () => { if (!registration.waiting) return; const button = add('button', 'Actualiser Flōw', 'button secondary'); button.type = 'button'; button.addEventListener('click', () => { registration.waiting.postMessage({ type: 'SKIP_WAITING' }); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); }); };
        offerUpdate(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', offerUpdate));
      } catch (_) { status.textContent = 'L’installation hors ligne n’est pas disponible ici. Les fonctions locales restent utilisables.'; }
    }
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) install.hidden = true;
    intro.hidden = false; refresh();
    const user = window.FlowCloud?.getCurrentUser(); if (user) await onAuth({ uid: user.uid });
  }
  return { buildReminders, validConfig, publicKeyBytes, mount };
});
