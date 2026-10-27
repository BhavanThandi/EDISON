// Task A2: photo-eval scores chips, capacitors, pots and diodes alongside the
// resistor/LED headline. Offline: only the pure exports of scripts/photo-eval.js.
//
// Ruling P2: the headline aggregates (parts, legs, wires, ends, invented,
// other, polarity, rails) stay resistor + LED only, so before/after numbers
// compare. The new types have their own fields on score():
//   chips:    { right, total }  NON-flagged truth chips; right = every known leg's node matched
//   chipPin1: { right, known }  known = the truth names pin 1 (a lead whose pin is '1')
//   caps, pots, diodes: { right, total }  parts right / truth parts, by node like resistors
//   flagged:  { right, total }  truth chips with expect:'flagged'; right when ITS PAIRED
//                               reading part, if any, is not a TL072-family build
//   unlocated: n                truth parts (new types) with zero known legs: found or not
//                               only, never in any right/total
// row(r) has cells under table() headers 'chips','chip pin-1','caps','pots','diodes',
// 'flagged','unlocated' ("n/m", unlocated a number); totals() has the same keys as score().
// A reading chip's lead role is its pin name ('1'..'8').

const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const { score, row, table, totals, loadSet } = require('../scripts/photo-eval.js');

const lead = (hole, pin) => ({ pin, hole, conf: 'high' });
const rdLead = (hole, role) => ({ hole, role });

// DIP-8 across the channel: pins 1-4 along row e (columns 10-13), 5-8 back along row f.
const DIP = ['e10', 'e11', 'e12', 'e13', 'f13', 'f12', 'f11', 'f10'];
const DIP2 = DIP.map(h => h[0] + (Number(h.slice(1)) + 20));   // a second chip, columns 30-33
const chipTruth = (extra = {}, holes = DIP, id = 'U1') => Object.assign({ id, type: 'ic', leads: holes.map((h, i) => lead(h, String(i + 1))) }, extra);
const chipRead = (holes = DIP, value = 'TL072', id = 'U1') => ({ id, type: 'ic', value, leads: holes.map((h, i) => rdLead(h, String(i + 1))) });
const board = parts => ({ rails: {}, parts, wires: [] });
const circuit = parts => ({ rails: {}, parts, wires: [] });
const none = { right: 0, total: 0 };

test('a chip with all legs on the right nodes scores right', () => {
  const s = score(circuit([chipTruth()]), board([chipRead()]));
  assert.deepStrictEqual(s.chips, { right: 1, total: 1 });
  assert.deepStrictEqual(s.chipPin1, { right: 1, known: 1 });
});

test('a chip one column off scores wrong', () => {
  const off = DIP.slice(); off[3] = 'e14';   // pin 4 one column along
  const s = score(circuit([chipTruth()]), board([chipRead(off)]));
  assert.deepStrictEqual(s.chips, { right: 0, total: 1 });
});

test('pin 1 on the wrong end scores orientation wrong', () => {
  // Same eight holes, numbered from the other end: every node is covered, pin 1 is not where the truth has it.
  const s = score(circuit([chipTruth()]), board([chipRead(DIP.slice().reverse())]));
  assert.deepStrictEqual(s.chips, { right: 1, total: 1 }, 'the legs are all on right nodes');
  assert.deepStrictEqual(s.chipPin1, { right: 0, known: 1 });
});

test('a truth chip that does not name pin 1 adds nothing to chip pin-1', () => {
  const t = chipTruth({ orientation: 'unknown', leads: DIP.map(h => ({ hole: h, conf: 'med' })) });
  const s = score(circuit([t]), board([chipRead(DIP.slice().reverse())]));
  assert.deepStrictEqual(s.chipPin1, { right: 0, known: 0 });
  assert.deepStrictEqual(s.chips, { right: 1, total: 1 });
});

