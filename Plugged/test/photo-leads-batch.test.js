// Task A3 (photo fix, Part A): the crop round sends batched calls, not one
// call per item. backend/photo-leads.js readLeads(body, opts) keeps its
// contract ({ items, provider, model, ms, resent, retries, usage }, one
// opts.onItem per item, never rejects) but groups the items into batches of
// at most PHOTO_LEADS_BATCH (env, default 12), one generateContent per batch,
// at most 2 batches in flight. Every test uses a fake fetch: no network, no
// key, never a real AI.
//
// A batch request's contents.parts = [instructions, then for each item k
// (1-based): { text: "Crop k: id <id>, <what it shows>, outlined in magenta" }
// followed by that item's image part]. The reply is
//   { items: [{ id, found, conf, leads: [{ pin, point: [y, x] | null, hole }] }] }
// with the points on 0-1000 over that item's own crop; they map back through
// that item's own `window` exactly as the single-crop path does.
// The browser side (render() drawing the magenta box outline) is e2e only:
// e2e/photo-crops.spec.js, since render() needs a canvas.

const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const WIN_R1 = { x: 400, y: 150, scale: 3, padLeft: 60, padTop: 40, width: 900, height: 600 };
const WIN_W1 = { x: 1200.5, y: 80, scale: 2.5, padLeft: 45, padTop: 45, width: 700, height: 1000 };
const WIN    = { x: 0, y: 0, scale: 3, padLeft: 27, padTop: 27, width: 600, height: 400 };

