// Ruling 21: the AI-facing TL072 and 7-segment recipes and examples on the
// flipped board. The board's rows are mirrored (row a nearest the viewer), but
// Edison's conventions are not: the + terminal goes to tp, COM to tn, − to bn,
// and the recipe keeps its rows and rail names. What changes is the chip's
// handedness: each recipe is the ORIGINAL (commit 8fa7ac8, captured in
// test/fixtures/recipes-original.js) reflected about the middle of its own
// columns (test/fixtures/recipe-reflect.js), so a chip seated "f30 right" is
// seated "f33 left", and runs counter-clockwise seen from above like a real DIP.
//
// Ruling 24 supersedes that for the 7-segment display: its face is a digit, and
// the column reflection turns it upside down on the flipped board (a 180
// degree turn of the old picture, not a left-right flip). So its guide,
// recipe and example are the ORIGINAL mapped through T_A (restores the old
// picture exactly): pins 1-5 on row e running right, body holes and the
// rail-to-body wires through the row map, BAT1 -> tp_63 / tn_63 kept, and the
// tp_1 -> bp_1 / tn_1 -> bn_1 bridges present (upright() in
// test/fixtures/recipe-reflect.js). The TL072 keeps Ruling 21.
//
// Pure logic: the recipes' own data, the board model and the geometry. No
// network, no browser.

const assert = require('node:assert');
const Parts    = require('../circuit3d/js/parts');
const Board    = require('../circuit3d/js/board-model.js');
const Geometry = require('../circuit3d/js/board-geometry.js');
const ORIGINAL = require('./fixtures/recipes-original.js');
const { reflect, upright, partition } = require('./fixtures/recipe-reflect.js');
const { recipeActions } = require('./fixtures/recipe-steps.js');

const TYPES = ['tl072', 'seven_segment'];
const listOf = x => [x.recipe, ...(x.recipes || []), ...(x.examples || [])].filter(Boolean);
const current = type => { const d = Parts.get(type); return listOf({ recipe: d.ai.recipe, recipes: d.ai.recipes, examples: d.examples }); };
const original = type => listOf(ORIGINAL[type]);

const CASES = [];
const REFLECTED = c => c[0] === 'tl072';     // Ruling 21 cases; the 7-segment is Ruling 24 (below)
for (const type of TYPES) {
  const now = current(type), was = original(type);
  test(`${type}: the app has the same number of recipes and examples as the original (${was.length})`, () => {
    assert.strictEqual(now.length, was.length, now.map(e => e.name).join(' | '));
  });
  now.forEach((ex, i) => CASES.push([type, ex, was[i]]));
}

// (a) Every recipe/example is a valid placement on the flipped board.
test('(a) every TL072 and 7-segment recipe and example turns into actions the flipped board accepts (no "no direction puts its legs" / "no legs for hole")', () => {
  const bad = [];
  for (const [type, ex] of CASES) {
    let actions;
    try { actions = recipeActions(ex); } catch (e) { bad.push(`${type} "${ex.name}": ${e.message}`); continue; }
    const { errors } = Board.apply(Board.empty(), actions.map(a => ({ ...a })));
    for (const err of errors) bad.push(`${type} "${ex.name}": ${JSON.stringify(err)}`);
  }
  assert.deepStrictEqual(bad, []);
});

// (b) Every straddle chip runs counter-clockwise: pins 1 → N, x = column,
// y = −ROW_Z[row] (the screen's up), signed area > 0.
const signedArea = holes => {
  const pts = holes.map(h => ({ x: Number(h.slice(1)), y: -Geometry.ROW_Z[h[0]] }));
  let s = 0;
  pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; });
  return s / 2;
};

test('(b) every TL072 in a recipe or example runs counter-clockwise (pins 1 → N, signed area > 0)', () => {
  const bad = [];
  let chips = 0;
  for (const [type, ex] of CASES.filter(REFLECTED)) {
    for (const p of ex.parts) {
      if (!Parts.get(p.type).place.straddle) continue;
      chips++;
      const area = signedArea(p.holes);
      if (!(area > 0)) bad.push(`${type} "${ex.name}": ${p.label} ${p.holes.join(' ')} has signed area ${area}`);
    }
  }
  assert.ok(chips >= 4, `sanity: ${chips} chips seen`);
  assert.deepStrictEqual(bad, []);
});

test('(b, sanity) the original chips ran clockwise on the old board, and the rule turns them counter-clockwise', () => {
  const chip = ORIGINAL.tl072.recipe.parts.find(p => p.type === 'tl072').holes;
  assert.ok(signedArea(chip) < 0, 'the old f30 right is clockwise on the flipped board');
  assert.ok(signedArea(reflect(ORIGINAL.tl072.recipe).parts.find(p => p.type === 'tl072').holes) > 0, 'its reflection is not');
});

