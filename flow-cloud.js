import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, sendEmailVerification,
  sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, deleteDoc,
  writeBatch, onSnapshot, runTransaction, serverTimestamp, Timestamp, query, where, limit, deleteField, increment, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { queueKeyForUser, conflictKeyForUser, reconcileCommittedQueue, shouldFlushAfterCommit, canonicalStateKey } from "./flow-sync-core.mjs?v=5.0.2";

// Flow deliberately shares the Firebase project/Auth identities with Sōlo, while
// all of its financial data stays in the flowUsers namespace.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
const stateRef = uid => doc(db, "flowUsers", uid);
const queueKey = queueKeyForUser;
const conflictKey = conflictKeyForUser;
const MAX_STATE_BYTES = 850000;
let user = null;
let unsubscribe = null;
let writeTimer = 0;
let retryTimer = 0;
let retryDelay = 1500;
let authMode = "login";
let knownRevision = 0;
let flushing = false;
let syncIdle = Promise.resolve();
let erasingUid = null;
let conflictOpen = false;
let activeUid = null;
let sharingRefreshGeneration = 0;
let sharingReady = false;
async function checkSharingRules(uid) {
  // Reading a private nonexistent proof is allowed only by the upgraded rules.
  // No data write or insecure legacy invitation fallback is used as a probe.
  try { await getDoc(doc(db, 'flowUsers', uid, 'joinProofs', 'flow-rules-v502-probe')); return true; }
  catch { return false; }
}
function requireSharingRules() {
  if (!sharingReady) throw new Error('Le partage attend la publication des nouvelles règles Firebase. Tes comptes personnels restent accessibles et synchronisés.');
}

const localState = () => window.FlowApp?.getState?.() || null;
const useful = state => window.FlowApp?.hasUsefulData?.(state)
  ?? !!(state && (state.transactions?.length || state.recurring?.length || state.goals?.length || state.accounts?.some(a => Number(a.initialBalance))));
