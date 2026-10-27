// welcome.js — DOM layer for the Edison welcome card (#welcome-card).
// Shows on first load of the session; × hides it and remembers that in
// sessionStorage. The three demo buttons dispatch a `welcome:demo`
// CustomEvent on document with detail.demo = 'build' | 'photo' | 'run'.
// D2 listens for it. (The card is only visible in the Edison UI: CSS.)
(function () {
  const KEY = 'edison.welcome.dismissed';
  const card = document.getElementById('welcome-card');
  if (!card) return;

  function dismissed() { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } }
  function remember() { try { sessionStorage.setItem(KEY, '1'); } catch { /* blocked storage: hidden for this page only */ } }

  if (document.documentElement.dataset.ui === 'edison' && !dismissed()) card.hidden = false;   // Edison UI only

  card.querySelector('.welcome-close').addEventListener('click', () => { card.hidden = true; remember(); });
  card.querySelectorAll('[data-demo]').forEach(b => {
    b.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('welcome:demo', { detail: { demo: b.dataset.demo } }));
    });
  });
})();