const crop = seed => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, seed)]).toString('base64')}`;
const b64  = dataUrl => dataUrl.slice(dataUrl.indexOf(',') + 1);
function item(id, extra = {}) {
  const kind = /^W/.test(id) ? 'wire' : 'part';
  const type = kind === 'wire' ? 'wire' : /^LED/.test(id) ? 'led' : 'resistor';
  return { id, kind, type, value: type === 'resistor' ? 470 : 0, image: crop(`${id}|`), window: { ...WIN }, ...extra };
}
const many = (n, prefix = 'R') => Array.from({ length: n }, (_, i) => item(`${prefix}${i + 1}`));

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, statusText: '', headers: new Headers({ 'content-type': 'application/json' }),
  text: async () => JSON.stringify(body), json: async () => body });
const geminiSays = (answer, usageMetadata) => reply(200, { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }],
  ...(usageMetadata ? { usageMetadata } : {}) });
const status429 = () => reply(429, { error: { code: 429, message: 'upstream 429' } });

// One item's batch answer: two legs, at [500, 250] and [500, 750].
const leg  = (pin, point) => ({ pin, point, hole: 'a1' });
const good = id => ({ id, found: true, conf: 0.9, leads: [leg('1', [500, 250]), leg('2', [500, 750])] });
const batchAnswer = ids => geminiSays({ items: ids.map(good) });

const partsOf = body => ((body && body.contents) || []).flatMap(m => (m && m.parts) || []);
const isImage = p => p && (p.inline_data || p.inlineData);
// The ids a batch request names, in order, from its "Crop k: id <id>" parts.
const idsOf = body => partsOf(body).filter(p => typeof p.text === 'string')
  .map(p => /^Crop \d+: id ([^,\s]+)/.exec(p.text)).filter(Boolean).map(m => m[1]);

// answerFor(call) → a reply, a promise of one, or throws. call = { ids, body, signal, n }.
function fakeGemini(answerFor) {
  const calls = [];
  let inFlight = 0, maxInFlight = 0;
  const fetch = (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith(GEMINI_BASE)) return Promise.reject(new Error(`unexpected URL: ${u}`));
    let body = null;
    try { body = JSON.parse(opts.body); } catch { /* the asserts report it */ }
    const call = { ids: idsOf(body), body, signal: opts.signal, n: calls.length + 1, at: Date.now() };
    calls.push(call);
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    return new Promise((resolve, reject) => {
      const signal = opts.signal;
      const abort = () => reject(signal.reason || new DOMException('aborted', 'AbortError'));
      if (signal && signal.aborted) return abort();
      if (signal) signal.addEventListener('abort', abort, { once: true });
      let out;
      try { out = answerFor(call); } catch (e) { return reject(e); }
      Promise.resolve(out).then(resolve, reject);
    }).finally(() => { inFlight--; });
  };
  return { fetch, calls, get maxInFlight() { return maxInFlight; } };
}

const FAKE = { toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] };
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const advance = async ms => { await vi.advanceTimersByTimeAsync(ms); await flush(); };
let emptyDir, savedEnv;

function start(body, fake, opts = {}) {
  const { readLeads } = require('../backend/photo-leads.js');
  if (!vi.isFakeTimers()) vi.useFakeTimers(FAKE);
  const s = { done: false };
  s.promise = readLeads(body, { fetch: fake.fetch, fixturesDir: emptyDir, ...opts });
  Promise.resolve(s.promise).then(v => { s.done = true; s.value = v; }, e => { s.done = true; s.error = e; });
  return s;
}
async function finish(s, limit = 40000) {
  for (let t = 0; t < limit && !s.done; t += 500) await advance(500);
  await flush();
  assert.ok(s.done, `readLeads had not resolved after ${limit / 1000} s`);
  assert.ok(!s.error, `readLeads rejected: ${s.error && s.error.message}`);
  return s.value;
}
const readAll = (body, fake, opts) => finish(start(body, fake, opts));
const byId = (out, id) => out.items.find(x => x.id === id);

beforeAll(() => { emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-leads-batch-')); });
afterAll(() => { fs.rmSync(emptyDir, { recursive: true, force: true }); });
beforeEach(() => {
  savedEnv = Object.fromEntries(['GEMINI_API_KEY', 'PHOTO_BATCH', 'PHOTO_LEADS_BATCH', 'PHOTO_PROVIDERS', 'PHOTO_RECORD', 'PHOTO_HEDGE_MS',
    'PHOTO_LEADS_TIMEOUT_MS', 'PHOTO_LEADS_CONCURRENCY'].map(k => [k, process.env[k]]));
  process.env.GEMINI_API_KEY = 'test-gemini-key-a3';
  for (const k of ['PHOTO_LEADS_BATCH', 'PHOTO_PROVIDERS', 'PHOTO_RECORD', 'PHOTO_HEDGE_MS', 'PHOTO_LEADS_TIMEOUT_MS', 'PHOTO_LEADS_CONCURRENCY']) delete process.env[k];
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('17 items go out as 2 calls, not 17', async () => {
  const items = many(17);
  const fake = fakeGemini(c => batchAnswer(c.ids));
  const out = await readAll({ key: 'no-saved-leads', items }, fake);
  assert.equal(fake.calls.length, 2, `calls sent: ${fake.calls.map(c => c.ids.length)}`);
  assert.deepStrictEqual(fake.calls.map(c => c.ids.length).sort((a, b) => b - a), [12, 5]);
  assert.deepStrictEqual(fake.calls[0].ids, items.slice(0, 12).map(i => i.id), 'the first batch is the first 12, in item order');
  assert.deepStrictEqual(out.items.map(e => e.id), items.map(i => i.id), 'one entry per item, in request order');
  assert.ok(out.items.every(e => e.found === true && !e.error), JSON.stringify(out.items.filter(e => e.error)));
});

test('PHOTO_LEADS_BATCH sets the batch size', async () => {
  process.env.PHOTO_LEADS_BATCH = '5';
  const fake = fakeGemini(c => batchAnswer(c.ids));
  await readAll({ key: 'no-saved-leads', items: many(11) }, fake);
  assert.deepStrictEqual(fake.calls.map(c => c.ids.length).sort(), [1, 5, 5]);
});

test('each item\'s line streams when its batch answers', async () => {
  const items = many(17);
  const fake = fakeGemini(c => (c.ids.length === 12 ? batchAnswer(c.ids) : new Promise(r => setTimeout(() => r(batchAnswer(c.ids)), 5000))));
  const seen = [];
  const s = start({ key: 'no-saved-leads', items }, fake, { onItem: e => seen.push({ id: e.id, at: Date.now() }) });
  const t0 = Date.now();
  await advance(1000);
  assert.deepStrictEqual(seen.map(x => x.id), items.slice(0, 12).map(i => i.id), 'the answered batch\'s 12 items stream while the other batch is still out');
  assert.ok(!s.done, 'readLeads waits for the second batch');
  await advance(4500);
  const out = await finish(s);
  assert.equal(seen.length, 17, 'onItem once per item');
  assert.deepStrictEqual(seen.slice(12).map(x => x.id).sort(), items.slice(12).map(i => i.id).sort());
  assert.ok(seen.slice(12).every(x => x.at - t0 >= 5000), 'the late batch\'s items stream when it answers, not before');
  for (const x of seen) assert.deepStrictEqual(out.items.find(e => e.id === x.id).id, x.id);
});

test('a failed batch only fails its own items', async () => {
  const items = many(17);
  // Without a saved file: the second batch (R13..R17) gets 429 on every call.
  const fake = fakeGemini(c => (c.ids.includes('R13') ? status429() : batchAnswer(c.ids)));
  const seen = [];
  const out = await readAll({ key: 'no-saved-leads', items }, fake, { onItem: e => seen.push(e.id) });
  for (const it of items.slice(0, 12)) assert.equal(byId(out, it.id).found, true, `${it.id} is in the good batch`);
  for (const it of items.slice(12)) assert.equal(byId(out, it.id).error, 'AI_FAILED', `${it.id} is in the 429 batch`);
  assert.equal(fake.calls.filter(c => c.ids.includes('R13')).length, 3, 'the failing batch is tried 3 times (raceGemini\'s cap), no more');
  assert.equal(seen.length, 17, 'onItem once per item');

  // With a saved file for an image-hash key: the failed batch's items take their saved answers.
  const key = 'a'.repeat(64);
  fs.writeFileSync(path.join(emptyDir, `${key}.json`), JSON.stringify({ key, model: 'm', items: [
    { id: 'R13', found: true, conf: 0.7, leads: [{ pin: '1', pt: [11, 22], role: 'none' }, { pin: '2', pt: [33, 44], role: 'none' }] }] }));
  const fake2 = fakeGemini(c => (c.ids.includes('R13') ? status429() : batchAnswer(c.ids)));
  const out2 = await readAll({ key, items }, fake2);
  assert.deepStrictEqual(byId(out2, 'R13').leads.map(l => l.pt), [[11, 22], [33, 44]], 'a saved answer stands in for R13');
  assert.equal(byId(out2, 'R14').error, 'AI_FAILED', 'an item with no saved answer errors');
  assert.equal(byId(out2, 'R1').found, true);
});

test('ids outside the batch are dropped and missing ids are unanswered', async () => {
  const items = [item('R1'), item('R2'), item('R3')];
  const fake = fakeGemini(() => geminiSays({ items: [good('R1'), good('ZZ9'), good('R2')] }));   // invents ZZ9, skips R3
  const seen = [];
  const out = await readAll({ key: 'no-saved-leads', items }, fake, { onItem: e => seen.push(e.id) });
  assert.deepStrictEqual(out.items.map(e => e.id), ['R1', 'R2', 'R3'], 'only the requested ids, in order');
  assert.equal(byId(out, 'R1').found, true);
  assert.equal(byId(out, 'R2').found, true);
  assert.equal(byId(out, 'R3').error, 'AI_FAILED', 'the skipped id is unanswered');
  assert.deepStrictEqual([...seen].sort(), ['R1', 'R2', 'R3'], 'onItem once per requested id, never for ZZ9');
});

test('points map back through each item\'s window', async () => {
  const items = [item('R1', { window: WIN_R1 }), item('W1', { window: WIN_W1 })];
  const fake = fakeGemini(() => geminiSays({ items: [
    { id: 'R1', found: true, conf: 0.9, leads: [leg('1', [500, 250]), leg('2', [500, 750])] },
    { id: 'W1', found: true, conf: 0.8, leads: [leg('1', [100, 900]), leg('2', null)] }] }));
  const out = await readAll({ key: 'no-saved-leads', items }, fake);
  // (x/1000*width, y/1000*height) -> win.x + (u - padLeft)/scale, rounded to 0.1
  assert.deepStrictEqual(byId(out, 'R1').leads.map(l => l.pt), [[455, 236.7], [605, 236.7]]);
  assert.deepStrictEqual(byId(out, 'W1').leads.map(l => l.pt), [[1434.5, 102], null]);
  assert.deepStrictEqual(byId(out, 'R1').leads.map(l => l.role), ['none', 'none']);
});

test('never more than 2 batches in flight', async () => {
  const items = many(30);
  const waiting = [];
  const fake = fakeGemini(c => new Promise(r => waiting.push(() => r(batchAnswer(c.ids)))));
  const s = start({ key: 'no-saved-leads', items }, fake);
  await advance(100);
  assert.equal(fake.calls.length, 2, `two batches go out at once, the third waits: ${fake.calls.length}`);
  waiting.shift()();
  await advance(100);
  assert.equal(fake.calls.length, 3, 'the third batch goes out when one finishes');
  while (!s.done) { while (waiting.length) waiting.shift()(); await advance(100); }
  const out = await finish(s);
  assert.equal(fake.maxInFlight, 2, `most in flight at once: ${fake.maxInFlight}`);
  assert.deepStrictEqual(fake.calls.map(c => c.ids.length), [12, 12, 6]);
  assert.ok(out.items.every(e => e.found === true));
});

test('the batch prompt names every crop and its outline', async () => {
  const items = [item('R1', { window: WIN_R1 }), item('LED1'), item('W1', { window: WIN_W1 })];
  const fake = fakeGemini(c => batchAnswer(c.ids));
  await readAll({ key: 'no-saved-leads', items }, fake);
  assert.equal(fake.calls.length, 1);
  const body = fake.calls[0].body, parts = partsOf(body);
  assert.equal(parts.length, 1 + 2 * items.length, 'instructions, then a text part and an image part per item');
  assert.equal(typeof parts[0].text, 'string', 'the instructions come first');
  items.forEach((it, i) => {
    const text = parts[1 + 2 * i], img = parts[2 + 2 * i];
    assert.ok(text && typeof text.text === 'string', `part ${1 + 2 * i} is the text for ${it.id}`);
    assert.ok(text.text.startsWith(`Crop ${i + 1}: id ${it.id}`), `crop ${i + 1} is named: ${text.text}`);
    assert.ok(text.text.includes('outlined in magenta'), `crop ${i + 1} names its outline: ${text.text}`);
    assert.ok(isImage(img), `part ${2 + 2 * i} is ${it.id}'s image`);
    assert.equal((img.inline_data || img.inlineData).data, b64(it.image), `${it.id}'s own crop follows its text`);
  });
  const gc = body.generationConfig || {};
  assert.equal(gc.responseMimeType, 'application/json');
  const schema = JSON.stringify(gc.responseSchema);
  assert.ok(!schema.includes('anyOf'), 'the batch schema is plain objects, no anyOf');
  for (const it of items) assert.ok(schema.includes(`"${it.id}"`), `the schema's id enum holds ${it.id}: ${schema.slice(0, 300)}`);
});

