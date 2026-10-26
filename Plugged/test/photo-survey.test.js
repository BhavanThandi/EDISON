// Task A4 (photo fix, Part A): the box round becomes a "survey". Each item may
// carry lead POINTS and chip facts, and Reading v1.1 keeps part types and more
// than 2 leads. Every test uses a fake fetch: no network, no key, no real AI.
//
// Shapes these tests assume (inferred from the A4 brief; the builder matches):
// - The Gemini answer's item: { type, value, conf, box_2d, leads?: [{ pin, point: [y, x] }],
//   pins?, notch?: 'left'|'right'|'unsure', label?: string|null }; box_2d and
//   point both on 0-1000 over the whole flattened image (x px = xn/1000 * grid.width).
// - boxesToReading: an item with leads sets the part's (or wire's) leads to those
//   points as { hole: '?', pt: [x, y] px, role: 'unknown' }, plus `pin` (the survey's
//   pin label, a string) on each lead of a part that has pins. No leads → today's
//   short-edge midpoints. The type is kept for ic, capacitor, potentiometer, diode,
//   button; anything else is still 'other'. The part gets pins, notch, label.
// - Off-board is decided by the page's PhotoGrid.snap ('off'); the server never throws
//   on a point outside the image and keeps it as is.
// - PHOTO_THINKING = default|high|medium|low. Unset or 'default': no thinking field.
//   Otherwise generationConfig.thinkingConfig.thinkingLevel (Gemini's REST field;
//   the repo has no earlier precedent) is that level, on the box and the crop call.

const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const Reader = require('../backend/photo-reader.js');
const PhotoGrid  = require('../circuit3d/js/photo-grid.js');
const PhotoCrops = require('../circuit3d/js/photo-crops.js');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const GRID = { cols: 63, pitch: 30, x0: 90, y0: 190, width: 2040, height: 710 };
const B64  = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 'p')]).toString('base64');
const IMG  = `data:image/jpeg;base64,${B64}`;
const RAILS = { aOuter: '+', aInner: '-', jInner: '+', jOuter: '-' };

let emptyDir, savedEnv;
const ENV_KEYS = ['GEMINI_API_KEY', 'PHOTO_GEMINI_MODEL', 'PHOTO_PROVIDERS', 'PHOTO_RECORD', 'PHOTO_THINKING', 'PHOTO_HEDGE_MS',
  'PHOTO_TIMEOUT_MS', 'PHOTO_FALLBACK_MODEL', 'PHOTO_FALLBACK_AT_MS'];
beforeAll(() => { emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-survey-')); });
afterAll(() => fs.rmSync(emptyDir, { recursive: true, force: true }));
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.GEMINI_API_KEY = 'test-gemini-key-a4';
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

// A fake Gemini that answers every call with `answer` and records each request body.
function fakeGemini(answer) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    assert.ok(String(url).startsWith(GEMINI_BASE), `unexpected URL ${url}`);
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    const body = { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }] };
    return { ok: true, status: 200, statusText: '', headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(body), json: async () => body };
  };
  return { fetch, calls };
}
const survey = items => ({ rails: RAILS, items });
const readSurvey = async items => {
  const fake = fakeGemini(survey(items));
  const out = await Reader.readPhoto({ image: IMG, grid: GRID }, { providers: ['gemini'], fetch: fake.fetch, fixturesDir: emptyDir });
  return { out, fake };
};
const close = (got, want, what, tol = 1) => {
  assert.ok(Array.isArray(got) && got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) <= tol),
    `${what}: got ${JSON.stringify(got)}, expected about ${JSON.stringify(want)}`);
};
// Survey point [y, x] on 0-1000 → flattened px [x, y].
const px = ([y, x]) => [x / 1000 * GRID.width, y / 1000 * GRID.height];

