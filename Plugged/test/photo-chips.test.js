// PhotoChips (Part B, task B1): which chip a printed label names, and how a
// DIP-8 chip sits on the breadboard from the two points the vision model
// gave (pin 1 and pin 4).
//
// Contract these tests are written against (circuit3d/js/photo-chips.js, UMD
// like photo-import.js; Node: module.exports):
// - PhotoChips.DUAL_OPAMPS: TL052 TL062 TL072 TL082 LM358 LM2904 LF353 LF412
//   NE5532 MC1458 RC4558.
// - identify(label) → 'opamp' | 'other' | 'unknown': uppercase, drop
//   non-alphanumerics; empty → unknown; contains a list entry → opamp;
//   contains a digit → other; else unknown.
// - seat({ pin1, pinN, pins = 8, notch, cols = 63 }) → { hole, direction,
//   sure } | { why }. pin1 / pinN are body holes like "e30". Pin 1's half
//   decides the direction: a–e → "e{c1}" right; f–j → "f{c1}" left. Pin N/2
//   must be 3 columns away on the correct side in the same half (rows inside
//   a half do not matter). The notch ('left' | 'right' | 'unsure' | absent)
//   is a second cue: it agrees (left notch ↔ right, right notch ↔ left) →
//   sure; unsure, absent or disagreeing → sure:false, same seat.
// - A clockwise pin pair, two halves, a wrong gap, pins other than 8 and a
//   seat past the board's last column all give { why }, never a seat.
// - The seat is the real thing: Parts.footprintLegs('tl072', hole, 0 | 180)
//   puts pin 1 and pin 4 where the points were, and Parts.checkPlacement
//   passes. Nothing is mocked.

const assert = require('node:assert');

const Parts = require('../circuit3d/js/parts');
const PhotoChips = require('../circuit3d/js/photo-chips.js');

const ROT = { right: 0, left: 180 };
const half = hole => (/^[a-e]/.test(hole) ? 'top' : 'bottom');
const colOf = hole => Number(hole.slice(1));

test('identify names the dual op-amps from a printed label', () => {
  for (const label of ['TL072CP', 'tl 072', 'LM358N', 'NE5532P', 'LF353N', 'TL082', 'TL052']) {
    assert.strictEqual(PhotoChips.identify(label), 'opamp', label);
  }
});

test('identify calls a labelled chip that is not a dual op-amp "other"', () => {
  for (const label of ['NE555N', 'LM741CN', '74HC00']) {
    assert.strictEqual(PhotoChips.identify(label), 'other', label);
  }
});

test('identify says "unknown" when there is nothing to read', () => {
  for (const label of [null, undefined, '', '  ', 'ST']) {
    assert.strictEqual(PhotoChips.identify(label), 'unknown', JSON.stringify(label));
  }
});

test('every entry of DUAL_OPAMPS identifies as an op-amp', () => {
  assert.ok(Array.isArray(PhotoChips.DUAL_OPAMPS) && PhotoChips.DUAL_OPAMPS.length > 0);
  for (const name of PhotoChips.DUAL_OPAMPS) assert.strictEqual(PhotoChips.identify(name), 'opamp', name);
  for (const name of ['TL072', 'LM358', 'NE5532']) assert.ok(PhotoChips.DUAL_OPAMPS.includes(name), name);
});

test('seat: pin 1 in a–e with a left notch is "e{c} right", sure', () => {
  assert.deepStrictEqual(PhotoChips.seat({ pin1: 'e30', pinN: 'e33', notch: 'left' }), { hole: 'e30', direction: 'right', sure: true });
});

test('seat: pin 1 in f–j with a right notch is "f{c} left", sure', () => {
  assert.deepStrictEqual(PhotoChips.seat({ pin1: 'f33', pinN: 'f30', notch: 'right' }), { hole: 'f33', direction: 'left', sure: true });
});

test('seat: rows inside a half do not matter', () => {
  assert.deepStrictEqual(PhotoChips.seat({ pin1: 'c30', pinN: 'b33', notch: 'left' }), { hole: 'e30', direction: 'right', sure: true });
  assert.deepStrictEqual(PhotoChips.seat({ pin1: 'h33', pinN: 'j30', notch: 'right' }), { hole: 'f33', direction: 'left', sure: true });
});