test('usage counts one call per batch', async () => {
  const fake = fakeGemini(c => geminiSays({ items: c.ids.map(good) }, { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 50 }));
  const out = await readAll({ key: 'no-saved-leads', items: many(17) }, fake);
  assert.equal(out.usage.calls, 2, JSON.stringify(out.usage));
  assert.equal(out.usage.promptTokens, 2000, JSON.stringify(out.usage));
  assert.equal(out.usage.outputTokens, 200);
  assert.equal(out.usage.thoughtTokens, 100);
});

test('PHOTO_LEADS_CONCURRENCY caps batch calls in flight', async () => {
  for (const [cap, want] of [[undefined, 2], ['1', 1], ['3', 3]]) {
    if (cap === undefined) delete process.env.PHOTO_LEADS_CONCURRENCY;
    else process.env.PHOTO_LEADS_CONCURRENCY = cap;
    process.env.PHOTO_LEADS_BATCH = '5';   // 30 items -> 6 batches
    const waiting = [];
    const fake = fakeGemini(c => new Promise(r => waiting.push(() => r(batchAnswer(c.ids)))));
    const s = start({ key: 'no-saved-leads', items: many(30) }, fake);
    await advance(100);
    assert.equal(fake.calls.length, want, `cap ${cap || 'default'}: ${fake.calls.length} batch calls out at the start, expected ${want}`);
    while (!s.done) { while (waiting.length) waiting.shift()(); await advance(100); }
    const out = await finish(s);
    assert.equal(fake.maxInFlight, want, `cap ${cap || 'default'}: most in flight at once: ${fake.maxInFlight}`);
    assert.equal(fake.calls.length, 6, 'every batch is sent once');
    assert.ok(out.items.every(e => e.found === true));
    vi.useRealTimers();
  }
});

