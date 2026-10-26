// Content in the flipped board's printed hole names (mirror fix, Task 5).
//
// The board is flipped: row a and the tp/tn rails are nearest the viewer, a
// DIP chip's pins 1 -> N run counter-clockwise, and old saves migrate through
// T_A (a<->j, b<->i, c<->h, d<->g, e<->f, tp<->bp, tn<->bn; columns kept).
// Content (samples, labs, figures, docs boards) is rewritten by two rules
// (task-5-addendum.md, Rulings 21 and 22), computed here from the ORIGINAL
// literals captured from commit 99f0205 in test/fixtures/content-original/,
// never from the new code:
//   1. chip-less boards keep every hole; only `v: 2` is stamped;
//   2. boards with a TL072 / 7-segment are column-reflected (reflect() in
//      test/fixtures/recipe-reflect.js) and stamped `v: 2`;
//   3. the photo-tied samples match the photo's printed holes: thandi-blinker
//      by T_A, ensc-lab by columns c -> 64 - c with right <-> left.

const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const Parts   = require('../circuit3d/js/parts');
const Board   = require('../circuit3d/js/board-model.js');
const Chat    = require('../circuit3d/js/chat.js');
const BoardIO = require('../circuit3d/js/board-io.js');
const Ids     = require('../circuit3d/js/ids.js');
const G       = require('../circuit3d/js/board-geometry.js');
const { reflect, span } = require('./fixtures/recipe-reflect.js');
const { lab2Finish }    = require('./fixtures/lab2-finish.js');

const { ROW_Z } = G;
const PLUGGED   = path.join(__dirname, '..');
const ROOT      = path.join(PLUGGED, '..');
const ORIGINAL  = path.join(__dirname, 'fixtures', 'content-original');
const original  = name => JSON.parse(fs.readFileSync(path.join(ORIGINAL, name), 'utf8'));

// ── The content files: [path from the worktree root, original fixture, has a chip] ──
const FILES = [
  ['Plugged/demo.sparky',                          'demo.sparky',                                false],
  ['Plugged/circuit3d/labs/lab1.sparky',           'circuit3d_labs_lab1.sparky',                 false],
  ['Plugged/circuit3d/labs/lab1-start.sparky',     'circuit3d_labs_lab1-start.sparky',           false],
  ['Plugged/edison/demo/led.sparky',               'edison_demo_led.sparky',                     false],
  ['Plugged/edison/figures/divider.sparky',        'edison_figures_divider.sparky',              false],
  ['Plugged/edison/figures/ohm.sparky',            'edison_figures_ohm.sparky',                  false],
  ['Plugged/circuit3d/labs/lab2.sparky',           'circuit3d_labs_lab2.sparky',                 true],
  ['Plugged/edison/demo/inverting-amp.sparky',     'edison_demo_inverting-amp.sparky',           true],
  ['Plugged/edison/figures/inverting.sparky',      'edison_figures_inverting.sparky',            true],
  ['Plugged/edison/figures/non-inverting.sparky',  'edison_figures_non-inverting.sparky',        true],
  ['docs/boards/photo11-ensc-lab-bench.sparky',    'docs_boards_photo11-ensc-lab-bench.sparky',  true],
  ['docs/boards/photoexample-op-amp-blinker.sparky', 'docs_boards_photoexample-op-amp-blinker.sparky', true],
];
const load = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// ── Saved records <-> Example form (hole names), so reflect() applies ──
// holeRef { col (0-based), row } <-> "e30" / "tp_30".
const nameOf = r => (/^[a-j]$/.test(r.row) ? r.row + (r.col + 1) : r.row + '_' + (r.col + 1));
const refOf  = (name, like) => {
  const m = /^(?:([a-j])(\d+)|(tp|tn|bn|bp)_(\d+))$/.exec(name);
  return { ...like, col: Number(m[2] || m[4]) - 1, row: m[1] || m[3] };
};
const sameRefs = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function toExample(data) {
  // older files leave a part's label off; the page names it by placement order
  const labels = [];
  data.components.forEach(c => labels.push(c.label || Ids.nextLabel(labels.map(l => ({ label: l })), c.type)));
  const label = i => labels[i];
  const end = (hole, ci, pi) => (hole ? nameOf(hole) : `${label(ci)}.${pi}`);
  return {
    parts: data.components.map((c, i) => (Array.isArray(c.holeRefs)
      ? { type: c.type, label: labels[i], holes: c.holeRefs.map(nameOf), values: c.values }
      : { type: c.type, label: labels[i], values: c.values })),
    wires: data.wires.map(w => [end(w.startHole, w.startCompIdx, w.startPinIdx),
                                end(w.endHole, w.endCompIdx, w.endPinIdx)]),
  };
}

