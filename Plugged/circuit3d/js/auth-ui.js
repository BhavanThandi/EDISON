// Sign in with Google from the editor (D4). Firebase Auth loads lazily from the
// same CDN, version and config as dashboard.html; if it can't load, token()
// resolves null and the editor works signed out.
// Contract: docs/API-CONTRACT.md → "Page additions" → Sign-in.
(function () {
  if (window.EdisonAuth) return;   // already provided (a test stub): leave it

  const FB = 'https://www.gstatic.com/firebasejs/10.12.0/';
  const LOAD_MS = 8000;
  let ready = null;   // Promise<firebase.auth.Auth | null>

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('could not load ' + src));
      document.head.appendChild(s);
    });
  }

  function init() {
    if (ready) return ready;
    const load = (async () => {
      await loadScript(FB + 'firebase-app-compat.js');
      await loadScript(FB + 'firebase-auth-compat.js');
      await loadScript('../firebase-config.js');
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      const auth = firebase.auth();
      await new Promise(resolve => { const off = auth.onAuthStateChanged(() => { off(); resolve(); }); });
      auth.onAuthStateChanged(paint);
      paint(auth.currentUser);
      return auth;
    })().catch(() => null);
    const timeout = new Promise(r => setTimeout(() => r(null), LOAD_MS));
    return (ready = Promise.race([load, timeout]));
  }

  function paint(user) {
    const chip = document.getElementById('auth-chip');
    if (!chip) return;
    chip.hidden = !user;
    const initial = chip.querySelector('.auth-initial');
    if (user && initial) {
      initial.textContent = (user.email || '?').charAt(0).toUpperCase();
      initial.title = user.email || '';
    }
  }

  window.EdisonAuth = {
    async token() {
      const auth = await init();
      if (!auth || !auth.currentUser) return null;
      try { return await auth.currentUser.getIdToken(); } catch { return null; }
    },
    async signIn() {
      const auth = await init();
      if (!auth) throw new Error('Sign-in is unavailable right now.');
      await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    },
    user() {
      const auth = window.firebase && firebase.apps && firebase.apps.length ? firebase.auth() : null;
      const u = auth && auth.currentUser;
      return u ? { email: u.email } : null;
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    const out = document.getElementById('auth-signout');
    if (out) out.addEventListener('click', async () => {
      const auth = await init();
      if (auth) await auth.signOut().catch(() => {});
    });
    init();   // restore a signed-in session and paint the chip
  });
})();
