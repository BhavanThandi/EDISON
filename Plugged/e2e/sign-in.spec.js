// Task D4-lite: sign in from the editor; the token goes with every AI request.
// window.EdisonAuth is stubbed with addInitScript (never the real Google popup,
// never real Firebase); /api/* is stubbed with page.route; no AI is called.
//
// The stub is installed as an accessor on window with a NO-OP SETTER, so if
// auth-ui.js (or the Firebase script) assigns window.EdisonAuth later, the
// assignment is silently ignored and the stub stays. BUILDER NOTE: auth-ui.js
// must still create EdisonAuth only if absent (`if (!window.EdisonAuth)`), and
// must not throw when the assignment is ignored (no strict-mode write that
// depends on it). The CDN-blocked test runs WITHOUT a stub: the editor must
// load and work signed out when Firebase cannot load.
//
// The 401 / 429 replies make Chrome log "Failed to load resource ... status of
// 401|429"; that browser line is not an app error and is filtered. Nothing
// else is.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { chooseSample } = require('./fixtures/photo-sample');

const SIGN_IN_MSG = 'Sign in with Google to ask your own questions (5 a day).';
const LIMIT_MSG = "You've used today's 5 questions. The demos still work — come back tomorrow.";
const SIGN_IN_401 = { status: 401, json: { code: 'SIGN_IN', message: SIGN_IN_MSG } };
const LIMIT_429 = { status: 429, json: { code: 'DAILY_LIMIT', message: LIMIT_MSG } };
const LED_BUILD = {
  reply: 'Built a single LED with a current-limiting resistor.',
  actions: [
    { tool: 'delete_all' },
    { tool: 'place_battery' },
    { tool: 'add_wire', from: 'BAT1.0', to: 'tp_63', color: 'red' },
    { tool: 'add_wire', from: 'BAT1.1', to: 'tn_63', color: 'black' },
    { tool: 'place_resistor', holeA: 'b2', holeB: 'b6' },
    { tool: 'place_led', holeA: 'c8', holeB: 'c6' },
    { tool: 'add_wire', from: 'tp_3', to: 'a2', color: 'red' },
    { tool: 'add_wire', from: 'a8', to: 'tn_8', color: 'black' },
  ],
};
const MOCK_READING = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'photo', 'demo-board.json'), 'utf8')).reading;
const KEY = 'demo-board';
const BB830 = { aOuter: '+', aInner: '-', jInner: '+', jOuter: '-' };

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/status of (401|429)/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  return errors;
}

// A fake EdisonAuth the page cannot overwrite. signedIn: start signed in.
// window.__auth.signInCalls counts signIn() calls.
async function stubAuth(page, signedIn) {
  await page.addInitScript(startSignedIn => {
    let on = !!startSignedIn;
    const fake = {
      token: () => Promise.resolve(on ? 'T' : null),
      signIn: () => { fake.signInCalls++; on = true; return Promise.resolve(); },
      user: () => (on ? { email: 'e@example.com' } : null),
      signInCalls: 0,
    };
    Object.defineProperty(window, 'EdisonAuth', { get: () => fake, set: () => {}, configurable: false });
    window.__auth = fake;
  }, signedIn);
}

async function openEditor(page) {
  await page.goto('/circuit3d/index.html');
  await page.waitForFunction(() => window.App && App.state && App.state.breadboard && App.renderer);
}

async function ask(page, text) {
  await page.locator('#sparky-input').fill(text);
  await page.locator('#sparky-input').press('Enter');
}

const authOf = req => req.headers()['authorization'];

test('signed out: 401 SIGN_IN shows the message and a Sign in with Google button; clicking it re-sends the question once with Bearer T and the answer previews', async ({ page }) => {
  const errors = watchErrors(page);
  await stubAuth(page, false);
  const asks = [];
  await page.route('**/api/ask', route => {
    asks.push({ auth: authOf(route.request()), message: route.request().postDataJSON().message });
    return asks.length === 1 ? route.fulfill(SIGN_IN_401) : route.fulfill({ json: LED_BUILD });
  });
  await openEditor(page);
  await ask(page, 'Explain how a diode works in detail');
  await expect(page.locator('#sparky-messages')).toContainText(SIGN_IN_MSG);
  const btn = page.locator('.chat-signin');
  await expect(btn).toHaveCount(1);
  await expect(btn).toContainText(/Sign in with Google/i);
  expect(asks, 'one request so far, with no token').toEqual([{ auth: undefined, message: 'Explain how a diode works in detail' }]);

  await btn.click();
  await expect(page.locator('#sparky-pending-bar'), 'the re-sent question previews').toBeVisible();
  expect(asks).toEqual([
    { auth: undefined, message: 'Explain how a diode works in detail' },
    { auth: 'Bearer T', message: 'Explain how a diode works in detail' },
  ]);
  expect(await page.evaluate(() => window.__auth.signInCalls)).toBe(1);
  await page.waitForTimeout(300);
  expect(asks.length, 're-sent exactly once').toBe(2);
  expect(errors).toEqual([]);
});

