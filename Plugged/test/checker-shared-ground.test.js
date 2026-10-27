// The server's circuit checker (findCircuitProblems) on the standard bench
// (issue #9): a bench supply and a function generator sharing the ground
// rail. A backwards LED on the supply is still named, whatever the
// generator beside it does; the clean builds still give [].
//
// Run with:  npm test
//
// What these tests hold the checker to (the issue's rule): a diode is
// backwards when, for some single source pair, its cathode is on that
// pair's + side and its anode on that pair's − side, and no single pair
// (including a crossing generator's reversed pair, #3) has it forward. One
// source's + is never mixed with another source's − (the bench supply's
// own pairs, pos → com → neg in series, still make a load across the full
// ± span forward: test/bench-supply-ai.test.js's #77 pins). Every message
// keeps today's wording, word for word.
//
// No network and no AI: real builds (an Example turned into actions, as
// test/checker-sine.test.js does) through the real checker and simulator.
// Every expected number is hand-computed in the comment above its build.

const assert = require('node:assert');
process.env.AI_PROVIDER = 'fixture';
process.env.RECORD_FIXTURES = '0';     // never write ask fixtures from here

const Server = require('../backend/server.js');
const Board  = require('../circuit3d/js/board-model.js');
const Sim    = require('../circuit3d/js/simulate.js');
const { recipeActions } = require('./fixtures/recipe-steps.js');
const N = require('../circuit3d/js/board-geometry.js').COLS;

const problems = actions => Server.findCircuitProblems(actions.map(a => ({ ...a })));

// ── Parts and wiring, as Examples (test/checker-sine.test.js's) ────────────
// The chip at e30 facing right: OUT1 e30, IN1− e31, IN1+ e32, V− e33 (the
// bottom strips 30–33), IN2+ f33, IN2− f32, OUT2 f31, V+ f30 (the top ones).
const CHIP = ['e30', 'e31', 'e32', 'e33', 'f33', 'f32', 'f31', 'f30'];
const PS1  = volts => ({ type: 'bench_supply', label: 'PS1', values: { voltage: volts } });
const FG1  = (amplitude, { frequency = 1, offset = 0 } = {}) =>
  ({ type: 'function_generator', label: 'FG1', values: { amplitude, offset, frequency } });
const U1   = { type: 'tl072', label: 'U1', holes: CHIP };
const R    = (label, holes, ohms) => ({ type: 'resistor', label, holes, values: { resistance: ohms } });
const LED  = (label, holes) => ({ type: 'led', label, holes, values: { color: 'red' } });          // [cathode, anode]
const D    = (label, holes, model = '1N4148') => ({ type: 'diode', label, holes, values: { model } });   // [cathode, anode]
const SUPPLY   = [['PS1.0', `bp_${N}`], ['PS1.1', `bn_${N}`]];                              // + → tp, COM → tn
const DUAL     = [...SUPPLY, ['PS1.3', `bn_${N - 1}`], ['PS1.2', `tn_${N}`],
                  ['bp_30', 'j30'], ['tn_33', 'a33']];                                       // V+ +12, V− −12
const FG_COM   = ['FG1.1', `bn_${N - 2}`];
const FG_RAILS = [['FG1.0', `bp_${N}`], ['FG1.1', `bn_${N}`]];
const build = (parts, wires) => recipeActions({ name: 'checker', parts, wires, expect: {} });

// Today's message, word for word.
const BACKWARDS = (part, cathode, anode) => `The ${part} at ${cathode}/${anode} is backwards: its cathode ${cathode} is on the power side and its anode ${anode} is on the ground side. Swap holeA and holeB.`;

// ── The builds ─────────────────────────────────────────────────────────────

// Case 1, the standard bench: PS1 at 5 V (+ → tp, COM → tn) and FG1 (COM →
// tn too). On the supply:
//   LED1, the right way round: bp_13 → j12, 470 Ω i12–i16, anode h16 /
//     cathode h18, j18 → bn_18. (5 − 2.0)/(470 + 0.1) = 6.38 mA.
//   LED2, backwards: bp_3 → j2, 470 Ω i2–i6, cathode h6 / anode h8, j8 →
//     bn_8. No current, so its cathode sits at tp, 5.000 V, and its anode
//     at tn, 0 V: reversed by 5 V, far past REVERSE_VOLTS (0.5 V).
// On the generator: FG1.0 → j40, 220 Ω i40–i44, LED3 anode h44 / cathode
//   h48, j48 → bn_48. At 5 Vp: (5 − 2.0)/(220 + 50 + 0.1) = 11.1 mA at the
//   peak.
// Today the generator's − growth from COM walks tn → LED1 (cathode to
// anode) → tp → h6, so LED2's cathode lands on the − side while the
// supply's COM-as-+ pair has its anode on the + side: mixed together, LED2
// reads as forward and nothing is said.
// `backwards: false` leaves LED2's branch out: one correct LED on the
// supply beside the generator.
const sharedGround = ({ offset = 0, backwards = true } = {}) => build(
  [PS1(5), FG1(5, { offset }),
   R('R1', ['i12', 'i16'], 470), LED('LED1', ['h18', 'h16']),
   ...(backwards ? [R('R2', ['i2', 'i6'], 470), LED('LED2', ['h6', 'h8'])] : []),
   R('R3', ['i40', 'i44'], 220), LED('LED3', ['h48', 'h44'])],
  [...SUPPLY, FG_COM,
   ['bp_13', 'j12'], ['j18', 'bn_18'],
   ...(backwards ? [['bp_3', 'j2'], ['j8', 'bn_8']] : []),
   ['FG1.0', 'j40'], ['j48', 'bn_48']]);

