// D3e: with auth on and no counter store configured, the server says once
// that the counters are per-instance memory ("[quota] in-memory counters (no
// Upstash)", console.warn). Whether it logs at startup or at the first
// counted request is the builder's choice; the spy is installed before the
// server module loads, and the line must appear exactly once across several
// asks. Its own file so the module-level "once" is fresh.

const assert = require('node:assert');
const http = require('node:http');
const { makeKeys, sign, PROJECT } = require('./helpers/jwt.js');

test('one "[quota] in-memory counters (no Upstash)" warning when auth is on and no store is set', async () => {
  for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[k];
  Object.assign(process.env, { REQUIRE_AUTH: '1', FIREBASE_PROJECT_ID: PROJECT, AI_PROVIDER: 'deepseek', RECORD_FIXTURES: '0', TRUST_PROXY: '1' });
  const warns = [];
  vi.spyOn(console, 'warn').mockImplementation((...a) => { warns.push(a.map(String).join(' ')); });
  for (const m of ['log', 'info', 'error']) vi.spyOn(console, m).mockImplementation(() => {});
  const keys = makeKeys();
  vi.stubGlobal('fetch', async url => {
    if (/securetoken/.test(String(url))) {
      const body = { kid1: keys.publicPem };
      return { ok: true, status: 200, headers: { get: () => 'max-age=3600' }, json: async () => body, text: async () => JSON.stringify(body) };
    }
    return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: 'hi', tool_calls: null } }] }) };
  });
  const Server = require('../backend/server.js');
  await new Promise(r => Server.server.listen(0, '127.0.0.1', r));
  const port = Server.server.address().port;
  const token = sign(keys.privateKey, { now: Math.floor(Date.now() / 1000), payload: { sub: 'warn-user' } });
  const send = (i) => new Promise((resolve, reject) => {
    const text = JSON.stringify({ markdown: '', message: 'hi', history: [] });
    const req = http.request({ host: '127.0.0.1', port, path: '/api/ask', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'X-Forwarded-For': `10.44.0.${i + 1}`, Authorization: `Bearer ${token}` } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end(text);
  });
  try {
    for (let i = 0; i < 3; i++) assert.equal(await send(i), 200);
  } finally {
    await new Promise(r => Server.server.close(r));
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  }
  const hits = warns.filter(w => w.includes('[quota] in-memory counters (no Upstash)'));
  assert.equal(hits.length, 1, `warnings: ${JSON.stringify(warns)}`);
});