// The original file's records with the reflected holes written back, `v` not set.
function reflectedRecords(data, cut) {
  const ex = cut ? cut(toExample(data)) : toExample(data);
  const out = reflect(ex);
  return {
    components: data.components.map((c, i) => (Array.isArray(c.holeRefs)
      ? { ...c, holeRefs: c.holeRefs.map((r, k) => refOf(out.parts[i].holes[k], r)) } : { ...c })),
    wires: data.wires.map((w, i) => {
      const [a, b] = out.wires[i];
      return { ...w,
        ...(w.startHole ? { startHole: refOf(a, w.startHole) } : {}),
        ...(w.endHole   ? { endHole:   refOf(b, w.endHole) }   : {}) };
    }),
  };
}

const withoutV = r => { const { v, ...rest } = r; return rest; };   // eslint-disable-line no-unused-vars

// ── The page's own apply path, in Node (as test/sample-boards.test.js) ──
const HOLE = /^(?:([a-j])(\d+)|(tp|tn|bn|bp)_(\d+))$/;
function holeRef(s) {
  const m = HOLE.exec(String(s));
  if (!m) return null;
  return m[1] ? { col: Number(m[2]) - 1, row: m[1] } : { col: Number(m[4]) - 1, row: m[3] };
}
function pageBoard() {
  const parts = [], wires = [], notes = [];
  const wireEnd = (e, side) => (e.hole
    ? { [side + 'Hole']: { col: e.hole.col, row: e.hole.row }, [side + 'Comp']: null, [side + 'PinIdx']: -1 }
    : { [side + 'Hole']: null, [side + 'Comp']: e.comp, [side + 'PinIdx']: e.pin });
  return {
    notes,
    note:        text => notes.push(text),
    components:  () => parts,
    batterySpot: () => ({ x: 15.8, z: -3.15 }),
    parseHole:   s => { const r = holeRef(s); if (!r) throw new Error('parseHole: ' + s); return r; },
    getHole:     (col, row) => ({ col, row }),
    holeMap:     () => BoardIO.buildHoleMap(parts, wires),
    placePart(type, where, values) {
      const def = Parts.get(type);
      const rec = { type, label: Ids.nextLabel(parts, type), pins: def.pins.map(() => ({ x: 0, y: 0, z: 0 })),
                    holeRefs: Array.isArray(where) ? where.map(h => ({ col: h.col, row: h.row })) : null,
                    position: Array.isArray(where) ? undefined : where, values: Object.assign({}, values) };
      parts.push(rec);
      return rec;
    },
    setValues:   (comp, v) => { comp.values = Object.assign({}, comp.values, v); },
    setControls: (comp, c) => { comp.controls = Object.assign({}, comp.controls, c); },
    deletePart:  () => { throw new Error('content deletes nothing'); },
    deleteWire:  () => false,
    clearAll:    () => { parts.length = 0; wires.length = 0; },
    addWire(from, to) { wires.push(Object.assign({}, wireEnd(from, 'start'), wireEnd(to, 'end'))); return true; },
    batch:       fn => fn(),
  };
}

// Every placement and wire of an action list goes through the page's checks.
function applyOnPage(actions) {
  const board = pageBoard();
  const out = Chat.applyActions(actions.map(a => ({ ...a })), board);
  return { notes: board.notes, applied: out.applied, failed: out.failed, failedActions: out.failedActions };
}

// Shoelace area of a chip's pins in pin order (x = column, y = -ROW_Z): > 0 is counter-clockwise.
function signedArea(holes) {
  const pts = holes.map(h => ({ x: Number(h.slice(1)), z: ROW_Z[h[0]] }));
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    sum += a.x * -b.z - b.x * -a.z;
  }
  return sum / 2;
}
const STRADDLE = new Set(['tl072', 'seven_segment']);

