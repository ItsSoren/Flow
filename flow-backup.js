(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlowBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 4 * 1024 * 1024;
  function validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !['accounts', 'transactions', 'operations', 'goals', 'objectifs', 'recurring', 'revenus'].some(key => Array.isArray(raw[key]))) throw new Error('Cette sauvegarde ne contient pas de données Flow reconnues.');
    if (Number(raw.version) > 5) throw new Error('Cette sauvegarde vient d’une version plus récente de Flow.');
    for (const value of Object.values(raw)) if (Array.isArray(value) && value.length > 20000) throw new Error('Trop d’éléments dans cette sauvegarde.');
    for (const key of ['accounts', 'transactions', 'operations', 'goals', 'objectifs', 'recurring', 'revenus', 'reservations', 'reservedContributions', 'notifications', 'reminders']) {
      if (Array.isArray(raw[key]) && raw[key].some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error(`La liste « ${key} » contient une entrée invalide.`);
    }
    return raw;
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Sauvegarde trop volumineuse : 4 Mo maximum.');
    return validate(JSON.parse(text));
  }
  function encode(bytes) {
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(text) {
    const s = text.replace(/-/g, '+').replace(/_/g, '/'), raw = atob(s + '='.repeat((4 - s.length % 4) % 4));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }
  async function boundedBytes(stream) {
    const reader = stream.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { reader.cancel().catch(() => {}); throw new Error('Sauvegarde décompressée trop volumineuse.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  }
  async function createCode(state) {
    const text = JSON.stringify(validate(state)); parse(text);
    const bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream !== 'undefined') return `FLOW50G-${encode(await boundedBytes(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))))}`;
    return `FLOW50J-${encode(bytes)}`;
  }
  async function readCode(input) {
    if (typeof input !== 'string' || input.length > MAX_BYTES * 1.5) throw new Error('Code trop volumineux.');
    const match = input.trim().replace(/\s+/g, '').match(/^FLOW(?:42|50)([GJ])-([A-Za-z0-9_-]+)$/);
    if (!match) throw new Error('Code Flow invalide ou incomplet.');
    let bytes = decode(match[2]);
    if (match[1] === 'G') {
      if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne peut pas lire les codes compressés. Utilise un fichier JSON.');
      bytes = await boundedBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
    }
    if (bytes.length > MAX_BYTES) throw new Error('Sauvegarde trop volumineuse.');
    return parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  return { MAX_BYTES, validate, parse, createCode, readCode };
});
