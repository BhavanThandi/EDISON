// Login, allowances and caps on /api/ask, /api/photo and /api/photo/leads
// (task D3).
//
// Interface assumed (stated for the builder):
// - REQUIRE_AUTH=1 (read per request) turns the gate on. Unset: no token, no
//   allowance, nothing changes.
// - The server verifies `Authorization: Bearer <id token>` with
//   Auth.verifyIdToken(token, { projectId: process.env.FIREBASE_PROJECT_ID, ... })
//   using auth.js's DEFAULT fetchCerts, which does a global fetch() of
//   https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com.
//   So no hook is needed: these tests stub global fetch to serve a PUBLIC-KEY
//   PEM map there ({ kid1: pem }, with a Cache-Control max-age header) and
//   answer DeepSeek for /api/ask. A fetch reply is { ok, status, headers:
//   { get }, json(), text() }. Both are read per request/call.
// - Limits come from env, read per request: ASK_PER_USER_DAY (5),
//   PHOTO_PER_USER_DAY (1), ASK_GLOBAL_DAY (100), PHOTO_GLOBAL_DAY (15).
// - Quota keys: take('u:<uid>:ask'), take('g:ask'), take('u:<uid>:photo'),
//   take('g:photo') (see quota.test.js). quota.js exports resetMemory() which
//   clears the in-memory counters; these tests call it between tests.
// - Order on /api/ask: auth (401) → per-user (429 DAILY_LIMIT) → global
//   (429 DAILY_LIMIT_GLOBAL) → the model. /api/photo the same with the photo
//   keys. A 401/429 never reaches a provider. D4 turns the ask-global 429
//   into a Gemini fallback later; D3 answers 429 { code: 'DAILY_LIMIT_GLOBAL',
//   message } (message text is free; the tests only check it is a string; for
//   photo it must mention "photo"). The per-user photo message must differ
//   from the ask one and mention "photo".
// - /api/photo/leads needs the same token but takes nothing from the photo
//   allowance (it is part of the photo's read).
// - Replies carry the code and message at the top level; the usual `reply`
//   field is also present (same text as message) so the page can show it.

const assert = require('node:assert');
const http = require('node:http');
const { makeKeys, sign, PROJECT } = require('./helpers/jwt.js');

process.env.AI_PROVIDER = 'deepseek';
process.env.RECORD_FIXTURES = '0';
process.env.TRUST_PROXY = '1';
process.env.FIREBASE_PROJECT_ID = PROJECT;
const Server = require('../backend/server.js');

const fs = require('node:fs');
const path = require('node:path');
const DEMO_READING = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/photo/demo-board.json'), 'utf8')).reading;
const keys = makeKeys();
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const SIGN_IN = 'Sign in with Google to ask your own questions (5 a day).';
const ASK_LIMIT = "You've used today's 5 questions. The demos still work — come back tomorrow.";

let port;
beforeAll(() => new Promise(r => Server.server.listen(0, '127.0.0.1', () => { port = Server.server.address().port; r(); })));
afterAll(() => new Promise(r => Server.server.close(r)));

