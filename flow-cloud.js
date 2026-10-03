import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, sendEmailVerification,
  sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, deleteDoc,
  writeBatch, onSnapshot, runTransaction, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { queueKeyForUser, conflictKeyForUser, reconcileCommittedQueue, shouldFlushAfterCommit } from "./flow-sync-core.mjs";

// Flow deliberately shares the Firebase project/Auth session with Sōlo, while
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

const localState = () => window.FlowApp?.getState?.() || null;
const useful = state => window.FlowApp?.hasUsefulData?.(state)
  ?? !!(state && (state.transactions?.length || state.recurring?.length || state.goals?.length || state.accounts?.some(a => Number(a.initialBalance))));
function status(message, connected = false) {
  const el = $("cloudStatus");
  if (el) el.textContent = message;
  const label = $("cloudAccountLabel");
  const button = $("cloudAccountButton");
  if (label) label.textContent = connected ? (user?.displayName || user?.email?.split("@")[0] || "Connecté") : "Connexion";
  button?.classList.toggle("is-connected", connected);
  $("cloudSignIn")?.classList.toggle("hidden", connected);
  $("cloudSignOut")?.classList.toggle("hidden", !connected);
  $("cloudVerifyEmail")?.classList.toggle("hidden", !connected || user?.emailVerified !== false);
  $("cloudDeleteAccount")?.classList.toggle("hidden", !connected);
}
function setAuthError(message) { const node = $("cloudAuthError"); if (node) node.textContent = message; }
function openAuth() { $("cloudAuthModal")?.classList.remove("hidden"); $("cloudEmail")?.focus(); }
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
function serialize(state) { return JSON.stringify(state); }
function currentQueue() {
  if (!user) return null;
  try { return JSON.parse(localStorage.getItem(queueKey(user.uid)) || "null"); }
  catch { return null; }
}
function saveQueue(state, baseRevision = knownRevision) {
  if (!user || !state) return false;
  const serialized = serialize(state);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) {
    status("La sauvegarde dépasse la taille maximale de synchronisation. Exporte une copie puis allège l’historique.", true);
    return false;
  }
  try {
    const old = currentQueue();
    const record = { state, baseRevision, generation: (old?.generation || 0) + 1, queuedAt: Date.now() };
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
      if (serialize(pending.state) === serialize(remote.personalState)) clearQueue(pending.state);
      else displayConflict({ remoteState: remote.personalState, revision: knownRevision });
    } else if (serialize(local) !== serialize(remote.personalState)) {
      if (useful(local)) displayConflict({ remoteState: remote.personalState, revision: knownRevision });
      else window.FlowApp?.applyRemoteState?.(remote.personalState);
    }
  } else if (pending?.state) {
    saveQueue(pending.state, knownRevision);
    flushQueue();
  } else if (useful(local)) {
    saveQueue(local, knownRevision);
    flushQueue();
  } else if (guestCandidate && useful(guestCandidate) && confirm("Des données locales non synchronisées sont disponibles sur cet appareil.\n\nVeux-tu les copier dans ce nouvel espace Flow ? La copie locale d’origine restera sur cet appareil.")) {
    window.FlowApp?.applyRemoteState?.(guestCandidate);
    saveQueue(guestCandidate, knownRevision);
    flushQueue();
  }
  if (!user || user.uid !== uid) return;
  unsubscribe?.();
  unsubscribe = onSnapshot(stateRef(uid), snapshotUpdate => {
    if (!user || user.uid !== uid || erasingUid === uid || !snapshotUpdate.exists()) return;
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
    setAuthError("Si un compte Flow existe pour cette adresse, un lien de réinitialisation vient d’être envoyé.");
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
    // Membership indexes belong to shared spaces, which this personal-only action explicitly preserves.
    await deleteDoc(stateRef(uid));
    if (user?.uid !== uid) return;
    const localKey = window.FlowApp?.getStorageKey?.();
    clearQueue();
    try { localStorage.removeItem(conflictKey(uid)); } catch { /* best effort */ }
    window.FlowApp?.applyRemoteState?.(window.FlowApp?.getEmptyState?.() || {});
    if (localKey) { try { localStorage.removeItem(localKey); } catch { /* memory is already blank */ } }
    knownRevision = 0;
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
      <button type="submit" class="button secondary">Créer l’espace</button></form>
    <form data-share-form="join" class="sharing-form"><h3>Rejoindre avec un code</h3>
      <label>Code d’invitation<input name="code" maxlength="64" minlength="32" required autocomplete="off" spellcheck="false" placeholder="Colle le code reçu"></label>
      <button type="submit" class="button ghost">Rejoindre</button></form>
  </div><p class="field-help" role="status" data-share-status>${message}</p><div data-share-list><p class="field-help">Chargement des espaces…</p></div>`;
  refreshSharedSpaces();
}
async function createSharedSpace(form) {
  const fd = new FormData(form);
  const name = String(fd.get("name") || "").trim();
  const kind = String(fd.get("kind") || "project");
  const amount = Number(fd.get("amount") || 0);
  if (!user || !name || name.length > 48 || !["project", "budget"].includes(kind) || !Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return;
  const workspaceId = randomCode(18);
  const who = user.uid;
  const batch = writeBatch(db);
  const workspace = doc(db, "flowWorkspaces", workspaceId);
  batch.set(workspace, { ownerId: who, name, kind, memberCount: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(db, "flowWorkspaces", workspaceId, "members", who), { uid: who, role: "admin", joinedAt: serverTimestamp() });
  batch.set(doc(db, "flowUsers", who, "workspaces", workspaceId), { workspaceId, role: "admin", name });
  await batch.commit();
  await setDoc(doc(db, "flowWorkspaces", workspaceId, "goals", "summary"), {
    title: name, kind, target: amount, saved: 0, ownerId: who, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  if (user?.uid === who) { const statusNode = shareMount()?.querySelector("[data-share-status]"); if (statusNode) statusNode.textContent = "Espace créé. Tu peux maintenant générer un code pour inviter quelqu’un."; await refreshSharedSpaces(); }
}
async function makeInvite(workspaceId, role = "member") {
  if (!user || !["member", "viewer"].includes(role)) return;
  const code = randomCode(24);
  const invite = doc(db, "flowInvites", code);
  await setDoc(invite, { workspaceId, role, createdBy: user.uid, expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 86400000)) });
  try { await navigator.clipboard.writeText(code); } catch { /* display code below for manual copy */ }
  const box = shareMount()?.querySelector(`[data-invite-output="${CSS.escape(workspaceId)}"]`);
  if (box) { box.textContent = `Code valable 7 jours : ${code} · copie-le et envoie-le à la personne. Tes comptes et opérations restent privés.`; box.classList.remove("hidden"); }
}
async function acceptInvite(form) {
  const code = String(new FormData(form).get("code") || "").trim();
  if (!user || !/^[A-Za-z0-9_-]{32,64}$/.test(code)) throw new Error("Ce code d’invitation semble incomplet.");
  const snap = await getDoc(doc(db, "flowInvites", code));
  if (!snap.exists()) throw new Error("Code invalide ou expiré.");
  const invitation = snap.data();
  if (!invitation.workspaceId || !["member", "viewer"].includes(invitation.role) || !invitation.expiresAt?.toDate || invitation.expiresAt.toDate().getTime() <= Date.now()) throw new Error("Code invalide ou expiré.");
  const uid = user.uid;
  const batch = writeBatch(db);
  batch.set(doc(db, "flowWorkspaces", invitation.workspaceId, "members", uid), { uid, role: invitation.role, inviteCode: code, joinedAt: serverTimestamp() });
  batch.set(doc(db, "flowUsers", uid, "workspaces", invitation.workspaceId), { workspaceId: invitation.workspaceId, role: invitation.role, name: "Espace partagé" });
  await batch.commit();
  if (user?.uid === uid) await refreshSharedSpaces();
}
async function refreshSharedSpaces() {
  const list = shareMount()?.querySelector("[data-share-list]");
  if (!list || !user) return;
  const uid = user.uid;
  try {
    const indexes = await getDocs(collection(db, "flowUsers", uid, "workspaces"));
    const spaces = await Promise.all(indexes.docs.slice(0, 50).map(async item => {
      const data = item.data();
      try { const snap = await getDoc(doc(db, "flowWorkspaces", item.id)); return snap.exists() ? { id: item.id, role: data.role, ...snap.data() } : null; }
      catch { return null; }
    }));
    if (user?.uid !== uid || !list.isConnected) return;
    const available = spaces.filter(Boolean);
    if (!available.length) { list.innerHTML = '<p class="field-help">Aucun espace partagé pour le moment. Crée-en un ou rejoins-en un avec un code.</p>'; return; }
    list.replaceChildren();
    for (const space of available) {
      const card = document.createElement("article");
      card.className = "sharing-space";
      const title = document.createElement("h3"); title.textContent = space.name || "Espace Flow";
      const meta = document.createElement("p"); meta.className = "field-help"; meta.textContent = `${space.kind === "budget" ? "Budget partagé" : "Projet partagé"} · rôle : ${space.role || "membre"}`;
      card.append(title, meta);
      if (space.role === "admin") {
        const actions = document.createElement("div"); actions.className = "sharing-actions";
        for (const [label, role] of [["Inviter · peut modifier", "member"], ["Inviter · lecture seule", "viewer"]]) {
          const button = document.createElement("button"); button.type = "button"; button.className = "button ghost"; button.textContent = label;
          button.addEventListener("click", () => makeInvite(space.id, role).catch(error => { const node = shareMount()?.querySelector("[data-share-status]"); if (node) node.textContent = authError(error); })); actions.append(button);
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
          limit.textContent = `${space.kind === "budget" ? "Plafond" : "Objectif"} : ${Number(data.target || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}${space.kind === "project" ? ` · déjà mis de côté : ${Number(data.saved || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}` : ""}`;
          card.append(limit);
          if (space.role !== "viewer") {
            const edit = document.createElement("form"); edit.className = "sharing-actions";
            const label = document.createElement("label"); label.textContent = space.kind === "budget" ? "Dépenses partagées" : "Montant déjà épargné";
            const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = String(data.target || 10000000); input.step = "0.01"; input.value = String(data.saved || 0); input.name = "saved";
            label.append(input);
            const save = document.createElement("button"); save.className = "button ghost"; save.type = "submit"; save.textContent = "Mettre à jour";
            edit.append(label, save);
            edit.addEventListener("submit", event => {
              event.preventDefault();
              const saved = Number(input.value);
              if (!Number.isFinite(saved) || saved < 0 || saved > Number(data.target || 10000000)) return;
              setDoc(contentRef, { title: data.title, kind: data.kind, target: data.target, saved, ownerId: data.ownerId, createdAt: data.createdAt, updatedAt: serverTimestamp() }).then(() => { if (shareMount()?.querySelector("[data-share-status]")) shareMount().querySelector("[data-share-status]").textContent = "Progression partagée mise à jour."; }).catch(() => { if (shareMount()?.querySelector("[data-share-status]")) shareMount().querySelector("[data-share-status]").textContent = "Modification non autorisée ou espace hors ligne."; });
            });
            card.append(edit);
          }
        }
      } catch { /* permission or deleted summary: metadata remains available */ }
      list.append(card);
    }
  } catch (error) {
    if (list.isConnected) list.textContent = "Impossible de charger les espaces maintenant. Tes données personnelles restent disponibles.";
  }
}
shareMount()?.addEventListener("click", event => {
  if (event.target.closest('[data-share="signin"]')) openAuth();
});
shareMount()?.addEventListener("submit", event => {
  const form = event.target.closest("form[data-share-form]");
  if (!form) return;
  event.preventDefault();
  const statusNode = shareMount()?.querySelector("[data-share-status]");
  if (statusNode) statusNode.textContent = "En cours…";
  const action = form.dataset.shareForm === "create" ? createSharedSpace(form) : acceptInvite(form);
  action.then(() => { if (statusNode?.isConnected) statusNode.textContent = "C’est prêt."; }).catch(error => { if (statusNode?.isConnected) statusNode.textContent = error?.message || "Impossible de terminer cette action."; });
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
  renderSharing();
  if (!user) {
    activeUid = null;
    await window.FlowApp?.activateLocal?.();
    status("Tes données locales restent accessibles. Connecte-toi pour les retrouver sur PC et mobile.");
    window.dispatchEvent(new CustomEvent("flow:auth-state", { detail: { uid: null } }));
    return;
  }
  if (previousUid && previousUid !== user.uid) await window.FlowApp?.activateLocal?.();
  knownRevision = 0;
  status("Connexion à ton espace…", true);
  renderSharing();
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