test('survey points replace box-end placeholders', async () => {
  const { out } = await readSurvey([
    // box is wide: placeholders would be the left/right edge midpoints at y = 500 → px [408, 355] and [612, 355].
    { type: 'resistor', value: 470, conf: 0.9, box_2d: [450, 200, 550, 300], leads: [{ pin: '1', point: [430, 210] }, { pin: '2', point: [560, 290] }] },
    { type: 'resistor', value: 1000, conf: 0.9, box_2d: [450, 600, 550, 700] },   // no points: today's placeholders
  ]);
  const [r1, r2] = out.reading.parts;
  assert.equal(r1.leads.length, 2);
  close(r1.leads[0].pt, px([430, 210]), 'R1 lead 1');
  close(r1.leads[1].pt, px([560, 290]), 'R1 lead 2');
  for (const l of r1.leads) assert.equal(l.hole, '?', 'the page snaps it, the server does not name a hole');
  assert.equal(r2.leads.length, 2);
  close(r2.leads[0].pt, [600 / 1000 * GRID.width, 500 / 1000 * GRID.height], 'R2 placeholder 1');
  close(r2.leads[1].pt, [700 / 1000 * GRID.width, 500 / 1000 * GRID.height], 'R2 placeholder 2');
});

test('survey points also set a wire\'s two ends', async () => {
  const { out } = await readSurvey([
    { type: 'wire', value: null, conf: 0.8, box_2d: [100, 100, 400, 140], leads: [{ pin: '1', point: [110, 105] }, { pin: '2', point: [390, 135] }] },
  ]);
  const w = out.reading.wires[0];
  close(w.ends[0].pt, px([110, 105]), 'wire end 1');
  close(w.ends[1].pt, px([390, 135]), 'wire end 2');
});

test('an ic keeps its type, pins, notch, label and its two pin points', async () => {
  const { out } = await readSurvey([
    { type: 'ic', value: null, conf: 0.9, box_2d: [300, 400, 420, 500], pins: 8, notch: 'left', label: 'TL072CP',
      leads: [{ pin: '1', point: [410, 405] }, { pin: '4', point: [410, 495] }] },
  ]);
  assert.equal(out.reading.parts.length, 1);
  const ic = out.reading.parts[0];
  assert.equal(ic.type, 'ic', 'the survey type is kept, not collapsed to other');
  assert.equal(ic.pins, 8);
  assert.equal(ic.notch, 'left');
  assert.equal(ic.label, 'TL072CP');
  assert.equal(ic.leads.length, 2);
  assert.deepStrictEqual(ic.leads.map(l => l.pin), ['1', '4']);
  close(ic.leads[0].pt, px([410, 405]), 'pin 1 point');
  close(ic.leads[1].pt, px([410, 495]), 'pin 4 point');
});

test('the survey type is kept for capacitor, diode and button (2 leads each); an unknown type is still other', async () => {
  const two = (type, y) => ({ type, value: null, conf: 0.8, box_2d: [y, 100, y + 40, 160], leads: [{ pin: '1', point: [y + 20, 105] }, { pin: '2', point: [y + 20, 155] }] });
  const { out } = await readSurvey([two('capacitor', 100), two('diode', 200), two('button', 300), two('gizmo', 400)]);
  assert.deepStrictEqual(out.reading.parts.map(p => p.type), ['capacitor', 'diode', 'button', 'other']);
  for (const p of out.reading.parts) assert.equal(p.leads.length, 2);
});

test('a pot keeps three leads', async () => {
  const pts = [[600, 700], [600, 740], [600, 780]];
  const { out } = await readSurvey([
    { type: 'potentiometer', value: '10k', conf: 0.8, box_2d: [560, 680, 660, 800], leads: pts.map((point, i) => ({ pin: String(i + 1), point })) },
  ]);
  const pot = out.reading.parts[0];
  assert.equal(pot.type, 'potentiometer');
  assert.equal(pot.leads.length, 3, 'the 2-lead cap is gone');
  pts.forEach((p, i) => close(pot.leads[i].pt, px(p), `pot lead ${i + 1}`));
});

test('survey points off the board become off: the reader keeps them, never throws, and the page\'s snap says off', async () => {
  const far = [[1200, -50], [500, 10]];   // below and left of the image; and inside the image but left of column 1
  const { out } = await readSurvey([
    { type: 'resistor', value: 100, conf: 0.5, box_2d: [450, 400, 550, 500], leads: far.map((point, i) => ({ pin: String(i + 1), point })) },
  ]);
  const r = out.reading.parts[0];
  assert.equal(r.leads.length, 2);
  r.leads.forEach((l, i) => close(l.pt, px(far[i]), `lead ${i + 1} kept where the AI said`));
  const grid = PhotoGrid.homography({ a1: [90, 190], a63: [1950, 190], j63: [1950, 520], j1: [90, 520] }, 63);
  for (const l of r.leads) assert.equal(grid.snap(l.pt).hole, 'off', `snap(${JSON.stringify(l.pt)})`);
});