function samples() {
  const file = path.join(PLUGGED, 'circuit3d', 'samples', 'samples.js');
  const window = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window }, { filename: file });
  return JSON.parse(JSON.stringify(window.PhotoSamples));
}

// ── 1. The rehearsed samples ──
test('rehearsed samples use the photo\'s printed holes', () => {
  const S = samples();
  const chip = (id, actions = S[id].board) => actions.filter(a => a.tool === 'place_tl072').map(a => `${a.hole} ${a.direction}`);
  assert.deepStrictEqual(chip('ensc-lab'), ['f7 left'], 'ensc-lab\'s TL072');
  assert.deepStrictEqual(chip('thandi-blinker'), ['e27 right'], 'thandi\'s photographed chip');
  assert.deepStrictEqual(chip('thandi-blinker', S['thandi-blinker'].fix.actions), ['f32 left'], 'thandi\'s fix chip');
});

// thandi-blinker is the picture-faithful T_A of the original, ensc-lab is the
// column map c -> 64 - c with right <-> left (rows kept); both computed from
// the original literals.
const T_A = { a: 'j', b: 'i', c: 'h', d: 'g', e: 'f', f: 'e', g: 'd', h: 'c', i: 'b', j: 'a', tp: 'bp', tn: 'bn', bp: 'tp', bn: 'tn' };
const mapHole = (name, f) => {
  const m = /^(tp|tn|bn|bp|[a-j])(_?)(\d+)$/.exec(name);
  return m ? f(m[1], Number(m[3]), m[2]) : name;
};
const viaTA  = name => mapHole(name, (row, col, us) => T_A[row] + us + col);
const viaCol = name => mapHole(name, (row, col, us) => row + us + (64 - col));
const SWAP = { right: 'left', left: 'right' };
const HOLE_KEYS = ['hole', 'holeA', 'holeB', 'from', 'to'];
const mapAction = (a, f, dir) => {
  const out = { ...a };
  for (const k of HOLE_KEYS) if (typeof out[k] === 'string') out[k] = f(out[k]);
  if (dir && out.direction) out.direction = dir(out.direction);
  return out;
};

test('thandi-blinker\'s board and fix are T_A of the original (rows a<->j ..., columns kept), its text names the new holes', () => {
  const orig = original('samples-original.json')['thandi-blinker'];
  const now  = samples()['thandi-blinker'];
  assert.deepStrictEqual(now.board, orig.board.map(a => mapAction(a, viaTA)), 'the photographed board');
  assert.deepStrictEqual(now.fix.actions, orig.fix.actions.map(a => mapAction(a, viaTA)), 'the fix');
  assert.ok(now.explain.includes('f32') && !/\be32\b/.test(now.explain), `explain says f32, not e32: ${now.explain}`);
  assert.ok(now.fix.reply.includes('f32') && !/\be32\b/.test(now.fix.reply), `fix reply says f32, not e32: ${now.fix.reply}`);
  assert.ok(now.fix.reply.includes('j29 → bn_29') && !now.fix.reply.includes('a29'), `fix reply names the wire j29 → bn_29: ${now.fix.reply}`);
});

test('ensc-lab\'s board is the original with columns c -> 64 - c and right <-> left, rows unchanged', () => {
  const orig = original('samples-original.json')['ensc-lab'];
  const now  = samples()['ensc-lab'];
  assert.deepStrictEqual(now.board, orig.board.map(a => mapAction(a, viaCol, d => SWAP[d] || d)));
});

// ── 2. Validity and handedness ──
const BOARD = { cols: 63, bodyRows: G.BODY_ROWS };

