// The online op-amp photo set (Part A, Task A5), in Node. No network, no
// browser, no server: it reads test/fixtures/photo/online/ and calls the pure
// exports of scripts/photo-eval.js and circuit3d/js/photo-grid.js.
//
// Pinned here:
// - every online photo has taps, a column count and truth: photos.json and
//   truth.json list the same photos; each image file is there, a JPEG whose
//   size (with its EXIF orientation applied, as the browser shows it) is
//   photos.json's width × height; cols 30 or 63; the taps are the 4 corners
//   a1, aN, jN, j1, on the image, and PhotoGrid makes a grid of them.
// - every truth lead and wire end is a hole on that board in the existing
//   truth files' forms (a printed body hole c14, rail:aOuter:14, off) or '?'
//   (unseen: conf low and a note); conf is high, med or low; a chip names
//   pins '1'…'N' only when its pin 1 is known, else it says
//   orientation "unknown"; expect is only ever "flagged".
// - ATTRIBUTION.md credits every image (file, source, licence).
// - loadSet('online') loads them, and the truth read back scores full marks.
// Like eval/ and web/, each image is upright (EXIF orientation 1) and at
// most 2,048 px on its long edge, so the browser never turns it and moves the taps.

const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const { score, loadSet } = require('../scripts/photo-eval.js');
const PhotoGrid = require('../circuit3d/js/photo-grid.js');

const DIR    = path.join(__dirname, 'fixtures/photo/online');
const json   = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const PHOTOS = json('photos.json'), TRUTH = json('truth.json');
const IDS    = Object.keys(PHOTOS);

const STRIPS = ['aOuter', 'aInner', 'jInner', 'jOuter'];
const TYPES  = ['resistor', 'led', 'capacitor', 'potentiometer', 'diode', 'button', 'ic', 'other'];
const CONFS  = ['high', 'med', 'low'];
const SCORED = ['resistor', 'led'];

// ── JPEG header ─────────────────────────────────────────────────────────

// A JPEG's pixel size (its SOF segment) and EXIF Orientation (1 when absent).
function jpegInfo(buf) {
  assert.ok(buf[0] === 0xff && buf[1] === 0xd8, 'not a JPEG (no SOI marker)');
  let orientation = 1;
  for (let i = 2; i + 9 <= buf.length;) {
    assert.strictEqual(buf[i], 0xff, `no JPEG marker at byte ${i}`);
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }   // fill byte
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') orientation = exifOrientation(buf.subarray(i + 10, i + 2 + len));
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC): precision, height, width.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), orientation };
    }
    i += 2 + len;
  }
  throw new Error('no SOF segment');
}