test('a hanging batch is resent once and the cutoff ends all its items AI_TIMEOUT exactly once', async () => {
  process.env.PHOTO_LEADS_BATCH = '3';
  const items = many(6);
  const fake = fakeGemini(c => (c.ids.includes('R1') ? new Promise(() => {}) : batchAnswer(c.ids)));
  const seen = [];
  const s = start({ key: 'no-saved-leads', items }, fake, { onItem: e => seen.push(e.id) });
  await advance(11999);
  assert.equal(fake.calls.filter(c => c.ids.includes('R1')).length, 1, 'no resend before 12 s');
  await advance(1);
  assert.equal(fake.calls.filter(c => c.ids.includes('R1')).length, 2, 'the hanging batch is resent once at 12 s');
  const out = await finish(s);
  const sent = fake.calls.length;
  for (const id of ['R1', 'R2', 'R3']) assert.deepStrictEqual(byId(out, id), { id, error: 'AI_TIMEOUT' });
  for (const id of ['R4', 'R5', 'R6']) assert.equal(byId(out, id).found, true, `${id} is in the answered batch`);
  assert.deepStrictEqual([...seen].sort(), items.map(i => i.id).sort(), 'onItem once per id');
  await advance(60000);
  assert.equal(fake.calls.length, sent, 'no call after the cutoff');
  assert.equal(seen.length, 6, 'still once per id after the cutoff');
  for (const c of fake.calls.filter(c => c.ids.includes('R1'))) assert.ok(c.signal.aborted, 'both calls of the hanging batch are aborted');
});