test('a v1 reading validates as before', () => {
  const dir = path.join(__dirname, 'fixtures', 'photo');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 4, 'recorded readings found');
  for (const f of files) {
    const saved = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.deepStrictEqual(Reader.validateReading(saved.reading).reading, saved.reading, `${f} is unchanged by validateReading`);
  }
  const v1 = { board: { visible: true, cols: 63, rails: RAILS, split: false }, wires: [], power: [],
    parts: [{ id: 'X1', type: 'other', what: 'part', value: 0, bands: [], color: '', box: [1, 2, 3, 4], confidence: 0.5, unsure: [],
      leads: [{ hole: '?', pt: [1, 2], role: 'unknown' }, { hole: 'a1', pt: [3, 4], role: 'unknown' }] }] };
  assert.deepStrictEqual(Reader.validateReading(v1).reading, v1);
});

test('validateReading (v1.1) keeps the new types, the chip fields and up to 16 leads', () => {
  const lead = i => ({ hole: '?', pt: [10 * i, 20], role: 'unknown', pin: String(i + 1) });
  const raw = { board: { visible: true, cols: 63, rails: RAILS, split: false }, wires: [], power: [],
    parts: [{ id: 'U1', type: 'ic', what: 'TL072CP ic', value: 0, bands: [], color: '', box: [1, 2, 30, 40], confidence: 0.9, unsure: [],
      pins: 16, notch: 'right', label: 'CD4017', leads: Array.from({ length: 16 }, (_, i) => lead(i)) }] };
  const p = Reader.validateReading(raw).reading.parts[0];
  assert.equal(p.type, 'ic');
  assert.equal(p.pins, 16);
  assert.equal(p.notch, 'right');
  assert.equal(p.label, 'CD4017');
  assert.equal(p.leads.length, 16);
  for (const t of ['capacitor', 'potentiometer', 'diode', 'button']) {
    assert.equal(Reader.validateReading({ ...raw, parts: [{ ...raw.parts[0], type: t, leads: [lead(0), lead(1), lead(2)] }] }).reading.parts[0].type, t, t);
  }
});

test('PHOTO_THINKING=medium sets the thinking level on both rounds; unset or default leaves it out', async () => {
  const levelOf = body => ((body.generationConfig || {}).thinkingConfig || {}).thinkingLevel;
  const crops = { key: 'no-saved-leads', items: [{ id: 'R1', kind: 'part', type: 'resistor', value: 470, image: IMG,
    window: { x: 0, y: 0, scale: 3, padLeft: 27, padTop: 27, width: 600, height: 400 } }] };
  const cropAnswer = { items: [{ id: 'R1', found: true, conf: 0.9, leads: [{ pin: '1', point: [500, 250], hole: 'a1' }, { pin: '2', point: [500, 750], hole: 'a2' }] }] };
  const { readLeads } = require('../backend/photo-leads.js');
  const both = async () => {
    const box = await readSurvey([]);
    const fake = fakeGemini(cropAnswer);
    await readLeads(crops, { fetch: fake.fetch, fixturesDir: emptyDir });
    return { box: box.fake.calls, crop: fake.calls };
  };

  process.env.PHOTO_THINKING = 'medium';
  const on = await both();
  assert.ok(on.box.length >= 1 && on.crop.length >= 1, 'both rounds made a call');
  for (const c of [...on.box, ...on.crop]) assert.match(String(levelOf(c.body)), /^medium$/i, `thinkingLevel in ${JSON.stringify(c.body.generationConfig).slice(0, 200)}`);

  for (const v of [undefined, 'default']) {
    if (v === undefined) delete process.env.PHOTO_THINKING; else process.env.PHOTO_THINKING = v;
    const off = await both();
    for (const c of [...off.box, ...off.crop]) assert.ok(!JSON.stringify(c.body).includes('thinking'), `PHOTO_THINKING=${v}: no thinking field is sent`);
  }
});