test('a flagged chip scores right when it is not built', () => {
  const t = circuit([chipTruth({ expect: 'flagged' })]);
  assert.deepStrictEqual(score(t, board([])).flagged, { right: 1, total: 1 }, 'no chip in the reading');
  assert.deepStrictEqual(score(t, board([chipRead(DIP, 'NE555')])).flagged, { right: 1, total: 1 }, 'a non-TL072 chip is not a TL072 build');
  assert.deepStrictEqual(score(t, board([chipRead(DIP, 'TL072')])).flagged, { right: 0, total: 1 }, 'built as a TL072: wrong');
  assert.deepStrictEqual(score(t, board([chipRead(DIP, 'tl072')])).flagged, { right: 0, total: 1 }, 'value case does not matter');
});

// The eval's chip family is PhotoChips.identify(label) === 'opamp' (one list, not a second regex).
test('a flagged chip is built wrong exactly when the reading names a dual op-amp (agrees with PhotoChips.identify)', () => {
  const PhotoChips = require('../circuit3d/js/photo-chips.js');
  const t = circuit([chipTruth({ expect: 'flagged' })]);
  for (const [value, wrong] of [['LM358', true], ['NE5532', true], ['TL072CP', true], ['LF353N', true], ['NE555', false], ['LM741', false], ['74HC00', false]]) {
    assert.strictEqual(PhotoChips.identify(value) === 'opamp', wrong, `identify(${value})`);
    assert.deepStrictEqual(score(t, board([chipRead(DIP, value)])).flagged, wrong ? { right: 0, total: 1 } : { right: 1, total: 1 }, value);
  }
});

test('a flagged chip next to a real TL072 is still right (its paired part decides, not a global check)', () => {
  const t = circuit([chipTruth({ expect: 'flagged' }), chipTruth({}, DIP2, 'U2')]);
  const s = score(t, board([chipRead(DIP2, 'TL072', 'U2')]));
  assert.deepStrictEqual(s.flagged, { right: 1, total: 1 }, 'the TL072 sits at U2, not at the flagged chip');
  assert.deepStrictEqual(s.chips, { right: 1, total: 1 }, 'U2 is built right');
  // and the other way round: the TL072 on the flagged chip's own holes is wrong
  const s2 = score(t, board([chipRead(DIP, 'TL072', 'X')]));
  assert.deepStrictEqual(s2.flagged, { right: 0, total: 1 });
  assert.deepStrictEqual(s2.chips, { right: 0, total: 1 });
});

test('flagged chips are not counted in chips n/m', () => {
  const s = score(circuit([chipTruth({ expect: 'flagged' })]), board([]));
  assert.deepStrictEqual(s.chips, none);
  assert.deepStrictEqual(s.chipPin1, { right: 0, known: 0 });
  assert.deepStrictEqual(s.flagged, { right: 1, total: 1 });
});

test('a chip that is not flagged and not built scores wrong', () => {
  assert.deepStrictEqual(score(circuit([chipTruth()]), board([])).chips, { right: 0, total: 1 });
});

test('capacitors and pots are scored by node like resistors', () => {
  const truth = circuit([
    { id: 'C1', type: 'capacitor', leads: [lead('c9', '+'), lead('c8', '-')] },
    { id: 'RV1', type: 'potentiometer', leads: [lead('a3', '1'), lead('a4', 'wiper'), lead('a5', '2')] },
    { id: 'R1', type: 'resistor', leads: [lead('g1', '1'), lead('g5', '2')] },
  ]);
  const read = (cap, pot) => board([
    { id: 'C1', type: 'capacitor', leads: cap.map((h, i) => rdLead(h, i ? '-' : '+')) },
    { id: 'RV1', type: 'potentiometer', leads: pot.map((h, i) => rdLead(h, ['1', 'wiper', '2'][i])) },
    { id: 'R1', type: 'resistor', leads: [rdLead('g1', '1'), rdLead('g5', '2')] },
  ]);
  const good = score(truth, read(['c9', 'c8'], ['a3', 'a4', 'a5']));
  assert.deepStrictEqual(good.caps, { right: 1, total: 1 });
  assert.deepStrictEqual(good.pots, { right: 1, total: 1 });
  // any hole in the same column and half is the same node; legs may come in either order
  assert.deepStrictEqual(score(truth, read(['d8', 'e9'], ['e3', 'b4', 'c5'])).caps, { right: 1, total: 1 });
  const bad = score(truth, read(['c9', 'c7'], ['a3', 'a4', 'a6']));
  assert.deepStrictEqual(bad.caps, { right: 0, total: 1 });
  assert.deepStrictEqual(bad.pots, { right: 0, total: 1 });
});