// Case 2: the generator's OUT reaches tp through a resistor, with no
// resistive path back to its COM. PS1 at 5 V on tp/tn; LED1 on the supply
// (bp_3 → j2, 470 Ω i2–i6, LED1 at h6/h8, j8 → bn_8); FG1 at 5 Vp on a 0 V
// offset, COM → tn, FG1.0 → j40, 1 kΩ i40–i44, j44 → bp_44.
// The supply holds tp at 5 V, so the 1 kΩ only carries the generator's
// own current, (5 − v)/(1000 + 50): 0 at the peak (+5 V), 10/1050 =
// 9.5 mA at the trough (−5 V). LED1 backwards (cathode h6, anode h8):
// cathode 5 V, anode 0 V at every moment, reversed by 5 V.
// Today #3's reversed pair (COM as +, OUT as −) grows + from COM through
// tn to h8 and − from OUT through the 1 kΩ and tp to h6, so it reads LED1
// as forward and nothing is said.
// `backwards: false` turns LED1 the right way round (cathode h8, anode h6).
const outToTp = ({ backwards = true } = {}) => build(
  [PS1(5), R('R1', ['i2', 'i6'], 470), LED('LED1', backwards ? ['h6', 'h8'] : ['h8', 'h6']),
   FG1(5), R('R2', ['i40', 'i44'], 1000)],
  [...SUPPLY, FG_COM, ['bp_3', 'j2'], ['j8', 'bn_8'], ['FG1.0', 'j40'], ['j44', 'bp_44']]);

// BANK-07 and BANK-15, test/checker-sine.test.js's builds.
// BANK-07, the superdiode on ±12 V: FG1.0 → a32 (IN1+); D1 1N4148 anode c30
// (OUT1), cathode c26, the output: 10 kΩ b22–b26 to COM (a22 → bn_22) and
// fed back d26 → d31 (IN1−). D1 forward at the peak (cathode 1.000 V,
// anode 1.65 V), reverse-biased on the trough, as it should be.
const superdiode = () => build(
  [PS1(12), FG1(1), U1, D('D1', ['c26', 'c30']), R('R1', ['b22', 'b26'], 10000)],
  [...DUAL, FG_COM, ['FG1.0', 'a32'], ['d26', 'd31'], ['a22', 'bn_22']]);

// BANK-15, 5 Vp on the rails (FG1.0 → tp, COM → tn): bp_2 → j2, 220 Ω
// i2–i6, LED1 anode h6 / cathode h8, LED2 anode g8 / cathode g6 (the other
// way), j8 → COM. LED1 lights on the peak, LED2 on the trough:
// (5 − 2.0)/(220 + 50) = 11.1 mA each.
const backToBack = () => build(
  [FG1(5), R('R1', ['i2', 'i6'], 220), LED('LED1', ['h8', 'h6']), LED('LED2', ['g6', 'g8'])],
  [...FG_RAILS, ['bp_2', 'j2'], ['j8', 'bn_8']]);

// #3's reviewer's repro (test/checker-sine.test.js): a battery on tp/tn
// with a correct LED (bp_13 → j12, i12–i16, LED anode h16 / cathode h18,
// j18 → bn_18) and a backwards one (bp_3 → j2, i2–i6, LED cathode h6 /
// anode h8, j8 → bn_8), beside a ±5 V sine into its own LED (FG1.0 → j40,
// i40–i44, LED anode h44 / cathode h48, j48 → bn_48, COM → tn). Only the
// battery's LED is backwards.
const batteryBackwardsBesideSine = [
  { tool: 'delete_all' },
  { tool: 'place_battery' },
  { tool: 'add_wire', from: 'BAT1.0', to: `bp_${N}` },
  { tool: 'add_wire', from: 'BAT1.1', to: `bn_${N}` },
  { tool: 'add_wire', from: 'bp_13', to: 'j12' },
  { tool: 'place_resistor', holeA: 'i12', holeB: 'i16' },
  { tool: 'place_led', holeA: 'h18', holeB: 'h16' },
  { tool: 'add_wire', from: 'j18', to: 'bn_18' },
  { tool: 'add_wire', from: 'bp_3', to: 'j2' },
  { tool: 'place_resistor', holeA: 'i2', holeB: 'i6' },
  { tool: 'place_led', holeA: 'h6', holeB: 'h8' },
  { tool: 'add_wire', from: 'j8', to: 'bn_8' },
  { tool: 'place_function_generator', amplitude: 5, offset: 0, frequency: 1 },
  { tool: 'add_wire', from: 'FG1.0', to: 'j40' },
  { tool: 'place_resistor', holeA: 'i40', holeB: 'i44' },
  { tool: 'place_led', holeA: 'h48', holeB: 'h44' },
  { tool: 'add_wire', from: 'j48', to: 'bn_48' },
  { tool: 'add_wire', from: 'FG1.1', to: `bn_${N - 2}` },
];