test('the merge keeps crop answers with more than 2 pins', () => {
  const reading = { board: { visible: true, cols: 63, rails: RAILS, split: false }, wires: [], power: [],
    parts: [{ id: 'P1', type: 'potentiometer', what: 'pot', value: 0, bands: [], color: '', box: [10, 10, 60, 40], confidence: 0.8, unsure: ['leads'],
      leads: [0, 1, 2].map(i => ({ hole: '?', pt: [10 + 20 * i, 25], role: 'unknown' })) }] };
  const pts = [[100, 200], [140, 200], [180, 200]];
  const out = PhotoCrops.merge(reading, [{ id: 'P1', found: true, conf: 0.9, leads: pts.map((pt, i) => ({ pin: String(i + 1), pt, role: 'none' })) }]);
  const p = out.parts[0];
  assert.equal(p.leads.length, 3);
  assert.deepStrictEqual(p.leads.map(l => l.pt), pts, 'all 3 answers placed');
  assert.deepStrictEqual(p.leads.map(l => l.hole), ['?', '?', '?']);
  assert.ok(!p.unsure.includes('leads'), 'leads leaves unsure');
});

// ── Fix round 2 (review, Ruling P6) ─────────────────────────────────────────

test('a resistor or LED with 1 or 3 survey points keeps its 2 placeholders and the crop answer still lands', async () => {
  const pts = n => Array.from({ length: n }, (_, i) => ({ pin: String(i + 1), point: [100 + 30 * i, 100 + 40 * i] }));
  const box = [450, 200, 550, 300];   // wide: placeholders are the left/right midpoints at y = 500
  const placeholders = [[200 / 1000 * GRID.width, 500 / 1000 * GRID.height], [300 / 1000 * GRID.width, 500 / 1000 * GRID.height]];
  const rows = [['resistor', 1], ['resistor', 3], ['led', 1], ['led', 3], ['capacitor', 3], ['diode', 1], ['button', 3], ['ic', 3], ['potentiometer', 2]];
  for (const [type, n] of rows) {
    const { out } = await readSurvey([{ type, value: null, conf: 0.8, box_2d: box, leads: pts(n), ...(type === 'ic' ? { pins: 8, notch: 'left', label: null } : {}) }]);
    const part = out.reading.parts[0];
    assert.equal(part.leads.length, 2, `${type} with ${n} points keeps 2 placeholders`);
    part.leads.forEach((l, i) => close(l.pt, placeholders[i], `${type}/${n} placeholder ${i + 1}`));
    assert.ok(part.unsure.includes('leads'), `${type}/${n}: leads stays unsure`);
    // the crop round's 2-leg answer still lands on it
    const merged = PhotoCrops.merge(out.reading, [{ id: part.id, found: true, conf: 0.9, leads: [{ pin: '1', pt: [11, 22], role: 'none' }, { pin: '2', pt: [33, 44], role: 'none' }] }]);
    assert.deepStrictEqual(merged.parts[0].leads.map(l => l.pt), [[11, 22], [33, 44]], `${type}/${n}: the crop answer lands`);
    assert.ok(!merged.parts[0].unsure.includes('leads'));
  }
  // The counts that do match are used; other takes any count; a pot takes 3.
  const ok = await readSurvey([
    { type: 'potentiometer', value: null, conf: 0.8, box_2d: box, leads: pts(3) },
    { type: 'gizmo', value: null, conf: 0.8, box_2d: box, leads: pts(3) },
  ]);
  assert.deepStrictEqual(ok.out.reading.parts.map(p => p.leads.length), [3, 3]);
});

test('survey points map back through a real window', async () => {
  const win = { x: 0, y: 0, scale: 0.9778, padLeft: 27, padTop: 27, width: 2048, height: 748 };
  const grid = PhotoGrid.homography({ a1: [90, 190], a63: [1950, 190], j63: [1950, 520], j1: [90, 520] }, 63);
  const a14 = grid.holeCentre('a14'), j40 = grid.holeCentre('j40');
  // forward: the render's mapping, then 0-1000 over the whole margined image: [y, x]
  const fwd = ([fx, fy]) => [(win.padTop + (fy - win.y) * win.scale) / win.height * 1000, (win.padLeft + (fx - win.x) * win.scale) / win.width * 1000];
  const [ya, xa] = fwd(a14), [yj, xj] = fwd(j40);
  const fake = fakeGemini(survey([{ type: 'resistor', value: 470, conf: 0.9, box_2d: [Math.min(ya, yj), Math.min(xa, xj), Math.max(ya, yj), Math.max(xa, xj)],
    leads: [{ pin: '1', point: [ya, xa] }, { pin: '2', point: [yj, xj] }] }]));
  const out = await Reader.readPhoto({ image: IMG, grid: GRID, window: win }, { providers: ['gemini'], fetch: fake.fetch, fixturesDir: emptyDir });
  const r = out.reading.parts[0];
  close(r.leads[0].pt, a14, 'lead 1 is a14\'s centre');
  close(r.leads[1].pt, j40, 'lead 2 is j40\'s centre');
  close(r.box, [Math.min(a14[0], j40[0]), Math.min(a14[1], j40[1]), Math.max(a14[0], j40[0]), Math.max(a14[1], j40[1])], 'the box maps back too');
});

