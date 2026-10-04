// Firestore map key order is not an indication of a changed document.
export function canonicalStateKey(value, normalize = value => value) {
  const sorted = item => Array.isArray(item) ? item.map(sorted)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted(item[key])])) : item;
  return JSON.stringify(sorted(normalize(value)));
}
const serialize = canonicalStateKey;

export const queueKeyForUser = uid => `flow_cloud_pending_v1:${uid}`;
export const conflictKeyForUser = uid => `flow_cloud_conflict_v1:${uid}`;
export const userStorageKey = (baseKey, uid) => `${baseKey}:${uid ? `user:${uid}` : 'local'}`;

/** Reconcile a newer local edit with the exact revision just committed remotely. */
export function reconcileCommittedQueue(inFlight, latest, committedRevision) {
  if (!latest || serialize(latest.state) === serialize(inFlight.state)) return { action: 'clear' };
  if (latest.baseRevision === inFlight.baseRevision) {
    return { action: 'rebase', queue: { ...latest, baseRevision: committedRevision } };
  }
  return { action: 'keep', queue: latest };
}

export function shouldFlushAfterCommit(inFlight, latest, knownRevision) {
  return Boolean(latest && latest.generation !== inFlight.generation && latest.baseRevision <= knownRevision);
}
