// Task A1 (photo fix, part A): count Gemini calls, HTTP 429s and tokens per
// photo, and report them. Every test uses a fake fetch: no network, no key,
// never a real AI.
//
// Shapes these tests assume (stated so the builder matches them):
// - The per-request tally inside ctx (what readPhoto / readLeads pass to the
//   providers) gains numeric fields, all starting at 0:
//     calls         every HTTP request sent to Gemini (retries and resends too)
//     http429       responses with status 429
//     promptTokens  sum of usageMetadata.promptTokenCount
//     outputTokens  sum of usageMetadata.candidatesTokenCount
//     thoughtTokens sum of usageMetadata.thoughtsTokenCount
//   A missing usageMetadata, or a missing field in it, adds 0 (never NaN).
//   The box round is tested through PROVIDERS.gemini.read(input, ctx) with
//   our own ctx.tally; the usage of a reply counts even when the reply is
//   then rejected (the tokens were spent).
// - The leads route's last NDJSON line is
//     { done: true, provider, model, ms, usage: { calls, http429, promptTokens, outputTokens, thoughtTokens } }
//   and the [photo-leads] line gains `calls=N 429s=N tokens=in/out/thought`.
// - scripts/photo-eval.js exports row(r), table(rows) and totals(results)
//   (today they are private). r.net['/api/photo'].usage and
//   r.net['/api/photo/leads'].usage hold the two responses' usage objects.
//   row's cells include the columns 'calls', '429', 'tok in', 'tok out'
//   (table's header); calls and 429s are summed over the two responses,
//   tok out includes thought tokens. totals(results) gains
//     calls, http429, tokensIn, tokensOut (thought included) and
//     costUsd = tokensIn/1e6 * $1 + tokensOut/1e6 * $5.

const assert = require('node:assert');
const http   = require('node:http');
const util   = require('node:util');

process.env.AI_PROVIDER = 'fixture';   // /api/ask needs no key and never calls out
process.env.RECORD_FIXTURES = '0';
process.env.TRUST_PROXY = '1';
const Server = require('../backend/server.js');
const Reader = require('../backend/photo-reader.js');
const Eval   = require('../scripts/photo-eval.js');

const GEMINI_KEY = 'test-gemini-key-a1';
const GRID = { cols: 63, pitch: 30, x0: 90, y0: 190, width: 2040, height: 710 };
const B64  = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 'p')]).toString('base64');
const IMG  = `data:image/jpeg;base64,${B64}`;

// ── Environment ─────────────────────────────────────────────────────────────

const ENV_KEYS = ['GEMINI_API_KEY', 'PHOTO_GEMINI_MODEL', 'PHOTO_RECORD', 'PHOTO_PROVIDERS', 'PHOTO_TIMEOUT_MS',
  'PHOTO_HEDGE_MS', 'PHOTO_FALLBACK_MODEL', 'PHOTO_FALLBACK_AT_MS', 'PHOTO_LEADS_TIMEOUT_MS', 'PHOTO_LEADS_CONCURRENCY'];
let savedEnv, logs, port;
beforeAll(() => new Promise(r => { Server.server.listen(0, '127.0.0.1', () => { port = Server.server.address().port; r(); }); }));
afterAll(() => new Promise(r => { Server.server.close(r); }));
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.GEMINI_API_KEY = GEMINI_KEY;
  process.env.PHOTO_FALLBACK_MODEL = '';   // only Robotics-ER's own calls are counted here
  logs = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
    vi.spyOn(console, m).mockImplementation((...args) => { logs.push(args.map(a => (typeof a === 'string' ? a : util.inspect(a))).join(' ')); });
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ── A fake Gemini ───────────────────────────────────────────────────────────