// (c) The netlist equals the original's under the reflection: the partition
// of part pins and off-board terminals into nodes is the same.
test('(c) each TL072 recipe/example has the netlist of the original recipe reflected (same partition of part pins into nodes)', () => {
  const bad = [];
  for (const [type, ex, orig] of CASES.filter(REFLECTED)) {
    const want = partition(reflect(orig)), got = partition(ex);
    // the original's own partition (reflection keeps nodes), as a check on the helper
    assert.deepStrictEqual(partition(orig), want, `${type} "${orig.name}": reflecting must not change the netlist`);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${type} "${ex.name}":\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
  assert.deepStrictEqual(bad, []);
});

// (c') and literally: the same holes, the same wires, the rule's own result.
const pair = w => w.slice().sort().join(' ~ ');
test('(c) each TL072 recipe/example is exactly the original with its columns reflected: every part\'s holes and every wire', () => {
  const bad = [];
  for (const [type, ex, orig] of CASES.filter(REFLECTED)) {
    const want = reflect(orig);
    const holes = e => e.parts.map(p => `${p.label}: ${(p.holes || []).join(' ')}`);
    if (JSON.stringify(holes(ex)) !== JSON.stringify(holes(want))) bad.push(`${type} "${ex.name}" parts:\n  got  ${holes(ex).join(' | ')}\n  want ${holes(want).join(' | ')}`);
    const wires = e => e.wires.map(pair).sort();
    if (JSON.stringify(wires(ex)) !== JSON.stringify(wires(want))) bad.push(`${type} "${ex.name}" wires:\n  got  ${wires(ex).join(' | ')}\n  want ${wires(want).join(' | ')}`);
  }
  assert.deepStrictEqual(bad, []);
});

// (d) Edison's conventions hold in every recipe: + on tp, COM on tn, − on bn.
test('(d) conventions: BAT1.0 / PS1.0 → tp_N, BAT1.1 / PS1.1 → tn_N, PS1.2 → bn_N, FG1.1 → tn whenever those terminals are wired', () => {
  const want = { 'BAT1.0': 'tp', 'PS1.0': 'tp', 'BAT1.1': 'tn', 'PS1.1': 'tn', 'PS1.2': 'bn', 'PS1.3': 'tn', 'FG1.1': 'tn' };
  const bad = [];
  let seen = 0;
  for (const [type, ex] of CASES) {
    for (const [a, b] of ex.wires) {
      for (const [term, other] of [[a, b], [b, a]]) {
        if (!(term in want)) continue;
        seen++;
        if (!new RegExp(`^${want[term]}_\\d+$`).test(other)) bad.push(`${type} "${ex.name}": ${term} → ${other}, want ${want[term]}_N`);
      }
    }
  }
  assert.ok(seen >= 15, `sanity: ${seen} terminal wires seen`);
  assert.deepStrictEqual(bad, []);
});

test('(d) the TL072 guide keeps the conventional rails (V+ tp, V− bn, COM tn, comparator V− tn) and names no bp', () => {
  const guide = Parts.get('tl072').ai.guide;
  for (const s of ['V+ tp', 'V− bn', 'COM tn', 'V− tn']) assert.ok(guide.includes(s), `the guide lacks "${s}": ${guide}`);
  assert.doesNotMatch(guide, /\bbp\b/, guide);
});

test('(c) the TL072 guide seats the chip as the reflected original: "hole=fC, left: 1-4 fC..fC-3, 8-5 eC..eC-3" (the original was right, fC..fC+3 / eC..eC+3)', () => {
  const guide = Parts.get('tl072').ai.guide;
  assert.ok(guide.includes('hole=fC, left'), guide);
  assert.ok(guide.includes('1-4 fC..fC-3'), guide);
  assert.ok(guide.includes('8-5 eC..eC-3'), guide);
});


// ── Ruling 24: the 7-segment recipe and examples are upright ──────────────────

const SEVEN = CASES.filter(c => c[0] === 'seven_segment');
const holeNames = legs => legs.map(l => l.row + (l.col + 1));

test('7-segment: the app has the digit-7 recipe and the digit-1 example, and each seats the display at e30 facing right (Parts.footprintLegs)', () => {
  assert.strictEqual(SEVEN.length, 2, SEVEN.map(c => c[1].name).join(' | '));
  const want = holeNames(Parts.footprintLegs('seven_segment', 'e30', 0));
  assert.deepStrictEqual(want, ['e30', 'e31', 'e32', 'e33', 'e34', 'f34', 'f33', 'f32', 'f31', 'f30']);
  for (const [, ex] of SEVEN) {
    assert.deepStrictEqual(ex.parts.find(p => p.type === 'seven_segment').holes, want, ex.name);
  }
});

test('7-segment: each recipe/example is exactly the ORIGINAL through T_A: every part\'s holes and every wire, plus the tp_1 -> bp_1 and tn_1 -> bn_1 bridges', () => {
  const bad = [];
  for (const [, ex, orig] of SEVEN) {
    const want = upright(orig);
    const holes = e => e.parts.map(p => `${p.label}: ${(p.holes || []).join(' ')}`);
    if (JSON.stringify(holes(ex)) !== JSON.stringify(holes(want))) bad.push(`"${ex.name}" parts:\n  got  ${holes(ex).join(' | ')}\n  want ${holes(want).join(' | ')}`);
    const wires = e => e.wires.map(pair).sort();
    if (JSON.stringify(wires(ex)) !== JSON.stringify(wires(want))) bad.push(`"${ex.name}" wires:\n  got  ${wires(ex).join(' | ')}\n  want ${wires(want).join(' | ')}`);
    // by hand, for the digit-7 recipe: the bridges and the mapped feeds
    for (const w of ['tp_1 ~ bp_1', 'tn_1 ~ bn_1', 'BAT1.0 ~ tp_63', 'BAT1.1 ~ tn_63']) {
      if (!wires(ex).includes(w)) bad.push(`"${ex.name}" lacks the wire ${w}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('7-segment: the netlist equals the original\'s (same partition of part pins into nodes); the two bridges only join the new bp / bn rails to tp / tn', () => {
  const bad = [];
  for (const [, ex, orig] of SEVEN) {
    const got = partition(ex), want = partition(orig);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`"${ex.name}":\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
  assert.deepStrictEqual(bad, []);
});

// The display's face, from the real geometry. The part (parts/seven_segment.js
// view.build) turns its face group about y by atan2(-right.z, right.x), right =
// pin 5 - pin 1 in the world; a bar sits at (x + shift - z * SLANT, z) in that
// group, with a at z = -H2 (the digit's top) and d at +H2, the dot at
// (W2 + shift + 0.2 - H2 * SLANT, H2). The screen's up is -z (ROW_Z: larger z is
// nearer the viewer) and its right is +x (the column).
const DIGIT_W = 0.78, DIGIT_H = 1.26, SLANT = 0.1, SHIFT = -0.1;
const W2 = DIGIT_W / 2, H2 = DIGIT_H / 2;
const BAR_AT = {
  a:  [0 + SHIFT - (-H2) * SLANT, -H2],
  d:  [0 + SHIFT - (H2) * SLANT, H2],
  dp: [W2 + SHIFT + 0.2 - H2 * SLANT, H2],
};
function faceOnScreen(holes) {
  const pts = holes.map(h => ({ x: Number(h.slice(1)) * Geometry.HS, z: Geometry.ROW_Z[h[0]] }));
  const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
  const right = { x: pts[4].x - pts[0].x, z: pts[4].z - pts[0].z };
  const th = Math.atan2(-right.z, right.x);
  const out = {};
  for (const [name, [lx, lz]] of Object.entries(BAR_AT)) {
    out[name] = { x: mid.x + lx * Math.cos(th) + lz * Math.sin(th), up: -(mid.z - lx * Math.sin(th) + lz * Math.cos(th)) };
  }
  return out;
}

test('7-segment (sanity of the face helper): the old f39 left seat has segment a BELOW segment d (the "7" read as "L"), e30 right has it above', () => {
  const left = faceOnScreen(['f39', 'f38', 'f37', 'f36', 'f35', 'e35', 'e36', 'e37', 'e38', 'e39']);
  assert.ok(left.a.up < left.d.up, JSON.stringify(left));
  const right = faceOnScreen(holeNames(Parts.footprintLegs('seven_segment', 'e30', 0)));
  assert.ok(right.a.up > right.d.up, JSON.stringify(right));
});

test('the 7-segment face is upright in every recipe and example: segment a projects above segment d, the decimal point at the bottom right', () => {
  const bad = [];
  for (const [, ex] of SEVEN) {
    const f = faceOnScreen(ex.parts.find(p => p.type === 'seven_segment').holes);
    if (!(f.a.up > f.d.up)) bad.push(`"${ex.name}": segment a is not above d (screen up a ${f.a.up.toFixed(2)}, d ${f.d.up.toFixed(2)})`);
    if (!(f.dp.up < f.a.up && f.dp.x > f.a.x && f.dp.x > f.d.x)) bad.push(`"${ex.name}": the dot is not at the bottom right: ${JSON.stringify(f)}`);
  }
  assert.deepStrictEqual(bad, []);
});