// ── 1. A backwards LED on the supply is named beside a generator ───────────

test('case 1: a backwards LED on the bench supply, beside a correct one and a 5 Vp sine (0 V offset) on the shared tn, is named', () => {
  assert.deepStrictEqual(problems(sharedGround()), [BACKWARDS('LED', 'h6', 'h8')]);
});

// The generator on a 5 V offset (0–10 V) never crosses 0 V, so it has no
// reversed pair: its forward growth alone hides LED2 today.
test('case 1 with the generator on a 5 V offset (0–10 V, never crosses 0 V): the backwards LED on the supply is named', () => {
  assert.deepStrictEqual(problems(sharedGround({ offset: 5 })), [BACKWARDS('LED', 'h6', 'h8')]);
});

test('case 2: a backwards LED on the bench supply, beside a 5 Vp sine whose OUT reaches tp through 1 kΩ (no resistive path back to its COM), is named', () => {
  assert.deepStrictEqual(problems(outToTp()), [BACKWARDS('LED', 'h6', 'h8')]);
});

// ── 2. Pins: what passes today keeps passing ───────────────────────────────

test('pin: the clean BANK-07 superdiode and BANK-15 back-to-back LEDs still have no problems', () => {
  assert.deepStrictEqual(problems(superdiode()), [], 'BANK-07');
  assert.deepStrictEqual(problems(backToBack()), [], 'BANK-15');
});

test('pin: an LED backwards on a battery, beside a correct one and a sine that crosses 0 V into its own LED, is still named', () => {
  assert.deepStrictEqual(problems(batteryBackwardsBesideSine), [BACKWARDS('LED', 'h6', 'h8')]);
});

// Per-pair judging must not turn a correct LED into a backwards one: each
// is forward for the supply's own pair, whatever the generator's pairs say.
test('pin: a correct LED on the bench supply beside a generator on the shared tn gives no problem', () => {
  const bad = [];
  for (const [what, actions] of [
    ['the generator at 5 Vp, 0 V offset, into its own LED',  sharedGround({ backwards: false })],
    ['the generator at 5 Vp, 5 V offset, into its own LED',  sharedGround({ offset: 5, backwards: false })],
    ['the generator\'s OUT into tp through 1 kΩ',              outToTp({ backwards: false })],
  ]) {
    const got = problems(actions);
    if (got.length) bad.push(`${what}: ${JSON.stringify(got)}`);
  }
  assert.deepStrictEqual(bad, []);
});

// ── Sanity: the simulator agrees the supply's LED is backwards ─────────────

// t undefined: a plain solve (the wave at its offset).
function solveAt(actions, t) {
  const applied = Board.apply(Board.empty(), actions);
  assert.deepStrictEqual(applied.errors, [], 'every action applies');
  const { components, wires } = Board.toSim(applied.board);
  const r = t === undefined ? Sim.analyze(components, wires) : Sim.analyze(components, wires, { dt: 1e-3, state: {}, t });
  assert.strictEqual(r.status, 'ok');
  return r;
}
const near = (got, want, tol, what) =>
  assert.ok(typeof got === 'number' && Math.abs(got - want) <= tol, `${what}: expected ${want} (±${tol}), got ${got}`);

test('sanity: the supply\'s backwards LED is reversed by 5 V (cathode 5 V, anode 0 V) in case 1, and in case 2 at the plain solve, the peak and the trough', () => {
  for (const [what, actions, label, moments] of [
    ['case 1',                  sharedGround(),             'LED2', [undefined]],
    ['case 1, 5 V offset',      sharedGround({ offset: 5 }), 'LED2', [undefined]],
    ['case 2',                  outToTp(),                  'LED1', [undefined, 0.25, 0.75]],
  ]) {
    for (const t of moments) {
      const pins = solveAt(actions, t).parts[label].r.pins;
      const when = t === undefined ? 'plain solve' : `t = ${t} s`;
      near(pins.cathode, 5, 0.01, `${what}, ${when}: ${label} cathode`);
      near(pins.anode, 0, 0.01, `${what}, ${when}: ${label} anode`);
    }
  }
});