// A saved file is loaded as it is (no AI-path rules such as "one bench supply"
// or "3-5 columns apart"), so a file part is valid when every hole is on the
// board and a chip sits in a legal seat of its type; samples go through the
// page's own apply path.
function fileProblems(id, board) {
  const out = [];
  for (const p of board.parts) {
    if (!p.holes) continue;
    for (const h of p.holes) {
      const r = holeRef(h);
      if (!r || r.col < 0 || r.col >= BOARD.cols) out.push(`${id}: ${p.label} hole ${h} is off the board`);
    }
    if (!STRADDLE.has(p.type)) continue;
    const dir = Object.keys(Board.ROTATION).find(d => {
      const legs = Parts.footprintLegs(p.type, p.holes[0], Board.ROTATION[d]);
      return legs && legs.map(l => l.hole).join() === p.holes.join();
    });
    const legs = dir && Parts.footprintLegs(p.type, p.holes[0], Board.ROTATION[dir]);
    const check = legs && Parts.checkPlacement(p.type, legs, new Map(), BOARD);
    if (!check || !check.ok) out.push(`${id}: ${p.label} (${p.holes.join(' ')}) is refused: ${check ? check.reason : 'no seat has those legs'}`);
    if (!(signedArea(p.holes) > 0)) out.push(`${id}: ${p.label} (${p.holes.join(' ')}) is not counter-clockwise`);
  }
  return out;
}

test('every content board is valid and its chips run counter-clockwise', () => {
  const problems = [];
  for (const [rel] of FILES) problems.push(...fileProblems(rel, Board.fromExample(toExample(load(rel)))));
  for (const [id, s] of Object.entries(samples())) {
    if (!s.board) continue;
    const out = applyOnPage(s.board);
    if (out.notes.length || out.failed) problems.push(`sample ${id}: ${out.failed} refused ${JSON.stringify(out.failedActions)} ${JSON.stringify(out.notes)}`);
    problems.push(...fileProblems('sample ' + id, Board.apply(Board.empty(), s.board).board));
    for (const a of ((s.fix && s.fix.actions) || []).filter(x => x.tool === 'place_tl072')) {
      const legs = Parts.footprintLegs('tl072', a.hole, Board.ROTATION[a.direction]);
      if (!legs || !legs.every(l => l.hole)) problems.push(`sample ${id} fix: ${a.hole} ${a.direction} has no legs`);
      else if (!(signedArea(legs.map(l => l.hole)) > 0)) problems.push(`sample ${id} fix: ${a.hole} ${a.direction} is not counter-clockwise`);
      else if (!Parts.checkPlacement('tl072', legs, new Map(), BOARD).ok) problems.push(`sample ${id} fix: ${a.hole} ${a.direction} is refused`);
    }
  }
  assert.deepStrictEqual(problems, []);
});

// ── 3. v2 ──
test('every content file is v2', () => {
  const stale = [];
  for (const [rel] of FILES) {
    const d = load(rel);
    d.components.forEach((c, i) => { if (c.v !== 2) stale.push(`${rel} component ${i} (${c.label}) v=${c.v}`); });
    d.wires.forEach((w, i) => { if (w.v !== 2) stale.push(`${rel} wire ${i} v=${w.v}`); });
    if ('version' in d && d.version !== 2) stale.push(`${rel} file version=${d.version}`);
  }
  assert.deepStrictEqual(stale, []);
});

// ── 4. Rule 1: chip-less content keeps its holes ──
test('chip-less content keeps its holes', () => {
  const changed = [];
  for (const [rel, fx, chip] of FILES.filter(f => !f[2])) {
    const orig = original(fx), now = load(rel);
    if (now.components.length !== orig.components.length || now.wires.length !== orig.wires.length) { changed.push(`${rel}: record counts`); continue; }
    now.components.forEach((c, i) => { if (!sameRefs(withoutV(c), orig.components[i])) changed.push(`${rel} component ${i} (${c.label})`); });
    now.wires.forEach((w, i) => { if (!sameRefs(withoutV(w), orig.wires[i])) changed.push(`${rel} wire ${i}`); });
    assert.equal(chip, false);
  }
  assert.deepStrictEqual(changed, []);
});

// ── 5. Rule 2: chip content is the column reflection of the original ──
test('chip content is the column reflection of the original', () => {
  const off = [];
  for (const [rel, fx] of FILES.filter(f => f[2])) {
    const want = reflectedRecords(original(fx)), now = load(rel);
    if (now.components.length !== want.components.length || now.wires.length !== want.wires.length) { off.push(`${rel}: record counts`); continue; }
    now.components.forEach((c, i) => { if (!sameRefs(withoutV(c), want.components[i])) off.push(`${rel} component ${i} (${c.label}): ${JSON.stringify(c.holeRefs)} want ${JSON.stringify(want.components[i].holeRefs)}`); });
    now.wires.forEach((w, i) => { if (!sameRefs(withoutV(w), want.wires[i])) off.push(`${rel} wire ${i}`); });
  }
  assert.deepStrictEqual(off, []);
});

