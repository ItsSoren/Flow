import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// Use the default app name so the same Firebase Auth session can be reused by Solo/NovaTasks.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
const stateRef = uid => doc(db, "flowUsers", uid);
let user = null;
let unsubscribe = null;
let writeTimer = 0;
let authMode = "login";
let lastCloudWrite = 0;
let lastRemoteState = "";

function localState() { return window.FlowApp?.getState?.() || null; }
function hasUsefulData(state) { return !!state && (state.transactions?.length || state.recurring?.length || state.goals?.length || state.accounts?.some(account => Number(account.initialBalance))); }
function setCloudStatus(message, connected = false) {
  const status = $("cloudStatus");
  const label = $("cloudAccountLabel");
  const button = $("cloudAccountButton");
  if (status) status.textContent = message;
  if (label) label.textContent = connected ? (user?.displayName || user?.email?.split("@")[0] || "Connecté") : "Connexion";
  if (button) button.classList.toggle("is-connected", connected);
  $("cloudSignIn")?.classList.toggle("hidden", connected);
  $("cloudSignOut")?.classList.toggle("hidden", !connected);
}
function openAuth() { $("cloudAuthModal")?.classList.remove("hidden"); $("cloudEmail")?.focus(); }
function closeAuth() { $("cloudAuthModal")?.classList.add("hidden"); $("cloudAuthError").textContent = ""; }
function setAuthMode(mode) {
  authMode = mode;
  const register = mode === "register";
  $("cloudAuthTitle").textContent = register ? "Crée ton espace Flow" : "Retrouve ton espace";
  $("cloudAuthIntro").textContent = register ? "Crée un compte gratuit pour retrouver tes données sur tous tes appareils." : "Connecte-toi pour retrouver tes comptes, opérations, projets et prévisions.";
  $("cloudNameField").classList.toggle("hidden", !register);
  $("cloudAuthSubmit").textContent = register ? "Créer mon compte" : "Se connecter";
  $("cloudAuthSwitch").textContent = register ? "J’ai déjà un compte" : "Créer un compte";
  $("cloudPassword").autocomplete = register ? "new-password" : "current-password";
}
function friendlyAuthError(error) {
  const messages = { "auth/invalid-credential": "E-mail ou mot de passe incorrect.", "auth/email-already-in-use": "Cette adresse possède déjà un compte.", "auth/weak-password": "Le mot de passe doit contenir au moins 6 caractères.", "auth/invalid-email": "Cette adresse e-mail n’est pas valide.", "auth/network-request-failed": "Connexion indisponible. Tes données locales restent accessibles." };
  return messages[error?.code] || "Impossible de se connecter pour le moment.";
}
async function writeState(state = localState()) {
  if (!user || !state) return;
  const payload = JSON.stringify(state);
  if (payload.length > 850000) return setCloudStatus("Sauvegarde trop volumineuse pour la synchronisation.", true);
  lastCloudWrite = Date.now();
  lastRemoteState = payload;
  await setDoc(stateRef(user.uid), { personalState: state, clientUpdatedAt: lastCloudWrite, updatedAt: serverTimestamp(), schemaVersion: 1 }, { merge: true });
  setCloudStatus("Synchronisé · tes données sont disponibles sur tes appareils.", true);
}
function scheduleWrite() {
  if (!user) return;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => writeState().catch(() => setCloudStatus("Synchronisation momentanément indisponible.", true)), 700);
}
async function loadAndSync() {
  if (!user) return;
  const snapshot = await getDoc(stateRef(user.uid));
  const remote = snapshot.exists() ? snapshot.data() : null;
  const local = localState();
  if (remote?.personalState) {
    const remoteJson = JSON.stringify(remote.personalState);
    if (!hasUsefulData(local)) {
      window.FlowApp?.applyRemoteState(remote.personalState);
    } else if (remoteJson !== JSON.stringify(local)) {
      if (confirm("Une sauvegarde Flow existe déjà sur ce compte. La charger sur cet appareil ?")) window.FlowApp?.applyRemoteState(remote.personalState);
      else await writeState(local);
    }
    lastRemoteState = JSON.stringify(localState());
  } else await writeState(local);
}
function subscribe() {
  unsubscribe?.();
  unsubscribe = onSnapshot(stateRef(user.uid), snapshot => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    const incoming = data.personalState;
    const stamp = Number(data.clientUpdatedAt || 0);
    if (!incoming || stamp <= lastCloudWrite) return;
    const serialized = JSON.stringify(incoming);
    if (serialized === lastRemoteState || serialized === JSON.stringify(localState())) return;
    lastRemoteState = serialized;
    window.FlowApp?.applyRemoteState(incoming);
    setCloudStatus("Mis à jour depuis un autre appareil.", true);
  }, () => setCloudStatus("Connexion cloud indisponible · mode local actif.", true));
}
async function submitAuth(event) {
  event.preventDefault();
  const email = $("cloudEmail").value.trim();
  const password = $("cloudPassword").value;
  const error = $("cloudAuthError");
  error.textContent = "";
  $("cloudAuthSubmit").disabled = true;
  try {
    if (authMode === "register") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const name = $("cloudName").value.trim();
      if (name) await updateProfile(credential.user, { displayName: name });
    } else await signInWithEmailAndPassword(auth, email, password);
    closeAuth();
  } catch (authError) { error.textContent = friendlyAuthError(authError); }
  finally { $("cloudAuthSubmit").disabled = false; }
}

$("cloudAccountButton")?.addEventListener("click", () => user ? signOut(auth) : openAuth());
$("cloudSignIn")?.addEventListener("click", openAuth);
$("cloudSignOut")?.addEventListener("click", () => signOut(auth));
$("cloudAuthSwitch")?.addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
$("cloudOffline")?.addEventListener("click", closeAuth);
$("cloudAuthForm")?.addEventListener("submit", submitAuth);
window.addEventListener("flow:state-change", scheduleWrite);

onAuthStateChanged(auth, async nextUser => {
  user = nextUser;
  if (!user) { unsubscribe?.(); unsubscribe = null; setCloudStatus("Tes données restent sur cet appareil. Connecte-toi pour les retrouver sur PC et mobile."); return; }
  setCloudStatus("Connexion à ton espace…", true);
  try { await loadAndSync(); subscribe(); } catch { setCloudStatus("Connexion cloud indisponible · mode local actif.", true); }
});