function status(message, connected = false) {
  const el = $("cloudStatus");
  if (el) el.textContent = message;
  const indicator=$("syncIndicator");
  if(indicator){indicator.textContent=!connected?'Enregistré sur cet appareil': /Synchronisé|Mis à jour depuis/.test(message)?'Synchronisé':/Hors connexion/.test(message)?'Hors connexion · enregistré ici':/indisponible|dépasse|ne peut pas/.test(message)?'À synchroniser · enregistré ici':/copie locale|Version locale/.test(message)?'Version choisie · voir les réglages':/Connexion à/.test(message)?'Connexion en cours…':'Enregistré ici · synchronisation en cours…';indicator.title=message;indicator.dataset.pending=connected&&!/Synchronisé|Mis à jour depuis/.test(message)?'true':'false';}
  const label = $("cloudAccountLabel");
  const localProblem = window.FlowApp?.getStorageProblem?.();
  if (indicator && localProblem) { indicator.textContent='Copie locale non enregistrée · export recommandé';indicator.title=localProblem; }
  const button = $("cloudAccountButton");
  if (label) label.textContent = connected ? (user?.displayName || user?.email?.split("@")[0] || "Connecté") : "Connexion";
  button?.classList.toggle("is-connected", connected);
  $("cloudSignIn")?.classList.toggle("hidden", connected);
  $("cloudSignOut")?.classList.toggle("hidden", !connected);
  $("cloudVerifyEmail")?.classList.toggle("hidden", !connected || user?.emailVerified !== false);
  $("cloudDeleteAccount")?.classList.toggle("hidden", !connected);
}
function setAuthError(message, success = false) { const node = $("cloudAuthError"); if (node) { node.textContent = message; node.classList.toggle('is-success', success); node.setAttribute('role', success ? 'status' : 'alert'); } }
function openAuth() { setAuthMode('login'); setAuthError(''); $("cloudAuthModal")?.classList.remove("hidden"); $("cloudEmail")?.focus(); }
function closeAuth() { $("cloudAuthModal")?.classList.add("hidden"); setAuthError(""); }
function setAuthMode(mode) {
  authMode = mode;
  const register = mode === "register";
  if ($("cloudAuthTitle")) $("cloudAuthTitle").textContent = register ? "Crée ton espace Flow" : "Retrouve ton espace";
  if ($("cloudAuthIntro")) $("cloudAuthIntro").textContent = register ? "Crée un compte gratuit pour retrouver tes données sur tous tes appareils." : "Connecte-toi pour retrouver tes comptes, opérations, projets et prévisions.";
  $("cloudNameField")?.classList.toggle("hidden", !register);
  if ($("cloudAuthSubmit")) $("cloudAuthSubmit").textContent = register ? "Créer mon compte" : "Se connecter";
  if ($("cloudAuthSwitch")) $("cloudAuthSwitch").textContent = register ? "J’ai déjà un compte" : "Créer un compte";
  if ($("cloudPassword")) $("cloudPassword").autocomplete = register ? "new-password" : "current-password";
  $("cloudResetPassword")?.classList.toggle("hidden", register);
}
function authError(error) {
  const messages = {
    "auth/invalid-credential": "E-mail ou mot de passe incorrect.",
    "auth/email-already-in-use": "Cette adresse possède déjà un compte.",
    "auth/weak-password": "Le mot de passe doit contenir au moins 6 caractères.",
    "auth/invalid-email": "Cette adresse e-mail n’est pas valide.",
    "auth/network-request-failed": "Connexion indisponible. Tes données locales restent accessibles.",
    "auth/too-many-requests": "Trop d’essais. Réessaie dans quelques minutes.",
    "auth/user-disabled": "Ce compte est désactivé.",
    "auth/requires-recent-login": "Reconnecte-toi avant de réaliser cette action."
  };
  return messages[error?.code] || "Impossible de terminer cette action pour le moment.";
}
function serialize(state) { return canonicalStateKey(state, window.FlowCore?.normalizeState); }
function currentQueue() {
  if (!user) return null;
  try { return JSON.parse(localStorage.getItem(queueKey(user.uid)) || "null"); }
  catch { return null; }
}
function saveQueue(state, baseRevision = null) {
  if (!user || !state) return false;
  const serialized = serialize(state);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) {
    status("La sauvegarde dépasse la taille maximale de synchronisation. Exporte une copie puis allège l’historique.", true);
    return false;
  }
  try {
    const old = currentQueue();
    // New edits must retain the revision on which the pending edits were based.
    // A newer remote snapshot is not permission to overwrite it silently.
    const record = { state, baseRevision: baseRevision ?? old?.baseRevision ?? knownRevision, generation: (old?.generation || 0) + 1, queuedAt: Date.now() };
    localStorage.setItem(queueKey(user.uid), JSON.stringify(record));
    return true;
  } catch {
    status("Le navigateur ne peut pas garder la file de synchronisation. Exporte tes données avant de fermer.", true);
    return false;
  }
}
function clearQueue(expectedState = null) {
  if (!user) return;
  const queued = currentQueue();
  if (expectedState && (!queued || serialize(queued.state) !== serialize(expectedState))) return;
  try { localStorage.removeItem(queueKey(user.uid)); } catch { /* local storage may be blocked */ }
}
function saveConflictCopy(state) {
  if (!user || !state) return;
  try {
    const key = conflictKey(user.uid);
    const history = JSON.parse(localStorage.getItem(key) || "[]");
    history.push({ savedAt: new Date().toISOString(), state });
    localStorage.setItem(key, JSON.stringify(history.slice(-5)));
  } catch { /* the live state and durable queue remain intact */ }
}
function queueLocalState() {
  const state = localState();
  if (!user || !state || erasingUid === user.uid) return;
  if (!saveQueue(state)) return;
  status(navigator.onLine ? "Modification gardée sur cet appareil · synchronisation en cours…" : "Hors connexion · modification gardée pour plus tard.", true);
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => flushQueue(), 900);
}
function displayConflict(message) {
  if (conflictOpen || !user) return false;
  conflictOpen = true;
  const queued = currentQueue();
  const remote = message.remoteState;
  const keepDeviceCopy = confirm("Une version de Flow a changé sur un autre appareil.\n\nOK : charger la version synchronisée (une copie de cette version locale sera conservée sur cet appareil).\nAnnuler : garder cette version locale et la synchroniser.");
  conflictOpen = false;
  if (!user || activeUid !== user.uid) return false;
  if (keepDeviceCopy) {
    saveConflictCopy(queued?.state || localState());
    if (remote) window.FlowApp?.applyRemoteState?.(remote);
    clearQueue();
    knownRevision = message.revision;
    status("Version synchronisée chargée · copie locale précédente conservée sur cet appareil.", true);
    return false;
  } else {
    knownRevision = message.revision;
    if (queued) saveQueue(queued.state, knownRevision);
    else saveQueue(localState(), knownRevision);
    status("Version locale gardée · nouvelle synchronisation en attente.", true);
    flushQueue();
    return true;
  }
}
async function flushQueue() {
  if (!user || flushing || erasingUid === user.uid || !navigator.onLine) return;
  const uid = user.uid;
  const pending = currentQueue();
  if (!pending?.state) return;
  flushing = true;
  let resolveIdle;
  syncIdle = new Promise(resolve => { resolveIdle = resolve; });
  let shouldFlushAfter = false;
  try {
    const state = pending.state;
    const result = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(stateRef(uid));
      const data = snapshot.exists() ? snapshot.data() : null;
      const remoteRevision = Number.isSafeInteger(data?.revision) ? data.revision : 0;
      const remoteState = data?.personalState || null;
      if (remoteRevision !== pending.baseRevision) {
        if (remoteState && serialize(remoteState) === serialize(state)) return { revision: remoteRevision, same: true };
        return { revision: remoteRevision, remoteState, conflict: true };
      }
      transaction.set(stateRef(uid), {
        personalState: state,
        revision: remoteRevision + 1,
        schemaVersion: 1,
        updatedAt: serverTimestamp()
      });
      return { revision: remoteRevision + 1, same: false };
    });
    if (user?.uid !== uid || erasingUid === uid) return;
    if (result.conflict) {
      knownRevision = result.revision;
      shouldFlushAfter = displayConflict(result);
      return;
    }
    knownRevision = Math.max(knownRevision, result.revision);
    const latest = currentQueue();
    const reconciliation = reconcileCommittedQueue(pending, latest, result.revision);
    if (reconciliation.action === "clear") clearQueue(state);
    else if (reconciliation.action === "rebase") {
      try { localStorage.setItem(queueKey(uid), JSON.stringify(reconciliation.queue)); } catch { /* pending local value remains durable */ }
    }
    retryDelay = 1500;
    status("Synchronisé · tes données sont disponibles sur tes appareils.", true);
  } catch (error) {
    if (user?.uid !== uid || erasingUid === uid) return;
    console.warn("Flow cloud sync deferred", error?.code || error?.message || error);
    status(navigator.onLine ? "Synchronisation indisponible · les changements restent en attente." : "Hors connexion · changements gardés pour plus tard.", true);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flushQueue, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60000);
  } finally {
    flushing = false;
    resolveIdle();
    const newest = currentQueue();
    if (erasingUid === uid) return;
    if (user?.uid === uid && newest && !navigator.onLine) status("Hors connexion · changements gardés pour plus tard.", true);
    else if (user?.uid === uid && shouldFlushAfterCommit(pending, newest, knownRevision) || (user?.uid === uid && shouldFlushAfter && newest)) {
      clearTimeout(writeTimer);
      writeTimer = setTimeout(flushQueue, 0);
    }
  }
}
async function loadForUser(guestCandidate = null) {
  if (!user) return;
  const uid = user.uid;
  activeUid = uid;
  await window.FlowApp?.activateUser?.(uid);
  if (!user || user.uid !== uid) return;
  const snapshot = await getDoc(stateRef(uid));
  if (!user || user.uid !== uid) return;
  const remote = snapshot.exists() ? snapshot.data() : null;
  knownRevision = Number.isSafeInteger(remote?.revision) ? remote.revision : 0;
  const pending = currentQueue();
  const local = localState();
  if (remote?.personalState) {
    if (pending?.state) {
      if (serialize(pending.state) === serialize(remote.personalState)) {
        clearQueue(pending.state);
        window.FlowApp?.applyRemoteState?.(remote.personalState);
      } else if (pending.baseRevision === knownRevision) {
        // Offline edits based on the current revision are not a conflict.
        window.FlowApp?.applyRemoteState?.(pending.state);
        flushQueue();
      }
      else displayConflict({ remoteState: remote.personalState, revision: knownRevision });
    } else if (serialize(local) !== serialize(remote.personalState)) {
      if (useful(local)) displayConflict({ remoteState: remote.personalState, revision: knownRevision });
      else window.FlowApp?.applyRemoteState?.(remote.personalState);
    }
  } else if (pending?.state || useful(local)) {
    // A missing document can mean an erasure from another device, not just a new account.
    displayConflict({ remoteState: window.FlowApp?.getEmptyState?.(), revision: knownRevision });
  } else if (guestCandidate && useful(guestCandidate) && confirm("Des données locales non synchronisées sont disponibles sur cet appareil.\n\nVeux-tu les copier dans ce nouvel espace Flow ? La copie locale d’origine restera sur cet appareil.")) {
    window.FlowApp?.applyRemoteState?.(guestCandidate);
    saveQueue(guestCandidate, knownRevision);
    flushQueue();
  }
  if (!currentQueue()) status(navigator.onLine?"Synchronisé · tes données sont disponibles sur tes appareils.":"Hors connexion · données enregistrées sur cet appareil.", true);
  if (!user || user.uid !== uid) return;
  unsubscribe?.();
  unsubscribe = onSnapshot(stateRef(uid), snapshotUpdate => {
    if (!user || user.uid !== uid || erasingUid === uid) return;
    // An optimistic SDK echo is not acknowledgement of a committed cloud save.
    if(snapshotUpdate.metadata?.hasPendingWrites || snapshotUpdate.metadata?.fromCache && currentQueue()) return;
    if (!snapshotUpdate.exists()) {
      if (knownRevision > 0) displayConflict({ remoteState: window.FlowApp?.getEmptyState?.(), revision: 0 });
      return;
    }
    const data = snapshotUpdate.data();
    const incoming = data.personalState;
    if (!incoming) return;
    const revision = Number.isSafeInteger(data.revision) ? data.revision : 0;
    if (revision <= knownRevision && serialize(incoming) === serialize(localState())) return;
    const queued = currentQueue();
    if (queued && serialize(queued.state) === serialize(incoming)) {
      knownRevision = Math.max(knownRevision, revision);
      clearQueue(queued.state);
      status("Synchronisé · tes données sont disponibles sur tes appareils.", true);
      return;
    }
    if (queued || serialize(incoming) === serialize(localState())) {
      knownRevision = Math.max(knownRevision, revision);
      return;
    }
    if (revision > knownRevision) {
      knownRevision = revision;
      window.FlowApp?.applyRemoteState?.(incoming);
      status("Mis à jour depuis un autre appareil.", true);
    }
  }, error => {
    console.warn("Flow cloud listener paused", error?.code || error?.message || error);
    status("Connexion cloud momentanément indisponible · les données locales restent accessibles.", true);
  });
}
async function submitAuth(event) {
  event.preventDefault();
  const email = $("cloudEmail")?.value.trim();
  const password = $("cloudPassword")?.value;
  if (!email || !password) return;
  setAuthError("");
  const submit = $("cloudAuthSubmit");
  if (submit) submit.disabled = true;
  try {
    if (authMode === "register") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const name = $("cloudName")?.value.trim();
      if (name) await updateProfile(credential.user, { displayName: name });
      await sendEmailVerification(credential.user);
      if ($("cloudAuthIntro")) $("cloudAuthIntro").textContent = "Un lien de vérification vient d’être envoyé. Tu peux utiliser Flow dès maintenant et vérifier ton adresse quand tu veux.";
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    closeAuth();
  } catch (error) { setAuthError(authError(error)); }
  finally { if (submit) submit.disabled = false; }
}
async function resetPassword() {
  const email = $("cloudEmail")?.value.trim();
  if (!email) { setAuthError("Saisis ton adresse e-mail pour recevoir le lien de réinitialisation."); $("cloudEmail")?.focus(); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    setAuthError("Si un compte Flow existe pour cette adresse, un lien de réinitialisation vient d’être envoyé.", true);
  } catch (error) { setAuthError(authError(error)); }
}
async function sendVerificationEmail() {
  if (!auth.currentUser) { status("Connecte-toi pour vérifier ton adresse e-mail."); return; }
  if (auth.currentUser.emailVerified) { status("Ton adresse e-mail est déjà vérifiée.", true); return; }
  try {
    await sendEmailVerification(auth.currentUser);
    status("Lien de vérification envoyé. Pense à regarder aussi dans les courriers indésirables.", true);
  } catch (error) { status(authError(error), true); }
}
async function erasePersonalFlowData() {
  if (!user) { status("Connecte-toi pour effacer la copie synchronisée de Flow."); return; }
  const uid = user.uid;
  if (erasingUid === uid) return;
  const approved = confirm("Effacer tes données personnelles Flōw ?\n\nCette action supprime le solde et l’historique personnels synchronisés, la file en attente et leur copie sur cet appareil. Les projets ou espaces partagés, leurs membres et leurs opérations restent dans Flow. Ton compte Firebase partagé avec Sōlo/NovaTasks reste actif.");
  if (!approved) return;
  erasingUid = uid;
  clearTimeout(writeTimer);
  clearTimeout(retryTimer);
  status("Effacement de tes données personnelles Flow…", true);
  try {
    // Let an already submitted write settle before deleting: otherwise it can recreate the document.
    await syncIdle;
    if (user?.uid !== uid) return;
    // Keep only an empty personal state and a monotonically increasing revision.
    // Deleting the document would reset revision to zero and allow an old offline queue to resurrect it.
    // Shared-space membership indexes are intentionally untouched.
    const emptyState = window.FlowApp?.getEmptyState?.();
    if (!emptyState) throw new Error("Empty Flow state unavailable");
    const erasedRevision = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(stateRef(uid));
      const revision = snapshot.exists() && Number.isSafeInteger(snapshot.data().revision) ? snapshot.data().revision : 0;
      transaction.set(stateRef(uid), { personalState: emptyState, revision: revision + 1, schemaVersion: 1, updatedAt: serverTimestamp() });
      return revision + 1;
    });
    if (user?.uid !== uid) return;
    const localKey = window.FlowApp?.getStorageKey?.();
    clearQueue();
    try { localStorage.removeItem(conflictKey(uid)); } catch { /* best effort */ }
    window.FlowApp?.applyRemoteState?.(emptyState);
    if (localKey) { try { localStorage.removeItem(localKey); } catch { /* memory is already blank */ } }
    knownRevision = erasedRevision;
    status("Données personnelles Flow effacées de ce compte et de cet appareil. Les espaces partagés et le compte Sōlo/NovaTasks sont conservés.", true);
  } catch (error) {
    console.warn("Flow personal data erasure failed", error?.code || error?.message || error);
    status("L’effacement n’a pas abouti. Tes données n’ont pas été confirmées comme supprimées ; réessaie avec une connexion.", true);
  } finally {
    if (erasingUid === uid) erasingUid = null;
  }
}