test('seat: an unsure or missing notch gives the same seat, not sure', () => {
  const want = { hole: 'e30', direction: 'right', sure: false };
  assert.deepStrictEqual(PhotoChips.seat({ pin1: 'e30', pinN: 'e33', notch: 'unsure' }), want);
  assert.deepStrictEqual(PhotoChips.seat({ pin1: 'e30', pinN: 'e33' }), want);
});

test('seat: a notch that disagrees with the points gives the same seat, not sure', () => {
  assert.deepStrictEqual(PhotoChips.seat({ pin1: 'e30', pinN: 'e33', notch: 'right' }), { hole: 'e30', direction: 'right', sure: false });
  assert.deepStrictEqual(PhotoChips.seat({ pin1: 'f33', pinN: 'f30', notch: 'left' }), { hole: 'f33', direction: 'left', sure: false });
});

test('a clockwise pin pair has no seat', () => {
  for (const [pin1, pinN] of [['e33', 'e30'], ['f30', 'f33']]) {
    for (const notch of ['left', 'right', 'unsure', undefined]) {
      const r = PhotoChips.seat({ pin1, pinN, notch });
      assert.ok(r.why && !r.hole, `${pin1} ${pinN} ${notch}: ${JSON.stringify(r)}`);
    }
  }
});

test('points that cannot be one chip have no seat: two halves, wrong gap, not 8 pins', () => {
  for (const arg of [
    { pin1: 'e30', pinN: 'f33', notch: 'left' },            // across the gap
    { pin1: 'e30', pinN: 'e32', notch: 'left' },            // 2 columns apart
    { pin1: 'e30', pinN: 'e34', notch: 'left' },            // 4 columns apart
    { pin1: 'e30', pinN: 'e33', notch: 'left', pins: 14 },  // not a DIP-8
  ]) {
    const r = PhotoChips.seat(arg);
    assert.ok(r.why && !r.hole, `${JSON.stringify(arg)}: ${JSON.stringify(r)}`);
  }
});

test('a seat past the board\'s last column is refused', () => {
  const r = PhotoChips.seat({ pin1: 'e28', pinN: 'e31', notch: 'left', cols: 30 });
  assert.ok(r.why && !r.hole, JSON.stringify(r));
  // and the same chip one column in is fine
  assert.deepStrictEqual(PhotoChips.seat({ pin1: 'e27', pinN: 'e30', notch: 'left', cols: 30 }), { hole: 'e27', direction: 'right', sure: true });
});

test('property: a sure seat puts pin 1 and pin 4 where the points were, and checkPlacement passes (columns 1–60, both directions)', () => {
  const board = { cols: 63, bodyRows: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] };
  for (let c = 1; c <= 60; c++) {
    const cases = [
      { pin1: 'e' + c, pinN: 'e' + (c + 3), notch: 'left', direction: 'right' },
      { pin1: 'f' + (c + 3), pinN: 'f' + c, notch: 'right', direction: 'left' },
    ];
    for (const { direction, ...arg } of cases) {
      const seat = PhotoChips.seat(arg);
      const where = `${JSON.stringify(arg)} → ${JSON.stringify(seat)}`;
      assert.strictEqual(seat.sure, true, where);
      assert.strictEqual(seat.direction, direction, where);
      const legs = Parts.footprintLegs('tl072', seat.hole, ROT[seat.direction]);
      assert.ok(legs, where);
      assert.strictEqual(half(legs[0].hole), half(arg.pin1), `pin 1 half: ${where}`);
      assert.strictEqual(colOf(legs[0].hole), colOf(arg.pin1), `pin 1 column: ${where}`);
      assert.strictEqual(half(legs[3].hole), half(arg.pinN), `pin 4 half: ${where}`);
      assert.strictEqual(colOf(legs[3].hole), colOf(arg.pinN), `pin 4 column: ${where}`);
      assert.deepStrictEqual(Parts.checkPlacement('tl072', legs, new Map(), board), { ok: true }, where);
    }
  }
});