function reply(code, body) {
  const t = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: code >= 200 && code < 300, status: code, statusText: '', headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => t, json: async () => JSON.parse(t) };
}
// A 200 whose text is `answer`, with usageMetadata when `usage` is given.
const says = (answer, usage) => reply(200, {
  candidates: [{ content: { role: 'model', parts: [{ text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] }, finishReason: 'STOP' }],
  ...(usage ? { usageMetadata: usage } : {}),
});
const U1 = { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 };
const U2 = { promptTokenCount: 1500, candidatesTokenCount: 100, thoughtsTokenCount: 0 };
const BOXES = { rails: { aOuter: '+', aInner: '-', jInner: '+', jOuter: '-' }, items: [] };
const NOT_JSON = 'this is not json at all';
const fails = n => reply(n, { error: { code: n, message: `upstream ${n}` } });

// Answers the calls in order; every call is kept.
function sequence(...replies) {
  const calls = [];
  const fetch = async (url, opts = {}) => { calls.push({ url: String(url), signal: opts.signal }); return replies[Math.min(calls.length, replies.length) - 1]; };
  return { fetch, calls };
}

const FAKE = { toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: 0 };
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

// PROVIDERS.gemini.read with our own tally, on the fake clock; a retry waits
// 1–2 s, so the clock is moved until the read settles. Resolves the tally.
async function readWithTally(fake) {
  vi.useFakeTimers(FAKE);
  const tally = { retries: 0 };
  const ctrl = new AbortController();
  const ctx = { fetch: fake.fetch, signal: ctrl.signal, deadlineAt: Date.now() + 45000, tally };
  let done = false, error = null;
  Reader.PROVIDERS.gemini.read({ image: IMG, grid: GRID }, ctx).then(() => { done = true; }, e => { done = true; error = e; });
  for (let t = 0; t < 10000 && !done; t += 500) { await vi.advanceTimersByTimeAsync(500); await flush(); }
  await flush();
  assert.ok(done, `the box read had not settled after 10 s of fake time (${fake.calls.length} calls)`);
  return { tally, error };
}

// ── 1. The box round ────────────────────────────────────────────────────────

// What the reader does today: the first call's reply is invalid JSON, so it is
// sent again 1–2 s later (raceGemini's retry rule, #172); the second answers.
// Both replies carry usage, and the invalid one's tokens were still spent.
test('a box round reports its calls and tokens', async () => {
  const fake = sequence(says(NOT_JSON, U1), says(BOXES, U2));
  const { tally, error } = await readWithTally(fake);
  assert.equal(error, null, `the read failed: ${error && error.message}`);
  assert.equal(fake.calls.length, 2, `${fake.calls.length} Gemini calls (the invalid first reply should be retried once)`);
  assert.deepStrictEqual(
    { calls: tally.calls, promptTokens: tally.promptTokens, outputTokens: tally.outputTokens, thoughtTokens: tally.thoughtTokens },
    { calls: 2, promptTokens: 2500, outputTokens: 300, thoughtTokens: 300 },
    `the tally: ${JSON.stringify(tally)}`);
});

test('a 429 is counted and still retried', async () => {
  const fake = sequence(fails(429), says(BOXES, U2));
  const { tally, error } = await readWithTally(fake);
  assert.equal(error, null, `the read failed: ${error && error.message}`);
  assert.equal(fake.calls.length, 2, `${fake.calls.length} Gemini calls (a 429 is retried)`);
  assert.equal(tally.calls, 2, `calls: ${JSON.stringify(tally)}`);
  assert.equal(tally.http429, 1, `http429: ${JSON.stringify(tally)}`);
});

// Review Focus 5: an older model or a replayed fixture has no usageMetadata.
test('missing usageMetadata counts as zero', async () => {
  const cases = [
    ['no usageMetadata', says(BOXES)],
    ['usageMetadata without the thought count', says(BOXES, { promptTokenCount: 700, candidatesTokenCount: 50 })],
  ];
  const want = [
    { calls: 1, http429: 0, promptTokens: 0, outputTokens: 0, thoughtTokens: 0 },
    { calls: 1, http429: 0, promptTokens: 700, outputTokens: 50, thoughtTokens: 0 },
  ];
  for (const [i, [what, res]] of cases.entries()) {
    const { tally, error } = await readWithTally(sequence(res));
    assert.equal(error, null, `${what}: the read failed: ${error && error.message}`);
    const got = { calls: tally.calls, http429: tally.http429, promptTokens: tally.promptTokens, outputTokens: tally.outputTokens, thoughtTokens: tally.thoughtTokens };
    assert.deepStrictEqual(got, want[i], `${what}: ${JSON.stringify(tally)} (zeros, never undefined or NaN)`);
    vi.useRealTimers();
  }
});

// ── 2. The leads route ──────────────────────────────────────────────────────

let ipCount = 0;
const freshIp = () => `10.201.${Math.floor(++ipCount / 250)}.${ipCount % 250 + 1}`;
const crop = seed => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, seed)]).toString('base64')}`;
const WIN = { x: 0, y: 0, scale: 3, padLeft: 27, padTop: 27, width: 600, height: 400 };

test('the leads route\'s done line carries usage', async () => {
  const items = [
    { id: 'R1', kind: 'part', type: 'resistor', value: 470, image: crop('R1|'), window: { ...WIN } },
    { id: 'W1', kind: 'wire', type: 'wire', value: 0, image: crop('W1|'), window: { ...WIN } },
  ];
  const usageOf = { [items[0].image.split(',')[1]]: U1, [items[1].image.split(',')[1]]: U2 };
  // PHOTO_LEADS_BATCH=1: one call per item, so the two calls' usage still adds up (Task A3 batches 12 by default).
  process.env.PHOTO_LEADS_BATCH = '1';
  const idOf = { [items[0].image.split(',')[1]]: 'R1', [items[1].image.split(',')[1]]: 'W1' };
  const leads = id => ({ items: [{ id, found: true, conf: 0.8, leads: [{ pin: '1', point: [500, 250], hole: 'a1' }, { pin: '2', point: [500, 750], hole: 'a2' }] }] });
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    const body = JSON.parse(opts.body);
    const part = body.contents.flatMap(m => m.parts).find(p => p.inline_data || p.inlineData);
    const data = (part.inline_data || part.inlineData).data;
    return says(leads(idOf[data]), usageOf[data]);
  });
  const text = JSON.stringify({ key: 'no-saved-leads', items });
  const raw = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/photo/leads', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'X-Forwarded-For': freshIp(), Accept: 'application/x-ndjson' } }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => resolve(out));
    });
    req.on('error', reject);
    setTimeout(() => { req.destroy(); reject(new Error('no answer from /api/photo/leads after 5 s')); }, 5000);
    req.end(text);
  });
  delete process.env.PHOTO_LEADS_BATCH;
  const lines = raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const done = lines.find(l => l.done === true);
  assert.ok(done, `no { done: true } line: ${raw.slice(0, 300)}`);
  assert.deepStrictEqual(done.usage, { calls: 2, http429: 0, promptTokens: 2500, outputTokens: 300, thoughtTokens: 300 },
    `the done line: ${JSON.stringify(done)}`);
  const line = logs.find(l => l.startsWith('[photo-leads]')) || '(no [photo-leads] line)';
  assert.match(line, /\bcalls=2\b/, line);
  assert.match(line, /\b429s=0\b/, line);
  assert.match(line, /\btokens=2500\/300\/300\b/, line);
});

// ── 3. photo-eval ───────────────────────────────────────────────────────────

// A builder note: row, table and totals are private in scripts/photo-eval.js
// today; the builder exports them. Until then this test fails on its import.
test('photo-eval prints calls, 429s and cost', () => {
  for (const f of ['row', 'table', 'totals']) assert.equal(typeof Eval[f], 'function', `scripts/photo-eval.js does not export ${f}()`);
  const result = (id, boxUsage, leadsUsage) => ({
    id, run: 1, ms: 4000, placedMs: 9000, outcome: 'ok',
    net: {
      '/api/photo': { status: 200, provider: 'gemini', s: 3, usage: boxUsage },
      '/api/photo/leads': { status: 200, s: 6, items: { n: 2, timeout: 0, failed: 0 }, usage: leadsUsage },
    },
  });
  const a = result('p1',
    { calls: 2, http429: 1, promptTokens: 2000, outputTokens: 300, thoughtTokens: 100 },
    { calls: 3, http429: 0, promptTokens: 500, outputTokens: 100, thoughtTokens: 50 });
  const b = result('p2',
    { calls: 1, http429: 0, promptTokens: 1000, outputTokens: 200, thoughtTokens: 0 },
    { calls: 1, http429: 2, promptTokens: 1500, outputTokens: 0, thoughtTokens: 0 });

  const header = Eval.table([]).split('\n')[0].split(/\s{2,}/);
  for (const col of ['calls', '429', 'tok in', 'tok out']) assert.ok(header.includes(col), `the table header has no "${col}" column: ${JSON.stringify(header)}`);
  const cells = r => Object.fromEntries(Eval.row(r).map((c, i) => [Eval.table([]).split('\n')[0].split(/\s{2,}/)[i], String(c)]));
  // p1: calls 2+3, 429s 1+0, in 2000+500, out (thought included) 300+100+100+50.
  const ra = cells(a);
  assert.deepStrictEqual([ra.calls, ra['429'], ra['tok in'], ra['tok out']], ['5', '1', '2500', '550'], `p1's row: ${JSON.stringify(ra)}`);

  const t = Eval.totals([a, b]);
  assert.equal(t.calls, 7, `total calls: ${JSON.stringify(t)}`);
  assert.equal(t.http429, 3, `total 429s: ${JSON.stringify(t)}`);
  assert.equal(t.tokensIn, 5000, `total tokens in: ${JSON.stringify(t)}`);
  assert.equal(t.tokensOut, 750, `total tokens out, thought included: ${JSON.stringify(t)}`);
  // $1/M in, $5/M out: 5000/1e6 + 750/1e6 * 5 = 0.00875.
  assert.ok(Math.abs(t.costUsd - 0.00875) < 1e-9, `estimated cost: ${t.costUsd}`);
});

