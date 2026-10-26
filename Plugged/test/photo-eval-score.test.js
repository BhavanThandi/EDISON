// Task A2: photo-eval scores chips, capacitors, pots and diodes (not only
// resistors and LEDs). Offline: only the pure exports of scripts/photo-eval.js.
//
// Score shape these tests expect (the builder adds it to score()'s result):
//   chips:   { right, total }   chip right = every known truth leg's node matched
//   chipPin1:{ right, known }   known = truth names pin 1 (a lead whose pin is '1')
//   caps:    { right, total }   capacitors, scored by node like resistors
//   pots:    { right, total }   potentiometers
// row(r) has cells under the table() headers 'chips', 'chip pin-1', 'caps',
// 'pots', each "n/m"; totals() has the same four keys as score().
// A truth chip with `expect: 'flagged'` is right when the reading does not
// build it as a TL072 (no reading part of type 'ic' with value TL072).
// A reading chip's lead role is its pin name ('1'..'8').

const assert = require('node:assert');
const { score, row, table, totals } = require('../scripts/photo-eval.js');

const lead = (hole, pin) => ({ pin, hole, conf: 'high' });
const rdLead = (hole, role) => ({ hole, role });

// DIP-8 across the channel: pins 1-4 along row e (columns 10-13), 5-8 back along row f.
const DIP = ['e10', 'e11', 'e12', 'e13', 'f13', 'f12', 'f11', 'f10'];
const chipTruth = (extra = {}) => Object.assign({ id: 'U1', type: 'ic', leads: DIP.map((h, i) => lead(h, String(i + 1))) }, extra);
const chipRead = (holes = DIP, value = 'TL072') => ({ id: 'U1', type: 'ic', value, leads: holes.map((h, i) => rdLead(h, String(i + 1))) });
const board = parts => ({ rails: {}, parts, wires: [] });
const circuit = parts => ({ rails: {}, parts, wires: [] });

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
  assert.deepStrictEqual(score(t, board([])).chips, { right: 1, total: 1 }, 'no chip in the reading');
  assert.deepStrictEqual(score(t, board([chipRead(DIP, 'NE555')])).chips, { right: 1, total: 1 }, 'a non-TL072 chip is not a TL072 build');
  assert.deepStrictEqual(score(t, board([chipRead(DIP, 'TL072')])).chips, { right: 0, total: 1 }, 'built as a TL072: wrong');
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
  // a resistor is not a capacitor
  assert.deepStrictEqual(good.caps.total + good.pots.total, 2);
});

test('diodes are scored as parts and legs, and the row and totals carry the new counts', () => {
  const truth = circuit([
    { id: 'D1', type: 'diode', leads: [lead('d27', 'anode'), lead('b32', 'cathode')] },
    chipTruth(),
    { id: 'C1', type: 'capacitor', leads: [lead('c9', '+'), lead('c8', '-')] },
    { id: 'RV1', type: 'potentiometer', leads: [lead('a3', '1'), lead('a5', '2')] },
  ]);
  const got = board([
    { id: 'D1', type: 'diode', leads: [rdLead('d27', 'anode'), rdLead('b32', 'cathode')] },
    chipRead(DIP.slice().reverse()),
    { id: 'C1', type: 'capacitor', leads: [rdLead('c9', '+'), rdLead('c8', '-')] },
    { id: 'RV1', type: 'potentiometer', leads: [rdLead('a3', '1'), rdLead('a6', '2')] },
  ]);
  const s = score(truth, got);
  assert.strictEqual(s.parts.truth, 4, 'diode, chip, cap and pot are all scored parts');
  assert.strictEqual(s.parts.found, 4);
  assert.deepStrictEqual([s.chips, s.chipPin1, s.caps, s.pots],
    [{ right: 1, total: 1 }, { right: 0, known: 1 }, { right: 1, total: 1 }, { right: 0, total: 1 }]);

  const head = table([]).split('\n')[0].split(/ {2,}/);
  const r = { id: 'x', run: 1, ms: 1000, placedMs: 2000, outcome: 'ok', net: {}, score: s };
  const cells = row(r);
  assert.strictEqual(cells.length, head.length, 'one cell per header');
  const at = h => { assert.ok(head.includes(h), `header "${h}"`); return cells[head.indexOf(h)]; };
  assert.deepStrictEqual([at('chips'), at('chip pin-1'), at('caps'), at('pots')], ['1/1', '0/1', '1/1', '0/1']);

  const t = totals([r, r]);
  assert.deepStrictEqual([t.chips, t.chipPin1, t.caps, t.pots],
    [{ right: 2, total: 2 }, { right: 0, known: 2 }, { right: 2, total: 2 }, { right: 0, total: 2 }]);
});