// A TIFF block (EXIF APP1 after its 'Exif\0\0') → IFD0's Orientation tag, else 1.
function exifOrientation(tiff) {
  const le  = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = o => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = o => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd = u32(4);
  for (let k = 0, n = u16(ifd); k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return 1;
}

// The size the browser shows: orientations 5–8 turn the image a quarter turn.
const upright = img => (img.orientation >= 5 && img.orientation <= 8 ? [img.height, img.width] : [img.width, img.height]);

// ── Truth holes ─────────────────────────────────────────────────────────

// A truth lead or wire end → why it isn't a hole on a `cols` board, or null.
function holeProblem(item, cols) {
  const h = item.hole;
  if (!CONFS.includes(item.conf)) return `conf ${JSON.stringify(item.conf)}`;
  if (h === '?') return item.conf === 'low' && item.note && String(item.note).trim() ? null : "'?' needs conf low and a note";
  if (h === 'off') return null;
  const m = /^(?:[a-j]|rail:(?:aOuter|aInner|jInner|jOuter):)(\d+)$/.exec(String(h));
  if (!m) return 'not a hole name';
  const n = Number(m[1]);
  return String(n) === m[1] && n >= 1 && n <= cols ? null : `column ${m[1]} is not 1…${cols}`;
}

// A chip → why its pin names or flags are off, or null.
function chipProblem(p) {
  const pins = (p.leads || []).map(l => l.pin);
  if (p.expect !== undefined && p.expect !== 'flagged') return `expect ${JSON.stringify(p.expect)}`;
  if (p.orientation === 'unknown') return pins.includes('1') ? "orientation unknown but a pin is named '1'" : null;
  const want = pins.map((_, k) => String(k + 1));
  if (pins.length % 2 || pins.length < 8) return `${pins.length} leads`;
  return JSON.stringify(pins) === JSON.stringify(want) ? null : `pins ${JSON.stringify(pins)}, not 1…${pins.length} (or orientation "unknown")`;
}

// ── Every online photo has taps, a column count and truth ───────────────

test('every online photo has taps, a column count and truth', () => {
  assert.ok(IDS.length > 0, 'photos.json lists no photos');
  assert.deepStrictEqual(Object.keys(TRUTH).sort(), IDS.slice().sort(), 'photos.json and truth.json list different photos');
  const missing = IDS.filter(id => !fs.existsSync(path.join(DIR, PHOTOS[id].file)));
  assert.deepStrictEqual(missing, [], 'image files missing');
});

test.each(IDS)('%s: a JPEG of the size photos.json gives (EXIF applied), cols 30 or 63, the 4 corner taps on the image, and a grid from them', id => {
  const p = PHOTOS[id];
  const img = jpegInfo(fs.readFileSync(path.join(DIR, p.file)));
  assert.deepStrictEqual(upright(img), [p.width, p.height], `${p.file}: upright size (EXIF ${img.orientation}) vs photos.json width/height`);
  assert.strictEqual(img.orientation, 1, `${p.file}: EXIF Orientation ${img.orientation}; the browser would turn it and move the taps`);
  assert.ok(Math.max(img.width, img.height) <= 2048, `${p.file}: long edge ${Math.max(img.width, img.height)} px`);

  assert.ok([30, 63].includes(p.cols), `cols ${p.cols}: the page offers 30 or 63`);
  const n = p.cols;
  assert.deepStrictEqual(Object.keys(p.taps), ['a1', 'a' + n, 'j' + n, 'j1'], 'taps: a1, aN, jN, j1 in the order the page asks');
  for (const [hole, xy] of Object.entries(p.taps)) {
    assert.ok(Array.isArray(xy) && xy.length === 2 && xy.every(Number.isFinite), `${hole}: ${JSON.stringify(xy)}`);
    const [x, y] = xy;
    assert.ok(x >= 0 && x <= p.width && y >= 0 && y <= p.height, `${hole} [${x}, ${y}] is off the ${p.width}×${p.height} image`);
  }
  assert.doesNotThrow(() => PhotoGrid.homography(p.taps, n), 'the taps make no grid');
});

test.each(IDS)('%s: truth: notes, a sign per rail strip, typed parts and wires, every leg a hole on this board or \'?\' with a note', id => {
  const t = TRUTH[id], cols = PHOTOS[id].cols;
  assert.ok(typeof t.notes === 'string' && t.notes.trim(), 'no notes');
  assert.deepStrictEqual(Object.keys(t.rails).sort(), STRIPS.slice().sort());
  for (const s of STRIPS) assert.ok(['+', '-', '?'].includes(t.rails[s]), `rails.${s} = ${JSON.stringify(t.rails[s])}`);

  const problems = [];
  const ids = [...t.parts, ...t.wires].map(x => x.id);
  const dup = ids.filter((x, k) => ids.indexOf(x) !== k);
  if (dup.length) problems.push(`ids used twice: ${dup.join(', ')}`);
  for (const p of t.parts) {
    if (!TYPES.includes(p.type)) problems.push(`${p.id}: type ${JSON.stringify(p.type)}`);
    if (!Array.isArray(p.leads) || !p.leads.length) problems.push(`${p.id}: no leads`);
    if (SCORED.includes(p.type) && (p.leads || []).length !== 2) problems.push(`${p.id}: ${(p.leads || []).length} leads`);
    if (p.type === 'ic') { const why = chipProblem(p); if (why) problems.push(`${p.id}: ${why}`); }
    else if (p.expect !== undefined || p.orientation !== undefined) problems.push(`${p.id}: expect/orientation on a ${p.type}`);
    (p.leads || []).forEach((l, k) => {
      const why = holeProblem(l, cols);
      if (why) problems.push(`${p.id}.leads[${k}] ${JSON.stringify(l.hole)}: ${why}`);
    });
  }
  for (const w of t.wires) {
    if (typeof w.color !== 'string' || !w.color) problems.push(`${w.id}: no color`);
    if (w.ends.length !== 2) problems.push(`${w.id}: ${w.ends.length} ends`);
    w.ends.forEach((e, k) => {
      const why = holeProblem(e, cols);
      if (why) problems.push(`${w.id}.ends[${k}] ${JSON.stringify(e.hole)}: ${why}`);
    });
  }
  assert.deepStrictEqual(problems, []);
});

test('the set has what it is for: a dual op-amp with pin 1 named, a flagged chip, and resistor legs to score', () => {
  const parts = IDS.flatMap(id => TRUTH[id].parts);
  assert.ok(parts.some(p => p.type === 'ic' && p.expect !== 'flagged' && (p.leads || []).some(l => l.pin === '1')), 'no op-amp with a known pin 1');
  assert.ok(parts.some(p => p.type === 'ic' && p.expect === 'flagged'), 'no flagged chip (NE555 / logic) negative');
  assert.ok(parts.some(p => p.type === 'resistor' && p.leads.some(l => l.hole !== '?')), 'no located resistor leg');
});

// ── ATTRIBUTION.md ──────────────────────────────────────────────────────

test('ATTRIBUTION.md credits every image: a table row with its file, source and a Creative Commons licence', () => {
  const md = fs.readFileSync(path.join(DIR, 'ATTRIBUTION.md'), 'utf8');
  const rows = md.split('\n').filter(l => l.startsWith('| `'));
  for (const id of IDS) {
    const p = PHOTOS[id];
    const row = rows.find(l => l.includes('`' + p.file + '`'));
    assert.ok(row, `${p.file}: no row in ATTRIBUTION.md`);
    assert.ok(row.includes(p.source), `${p.file}: the row doesn't link ${p.source}`);
    assert.ok(/\]\(https:\/\/creativecommons\.org\/licenses\/by(-sa)?\/[\d.]+\/\)/.test(row), `${p.file}: no CC BY / CC BY-SA licence link`);
    assert.strictEqual(row.split('|').length, 6, `${p.file}: the row isn't File | Source | Author | Licence`);
  }
});

