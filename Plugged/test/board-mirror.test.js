// Tests for circuit3d/js/board-mirror.js: the row map T_A (a<->j ... tp<->bp,
// tn<->bn) and the v1 -> v2 saved-record migration. Pure, not wired in yet.

const assert = require('node:assert');
const { ALL_ROWS } = require('../circuit3d/js/board-geometry.js');
const BM = require('../circuit3d/js/board-mirror.js');

const EXPECTED = { a:'j', b:'i', c:'h', d:'g', e:'f', f:'e', g:'d', h:'c', i:'b', j:'a',
                   tp:'bp', tn:'bn', bn:'tn', bp:'tp' };

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

const ref = (pin, col, row) => ({ pin, col, row });

test('mirrorRef swaps every row and keeps the column', () => {
  assert.equal(BM.RECORD_VERSION, 2);
  assert.deepStrictEqual(BM.MIRROR_ROW, EXPECTED);
  assert.deepStrictEqual(BM.mirrorRef({ col: 4, row: 'a', pin: '1' }), { col: 4, row: 'j', pin: '1' });
  assert.equal(Object.keys(EXPECTED).length, 14);
  for (const [from, to] of Object.entries(EXPECTED)) {
    assert.deepStrictEqual(BM.mirrorRef({ col: 7, row: from, pin: 'x' }), { col: 7, row: to, pin: 'x' }, from);
  }
  assert.equal(BM.mirrorRef(null), null);
  assert.deepStrictEqual(BM.mirrorRef({ col: 1, row: 'zz' }), { col: 1, row: 'zz' });
});

test('mirrorRef is its own inverse', () => {
  for (const row of ALL_ROWS) {
    for (let col = 0; col <= 62; col++) {
      const x = { col, row, pin: 'p' };
      assert.deepStrictEqual(BM.mirrorRef(BM.mirrorRef(x)), x);
    }
  }
});

test('mirrorHoleName maps body and rail names and leaves the rest', () => {
  assert.equal(BM.mirrorHoleName('a12'), 'j12');
  assert.equal(BM.mirrorHoleName('e30'), 'f30');
  assert.equal(BM.mirrorHoleName('tp_5'), 'bp_5');
  assert.equal(BM.mirrorHoleName('bn_63'), 'tn_63');
  assert.equal(BM.mirrorHoleName('off'), 'off');
  assert.equal(BM.mirrorHoleName('gap'), 'gap');
  assert.equal(BM.mirrorHoleName('?'), '?');
});

test('a v1 TL072 seated f30 right migrates to the holes of e30 right', () => {
  const v1 = {
    type: 'tl072',
    holeRefs: [
      ref('1', 29, 'f'), ref('2', 30, 'f'), ref('3', 31, 'f'), ref('4', 32, 'f'),
      ref('5', 32, 'e'), ref('6', 31, 'e'), ref('7', 30, 'e'), ref('8', 29, 'e'),
    ],
  };
  const out = BM.migrateRecords({ components: [v1], wires: [] }).components[0];
  assert.deepStrictEqual(out.holeRefs.map(h => h.row), ['e','e','e','e','f','f','f','f']);
  assert.deepStrictEqual(out.holeRefs.map(h => h.col), [29,30,31,32,32,31,30,29]);
  assert.deepStrictEqual(out.holeRefs.map(h => h.pin), ['1','2','3','4','5','6','7','8']);
  assert.equal(out.v, 2);
});

test('wire ends mirror, null ends stay null, everything else is kept', () => {
  const w = { startHole: { col: 30, row: 'tp' }, endHole: null, startCompIdx: -1, endCompIdx: 2, endPin: '8', color: 'red' };
  const out = BM.migrateRecords({ components: [], wires: [w] }).wires[0];
  assert.equal(out.startHole.row, 'bp');
  assert.equal(out.startHole.col, 30);
  assert.equal(out.endHole, null);
  assert.equal(out.startCompIdx, -1);
  assert.equal(out.endCompIdx, 2);
  assert.equal(out.endPin, '8');
  assert.equal(out.color, 'red');
  assert.equal(out.v, 2);
});

test('current records are returned unchanged', () => {
  assert.equal(BM.isCurrent({ v: 2 }), true);
  assert.equal(BM.isCurrent({ v: 3 }), true);
  assert.equal(BM.isCurrent({}), false);
  assert.equal(BM.isCurrent({ v: 1 }), false);
  const c2 = { type: 'led', v: 2, holeRefs: [ref('a', 3, 'a')] };
  const c3 = { type: 'led', v: 3, holeRefs: [ref('a', 3, 'a')] };
  const w2 = { v: 2, startHole: { col: 1, row: 'b' }, endHole: { col: 2, row: 'tp' } };
  const out = BM.migrateRecords({ components: [c2, c3], wires: [w2] });
  assert.deepStrictEqual(out.components[0], c2);
  assert.deepStrictEqual(out.components[1], c3);
  assert.deepStrictEqual(out.wires[0], w2);
});

test('position, values, label and controls are untouched', () => {
  const c = {
    type: 'resistor', position: { x: 1.5, y: 0, z: -2 }, values: { resistance: 4700 },
    label: 'R1', controls: { knob: 0.3 }, holeRefs: [ref('1', 5, 'c'), ref('2', 9, 'c')],
  };
  const top = { name: 'demo', extra: [1, 2, 3] };
  const out = BM.migrateRecords({ ...top, components: [c], wires: [] });
  const o = out.components[0];
  assert.deepStrictEqual(o.position, c.position);
  assert.deepStrictEqual(o.values, c.values);
  assert.equal(o.label, 'R1');
  assert.deepStrictEqual(o.controls, c.controls);
  assert.equal(o.holeRefs[0].row, 'h');
  assert.equal(out.name, 'demo');
  assert.deepStrictEqual(out.extra, [1, 2, 3]);
});

test('the input is not mutated', () => {
  const input = {
    components: [{ type: 'tl072', label: 'U1', holeRefs: [ref('1', 29, 'f'), ref('8', 29, 'e')] }],
    wires: [{ startHole: { col: 30, row: 'tp' }, endHole: null, color: 'red' }],
  };
  const saved = JSON.parse(JSON.stringify(input));
  deepFreeze(input);
  let out;
  assert.doesNotThrow(() => { out = BM.migrateRecords(input); });
  assert.deepStrictEqual(input, saved);
  assert.notStrictEqual(out, input);
});

test("an unknown part type's holeRefs mirror too", () => {
  const out = BM.migrateRecords({ components: [{ type: 'flux_capacitor', holeRefs: [{ col: 1, row: 'b' }] }], wires: [] });
  assert.equal(out.components[0].holeRefs[0].row, 'i');
  assert.equal(out.components[0].holeRefs[0].col, 1);
});
