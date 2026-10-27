// welcome.js — DOM layer for the Edison welcome card (#welcome-card).
// Shows on first load of the session; × hides it and remembers that in
// sessionStorage. The three demo buttons dispatch a `welcome:demo`
// CustomEvent on document with detail.demo = 'build' | 'photo' | 'run'.
// This file handles it, with no login and no AI request (D2):
//   build -> chat posts "Build me an LED circuit"; chat.js answers from the saved
//            build below (window.DemoCanned, after its 1.2 s typing delay) as a
//            normal preview with Accept. The actions are the recorded agent
//            answer in test/fixtures/ask/33906cc600548289.json (LED + resistor
//            + battery wiring).
//   photo -> PhotoDemo: the thandi-blinker sample's rehearsed board (photo.js), straight
//            to "Reading your board…" and the build, then its canned explain/fix.
//   run   -> loads ../demo.sparky (as the old landing's "Try it out" did) when the
//            board is empty, then starts the simulation.
// The card hides when any demo starts. (The card is only visible in the Edison UI: CSS.)
(function () {
  const KEY = 'edison.welcome.dismissed';
  const card = document.getElementById('welcome-card');
  if (!card) return;

  function dismissed() { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } }
  function remember() { try { sessionStorage.setItem(KEY, '1'); } catch { /* blocked storage: hidden for this page only */ } }

  if (document.documentElement.dataset.ui === 'edison' && !dismissed()) card.hidden = false;   // Edison UI only

  card.querySelector('.welcome-close').addEventListener('click', () => { card.hidden = true; remember(); });
  const LED_BUILD = {
    reply: 'Built a single-LED circuit: a 9 V battery feeds the rails, a resistor limits the current, and the LED lights up safely. Accept to put it on the board, then press Run.',
    actions: [{ tool: 'delete_all' }, { tool: 'place_battery' },
      { tool: 'add_wire', from: 'BAT1.0', to: 'tp_50', color: 'red' },
      { tool: 'add_wire', from: 'BAT1.1', to: 'tn_50', color: 'black' },
      { tool: 'place_resistor', holeA: 'b2', holeB: 'b6' },
      { tool: 'place_led', holeA: 'c8', holeB: 'c6' },
      { tool: 'add_wire', from: 'tp_3', to: 'a2', color: 'red' },
      { tool: 'add_wire', from: 'a8', to: 'tn_8', color: 'black' }],
  };
  const demos = {
    build() {
      window.DemoCanned = LED_BUILD;
      window.sparkyAsk('Build me an LED circuit');
    },
    photo() {
      window.PhotoDemo('thandi-blinker');
    },
    async run() {
      if (!App.state.components.length) {
        const data = await (await fetch('../demo.sparky')).json();
        App.loadCircuitData(data);
      }
      App.runSimulation();
    },
  };
  document.addEventListener('welcome:demo', e => {
    card.hidden = true;
    const run = demos[e.detail && e.detail.demo];
    if (run) Promise.resolve().then(run).catch(err => console.warn('Demo failed:', err && err.message));
  });
  card.querySelectorAll('[data-demo]').forEach(b => {
    b.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('welcome:demo', { detail: { demo: b.dataset.demo } }));
    });
  });
})();
