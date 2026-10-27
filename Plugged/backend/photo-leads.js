// ─────────────────────────────────────────────────────────────
//  photo-leads.js — where each lead enters the board, for /api/photo/leads
//
//  readLeads({ key, items }, opts) asks Gemini about the labelled crops (the
//  page cuts them, photo-crops.js), batched (A3) and resolves
//  { items, provider, model, ms, resent, retries }: one entry per item, in
//  order, { id, found, leads: [{ pin, pt, role }], conf } or
//  { id, error: 'AI_TIMEOUT' | 'AI_FAILED' }. It never rejects. `resent`
//  (batches that got a stall resend) and `retries` (calls sent again after a
//  failure) are for the route's log only.
//  opts.onItem(entry) (#173) is called once per item as it settles, in
//  finish order, with the entry `items` will hold (a saved answer standing
//  in included); replays and the no-key path call it too. The route
//  streams these as NDJSON lines.
//
//  Items go out in batches of at most PHOTO_LEADS_BATCH (default 12), one
//  generateContent per batch, each crop outlined in magenta by the page
//  (Set-of-Mark). Each batch is a raceGemini (photo-reader.js, #172): a call
//  that fails at once is retried 1–2 s later (a 429's retryAfterMs
//  honoured); one with no answer after PHOTO_HEDGE_MS (default 12 s) gets
//  one identical call alongside; at most 3 calls a batch; a 400/401/403 is
//  never retried. At most PHOTO_LEADS_CONCURRENCY (default 2) batch
//  calls (first calls and retries) are in flight;
//  the rest wait their turn, in item order. A stall resend is exempt. An
//  item's line streams when its batch answers; ids outside the batch are
//  ignored and a skipped id is that item unanswered. At
//  PHOTO_LEADS_TIMEOUT_MS (default 40 s) every call is aborted and the items
//  unanswered or still waiting are AI_TIMEOUT.
//  opts.signal (#177; the route's, aborted when the page goes away) ends
//  the round the same way at once: every call aborted, none sent after,
//  the timers cleared, the unanswered items AI_TIMEOUT.
//  Gemini only: deepseek can't point. Timers are the global setTimeout, so
//  fake timers drive them.
//
//  Saved leads (test/fixtures/photo/leads/<key>.json = { key, model, items },
//  points already in flattened pixels):
//    a sample id with a file   answered from it straight away
//    an image hash (64 hex)    live; an item that fails takes its saved answer
//    PHOTO_PROVIDERS=fixture   replays only, never a fetch
//    PHOTO_RECORD=1            always live; saves the answered items
//  Never logs the key, a crop or a reply.
// ─────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const { GEMINI_BASE, photoGeminiModel, photoProviders, photoHedgeMs, geminiImagePart, geminiText, postJSON, raceGemini, newTally, usageOf,
        loadFixture, thinkingConfig, parseLooseJSON, isSafeId, failed, num, obj, list } = require('./photo-reader');
const { PHOTO_CROP_PROMPT_BATCH, PHOTO_CROP_SCHEMA_BATCH, cropShows } = require('./photo-prompt');

const LEADS_DIR      = path.join(__dirname, '..', 'test', 'fixtures', 'photo', 'leads');
const IMAGE_HASH     = /^[0-9a-f]{64}$/;
const ROLES          = ['anode', 'cathode', 'none', 'unknown'];
const CROP_MAX_CALLS = 3;

// Read per request, so a test (or a restart-free tweak) can change them.
const cutoffMs    = () => (Number(process.env.PHOTO_LEADS_TIMEOUT_MS) > 0 ? Number(process.env.PHOTO_LEADS_TIMEOUT_MS) : 40000);
// PHOTO_LEADS_CONCURRENCY: most batch calls (first calls and retries) in flight, default 2.
const concurrency = () => {
  const n = Math.floor(Number(process.env.PHOTO_LEADS_CONCURRENCY));
  return n >= 1 ? n : 2;
};
const batchSize   = () => {
  const n = Math.floor(Number(process.env.PHOTO_LEADS_BATCH));
  return n >= 1 ? n : 12;
};

const round1 = v => Math.round(v * 10) / 10 || 0;   // || 0: never -0
const isPt   = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

// Gemini's [y, x] on 0–1000 over the whole crop → crop pixels → the
// flattened image's pixels [x, y], through the crop's window.
function toFlattened([y, x], w) {
  const u = x / 1000 * w.width, v = y / 1000 * w.height;
  return [round1(w.x + (u - w.padLeft) / w.scale), round1(w.y + (v - w.padTop) / w.scale)];
}

