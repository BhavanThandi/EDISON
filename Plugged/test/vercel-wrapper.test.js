// D5: the Vercel function wrapper (api/[...path].js), vercel.json and
// .vercelignore. No AI, no network: the wrapper is driven by a real
// http.createServer(wrapper) on port 0 and fetched over loopback, so the
// request and response are Node's own IncomingMessage / ServerResponse.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const WRAPPER = path.join(ROOT, 'api', '[...path].js');

const listen = srv => new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`)));
const close = srv => new Promise(resolve => { srv.close(() => resolve()); srv.closeAllConnections?.(); });

const open = [];
async function serve(handler) {
  const srv = http.createServer(handler);
  open.push(srv);
  return listen(srv);
}

const SAVED = {};
const ENV = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'PHOTO_PROVIDERS'];
beforeEach(() => { for (const k of ENV) { SAVED[k] = process.env[k]; delete process.env[k]; } });
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const k of ENV) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
  await Promise.all(open.splice(0).map(close));
});

test('api/[...path].js exports a (req, res) function and requiring it opens no port', () => {
  assert.ok(fs.existsSync(WRAPPER), 'Plugged/api/[...path].js exists');
  const wrapper = require(WRAPPER);
  assert.equal(typeof wrapper, 'function', 'module.exports is a function');
  assert.equal(wrapper.length, 2, 'it takes (req, res)');
  const { server } = require('../backend/server.js');
  assert.equal(server.listening, false, 'requiring the wrapper does not start the server listening');
});

test('GET /api/health through the wrapper is 200 with the same JSON the server gives locally', async () => {
  const wrapper = require(WRAPPER);
  const { server } = require('../backend/server.js');
  const viaWrapper = await serve(wrapper);
  const local = await serve((req, res) => server.emit('request', req, res));   // the same handler, mounted directly
  const a = await fetch(`${viaWrapper}/api/health`);
  const b = await fetch(`${local}/api/health`);
  assert.equal(a.status, 200);
  assert.match(String(a.headers.get('content-type')), /application\/json/);
  const body = await a.json();
  assert.deepStrictEqual(body, await b.json());
  assert.equal(body.status, 'ok');
  assert.ok('model' in body && 'voice' in body, `health shape: ${JSON.stringify(body)}`);
});

test('an NDJSON route streams its lines in order through the wrapper (/api/photo/leads, no key, nothing sent)', async () => {
  process.env.PHOTO_PROVIDERS = 'fixture';   // a replay: no Gemini, no key
  const fetched = [];
  const realFetch = globalThis.fetch;
  const base = await serve(require(WRAPPER));
  // Only loopback calls to the wrapper are allowed; anything else is recorded and fails.
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).startsWith(base)) return realFetch(url, init);
    fetched.push(String(url));
    throw new TypeError('the test network is off');
  }));
  const window = { x: 0, y: 0, scale: 3, padLeft: 27, padTop: 27, width: 600, height: 400 };
  const image = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]).toString('base64')}`;
  const ids = ['R1', 'W1', 'R2', 'LED1'];
  const res = await fetch(`${base}/api/photo/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ key: 'no-saved-leads-d5', items: ids.map(id => ({ id, kind: 'part', type: 'other', value: 0, image, window })) }),
  });
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /^application\/x-ndjson/);
  let raw = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
  }
  assert.ok(raw.endsWith('\n'), 'every line ends with a newline');
  const lines = raw.trim().split('\n').map(l => JSON.parse(l));   // each line is whole JSON
  assert.deepStrictEqual(lines.slice(0, -1).map(l => l.id), ids, 'one line per id, in request order');
  assert.equal(lines.at(-1).done, true, 'the last line is { done: true, ... }');
  assert.deepStrictEqual(fetched, [], 'no outside call was made');
});

test('vercel.json: redirect from /, 300 s function, no-cache on /api/(.*), cleanUrls off, and its paths exist', () => {
  const file = path.join(ROOT, 'vercel.json');
  assert.ok(fs.existsSync(file), 'Plugged/vercel.json exists');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));

  const redirect = (cfg.redirects || []).find(r => r.source === '/');
  assert.ok(redirect, `a redirect from "/": ${JSON.stringify(cfg.redirects)}`);
  assert.equal(redirect.destination, '/circuit3d/index.html?ui=edison');
  const [target] = redirect.destination.split('?');
  assert.ok(fs.existsSync(path.join(ROOT, target.slice(1))), `redirect target ${target} exists`);

  const fn = cfg.functions && cfg.functions['api/[...path].js'];
  assert.ok(fn, 'functions["api/[...path].js"] is set');
  assert.equal(fn.maxDuration, 300);   // ≥ the DeepSeek ask deadline (240 s) and the 45 s photo deadline
  assert.ok(fs.existsSync(WRAPPER), 'the function file named in vercel.json exists');

  const rule = (cfg.headers || []).find(h => h.source === '/api/(.*)');
  assert.ok(rule, `a header rule for /api/(.*): ${JSON.stringify(cfg.headers)}`);
  const cc = rule.headers.find(h => h.key.toLowerCase() === 'cache-control');
  assert.ok(cc, 'it sets Cache-Control');
  assert.match(cc.value, /no-store|no-cache/);

  assert.equal(cfg.cleanUrls, false);
});

test('.vercelignore keeps tests, sources, build output, modules and the local .env out of the deploy', () => {
  const file = path.join(ROOT, '.vercelignore');
  assert.ok(fs.existsSync(file), 'Plugged/.vercelignore exists');
  const entries = fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim().replace(/^\//, '')).filter(l => l && !l.startsWith('#'));
  for (const want of ['test/*', 'e2e/', 'src/', 'out/', 'node_modules/', 'backend/.env',
                      '!/test/fixtures/photo/*.json', '!/test/fixtures/photo/leads']) {
    assert.ok(entries.includes(want), `.vercelignore lists ${want}; has ${JSON.stringify(entries)}`);
  }
});

test("the wrapper restores the URL Vercel's catch-all rewrites (path query / [...path] file name)", () => {
  const { originalUrl } = require('../api/[...path].js');
  assert.equal(originalUrl('/api/health'), '/api/health');
  assert.equal(originalUrl('/api/health?path=health'), '/api/health');
  assert.equal(originalUrl('/api/photo/leads?path=photo&path=leads'), '/api/photo/leads');
  assert.equal(originalUrl('/api/[...path]?path=photo&path=leads'), '/api/photo/leads');
  assert.equal(originalUrl('/api/%5B...path%5D?path=photo%2Fleads'), '/api/photo/leads');
  assert.equal(originalUrl('/api/[...path]?...path=ask'), '/api/ask');
  assert.equal(originalUrl('/api/x?foo=1&path=x'), '/api/x?foo=1');
});
