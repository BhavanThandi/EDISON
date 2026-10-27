// Lab 2's finishing work (issue #152): what the student adds to
// the starter (circuit3d/labs/lab2.sparky: the TL072 U1 across the centre
// gap, the bench supply PS1 and the function generator FG1 off the board,
// nothing wired) to build the lab's inverting amplifier. One source for
// test/lab-sheets.test.js (added to the loaded starter, then time-stepped
// with the real simulator) and e2e/lab-sheet.spec.js (added through
// App.placePart and App.finishWire).
//
// The circuit (issue #152; case 11 of the AI test set): FG1 0.5 Vp at 1 Hz
// → Rin R1 10 kΩ → IN1− (pin 2);
// Rf R2 100 kΩ from OUT1 (pin 1) to IN1−; IN1+ (pin 3) to COM; PS1 in
// series at ±12 V, + to V+ (pin 8) and − to V− (pin 4). The generator is
// 50 Ω behind its EMF and IN1− is a virtual ground, so the output peak is
// 0.5 V × 100 kΩ / (10 kΩ + 50 Ω) = 4.975 V (gain −10, well under the ±10.5 V
// clip): −4.975 V at the input's crest, +4.975 V at its trough.
//
// Layout, by the chip's own columns. The board is flipped (row a nearest the
// viewer) and Lab 2's starter is the COLUMN REFLECTION of the old one
// (Ruling 21/22: the tp/tn/bn conventions stay, columns turn about 30..33):
// U1 at f33 facing left (OUT1 f33, IN1− f32, IN1+ f31, V− f30 along row f;
// V+ e33 across the gap):
//   supply    PS1 + → tp_63, COM → tn_63, − → bn_63; tn_1 → bp_1 (bp is
//             COM too); V+ tp_33 → a33; V− bn_30 → j30.
//   input     IN1+ j31 → bp_31; R1 10 kΩ i28–i32 (IN1−); FG1 OUT → g28,
//             COM → tn_62.
//   feedback  R2 100 kΩ j33 (OUT1)–j29; h29 → h32 joins it to IN1−.
// (The old layout, U1 at f30 facing right, is in
// test/fixtures/content-original/lab2-finish-original.json.)
// Nothing else crosses OUT1's column, and half 2 of the chip stays unused.
//
// lab2Finish(holes) takes the chip's holes by pin name ({ out1: 'f33',
// in1n: 'f32', in1p: 'f31', vneg: 'f30', vpos: 'e33', … }) and returns
// { supply, input, feedback }, each { parts, wires }: parts as Example parts
// ({ type, label, holes, values }), wires as [from, to] (a hole, or
// LABEL.k for a pin by index: PS1.0 is +, PS1.1 COM, PS1.2 −; FG1.0 OUT,
// FG1.1 COM).

const colOf = hole => Number(String(hole).slice(1));

function lab2Finish(holes) {
  const need = ['out1', 'in1n', 'in1p', 'vneg', 'vpos'];
  for (const pin of need) {
    if (!holes || !/^[a-j]\d+$/.test(String(holes[pin]))) {
      throw new Error(`lab2Finish needs the chip's ${pin} hole; got ${JSON.stringify(holes)}`);
    }
  }
  // The layout puts the resistors below the chip (rows g–j) and V+'s wire
  // above it (row a): pins 1–4 in row f, V+ in row e (the chip at f33
  // facing left, as the starter has it).
  const rowsOk = ['out1', 'in1n', 'in1p', 'vneg'].every(p => holes[p][0] === 'f') && holes.vpos[0] === 'e';
  if (!rowsOk) throw new Error(`lab2Finish expects pins 1–4 in row f and V+ in row e (U1 at f33 left); got ${JSON.stringify(holes)}`);

  const c = Object.fromEntries(need.map(p => [p, colOf(holes[p])]));
  return {
    supply: {
      parts: [],
      wires: [['PS1.0', 'tp_63'], ['PS1.1', 'tn_63'], ['PS1.2', 'bn_63'], ['tn_1', 'bp_1'],
              ['tp_' + c.vpos, 'a' + c.vpos], ['bn_' + c.vneg, 'j' + c.vneg]],
    },
    input: {
      parts: [{ type: 'resistor', label: 'R1', holes: ['i' + (c.in1n - 4), 'i' + c.in1n], values: { resistance: 10000 } }],
      wires: [['j' + c.in1p, 'bp_' + c.in1p], ['FG1.0', 'g' + (c.in1n - 4)], ['FG1.1', 'tn_62']],
    },
    feedback: {
      parts: [{ type: 'resistor', label: 'R2', holes: ['j' + c.out1, 'j' + (c.out1 - 4)], values: { resistance: 100000 } }],
      wires: [['h' + (c.out1 - 4), 'h' + c.in1n]],
    },
  };
}

// Every stage at once: the finished board's additions.
function lab2FinishAll(holes) {
  const s = lab2Finish(holes);
  const stages = [s.supply, s.input, s.feedback];
  return { parts: stages.flatMap(x => x.parts), wires: stages.flatMap(x => x.wires) };
}

module.exports = { lab2Finish, lab2FinishAll };