// ── 6. The literal sets that refer to the chip boards ──
// Lab 2's board is the column reflection about its starter's own span (the
// chip, columns 30..33, so c -> 63 - c): the finishing work, the heat-map and
// the sheet all use that same map.
function lab2Sum() {
  const { cmin, cmax } = span(toExample(original('circuit3d_labs_lab2.sparky')));
  return cmin + cmax;
}
const flipWith = (sum, h) => {
  const m = /^([a-j])(\d+)$/.exec(h), r = /^(tp|tn|bp|bn)_(\d+)$/.exec(h);
  return m ? m[1] + (sum - Number(m[2])) : r ? r[1] + '_' + (sum - Number(r[2])) : h;
};

test('lab 2\'s finishing fixture is the column reflection of the original finishing work (chip f33 left, c -> 63 - c)', () => {
  const old = original('lab2-finish-original.json');
  const sum = lab2Sum();
  assert.equal(sum, 63, 'Lab 2\'s starter spans columns 30..33');
  const isBodyHole = h => /^[a-j]\d+$/.test(h), isRailHole = h => /^(tp|tn|bp|bn)_\d+$/.test(h);
  // a rail end moves only when the wire's other end is a body hole
  const wire = ([a, b]) => (isBodyHole(a) && isRailHole(b) ? [flipWith(sum, a), flipWith(sum, b)]
    : isRailHole(a) && isBodyHole(b) ? [flipWith(sum, a), flipWith(sum, b)]
    : [flipWith(sum, a), flipWith(sum, b)].map((h, i) => (isBodyHole([a, b][i]) ? h : [a, b][i])));
  const part = p => ({ ...p, holes: p.holes.map(h => flipWith(sum, h)) });
  const want = {};
  for (const stage of ['supply', 'input', 'feedback']) {
    want[stage] = { parts: old.finish[stage].parts.map(part), wires: old.finish[stage].wires.map(wire) };
  }
  const chip = Object.fromEntries(Object.entries(old.holes).map(([pin, h]) => [pin, flipWith(sum, h)]));
  assert.deepStrictEqual(chip, { out1: 'f33', in1n: 'f32', in1p: 'f31', vneg: 'f30', vpos: 'e33' });
  assert.deepStrictEqual(lab2Finish(chip), want);
});

test('the course heat-map\'s Lab 2 holes are the column reflection of the original (c -> 63 - c)', () => {
  const D = require('../edison/course-data.js');
  const orig = { e30: 'V+ (pin 8) not wired', f33: 'V− (pin 4) not wired', g32: 'Rin on pin 3 instead of pin 2',
                 e31: 'Rf taken from pin 7 instead of pin 1', j27: 'Generator lead one column off' };
  const want = Object.entries(orig).map(([h, note]) => ({ hole: flipWith(63, h), note }));
  assert.deepStrictEqual(D.heatmap.cells.map(c => ({ hole: c.hole, note: c.note })), want);
});

// ── 7. The eval's captured boards carry the current topology text ──
// scripts/ai-eval-boards/*.json hold App.exportMarkdown() as captured, whose
// last section is App.boardTopologyText() (breadboard.js, generated from
// GEOMETRY): tp / tn sit beside row a now, bp / bn beside row j. A board
// captured before the flip still says "top half" and "positive top rail".
test('the eval\'s captured boards carry the current breadboard topology text', () => {
  const rows = G.BODY_ROWS, t0 = rows[0], b1 = rows[rows.length - 1];
  const dir = path.join(PLUGGED, 'scripts', 'ai-eval-boards');
  const stale = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
    const md = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).markdown;
    for (const line of [`- tp = positive rail beside row ${t0} (+), tn = negative rail beside row ${t0} (GND).`,
                        `- bp = positive rail beside row ${b1} (+), bn = negative rail beside row ${b1} (−).`]) {
      if (!md.includes(line)) stale.push(`${f} lacks: ${line}`);
    }
    if (/top half|positive top rail|positive bottom rail/.test(md)) stale.push(`${f} still has the old topology wording`);
  }
  assert.deepStrictEqual(stale, []);
});
