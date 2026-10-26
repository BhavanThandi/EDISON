// The board's handedness (mirror fix, Task 2): a real breadboard seen from
// above has row a nearest you, so a DIP chip's pins 1 → N run counter-clockwise
// (pin 1 at the near-left, the last pin back along the far row).
//
// - ROW_Z: row a and the tp/tn rails are the near half (larger Z, bottom of
//   the screen); f–j and bn/bp are the far half.
// - Parts.footprintLegs: a leg's row offset runs toward row a (down the
//   screen), so a chip anchored on row e has its second row on f, and the
//   potentiometer facing "down" (rotation 90) runs j5 → i5 → h5.
// - Seen from above (x = column, y = -Z, so y grows up the screen), the
//   pins 1 → N of a straddle chip wind counter-clockwise: positive area.

const assert = require('node:assert');

const Parts = require('../circuit3d/js/parts');
const G     = require('../circuit3d/js/board-geometry.js');

const { ROW_Z, BODY_ROWS } = G;
const BOARD = { cols: 63, bodyRows: BODY_ROWS };
const holes = legs => legs.map(l => l.hole);

// Shoelace area of the pins in pin order; > 0 is counter-clockwise.
function signedArea(legs) {
  let sum = 0;
  for (let i = 0; i < legs.length; i++) {
    const a = legs[i], b = legs[(i + 1) % legs.length];
    sum += (a.col + 1) * -ROW_Z[b.row] - (b.col + 1) * -ROW_Z[a.row];
  }
  return sum / 2;
}

// Every anchor in rows e and f, columns 1..60, rotations 0 and 180 that sits
// across the gap on the board with every leg in a hole.
function validSeats(type) {
  const seats = [];
  for (const row of ['e', 'f']) {
    for (let col = 1; col <= 60; col++) {
      for (const rot of [0, 180]) {
        const legs = Parts.footprintLegs(type, row + col, rot);
        if (!legs || !legs.every(l => l.hole)) continue;
        if (Parts.checkPlacement(type, legs, new Map(), BOARD).ok) seats.push({ anchor: row + col, rot, legs });
      }
    }
  }
  return seats;
}

test('row a and tp sit nearest the viewer', () => {
  assert.ok(ROW_Z.a > ROW_Z.j, `a ${ROW_Z.a} should be nearer (larger Z) than j ${ROW_Z.j}`);
  assert.ok(ROW_Z.tp > ROW_Z.a, `tp ${ROW_Z.tp} should be nearer than a ${ROW_Z.a}`);
});

for (const [type, pinCount] of [['tl072', 8], ['seven_segment', 10]]) {
  test(`every valid ${type} seat runs counter-clockwise seen from above`, () => {
    const seats = validSeats(type);
    assert.ok(seats.length > 0, `no valid ${type} seats found`);
    const clockwise = [];
    for (const { anchor, rot, legs } of seats) {
      assert.equal(legs.length, pinCount);
      const area = signedArea(legs);
      if (!(area > 0)) clockwise.push(`${anchor}@${rot} (${area})`);
    }
    assert.deepStrictEqual(clockwise.slice(0, 5), [],
      `${clockwise.length} of ${seats.length} ${type} seats are not counter-clockwise`);
  });
}

test('a real notch-left TL072 in columns 30–33 is e30 right', () => {
  const legs = Parts.footprintLegs('tl072', 'e30', 0);
  assert.ok(legs, 'e30 right gives legs');
  assert.deepStrictEqual(holes(legs), ['e30', 'e31', 'e32', 'e33', 'f33', 'f32', 'f31', 'f30']);
  assert.deepStrictEqual(Parts.checkPlacement('tl072', legs, new Map(), BOARD), { ok: true });
});

test('notch-right is f33 left', () => {
  const legs = Parts.footprintLegs('tl072', 'f33', 180);
  assert.ok(legs, 'f33 left gives legs');
  assert.deepStrictEqual(holes(legs), ['f33', 'f32', 'f31', 'f30', 'e30', 'e31', 'e32', 'e33']);
  assert.deepStrictEqual(Parts.checkPlacement('tl072', legs, new Map(), BOARD), { ok: true });
});

test('f30 right is refused', () => {
  const r = Parts.checkPlacement('tl072', Parts.footprintLegs('tl072', 'f30', 0), new Map(), BOARD);
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('a chip must sit across the centre gap (rows e and f).'), `"${r.reason}"`);
});

test('potentiometer down still runs down the screen', () => {
  const legs = Parts.footprintLegs('potentiometer', 'j5', 90);
  assert.ok(legs, 'j5 down gives legs');
  assert.deepStrictEqual(holes(legs), ['j5', 'i5', 'h5']);
});