test('signed in from the start: /api/ask, /api/photo and /api/photo/leads all carry Authorization: Bearer T', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await stubAuth(page, true);
  const auth = { ask: [], photo: [], leads: [] };
  await page.route('**/api/ask', route => { auth.ask.push(authOf(route.request())); return route.fulfill({ json: { reply: 'Hello.', actions: [] } }); });
  await openEditor(page);
  await ask(page, 'Explain how a diode works in detail');
  await expect(page.locator('.chat-msg.ai').last()).toContainText('Hello.');

  // A box-round Reading (leads unsure) so the page also posts /api/photo/leads.
  const c = await page.evaluate(() => {
    const s = window.PhotoSamples['demo-board'], g = window.PhotoGrid.homography(s.taps, s.cols);
    return { a: g.holeCentre('h10'), b: g.holeCentre('h14') };
  });
  const box = [c.a[0] - 15, c.a[1] - 12, c.b[0] + 15, c.b[1] + 12];
  const reading = {
    board: { visible: true, cols: 63, rails: BB830, split: false },
    parts: [{ id: 'R1', type: 'resistor', what: 'resistor', value: 470, bands: [], color: '',
              leads: [{ hole: '?', pt: [box[0], 100], role: 'unknown' }, { hole: '?', pt: [box[2], 100], role: 'unknown' }],
              box, confidence: 0.8, unsure: ['leads'] }],
    wires: [], power: [],
  };
  await page.route('**/api/photo', route => {
    auth.photo.push(authOf(route.request()));
    return route.fulfill({ json: { reading, provider: 'gemini', model: 'gemini-robotics-er-2-preview', ms: 5, key: KEY } });
  });
  await page.route('**/api/photo/leads', route => {
    auth.leads.push(authOf(route.request()));
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '{"done":true}\n' });
  });
  await chooseSample(page);
  await expect.poll(() => auth.leads.length, { message: 'the crop round posts /api/photo/leads' }).toBeGreaterThan(0);
  expect(auth.ask, 'ask').toEqual(['Bearer T']);
  expect(auth.photo, 'photo').toEqual(['Bearer T']);
  expect(auth.leads.every(a => a === 'Bearer T'), `leads: ${auth.leads}`).toBe(true);
  expect(errors).toEqual([]);
});

test('429 DAILY_LIMIT: the message shows, no sign-in button, no re-send', async ({ page }) => {
  const errors = watchErrors(page);
  await stubAuth(page, true);
  let asks = 0;
  await page.route('**/api/ask', route => { asks++; return route.fulfill(LIMIT_429); });
  await openEditor(page);
  await ask(page, 'Explain how a diode works in detail');
  await expect(page.locator('#sparky-messages')).toContainText(LIMIT_MSG);
  await page.waitForTimeout(400);
  await expect(page.locator('.chat-signin')).toHaveCount(0);
  expect(asks, 'no re-send').toBe(1);
  expect(errors).toEqual([]);
});