let deepseekCalls;
const ENV = ['VOICE_PROVIDER', 'ELEVENLABS_API_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REQUIRE_AUTH', 'ASK_PER_USER_DAY', 'PHOTO_PER_USER_DAY', 'ASK_GLOBAL_DAY', 'PHOTO_GLOBAL_DAY', 'PHOTO_PROVIDERS'];
beforeEach(() => {
  deepseekCalls = 0;
  for (const k of ENV) delete process.env[k];
  process.env.PHOTO_PROVIDERS = 'fakeai';
  require('../backend/photo-reader.js').PROVIDERS.fakeai = { name: 'fakeai', read: async () => ({ reading: DEMO_READING, model: 'fake-model' }) };
  for (const m of ['log', 'info', 'warn', 'error']) vi.spyOn(console, m).mockImplementation(() => {});
  const Q = (() => { try { return require('../backend/quota.js'); } catch { return null; } })();
  if (Q && Q.resetMemory) Q.resetMemory();
  vi.stubGlobal('fetch', async (url) => {
    if (String(url) === CERTS_URL) {
      const body = { kid1: keys.publicPem };
      return { ok: true, status: 200, headers: { get: h => (/cache-control/i.test(h) ? 'public, max-age=3600' : null) }, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (/deepseek/i.test(String(url))) {
      deepseekCalls++;
      return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: 'Hello from the model.', tool_calls: null } }] }) };
    }
    throw new Error(`unexpected network call to ${url}`);
  });
});
afterEach(() => { delete require('../backend/photo-reader.js').PROVIDERS.fakeai; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// A token for `uid`, valid against the real clock (the server uses Date.now()).
const tokenFor = uid => sign(keys.privateKey, { now: Math.floor(Date.now() / 1000), payload: { sub: uid } });

let ipCount = 0;
function post(path, body, { token, accept } = {}) {
  const text = JSON.stringify(body);
  const ip = `10.43.${Math.floor(++ipCount / 250)}.${ipCount % 250 + 1}`;
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'X-Forwarded-For': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (accept) headers.Accept = accept;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(out); } catch { /* ndjson etc. */ } resolve({ status: res.statusCode, json, raw: out }); });
    });
    req.on('error', reject);
    req.end(text);
  });
}
const ask = (opts, message = 'hi') => post('/api/ask', { markdown: '', message, history: [] }, opts);

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(out); } catch { /* */ } resolve({ status: res.statusCode, json, raw: out }); });
    }).on('error', reject);
  });
}
const CLIP = `data:audio/webm;base64,${Buffer.alloc(64, 1).toString('base64')}`;
const stt = opts => post('/api/voice/stt', { audio: CLIP }, opts);
const tts = opts => post('/api/voice/tts', { text: 'hello there' }, opts);