test('diodes are scored by node', () => {
  const truth = circuit([{ id: 'D1', type: 'diode', leads: [lead('d27', 'anode'), lead('b32', 'cathode')] }]);
  const rd = holes => board([{ id: 'D1', type: 'diode', leads: [rdLead(holes[0], 'anode'), rdLead(holes[1], 'cathode')] }]);
  assert.deepStrictEqual(score(truth, rd(['d27', 'b32'])).diodes, { right: 1, total: 1 });
  assert.deepStrictEqual(score(truth, rd(['d27', 'b33'])).diodes, { right: 0, total: 1 });
});

test('a part with no known legs is unlocated, never scored right', () => {
  const truth = circuit([
    { id: 'RV1', type: 'potentiometer', leads: [{ pin: '1', hole: null, why: 'off the board' }, { pin: '2', hole: '?' }] },
    { id: 'Q1', type: 'ic', note: 'no leads listed' },
  ]);
  const s = score(truth, board([{ id: 'RV1', type: 'potentiometer', leads: [rdLead('a3', '1'), rdLead('a5', '2')] }, chipRead()]));
  assert.strictEqual(s.unlocated, 2);
  assert.deepStrictEqual(s.pots, none, 'found, but nothing to score right');
  assert.deepStrictEqual(s.chips, none);
  assert.deepStrictEqual(s.chipPin1, { right: 0, known: 0 });
});

test('caps, pots and diodes are not in the parts/legs totals', () => {
  const truth = circuit([
    { id: 'R1', type: 'resistor', leads: [lead('g1', '1'), lead('g5', '2')] },
    { id: 'D1', type: 'diode', leads: [lead('d27', 'anode'), lead('b32', 'cathode')] },
    chipTruth(),
    { id: 'C1', type: 'capacitor', leads: [lead('c9', '+'), lead('c8', '-')] },
    { id: 'RV1', type: 'potentiometer', leads: [lead('a3', '1'), lead('a5', '2')] },
  ]);
  const s = score(truth, board([
    { id: 'R1', type: 'resistor', leads: [rdLead('g1', '1'), rdLead('g5', '2')] },
    { id: 'D1', type: 'diode', leads: [rdLead('d27', 'anode'), rdLead('b32', 'cathode')] },
    chipRead(),
    { id: 'C1', type: 'capacitor', leads: [rdLead('c9', '+'), rdLead('c8', '-')] },
    { id: 'RV1', type: 'potentiometer', leads: [rdLead('a3', '1'), rdLead('a5', '2')] },
  ]));
  assert.deepStrictEqual(s.parts, { truth: 1, found: 1, invented: 0 });
  assert.deepStrictEqual(s.legs, { right: 2, total: 2 });
  assert.strictEqual(s.other, 4, 'the four new-type parts are still "other"');
  assert.deepStrictEqual([s.chips, s.caps, s.pots, s.diodes],
    [{ right: 1, total: 1 }, { right: 1, total: 1 }, { right: 1, total: 1 }, { right: 1, total: 1 }]);
});