// Resistor and wire legs have no direction; an LED's has one when Gemini
// named it.
function roleOf(item, pin) {
  if (item.kind === 'wire' || item.type === 'wire' || item.type === 'resistor') return 'none';
  const p = pin.trim().toLowerCase();
  return p === 'anode' || p === 'cathode' ? p : 'unknown';
}

// One reply's JSON → the item's entry. A bare list is taken: [{...}] is its
// first object, [["1", [y, x]], …] the leads. Throws when it isn't an answer.
function toEntry(item, answer) {
  let a = answer;
  if (Array.isArray(a)) a = a.some(Array.isArray) ? { leads: a } : a.find(x => x && typeof x === 'object');
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw failed('the reply is not an answer');
  if (!Array.isArray(a.leads) && a.found !== false) throw failed('the reply has no leads');
  const leads = list(a.leads).filter(Array.isArray).map(([pin, at]) => {
    const name = typeof pin === 'string' || typeof pin === 'number' ? String(pin) : '?';
    return { pin: name, pt: isPt(at) ? toFlattened(at, item.window) : null, role: roleOf(item, name) };
  });
  return { id: item.id, found: typeof a.found === 'boolean' ? a.found : leads.length > 0, leads, conf: num(a.conf) };
}

// That id's saved answer, or null.
function savedEntry(file, id) {
  const e = file && list(file.items).find(x => obj(x).id === id && Array.isArray(x.leads));
  if (!e) return null;
  return { id, found: e.found !== false, conf: num(e.conf),
    leads: e.leads.map(obj).map(l => ({ pin: String(l.pin), pt: isPt(l.pt) ? [l.pt[0], l.pt[1]] : null, role: ROLES.includes(l.role) ? l.role : 'unknown' })) };
}

// At most `cap` first calls and retries in flight; the rest wait their
// turn, first come first served, so the items' first calls go out in item
// order. A stall resend goes out at once, outside the cap. slot(run, kind):
// run() sends a call and returns its promise, or null when its item has ended.
function limiter(cap) {
  let busy = 0;
  const queue = [];
  const pump = () => {
    while (busy < cap && queue.length) {
      const p = queue.shift()();
      if (!p) continue;
      busy++;
      p.then(free, free);
    }
  };
  const free = () => { busy--; pump(); };
  return (run, kind) => {
    if (kind === 'resend') return run();
    queue.push(run);
    pump();
  };
}

// One batch reply's JSON → an entry per item of the batch, in order. Ids
// outside the batch are ignored; an item the reply skips (or answers
// unusably) is { id, error: 'AI_FAILED' }. Throws when the reply holds no
// items list at all.
function toBatchEntries(batch, answer) {
  const a = Array.isArray(answer) ? { items: answer } : answer;
  if (!a || typeof a !== 'object' || !Array.isArray(a.items)) throw failed('the reply is not a batch answer');
  const byId = new Map();
  for (const r of a.items) if (r && typeof r === 'object' && typeof r.id === 'string' && !byId.has(r.id)) byId.set(r.id, r);
  if (!batch.some(item => byId.has(item.id))) throw failed('no crop answered');   // retried by raceGemini
  return batch.map(item => {
    const r = byId.get(item.id);
    if (!r) return { id: item.id, error: 'AI_FAILED' };
    try {
      const leads = list(r.leads).map(obj).map(l => [l.pin, l.point]);
      return toEntry(item, { found: r.found, conf: r.conf, leads });
    } catch {
      return { id: item.id, error: 'AI_FAILED' };
    }
  });
}

// The batch's request: the instructions, then per crop its text and image.
function batchBody(batch) {
  const parts = [{ text: PHOTO_CROP_PROMPT_BATCH }];
  batch.forEach((item, k) => {
    parts.push({ text: `Crop ${k + 1}: id ${item.id}, ${cropShows(item)}, outlined in magenta` }, geminiImagePart(item.image));
  });
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: PHOTO_CROP_SCHEMA_BATCH(batch.map(i => i.id)), temperature: 1, maxOutputTokens: 32768, ...thinkingConfig() },
  };
}