const GRID = { cols: 63, pitch: 30, x0: 90, y0: 190, width: 2040, height: 710 };
const IMG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 'a')]).toString('base64')}`;
// A real photo: no sample id, read by a registered fake provider. A body with a
// `sample` id is a recorded replay (no AI call): it needs no token and takes no
// allowance even with REQUIRE_AUTH=1 (D3c).
const photo = opts => post('/api/photo', { image: IMG, grid: GRID }, opts);
const photoSample = opts => post('/api/photo', { image: IMG, grid: GRID, sample: 'demo-board' }, opts);
const WINDOW = { x: 0, y: 0, scale: 1, padLeft: 0, padTop: 0, width: 100, height: 100 };
const leads = opts => post('/api/photo/leads', { key: 'resistors', items: [{ id: 'R1', image: IMG, window: WINDOW }] }, opts);

describe('REQUIRE_AUTH=1', () => {
  beforeEach(() => { process.env.REQUIRE_AUTH = '1'; });

  test('/api/ask without a token → 401 SIGN_IN with the exact text, and no provider call', async () => {
    const res = await ask({});
    assert.equal(res.status, 401, res.raw.slice(0, 200));
    assert.equal(res.json.code, 'SIGN_IN');
    assert.equal(res.json.message, SIGN_IN);
    assert.equal(deepseekCalls, 0);
  });

  test('bad tokens → 401, no provider call: garbage, wrong key, expired, wrong project', async () => {
    const other = makeKeys();
    const nowS = Math.floor(Date.now() / 1000);
    for (const token of [
      'not-a-token',
      sign(other.privateKey, { now: nowS }),
      sign(keys.privateKey, { now: nowS, payload: { exp: nowS - 10 } }),
      sign(keys.privateKey, { now: nowS, payload: { aud: 'other-project' } }),
    ]) {
      const res = await ask({ token });
      assert.equal(res.status, 401, res.raw.slice(0, 200));
      assert.equal(res.json.code, 'SIGN_IN');
    }
    assert.equal(deepseekCalls, 0);
  });

  test('/api/ask with a valid token → the normal answer', async () => {
    const res = await ask({ token: tokenFor('u-ok') });
    assert.equal(res.status, 200, res.raw.slice(0, 200));
    assert.equal(res.json.reply, 'Hello from the model.');
    assert.equal(deepseekCalls, 1);
  });

  test('the 6th ask by one user in a day → 429 DAILY_LIMIT; another user is unaffected', async () => {
    const token = tokenFor('u-five');
    for (let i = 1; i <= 5; i++) assert.equal((await ask({ token })).status, 200, `ask ${i}`);
    const res = await ask({ token });
    assert.equal(res.status, 429, res.raw.slice(0, 200));
    assert.equal(res.json.code, 'DAILY_LIMIT');
    assert.equal(res.json.message, ASK_LIMIT);
    assert.equal(deepseekCalls, 5, 'the refused ask never reached the model');
    assert.equal((await ask({ token: tokenFor('u-other') })).status, 200);
  });

  test('the limit message uses the env number: ASK_PER_USER_DAY=3 says 3 (the default text says 5)', async () => {
    process.env.ASK_PER_USER_DAY = '3';
    const token = tokenFor('u-three');
    for (let i = 1; i <= 3; i++) assert.equal((await ask({ token })).status, 200, `ask ${i}`);
    const res = await ask({ token });
    assert.equal(res.status, 429, res.raw.slice(0, 200));
    assert.equal(res.json.code, 'DAILY_LIMIT');
    assert.equal(res.json.message, "You've used today's 3 questions. The demos still work — come back tomorrow.");
  });

  test('a recorded sample replay needs no token and takes no photo allowance', async () => {
    const out = await photoSample({});
    assert.equal(out.status, 200, out.raw.slice(0, 200));
    const token = tokenFor('sample-user');
    assert.equal((await photoSample({ token })).status, 200);
    assert.equal((await photoSample({ token })).status, 200, 'sample replays are not counted');
    assert.equal((await photo({ token })).status, 200, 'the signed-in user still has the one real read');
    assert.equal((await photo({ token })).status, 429);
  });

  test('ASK_PER_USER_DAY is read per request', async () => {
    process.env.ASK_PER_USER_DAY = '1';
    const token = tokenFor('u-one');
    assert.equal((await ask({ token })).status, 200);
    assert.equal((await ask({ token })).status, 429);
  });

  test('the global ask cap → 429 DAILY_LIMIT_GLOBAL for a user who still has allowance', async () => {
    process.env.ASK_GLOBAL_DAY = '2';
    assert.equal((await ask({ token: tokenFor('g1') })).status, 200);
    assert.equal((await ask({ token: tokenFor('g2') })).status, 200);
    const res = await ask({ token: tokenFor('g3') });
    assert.equal(res.status, 429, res.raw.slice(0, 200));
    assert.equal(res.json.code, 'DAILY_LIMIT_GLOBAL');
    assert.equal(typeof res.json.message, 'string');
    assert.equal(deepseekCalls, 2);
  });

  test('/api/photo without a token → 401 SIGN_IN, no read', async () => {
    const res = await photo({});
    assert.equal(res.status, 401, res.raw.slice(0, 200));
    assert.equal(res.json.code, 'SIGN_IN');
    assert.equal(res.json.message, SIGN_IN);
  });

  test('/api/photo: the first read passes, the 2nd by the same user → 429 DAILY_LIMIT with a photo message', async () => {
    const token = tokenFor('p-user');
    const first = await photo({ token });
    assert.equal(first.status, 200, first.raw.slice(0, 200));
    const second = await photo({ token });
    assert.equal(second.status, 429, second.raw.slice(0, 200));
    assert.equal(second.json.code, 'DAILY_LIMIT');
    assert.match(second.json.message, /photo/i);
    assert.notEqual(second.json.message, ASK_LIMIT);
    assert.equal((await photo({ token: tokenFor('p-other') })).status, 200, 'another user still reads');
  });

  test('photo and ask allowances are separate', async () => {
    const token = tokenFor('both');
    assert.equal((await photo({ token })).status, 200);
    assert.equal((await ask({ token })).status, 200);
  });

  test('the global photo cap → 429 DAILY_LIMIT_GLOBAL whose message mentions photo reads', async () => {
    process.env.PHOTO_GLOBAL_DAY = '1';
    assert.equal((await photo({ token: tokenFor('pg1') })).status, 200);
    const res = await photo({ token: tokenFor('pg2') });
    assert.equal(res.status, 429, res.raw.slice(0, 200));
    assert.equal(res.json.code, 'DAILY_LIMIT_GLOBAL');
    assert.match(res.json.message, /photo/i);
  });

  test('/api/photo/leads needs a token (401 SIGN_IN without one)', async () => {
    const res = await leads({});
    assert.equal(res.status, 401, res.raw.slice(0, 200));
    assert.equal(res.json.code, 'SIGN_IN');
  });

  test('/api/photo/leads does not use the photo allowance, before or after the photo read', async () => {
    const token = tokenFor('leads-user');
    const a = await leads({ token });
    assert.notEqual(a.status, 401, a.raw.slice(0, 200));
    assert.notEqual(a.status, 429, a.raw.slice(0, 200));
    assert.equal((await photo({ token })).status, 200, 'the one photo read is still there after leads calls');
    for (let i = 0; i < 3; i++) {
      const r = await leads({ token });
      assert.notEqual(r.status, 429, `leads call ${i + 2}: ${r.raw.slice(0, 200)}`);
      assert.notEqual(r.status, 401);
    }
  });
});

describe('voice routes with REQUIRE_AUTH=1 (D3e)', () => {
  beforeEach(() => { process.env.REQUIRE_AUTH = '1'; });

  test.each([['stt', stt], ['tts', tts]])('/api/voice/%s without a token → 401 SIGN_IN and no ElevenLabs call', async (_, send) => {
    process.env.VOICE_PROVIDER = 'elevenlabs';
    process.env.ELEVENLABS_API_KEY = 'not-a-real-key';
    let elevenCalls = 0;
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', async (url, ...rest) => { if (/elevenlabs/.test(String(url))) { elevenCalls++; throw new Error('should not be called'); } return inner(url, ...rest); });
    const res = await send({});
    assert.equal(res.status, 401, res.raw.slice(0, 200));
    assert.equal(res.json.code, 'SIGN_IN');
    assert.equal(res.json.message, SIGN_IN);
    const bad = await send({ token: 'garbage' });
    assert.equal(bad.status, 401);
    assert.equal(elevenCalls, 0);
  });

  test('with a valid token both routes reach the (fixture) provider, and take no allowance', async () => {
    process.env.VOICE_PROVIDER = 'fixture';
    process.env.ASK_PER_USER_DAY = '1';
    const token = tokenFor('voice-user');
    for (let i = 0; i < 3; i++) {
      const a = await stt({ token });
      assert.equal(a.status, 200, a.raw.slice(0, 200));
      assert.equal(typeof a.json.text, 'string');
      assert.equal((await tts({ token })).status, 200);
    }
    assert.equal((await ask({ token })).status, 200, 'the single ask is still there');
  });
});

describe('REQUIRE_AUTH spelling (D3e)', () => {
  test.each(['1', 'true', ' 1', '1\n', 'yes', 'TRUE', ' Yes '])('%j turns auth ON', async v => {
    process.env.REQUIRE_AUTH = v;
    const res = await ask({});
    assert.equal(res.status, 401, res.raw.slice(0, 200));
    assert.equal(res.json.code, 'SIGN_IN');
  });
  test.each(['', '0', 'false', 'off', 'no', 'FALSE', ' Off ', ' NO\n'])('%j turns auth OFF', async v => {
    process.env.REQUIRE_AUTH = v;
    assert.equal((await ask({})).status, 200);
  });
});

describe('GET /api/health reports auth and counters (D3e)', () => {
  test('auth follows REQUIRE_AUTH', async () => {
    assert.equal((await get('/api/health')).json.auth, false);
    process.env.REQUIRE_AUTH = 'true';
    assert.equal((await get('/api/health')).json.auth, true);
  });
  test('counters: memory with no store, upstash with either pair', async () => {
    assert.equal((await get('/api/health')).json.counters, 'memory');
    process.env.UPSTASH_REDIS_REST_URL = 'https://u.example.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    assert.equal((await get('/api/health')).json.counters, 'upstash');
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.KV_REST_API_URL = 'https://kv.example.test';
    process.env.KV_REST_API_TOKEN = 't';
    assert.equal((await get('/api/health')).json.counters, 'upstash');
    delete process.env.KV_REST_API_TOKEN;
    assert.equal((await get('/api/health')).json.counters, 'memory', 'a URL without its token is not a store');
  });
  test('the old fields stay', async () => {
    const h = (await get('/api/health')).json;
    assert.equal(h.status, 'ok');
    assert.ok('model' in h && 'voice' in h);
  });
});

describe('REQUIRE_AUTH unset: local dev unchanged', () => {
  test('/api/ask needs no token and has no daily allowance', async () => {
    for (let i = 0; i < 7; i++) {
      const res = await ask({});
      assert.equal(res.status, 200, `ask ${i + 1}: ${res.raw.slice(0, 200)}`);
    }
  });

  test('/api/photo and /api/photo/leads need no token and have no allowance', async () => {
    for (let i = 0; i < 3; i++) {
      assert.equal((await photo({})).status, 200);
      const r = await leads({});
      assert.notEqual(r.status, 401);
      assert.notEqual(r.status, 429);
    }
  });

  test('REQUIRE_AUTH=0 is also off', async () => {
    process.env.REQUIRE_AUTH = '0';
    assert.equal((await ask({})).status, 200);
  });
});