test('an abort leaves a queued batch unsent', async () => {
  process.env.PHOTO_LEADS_BATCH = '3';
  process.env.PHOTO_LEADS_CONCURRENCY = '1';
  const items = many(6);
  const fake = fakeGemini(() => new Promise(() => {}));
  const seen = [];
  const ac = new AbortController();
  const s = start({ key: 'no-saved-leads', items }, fake, { signal: ac.signal, onItem: e => seen.push(e.id) });
  await advance(100);
  assert.deepStrictEqual(fake.calls.map(c => c.ids), [['R1', 'R2', 'R3']], 'cap 1: the second batch waits');
  ac.abort();
  const out = await finish(s, 1000);
  await advance(60000);
  assert.deepStrictEqual(fake.calls.map(c => c.ids), [['R1', 'R2', 'R3']], 'the queued batch is never fetched');
  assert.deepStrictEqual(out.items, items.map(i => ({ id: i.id, error: 'AI_TIMEOUT' })));
  assert.deepStrictEqual([...seen].sort(), items.map(i => i.id).sort(), 'onItem once per id');
});

test('a batch answer naming none of its ids is retried', async () => {
  process.env.PHOTO_LEADS_BATCH = '3';
  const items = many(3);
  const fake = fakeGemini(c => (c.n === 1 ? geminiSays({ items: [] }) : batchAnswer(c.ids)));
  const seen = [];
  const out = await readAll({ key: 'no-saved-leads', items }, fake, { onItem: e => seen.push(e.id) });
  assert.equal(fake.calls.length, 2, `an empty answer is retried once: ${fake.calls.length} calls`);
  assert.ok(out.items.every(e => e.found === true), JSON.stringify(out.items));
  assert.deepStrictEqual([...seen].sort(), ['R1', 'R2', 'R3'], 'every item answered once');
});