test('a numeric pin from the model is kept as a string (Gemini and DeepSeek)', async () => {
  const answer = survey([{ type: 'ic', value: null, conf: 0.9, box_2d: [300, 400, 420, 500], pins: 8, notch: 'left', label: 'TL072CP',
    leads: [{ pin: 1, point: [410, 405] }, { pin: 4, point: [410, 495] }] }]);
  const g = await Reader.readPhoto({ image: IMG, grid: GRID }, { providers: ['gemini'], fetch: fakeGemini(answer).fetch, fixturesDir: emptyDir });
  assert.deepStrictEqual(g.reading.parts[0].leads.map(l => l.pin), ['1', '4'], 'gemini');
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key-a4';
  const fetch = async () => {
    const body = { choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer) }, finish_reason: 'stop' }] };
    return { ok: true, status: 200, statusText: '', headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(body), json: async () => body };
  };
  const d = await Reader.readPhoto({ image: IMG, grid: GRID }, { providers: ['deepseek'], fetch, fixturesDir: emptyDir });
  assert.deepStrictEqual(d.reading.parts[0].leads.map(l => l.pin), ['1', '4'], 'deepseek');
  delete process.env.DEEPSEEK_API_KEY;
});

test('an unknown PHOTO_THINKING value sends nothing, and warns', async () => {
  process.env.PHOTO_THINKING = 'ultra';
  const { fake } = await readSurvey([]);
  for (const c of fake.calls) assert.ok(!JSON.stringify(c.body).includes('thinking'), 'no thinking field for an unknown level');
  // (no earlier warn pattern in the repo: asserts a console.warn that names PHOTO_THINKING)
  assert.ok(console.warn.mock.calls.some(a => /PHOTO_THINKING/.test(a.map(String).join(' '))), 'a warning names PHOTO_THINKING');
});

test('the fallback model never gets a thinking level', async () => {
  process.env.PHOTO_THINKING = 'medium';
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: 0 });
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('timeout', 'TimeoutError')), ms);
    return c.signal;
  });
  const calls = [];
  const fetch = (url, opts = {}) => {
    const body = JSON.parse(opts.body), er = String(url).includes('robotics');
    calls.push({ er, body });
    const res = er ? { ok: false, status: 503, statusText: '', headers: new Headers(), text: async () => '{"error":{"code":503}}', json: async () => ({}) }
      : (() => { const b = { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(survey([])) }] }, finishReason: 'STOP' }] };
          return { ok: true, status: 200, statusText: '', headers: new Headers(), text: async () => JSON.stringify(b), json: async () => b }; })();
    return Promise.resolve(res);
  };
  const p = Reader.readPhoto({ image: IMG, grid: GRID }, { fetch, fixturesDir: emptyDir });
  let done = false, out;
  p.then(v => { done = true; out = v; }, () => { done = true; });
  for (let t = 0; t < 60 && !done; t++) { await vi.advanceTimersByTimeAsync(1000); for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); }
  assert.ok(done && out, 'the fallback answered');
  const er = calls.filter(c => c.er), fb = calls.filter(c => !c.er);
  assert.ok(er.length && fb.length, `both models were asked (${er.length}, ${fb.length})`);
  for (const c of er) assert.equal(c.body.generationConfig.thinkingConfig.thinkingLevel, 'medium', 'Robotics-ER gets the level');
  for (const c of fb) assert.ok(!JSON.stringify(c.body).includes('thinking'), 'the fallback model gets no thinking level');
  vi.useRealTimers();
});