// Every item live, in batches of batchSize() items, one call each, at most
// concurrency() first calls and retries at once. settle(entry) takes
// each item's live entry as its batch settles (so lines stream per batch)
// and returns the one to keep. signal (optional) ends the round as the
// cutoff does, at once. Resolves { entries, resent, retries, ok, usage },
// ok counting live answers.
async function askGemini(items, model, fetch, settle, signal) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('photo-leads: GEMINI_API_KEY is not set');
    return { entries: items.map(it => settle({ id: it.id, error: 'AI_FAILED' })), resent: 0, retries: 0, ok: 0, usage: usageOf() };
  }
  if (signal && signal.aborted) {   // nobody is listening: send nothing
    return { entries: items.map(it => settle({ id: it.id, error: 'AI_TIMEOUT' })), resent: 0, retries: 0, ok: 0, usage: usageOf() };
  }
  const tally = newTally();
  const who = `gemini ${model}`, url = `${GEMINI_BASE}${model}:generateContent`;
  const slot = limiter(concurrency()), hedgeMs = photoHedgeMs(), deadlineAt = Date.now() + cutoffMs();
  const size = batchSize(), batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const runs = batches.map(batch => {
    const body = batchBody(batch);
    const call = async signal => {
      const data = await postJSON({ fetch, tally }, signal, who, url, { 'x-goog-api-key': apiKey }, body);
      return toBatchEntries(batch, parseLooseJSON(geminiText(data, who)));
    };
    return raceGemini(call, { maxCalls: CROP_MAX_CALLS, hedgeMs, deadlineAt, slot });
  });
  const late    = Object.assign(new Error('past the crop round\'s cutoff'), { code: 'AI_TIMEOUT' });
  const gone    = Object.assign(new Error('the page stopped listening'), { code: 'AI_TIMEOUT' });
  const cutoff  = setTimeout(() => runs.forEach(r => r.stop(late)), cutoffMs());
  const onAbort = () => { clearTimeout(cutoff); runs.forEach(r => r.stop(gone)); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  let lost = 0;   // the items with no live answer
  const lostRuns = new Set();
  const perBatch = await Promise.all(runs.map((r, bi) => r.result
    .catch(e => batches[bi].map(it => ({ id: it.id, error: e && e.code === 'AI_TIMEOUT' ? 'AI_TIMEOUT' : 'AI_FAILED' })))
    .then(es => es.map(e => { if (e.error) { lost++; lostRuns.add(bi); } return settle(e); }))));
  clearTimeout(cutoff);
  if (signal) signal.removeEventListener('abort', onAbort);

  const whys = [...new Set(runs.filter((r, i) => lostRuns.has(i) && r.stats.why).map(r => r.stats.why))];
  if (whys.length) console.warn(`photo-leads: ${lost} item(s) unanswered: ${whys.join('; ')}`);
  return { entries: perBatch.flat(), resent: runs.filter(r => r.stats.resent).length, retries: runs.reduce((n, r) => n + r.stats.retries, 0),
           ok: items.length - lost, usage: usageOf(tally) };
}

function record(dir, key, model, items) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${key}.json`), `${JSON.stringify({ key, model, items }, null, 2)}\n`);
  } catch (e) {
    console.warn('photo-leads: could not save the leads:', e.message);
  }
}

// body: { key, items: [{ id, kind, type, value, image, window }] }, already
// checked by the route. opts: { fetch, fixturesDir, onItem, signal }.
async function readLeads(body, opts = {}) {
  const started     = Date.now();
  const { key }     = obj(body);
  const items       = list(obj(body).items);
  const fixturesDir = opts.fixturesDir || LEADS_DIR;
  const file        = isSafeId(key) ? loadFixture(fixturesDir, key) : null;
  const names       = photoProviders();
  const replayOnly  = names.length === 1 && names[0] === 'fixture';
  const recording   = process.env.PHOTO_RECORD === '1';
  const done = (out, provider, model, resent = 0, retries = 0, usage = usageOf()) => ({ items: out, provider, model, ms: Date.now() - started, resent, retries, usage });
  const report = e => {   // the caller's onItem never breaks the round
    try { if (typeof opts.onItem === 'function') opts.onItem(e); } catch (err) { console.warn('photo-leads: onItem threw:', err.message); }
    return e;
  };

  if (replayOnly || (file && !IMAGE_HASH.test(key) && !recording)) {
    return done(items.map(it => report(savedEntry(file, it.id) || { id: it.id, error: 'AI_FAILED' })), 'fixture', file ? file.model : null);
  }

  // An item that fails live takes its saved answer, when the file has one.
  let fromFile = 0;
  const settle = e => {
    const saved = e.error && savedEntry(file, e.id);
    if (saved) fromFile++;
    return report(saved || e);
  };
  const model = photoGeminiModel();
  const live  = await askGemini(items, model, opts.fetch || globalThis.fetch, settle, opts.signal);
  const out   = live.entries;
  if (recording && live.ok && isSafeId(key)) record(fixturesDir, key, model, out.filter(e => !e.error));
  return live.ok === 0 && fromFile ? done(out, 'fixture', file.model, live.resent, live.retries, live.usage)
    : done(out, 'gemini', model, live.resent, live.retries, live.usage);
}

module.exports = { readLeads };