// ── photo-eval loads the set ────────────────────────────────────────────

// A truth entry → the snapped Reading shape score() takes (a lead's pin is its role).
const readBack = t => ({
  rails: Object.assign({}, t.rails),
  parts: t.parts.map(p => ({ id: p.id, type: p.type, value: p.value, leads: (p.leads || []).map(l => ({ hole: l.hole, role: l.pin })) })),
  wires: t.wires.map(w => ({ id: w.id, color: w.color, ends: w.ends.map(e => ({ hole: e.hole })) })),
});

test.each(IDS)("%s: loadSet('online') loads it with its truth, and the truth read back scores full marks", id => {
  const p = loadSet('online').find(x => x.id === id);
  assert.ok(p, `loadSet('online') has no ${id}`);
  assert.deepStrictEqual([p.cols, p.width, p.height, p.taps], [PHOTOS[id].cols, PHOTOS[id].width, PHOTOS[id].height, PHOTOS[id].taps]);
  assert.strictEqual(p.file, path.join(DIR, PHOTOS[id].file));
  assert.deepStrictEqual(p.truth, TRUTH[id]);

  const s = score(p.truth, readBack(p.truth));
  const scored = p.truth.parts.filter(q => SCORED.includes(q.type));
  const known  = list => list.filter(x => x.hole !== '?').length;
  assert.deepStrictEqual(s.parts, { truth: scored.length, found: scored.length, invented: 0 });
  assert.deepStrictEqual(s.legs, { right: known(scored.flatMap(q => q.leads)), total: known(scored.flatMap(q => q.leads)) });
  assert.deepStrictEqual(s.wires, { truth: p.truth.wires.length, found: p.truth.wires.length, invented: 0 });
  assert.deepStrictEqual(s.ends, { right: known(p.truth.wires.flatMap(w => w.ends)), total: known(p.truth.wires.flatMap(w => w.ends)) });
  assert.strictEqual(s.flagged.right, s.flagged.total, 'a flagged chip read back as itself counts as not built as a TL072');
});