test('photo: 401 SIGN_IN shows the message and a sign-in button in the overlay, and sign-in retries with Bearer T; 429 shows the message and the sample offer', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await stubAuth(page, false);
  const calls = [];
  let mode = '401';
  await page.route('**/api/photo', route => {
    calls.push(authOf(route.request()));
    if (mode === '401' && calls.length === 1) return route.fulfill(SIGN_IN_401);
    if (mode === '429') return route.fulfill(LIMIT_429);
    return route.fulfill({ json: { reading: MOCK_READING, provider: 'fixture', model: 'x', ms: 1 } });
  });
  await openEditor(page);
  await chooseSample(page);
  await expect(page.locator('#photo-modal')).toContainText(SIGN_IN_MSG);
  const btn = page.locator('#photo-modal .chat-signin');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('#photo-confirm'), 'retried after sign-in').toBeVisible();
  expect(calls).toEqual([undefined, 'Bearer T']);

  // 429: a fresh page (signed in), the message and the sample offer.
  mode = '429';
  await page.reload();
  await page.waitForFunction(() => window.App && App.state && App.state.breadboard && App.renderer);
  await chooseSample(page);
  await expect(page.locator('#photo-modal')).toContainText(LIMIT_MSG);
  await expect(page.locator('#photo-error-sample')).toBeVisible();
  await expect(page.locator('.chat-signin')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('pin (welcome-demos.spec.js owns it in full): a welcome demo signed out makes no /api/* request and asks no sign-in', async ({ page }) => {
  const errors = watchErrors(page);
  await stubAuth(page, false);
  const api = [];
  page.on('request', r => { if (/\/api\//.test(r.url())) api.push(r.url()); });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.state && App.state.breadboard && App.renderer);
  await page.locator('[data-demo="build"]').click();
  await expect(page.locator('#sparky-pending-bar')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.chat-signin')).toHaveCount(0);
  expect(api).toEqual([]);
  expect(await page.evaluate(() => window.__auth.signInCalls)).toBe(0);
  expect(errors).toEqual([]);
});

test('Firebase CDN blocked and EdisonAuth not stubbed: the editor loads with no page errors and a signed-out question still goes out with no Authorization header', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    // the aborted CDN request is the test's own doing
    if (m.type() === 'error' && !/gstatic|ERR_FAILED|ERR_BLOCKED/.test(m.text() + ((m.location() && m.location().url) || ''))) errors.push('console: ' + m.text());
  });
  await page.route(/gstatic\.com\/firebasejs|googleapis\.com|firebaseapp\.com/, route => route.abort());
  let auth = 'unset';
  await page.route('**/api/ask', route => { auth = authOf(route.request()); return route.fulfill({ json: { reply: 'Hello.', actions: [] } }); });
  await openEditor(page);
  await ask(page, 'Explain how a diode works in detail');
  await expect(page.locator('.chat-msg.ai').last()).toContainText('Hello.');
  expect(auth, 'no token, no header').toBeUndefined();
  expect(errors).toEqual([]);
});

// ── Fix round 1 ────────────────────────────────────────────────────────────

const FB_HOST = /gstatic\.com\/firebasejs/;

test('fix 1: real auth-ui.js, Firebase CDN blocked: #auth-chip (initial + Sign out) is hidden for a signed-out visitor', async ({ page }) => {
  await page.route(FB_HOST, route => route.abort());
  await openEditor(page);
  await expect(page.locator('#auth-chip')).toBeHidden();
  await expect(page.locator('#auth-signout')).toBeHidden();
});

test('fix 2: Firebase loads slower than the 8 s timeout, then completes: a later signIn() works (no permanent "unavailable")', async ({ page }) => {
  test.setTimeout(40_000);
  // A fake firebase served from the CDN route (no real Firebase, no popup):
  // the app script is held 9 s (past auth-ui.js's 8 s load timeout), then served.
  const APP = `window.firebase = { apps: [], initializeApp() { this.apps.push({}); },
    auth: Object.assign(() => ({ currentUser: null,
        onAuthStateChanged(cb) { setTimeout(() => cb(null), 0); return () => {}; },
        signInWithPopup: async () => { window.__popups = (window.__popups || 0) + 1; } }),
      { GoogleAuthProvider: function () {} }) };`;
  await page.route(FB_HOST, async route => {
    if (/firebase-app-compat/.test(route.request().url())) {
      await new Promise(r => setTimeout(r, 9000));
      return route.fulfill({ contentType: 'application/javascript', body: APP }).catch(() => {});
    }
    return route.fulfill({ contentType: 'application/javascript', body: '' }).catch(() => {});
  });
  await openEditor(page);
  expect(await page.evaluate(() => window.EdisonAuth.token()), 'while loading: token is null at the timeout').toBeNull();
  await page.waitForTimeout(2500);                 // Firebase is now ready (t > 9 s)
  const result = await page.evaluate(() => window.EdisonAuth.signIn().then(() => 'ok', e => 'error: ' + e.message));
  expect(result, 'signIn works once Firebase has loaded').toBe('ok');
  expect(await page.evaluate(() => window.__popups)).toBe(1);
});

test('fix 3: a token() that never resolves delays a typed question by under 2.5 s; the request goes out without Authorization', async ({ page }) => {
  await page.addInitScript(() => {
    const fake = { token: () => new Promise(() => {}), signIn: () => Promise.resolve(), user: () => null };
    Object.defineProperty(window, 'EdisonAuth', { get: () => fake, set: () => {}, configurable: false });
  });
  let sentAt = 0, auth = 'unset';
  await page.route('**/api/ask', route => { sentAt = Date.now(); auth = authOf(route.request()); return route.fulfill({ json: { reply: 'Hello.', actions: [] } }); });
  await openEditor(page);
  const t0 = Date.now();
  await ask(page, 'Explain how a diode works in detail');
  await expect.poll(() => sentAt, { timeout: 5000 }).toBeGreaterThan(0);
  expect(sentAt - t0, 'ms from Enter to the request').toBeLessThan(2500);
  expect(auth).toBeUndefined();
});

test('fix 4: after 401 → sign-in → automatic re-send, the chat shows the question once', async ({ page }) => {
  await stubAuth(page, false);
  let n = 0;
  await page.route('**/api/ask', route => (++n === 1 ? route.fulfill(SIGN_IN_401) : route.fulfill({ json: LED_BUILD })));
  await openEditor(page);
  const q = 'Explain how a diode works in detail';
  await ask(page, q);
  await page.locator('.chat-signin').click();
  await expect(page.locator('#sparky-pending-bar')).toBeVisible();
  await expect(page.locator('.chat-msg.user', { hasText: q })).toHaveCount(1);
});