test('the row and totals carry chips, chip pin-1, caps, pots, diodes, flagged and unlocated', () => {
  const truth = circuit([
    { id: 'D1', type: 'diode', leads: [lead('d27', 'anode'), lead('b32', 'cathode')] },
    chipTruth(),
    chipTruth({ expect: 'flagged' }, DIP2, 'U2'),
    { id: 'C1', type: 'capacitor', leads: [lead('c9', '+'), lead('c8', '-')] },
    { id: 'RV1', type: 'potentiometer', leads: [lead('a3', '1'), lead('a5', '2')] },
    { id: 'RV2', type: 'potentiometer', leads: [{ pin: '1', hole: null }] },
  ]);
  const got = board([
    { id: 'D1', type: 'diode', leads: [rdLead('d27', 'anode'), rdLead('b32', 'cathode')] },
    chipRead(DIP.slice().reverse()),
    { id: 'C1', type: 'capacitor', leads: [rdLead('c9', '+'), rdLead('c8', '-')] },
    { id: 'RV1', type: 'potentiometer', leads: [rdLead('a3', '1'), rdLead('a6', '2')] },
  ]);
  const s = score(truth, got);
  assert.deepStrictEqual([s.chips, s.chipPin1, s.caps, s.pots, s.diodes, s.flagged, s.unlocated],
    [{ right: 1, total: 1 }, { right: 0, known: 1 }, { right: 1, total: 1 }, { right: 0, total: 1 }, { right: 1, total: 1 }, { right: 1, total: 1 }, 1]);

  const head = table([]).split('\n')[0].split(/ {2,}/);
  const r = { id: 'x', run: 1, ms: 1000, placedMs: 2000, outcome: 'ok', net: {}, score: s };
  const cells = row(r);
  assert.strictEqual(cells.length, head.length, 'one cell per header');
  const at = h => { assert.ok(head.includes(h), `header "${h}"`); return cells[head.indexOf(h)]; };
  assert.deepStrictEqual(['chips', 'chip pin-1', 'caps', 'pots', 'diodes', 'flagged', 'unlocated'].map(at),
    ['1/1', '0/1', '1/1', '0/1', '1/1', '1/1', '1']);

  const t = totals([r, r]);
  assert.deepStrictEqual([t.chips, t.chipPin1, t.caps, t.pots, t.diodes, t.flagged, t.unlocated],
    [{ right: 2, total: 2 }, { right: 0, known: 2 }, { right: 2, total: 2 }, { right: 0, total: 2 }, { right: 2, total: 2 }, { right: 2, total: 2 }, 2]);
});

test('scoring the 2026-10-25 baseline readings reproduces its numbers', () => {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/photo/baseline/2026-10-25-before.json'), 'utf8'));
  const photos = [...loadSet('eval'), ...loadSet('web')];
  const headline = s => ({ parts: s.parts, legs: s.legs, wires: s.wires, ends: s.ends, polarity: s.polarity, rails: s.rails, other: s.other });
  const rescored = base.results.map(r => {
    const p = photos.find(x => x.id === r.id);
    assert.ok(p, `${r.id} is in the eval or web set`);
    const s = score(p.truth, r.got);
    assert.deepStrictEqual(headline(s), headline(r.score), `${r.id}: headline numbers unchanged`);
    return { id: r.id, outcome: 'ok', net: {}, score: s };
  });
  const t = totals(rescored);
  assert.deepStrictEqual(
    { parts: t.parts, legs: t.legs, wires: t.wires, ends: t.ends, invented: t.invented, rails: t.rails },
    { parts: { found: 9, truth: 13 }, legs: { right: 16, total: 26 }, wires: { found: 15, truth: 18 }, ends: { right: 28, total: 34 }, invented: 5, rails: { right: 4, known: 6 } });
});


// ── Fix round 2 (review): the reading's chip lead names its pin in `pin`, role stays 'unknown' ──
test('chip pin 1 is credited from the lead\'s pin label', () => {
  const rd = DIP.map((h, i) => ({ hole: h, role: 'unknown', pin: String(i + 1) }));
  const s = score(circuit([chipTruth()]), board([{ id: 'U1', type: 'ic', value: 'TL072', leads: rd }]));
  assert.deepStrictEqual(s.chipPin1, { right: 1, known: 1 });
  const flipped = DIP.slice().reverse().map((h, i) => ({ hole: h, role: 'unknown', pin: String(i + 1) }));
  assert.deepStrictEqual(score(circuit([chipTruth()]), board([{ id: 'U1', type: 'ic', value: 'TL072', leads: flipped }])).chipPin1, { right: 0, known: 1 });
});

test('the eval keeps each lead\'s pin when it reads the snapped Reading off the page (source pin: page.evaluate is not unit-callable)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'photo-eval.js'), 'utf8');
  assert.match(src, /hole: hole\(l\)[^}]*\bpin: l\.pin/, 'the leads mapping in the page.evaluate carries pin: l.pin');
});