// ── 4. A7: which model answered, and an honest cost line ────────────────────
// Names the builder must use (the tests can't see photo-eval's output otherwise):
//   - table()'s header gains a 'model' column; row() puts 'er' there when
//     net['/api/photo'].model is the Robotics-ER model, 'fallback' for any other model.
//   - totals(results).fallbacks counts the surveys a non-ER model answered.
//   - totals(results).costText is the cost wording main() prints: it starts
//     "≥ $", then the amount, and says resent and aborted calls are billed but not counted.
test('photo-eval shows which model answered the survey, counts fallback answers, and says the cost is a floor', () => {
  const ER = 'gemini-robotics-er-2-preview', FB = 'gemini-3.1-flash-lite';
  const result = (id, model) => ({
    id, run: 1, ms: 4000, placedMs: 9000, outcome: 'ok',
    net: { '/api/photo': { status: 200, provider: 'gemini', model, s: 3, usage: { calls: 1, http429: 0, promptTokens: 1000, outputTokens: 200, thoughtTokens: 0 } } },
  });
  const header = Eval.table([]).split('\n')[0].split(/\s{2,}/);
  assert.ok(header.includes('model'), `the table header has no "model" column: ${JSON.stringify(header)}`);
  const cell = r => String(Eval.row(r)[header.indexOf('model')]);
  assert.equal(cell(result('p1', ER)), 'er');
  assert.equal(cell(result('p2', FB)), 'fallback');
  assert.equal(cell(result('p3', 'gemini-something-else')), 'fallback', 'anything but the ER model is a fallback answer');

  const t = Eval.totals([result('p1', ER), result('p2', FB), result('p3', FB)]);
  assert.equal(t.fallbacks, 2, `fallback answers: ${JSON.stringify(t)}`);
  assert.equal(Eval.totals([result('p1', ER)]).fallbacks, 0);
  assert.match(String(t.costText), /^≥ \$\d/, `cost text: ${t.costText}`);
  assert.match(String(t.costText), /resent and aborted calls.*not counted/i, `cost text: ${t.costText}`);
});
