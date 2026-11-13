// The account on the server (Firebase, project zdrapka-12ba1): sign-in with Google or with an e-mail and a
// password, and a few documents in Firestore (Lite: plain requests, no cache of its own; what was sent is
// remembered by the app). Loaded only when needed (vendor/firebase, ~400 kB): opening Konto, or signed in.
// On the phone Google's sign-in is native (@capacitor-firebase/authentication, skipNativeAuth): it gives a
// Google token, the web SDK signs in with it. Tests put a stand-in in globalThis.__cloudFake.
import { isNative, native } from "./native.js";

const CONFIG = { apiKey: "AIzaSyB5aavB5leunzhaLn5cS3yu89cwM7VIkkA", authDomain: "zdrapka-12ba1.firebaseapp.com", projectId: "zdrapka-12ba1" };
const V = "../vendor/firebase/";

let ready = null;
/** -> {auth fns, db fns} (the same shape as the stand-in). */
export function cloud() {
  if (globalThis.__cloudFake) return Promise.resolve(globalThis.__cloudFake);
  ready ??= (async () => {
    const [A, U, F] = await Promise.all([import(`${V}firebase-app.js`), import(`${V}firebase-auth.js`), import(`${V}firebase-firestore-lite.js`)]);
    const app = A.initializeApp(CONFIG);
    const auth = U.initializeAuth(app, { persistence: [U.indexedDBLocalPersistence, U.browserLocalPersistence], ...(isNative() ? {} : { popupRedirectResolver: U.browserPopupRedirectResolver }) });
    auth.languageCode = "pl";
    const db = F.getFirestore(app);
    const nativeAuth = async () => {
      await native();
      const reg = globalThis.Capacitor?.registerPlugin || globalThis.capacitorExports?.registerPlugin;
      return globalThis.Capacitor?.Plugins?.FirebaseAuthentication || (reg ? reg("FirebaseAuthentication") : null);
    };
    const user = (u) => (u ? { uid: u.uid, name: u.displayName || "", email: u.email || "", verified: !!u.emailVerified, google: u.providerData.some((p) => p.providerId === "google.com") } : null);
    return {
      onUser: (cb) => U.onAuthStateChanged(auth, (u) => cb(user(u))),
      current: () => user(auth.currentUser),
      async google() {
        if (isNative()) {
          const N = await nativeAuth();
          if (!N) throw new Error("Brak logowania Google w tej wersji aplikacji");
          const r = await N.signInWithGoogle();
          const tok = r?.credential?.idToken;
          if (!tok) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
          return user((await U.signInWithCredential(auth, U.GoogleAuthProvider.credential(tok))).user);
        }
        return user((await U.signInWithPopup(auth, new U.GoogleAuthProvider())).user);
      },
      async emailIn(email, pass) { return user((await U.signInWithEmailAndPassword(auth, email, pass)).user); },
      async emailUp(email, pass, name) {
        const r = await U.createUserWithEmailAndPassword(auth, email, pass);
        if (name) await U.updateProfile(r.user, { displayName: name });
        await U.sendEmailVerification(r.user).catch(() => {});
        return user(auth.currentUser);
      },
      async verify() { if (auth.currentUser) await U.sendEmailVerification(auth.currentUser); },
      async reload() { if (auth.currentUser) await U.reload(auth.currentUser); return user(auth.currentUser); },
      async reset(email) { await U.sendPasswordResetEmail(auth, email); },
      async rename(name) { if (auth.currentUser) await U.updateProfile(auth.currentUser, { displayName: name }); return user(auth.currentUser); },
      async out() {
        await U.signOut(auth);
        if (isNative()) { try { await (await nativeAuth())?.signOut(); } catch { /* not signed in natively */ } }
      },
      async remove() { if (auth.currentUser) await U.deleteUser(auth.currentUser); },
      // documents: a path of segments ("users/<uid>/data/settings")
      async get(path) { const s = await F.getDoc(F.doc(db, path)); return s.exists() ? s.data() : null; },
      async set(path, data) { await F.setDoc(F.doc(db, path), data); },
      async del(path) { await F.deleteDoc(F.doc(db, path)); },
      async list(path) { const s = await F.getDocs(F.collection(db, path)); return s.docs.map((d) => ({ id: d.id, ...d.data() })); },
      /** Documents of a collection with one condition (field, op, value): [{id, ...}]. */
      async where(path, field, op, value) { const s = await F.getDocs(F.query(F.collection(db, path), F.where(field, op, value))); return s.docs.map((d) => ({ id: d.id, ...d.data() })); },
      /** Several writes at once (all or none): [{op: "set" | "update" | "del", path, data}] (at most 500). */
      async batch(ops) {
        for (let i = 0; i < ops.length; i += 450) {
          const b = F.writeBatch(db);
          for (const o of ops.slice(i, i + 450)) { const r = F.doc(db, o.path); if (o.op === "del") b.delete(r); else if (o.op === "update") b.update(r, o.data); else b.set(r, o.data); }
          await b.commit();
        }
      },
      /** A time for the server's rules (expiry of an invite). */
      at: (ms) => F.Timestamp.fromMillis(ms),
    };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

/** A sign-in error in a few words (Polish), or null when it was only cancelled. */
export function authError(e) {
  const c = e?.code || "";
  if (/cancel|popup-closed|user-cancelled|12501/i.test(c + " " + (e?.message || ""))) return null;
  const M = {
    "auth/invalid-credential": "Zły e-mail albo hasło", "auth/wrong-password": "Zły e-mail albo hasło", "auth/user-not-found": "Nie ma konta z tym e-mailem",
    "auth/invalid-email": "To nie wygląda na adres e-mail", "auth/email-already-in-use": "Konto z tym e-mailem już jest: zaloguj się",
    "auth/weak-password": "Hasło musi mieć co najmniej 6 znaków", "auth/missing-password": "Wpisz hasło", "auth/network-request-failed": "Brak połączenia z internetem",
    "auth/too-many-requests": "Za dużo prób: spróbuj za chwilę", "auth/requires-recent-login": "Zaloguj się jeszcze raz i powtórz",
    "auth/account-exists-with-different-credential": "Ten e-mail ma już konto z innym logowaniem",
  };
  return M[c] || `Nie udało się (${c || e?.message || e})`;
}