function randomCode(bytes = 24) {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  let binary = "";
  for (const value of raw) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function shareMount() { return $("cloudSharingMount"); }
function renderSharing(message = "") {
  const mount = shareMount();
  if (!mount) return;
  if (!user) {
    mount.innerHTML = '<p class="field-help">Connecte-toi pour créer ou rejoindre un espace collaboratif. Tes données financières personnelles ne sont jamais copiées dans ces espaces.</p><button type="button" class="button secondary" data-share="signin">Se connecter</button>';
    return;
  }
  mount.innerHTML = `<div class="sharing-tools">
    <form data-share-form="create" class="sharing-form"><h3>Créer un espace</h3>
      <label>Nom de l’espace<input name="name" maxlength="48" required placeholder="Vacances, budget maison…"></label>
      <label>Type<select name="kind"><option value="project">Projet partagé</option><option value="budget">Budget partagé</option></select></label>
      <label>Montant cible ou plafond (facultatif)<input name="amount" type="number" min="0" max="10000000" step="0.01" inputmode="decimal" placeholder="0,00"></label>
      <p class="field-help">Ton nom affiché sera visible par les membres. Ni ton e-mail ni tes comptes personnels ne sont copiés dans l’espace.</p>
      <button type="submit" class="button secondary">Créer l’espace</button></form>
    <form data-share-form="join" class="sharing-form"><h3>Rejoindre avec un code</h3>
      <label>Code d’invitation<input name="code" maxlength="64" minlength="32" required autocomplete="off" spellcheck="false" placeholder="Colle le code reçu"></label>
      <p class="field-help">En rejoignant, tu partages ton nom affiché avec les membres de cet espace.</p>
      <button type="submit" class="button ghost">Rejoindre</button></form>
  </div><button type="button" class="button ghost" data-share="refresh">Actualiser mes espaces</button><p class="field-help" role="status" data-share-status></p><div data-share-list><p class="field-help">Chargement des espaces…</p></div>`;
  mount.querySelector('[data-share-status]').textContent = message;
  if(!sharingReady) mount.querySelectorAll('form[data-share-form] button').forEach(button=>{button.disabled=true;});
  refreshSharedSpaces();
}
async function createSharedSpace(form) {
  requireSharingRules();
  const fd = new FormData(form);
  const name = String(fd.get("name") || "").trim();
  const kind = String(fd.get("kind") || "project");
  const amount = Number(fd.get("amount") || 0);
  if (!user || !name || name.length > 48 || !["project", "budget"].includes(kind) || !Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return;
  const workspaceId = randomCode(18);
  const who = user.uid;
  const batch = writeBatch(db);
  const workspace = doc(db, "flowWorkspaces", workspaceId);
  batch.set(workspace, { ownerId: who, name, kind, memberCount: 1, memberIds: [who], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(db, "flowWorkspaces", workspaceId, "members", who), { uid: who, role: "admin", displayName: String(user.displayName || 'Membre').slice(0, 48), joinedAt: serverTimestamp() });
  batch.set(doc(db, "flowUsers", who, "workspaces", workspaceId), { workspaceId, role: "admin", name });
  await batch.commit();
  await setDoc(doc(db, "flowWorkspaces", workspaceId, "goals", "summary"), {
    title: name, kind, target: amount, saved: 0, ownerId: who, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  if (user?.uid === who) { const statusNode = shareMount()?.querySelector("[data-share-status]"); if (statusNode) statusNode.textContent = "Espace créé. Tu peux maintenant générer un code pour inviter quelqu’un."; await refreshSharedSpaces(); }
}
async function makeInvite(workspaceId, role = "member") {
  requireSharingRules();
  if (!user || !["member", "viewer"].includes(role)) return;
  const code = randomCode(24);
  const invite = doc(db, "flowInvites", code);
  await setDoc(invite, { workspaceId, role, createdBy: user.uid, expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 86400000)) });
  try { await navigator.clipboard.writeText(code); } catch { /* display code below for manual copy */ }
  const box = shareMount()?.querySelector(`[data-invite-output="${CSS.escape(workspaceId)}"]`);
  if (box) { box.textContent = `Code valable 7 jours : ${code} · copie-le et envoie-le à la personne. Tes comptes et opérations restent privés.`; box.classList.remove("hidden"); }
}
async function acceptInvite(form) {
  requireSharingRules();
  const code = String(new FormData(form).get("code") || "").trim();
  if (!user || !/^[A-Za-z0-9_-]{32,64}$/.test(code)) throw new Error("Ce code d’invitation semble incomplet.");
  const snap = await getDoc(doc(db, "flowInvites", code));
  if (!snap.exists()) throw new Error("Code invalide ou expiré.");
  const invitation = snap.data();
  if (!invitation.workspaceId || !["member", "viewer"].includes(invitation.role) || !invitation.expiresAt?.toDate || invitation.expiresAt.toDate().getTime() <= Date.now()) throw new Error("Code invalide ou expiré.");
  const uid = user.uid;
  const batch = writeBatch(db);
  // Membership, exact roster delta and count are validated atomically.
  batch.update(doc(db, 'flowWorkspaces', invitation.workspaceId), { memberCount: increment(1), memberIds: arrayUnion(uid), updatedAt: serverTimestamp() });
  batch.set(doc(db, "flowUsers", uid, "joinProofs", invitation.workspaceId), { uid, workspaceId: invitation.workspaceId, role: invitation.role, inviteCode: code });
  batch.set(doc(db, "flowWorkspaces", invitation.workspaceId, "members", uid), { uid, role: invitation.role, displayName: String(user.displayName || 'Membre').slice(0, 48), joinedAt: serverTimestamp() });
  batch.set(doc(db, "flowUsers", uid, "workspaces", invitation.workspaceId), { workspaceId: invitation.workspaceId, role: invitation.role, name: "Espace partagé" });
  await batch.commit();
  if (user?.uid === uid) await refreshSharedSpaces();
}
async function refreshSharedSpaces() {
  const list = shareMount()?.querySelector("[data-share-list]");
  if (!list || !user) return;
  const uid = user.uid;
  const generation = ++sharingRefreshGeneration;
  const current = () => generation === sharingRefreshGeneration && user?.uid === uid && list.isConnected;
  const fragment = document.createDocumentFragment();
  const refresh = shareMount()?.querySelector('[data-share="refresh"]');
  list.inert = true; list.setAttribute('aria-busy', 'true');
  if (refresh) refresh.disabled = true;
  try {
    const indexes = await getDocs(collection(db, "flowUsers", uid, "workspaces"));
    const spaces = await Promise.all(indexes.docs.slice(0, 50).map(async item => {
      const data = item.data();
      try {
        const snap = await getDoc(doc(db, "flowWorkspaces", item.id));
        if (!snap.exists()) return null;
        try {
          const member = await getDoc(doc(db, "flowWorkspaces", item.id, "members", uid));
          return member.exists() ? { id: item.id, ...snap.data(), role: member.data().role } : null;
        } catch (error) {
          // Successful workspace read proves actual membership server-side.
          // Do not read or expose the old invitation to recover its UI metadata.
          if (error.code !== 'permission-denied') throw error;
          return { id: item.id, ...snap.data(), role: 'viewer', needsMigration: true };
        }
      }
      catch (error) { if(error.code==='permission-denied'||error.code==='not-found')return null;throw error; }
    }));
    if (!current()) return;
    const available = spaces.filter(Boolean);
    if (!available.length) { const empty=document.createElement('p');empty.className='field-help';empty.textContent='Aucun espace partagé pour le moment. Crée-en un ou rejoins-en un avec un code.';fragment.append(empty); }
    for (const space of available) {
      const card = document.createElement("article");
      card.className = "sharing-space";
      card.dataset.spaceId = space.id;
      const title = document.createElement("h3"); title.textContent = space.name || "Espace Flow";
      const meta = document.createElement("p"); meta.className = "field-help"; meta.textContent = `${space.kind === "budget" ? "Budget partagé" : "Projet partagé"} · rôle : ${space.role || "membre"}`;
      card.append(title, meta);
      if (space.needsMigration) { const warning=document.createElement('p');warning.className='field-help';warning.textContent='Ancien accès à sécuriser : cet espace reste disponible en lecture. Demande à son administrateur de sécuriser les anciennes invitations pour rétablir l’affichage exact de tes droits.';card.append(warning); }
      if (space.role === "admin") {
        const actions = document.createElement("div"); actions.className = "sharing-actions";
        for (const [label, role] of [["Inviter · peut modifier", "member"], ["Inviter · lecture seule", "viewer"]]) {
          const button = document.createElement("button"); button.type = "button"; button.className = "button ghost"; button.textContent = label;
          button.disabled = !sharingReady || !Array.isArray(space.memberIds);
          button.addEventListener("click", () => sharingAction(button, uid, null, () => makeInvite(space.id, role), false)); actions.append(button);
        }
        card.append(actions);
        const output = document.createElement("p"); output.className = "field-help hidden"; output.dataset.inviteOutput = space.id; card.append(output);
      }
      const contentRef = doc(db, "flowWorkspaces", space.id, "goals", "summary");
      try {
        const content = await getDoc(contentRef);
        if (content.exists()) {
          const data = content.data();
          const limit = document.createElement("p");
          limit.textContent = `${space.kind === "budget" ? "Plafond" : "Objectif"} : ${Number(data.target || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} · ${space.kind === "budget" ? "dépenses partagées" : "déjà mis de côté"} : ${Number(data.saved || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`;
          card.append(limit);
          if (space.role !== "viewer") {
            const edit = document.createElement("form"); edit.className = "sharing-actions";
            const label = document.createElement("label"); label.textContent = space.kind === "budget" ? "Dépenses partagées" : "Montant déjà épargné";
            const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = String(data.target || 10000000); input.step = "0.01"; input.value = String(data.saved || 0); input.name = "saved";
            label.append(input);
            const save = document.createElement("button"); save.className = "button ghost"; save.type = "submit"; save.textContent = "Mettre à jour";
            save.disabled = !sharingReady;
            edit.append(label, save);
            edit.addEventListener("submit", event => {
              event.preventDefault();
              const saved = Number(input.value);
              if (!Number.isFinite(saved) || saved < 0 || saved > Number(data.target || 10000000)) return;
              sharingAction(save, uid, null, () => setDoc(contentRef, { title: data.title, kind: data.kind, target: data.target, saved, ownerId: data.ownerId, createdAt: data.createdAt, updatedAt: serverTimestamp() }));
            });
            card.append(edit);
          }
        }
      } catch { /* permission or deleted summary: metadata remains available */ }
      await appendSharingManagement(card, space, uid);
      if (!current()) return;
      fragment.append(card);
    }
    if (!current()) return;
    // Replace once, after all reads, keeping disclosures open.
    for (const card of fragment.querySelectorAll('.sharing-space')) {
      const previous = [...list.querySelectorAll('.sharing-space')].find(node => node.dataset.spaceId === card.dataset.spaceId);
      if (previous?.querySelector('details')?.open) card.querySelector('details').open = true;
    }
    list.replaceChildren(fragment);
    if (!sharingReady) { const warning=document.createElement('p');warning.className='field-help';warning.textContent='Mise à jour du partage en attente des règles Firebase. Les comptes personnels ne sont pas affectés.';list.prepend(warning); }
  } catch (error) {
    if (current()) { const node=shareMount()?.querySelector('[data-share-status]');if(node)node.textContent='Impossible d’actualiser les espaces. Les données affichées sont conservées.'; }
  } finally {
    if (current()) { list.inert=false;list.removeAttribute('aria-busy');if(refresh)refresh.disabled=false; }
  }
}
async function sharingAction(button, uid, confirmation, action, refreshAfter = true) {
  if (button.disabled || user?.uid !== uid || (confirmation && !confirm(confirmation))) return;
  button.disabled = true;
  const node = shareMount()?.querySelector('[data-share-status]');
  if (node) node.textContent = 'Enregistrement en cours…';
  try {
    requireSharingRules();
    await action();
    if (user?.uid === uid) { if(refreshAfter) await refreshSharedSpaces();if(node?.isConnected)node.textContent='Modification enregistrée.'; }
  } catch {
    const node = shareMount()?.querySelector('[data-share-status]');
    if (user?.uid === uid && node) node.textContent = "Action non autorisée ou connexion indisponible. Aucun succès n’a été confirmé.";
  } finally { button.disabled = false; }
}
async function appendSharingManagement(card, space, uid) {
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'Membres et accès'; details.append(summary);
  try {
    const members = space.role === 'admin' ? await getDocs(collection(db, 'flowWorkspaces', space.id, 'members')) : { docs: [{ id:uid, data:()=>({role:space.role}) }] };
    if (user?.uid !== uid) return;
    if (space.role === 'admin' && (!Array.isArray(space.memberIds) || members.docs.some(member => Object.hasOwn(member.data(), 'inviteCode')))) {
      const secure=document.createElement('button');secure.type='button';secure.className='button secondary';secure.textContent='Sécuriser les anciennes invitations';secure.disabled=!sharingReady;
      secure.addEventListener('click',()=>sharingAction(secure,uid,'Révoquer tous les codes actifs de cet espace et retirer les anciens codes des fiches ? Les membres restent inscrits ; il faudra générer de nouvelles invitations.',async()=>{
        const invitations=await getDocs(query(collection(db,'flowInvites'),where('workspaceId','==',space.id)));
        const currentMembers=await getDocs(collection(db,'flowWorkspaces',space.id,'members'));
        // Revoke first; a partially interrupted cleanup cannot keep exposed codes live.
        for(let start=0;start<invitations.docs.length;start+=400){const batch=writeBatch(db);invitations.docs.slice(start,start+400).forEach(invite=>batch.delete(invite.ref));await batch.commit();}
        for(let start=0;start<currentMembers.docs.length;start+=400){const batch=writeBatch(db);currentMembers.docs.slice(start,start+400).filter(member=>Object.hasOwn(member.data(),'inviteCode')).forEach(member=>batch.update(member.ref,{inviteCode:deleteField()}));await batch.commit();}
        // Read each existing member in the transaction: concurrent departures
        // trigger a retry, so no stale roster re-enables a removed membership.
        await runTransaction(db, async transaction => {
          const ref=doc(db,'flowWorkspaces',space.id),root=await transaction.get(ref);
          if(Array.isArray(root.data()?.memberIds))return;
          const roster=await Promise.all(currentMembers.docs.map(member=>transaction.get(member.ref)));
          const ids=roster.filter(member=>member.exists()).map(member=>member.id);
          if(ids.length>1000)throw new Error('Cet espace dépasse la limite de migration. Contacte l’éditeur.');
          transaction.update(ref,{memberIds:ids,memberCount:ids.length,updatedAt:serverTimestamp()});
        });
      }));details.append(secure);
    }
    for (const member of members.docs) {
      const data = member.data(); const row = document.createElement('div'); row.className = 'sharing-actions';
      const label = document.createElement('span');
      label.textContent = `${member.id === uid ? 'Toi' : data.displayName || `Membre · ${member.id.slice(-8)}`} · ${member.id === space.ownerId ? 'propriétaire' : data.role === 'viewer' ? 'lecture seule' : 'peut modifier'}`;
      row.append(label);
      if (member.id !== space.ownerId && space.role === 'admin') {
        const role = document.createElement('button'); role.type = 'button'; role.className = 'button ghost';
        const nextRole = data.role === 'viewer' ? 'member' : 'viewer';
        role.textContent = nextRole === 'viewer' ? 'Passer en lecture seule' : 'Autoriser la modification';
        role.disabled=Object.hasOwn(data,'inviteCode');if(role.disabled)role.title='Sécurise d’abord les anciennes invitations.';
        role.addEventListener('click', () => sharingAction(role, uid, `Changer les droits de ce membre dans « ${space.name} » ?`, () => setDoc(doc(db, 'flowWorkspaces', space.id, 'members', member.id), { role: nextRole }, { merge: true })));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button danger'; remove.textContent = 'Retirer';
        remove.addEventListener('click', () => sharingAction(remove, uid, `Retirer l’accès de ce membre à « ${space.name} » ? Ses copies déjà consultées ne peuvent pas être effacées. Révoque aussi les codes d’invitation actifs pour empêcher un retour avec ces codes.`, () => {
          const batch = writeBatch(db);if(Array.isArray(space.memberIds))batch.update(doc(db,'flowWorkspaces',space.id),{memberIds:arrayRemove(member.id),memberCount:increment(-1),updatedAt:serverTimestamp()});batch.delete(doc(db, 'flowWorkspaces', space.id, 'members', member.id)); batch.delete(doc(db, 'flowUsers', member.id, 'workspaces', space.id)); return batch.commit();
        }));
        row.append(role, remove);
      }
      details.append(row);
    }
    if (uid !== space.ownerId) {
      const leave = document.createElement('button'); leave.type = 'button'; leave.className = 'button danger'; leave.textContent = 'Quitter cet espace';
      leave.addEventListener('click', () => sharingAction(leave, uid, `Quitter « ${space.name} » ? Tes données personnelles restent intactes. Un code d’invitation valide sera nécessaire pour revenir.`, () => {
        const batch = writeBatch(db);if(Array.isArray(space.memberIds))batch.update(doc(db,'flowWorkspaces',space.id),{memberIds:arrayRemove(uid),memberCount:increment(-1),updatedAt:serverTimestamp()});batch.delete(doc(db, 'flowWorkspaces', space.id, 'members', uid));batch.delete(doc(db,'flowUsers',uid,'joinProofs',space.id));batch.delete(doc(db, 'flowUsers', uid, 'workspaces', space.id)); return batch.commit();
      }));
      details.append(leave);
    }
    if (space.role === 'admin') {
      const invites = await getDocs(query(collection(db, 'flowInvites'), where('workspaceId', '==', space.id), limit(25)));
      const title = document.createElement('h4'); title.textContent = 'Codes d’invitation'; details.append(title);
      if (!invites.size) { const text = document.createElement('p'); text.className = 'field-help'; text.textContent = 'Aucun code actif.'; details.append(text); }
      for (const invite of invites.docs) {
        const data = invite.data(); const row = document.createElement('div'); row.className = 'sharing-actions';
        const label = document.createElement('span'); const expires = data.expiresAt?.toDate?.();
        label.textContent = `${data.role === 'viewer' ? 'Lecture seule' : 'Peut modifier'} · ${expires ? `expiration ${expires.toLocaleDateString('fr-FR')}` : 'expiration inconnue'}`;
        const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'button danger'; revoke.textContent = 'Révoquer le code';
        revoke.addEventListener('click', () => sharingAction(revoke, uid, 'Révoquer ce code ? Il ne permettra plus de rejoindre cet espace. Les membres déjà présents gardent leur accès.', () => deleteDoc(doc(db, 'flowInvites', invite.id))));
        row.append(label, revoke); details.append(row);
      }
      const help = document.createElement('p'); help.className = 'field-help'; help.textContent = 'La révocation d’un code ne retire pas les membres déjà présents. Retirer un membre n’efface pas ses copies locales.'; details.append(help);
    }
  } catch { const text = document.createElement('p'); text.className = 'field-help'; text.textContent = 'Gestion des accès indisponible. Actualise avec une connexion.'; details.append(text); }
  if(!sharingReady) details.querySelectorAll('button').forEach(button=>{button.disabled=true;});
  card.append(details);
}
shareMount()?.addEventListener("click", event => {
  if (event.target.closest('[data-share="signin"]')) openAuth();
  if (event.target.closest('[data-share="refresh"]')) refreshSharedSpaces();
});
shareMount()?.addEventListener("submit", event => {
  const form = event.target.closest("form[data-share-form]");
  if (!form) return;
  event.preventDefault();
  if(form.dataset.busy==='true')return;
  form.dataset.busy='true';const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
  const statusNode = shareMount()?.querySelector("[data-share-status]");
  if (statusNode) statusNode.textContent = "En cours…";
  const action = form.dataset.shareForm === "create" ? createSharedSpace(form) : acceptInvite(form);
  action.then(() => { if (statusNode?.isConnected) statusNode.textContent = "C’est prêt."; }).catch(error => { if (statusNode?.isConnected) statusNode.textContent = error?.code==='permission-denied'?'Accès refusé : espace plein, déjà rejoint ou ancien espace à mettre à jour par son administrateur. Aucune donnée personnelle n’a été modifiée.':error?.message || "Impossible de terminer cette action."; }).finally(()=>{delete form.dataset.busy;if(submit)submit.disabled=false;});
});

$("cloudAccountButton")?.addEventListener("click", () => user ? signOut(auth) : openAuth());
$("cloudSignIn")?.addEventListener("click", openAuth);
$("cloudSignOut")?.addEventListener("click", () => signOut(auth));
$("cloudAuthSwitch")?.addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
$("cloudOffline")?.addEventListener("click", closeAuth);
$("cloudAuthForm")?.addEventListener("submit", submitAuth);
$("cloudResetPassword")?.addEventListener("click", resetPassword);
$("cloudVerifyEmail")?.addEventListener("click", sendVerificationEmail);
$("cloudDeleteAccount")?.addEventListener("click", erasePersonalFlowData);
window.addEventListener("flow:state-change", queueLocalState);
window.addEventListener("online", () => { if (currentQueue()) flushQueue(); });
window.addEventListener("focus", () => { if (currentQueue()) flushQueue(); });

onAuthStateChanged(auth, async nextUser => {
  clearTimeout(writeTimer);
  clearTimeout(retryTimer);
  unsubscribe?.();
  unsubscribe = null;
  const previousUid = activeUid;
  const guestCandidate = nextUser && !previousUid ? localState() : null;
  user = nextUser;
  sharingReady = false;
  ++sharingRefreshGeneration;
  if (!user) {
    renderSharing();
    activeUid = null;
    await window.FlowApp?.activateLocal?.();
    status("Tes données locales restent accessibles. Connecte-toi pour les retrouver sur PC et mobile.");
    window.dispatchEvent(new CustomEvent("flow:auth-state", { detail: { uid: null } }));
    return;
  }
  if (previousUid && previousUid !== user.uid) await window.FlowApp?.activateLocal?.();
  knownRevision = 0;
  status("Connexion à ton espace…", true);
  if(shareMount()) shareMount().textContent='Chargement des espaces de ce compte…';
  const sharingUid=user.uid;
  checkSharingRules(sharingUid).then(ready=>{
    if(user?.uid!==sharingUid)return;
    sharingReady=ready;renderSharing();
  });
  window.dispatchEvent(new CustomEvent("flow:auth-state", { detail: { uid: user.uid, email: user.email, verified: user.emailVerified } }));
  try { await loadForUser(guestCandidate); }
  catch (error) {
    console.warn("Flow cloud load deferred", error?.code || error?.message || error);
    status("Connexion cloud indisponible · le mode local reste actif.", true);
  }
});

window.FlowCloud = {
  getIdToken: forceRefresh => auth.currentUser?.getIdToken(!!forceRefresh) || Promise.resolve(null),
  getCurrentUser: () => auth.currentUser,
  getKnownRevision: () => knownRevision,
  retrySync: flushQueue,
  erasePersonalData: erasePersonalFlowData,
  sendVerificationEmail
};
