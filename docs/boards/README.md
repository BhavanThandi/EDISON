# Reference boards for the photo samples

Boards for the hard-coded photo samples (`Plugged/circuit3d/samples/samples.js`, a `board:` per sample). Saved 2026-10-04 for the photo-samples work (#15, #16). Open one in the editor with File → Open, or load it with `App.loadCircuitData`.

## `photo11-ensc-lab-bench.sparky`: photo 11, `ensc-lab` (#16)

This is Aarmen's own rebuild of his ENSC 220 bench, 1:1 with the photo. The yellow wires on the real board are drawn green. It was saved from his browser at 07:28 on 2026-10-04: 6 parts and 16 wires.

- **U1:** a TL072 at f32. Pin 8 goes to +12 V (d32 → tp_31) and pin 4 to −12 V (j29 → bn_29).
- **PS1:** series ±12 V. **FG1:** a 5 V peak sine at 1 Hz, through R3 (470 Ω, g34–g30) into pin 3.
- **Pin 2:** held at about 0.54 V by R1 (10 kΩ, d60–d55) and R2 (470 Ω, h60–h56), a divider off +12 V.
- **Pin 1 (the output, f32):** nothing on it but the scope probe (i32).

As built, it is a comparator. The output is a ±10.5 V square wave, high whenever the sine is above 0.54 V. Check it against the board in #16's comment before hard-coding.

## `photoexample-op-amp-blinker.sparky`: the photoexample sketch

This is the "solved solution" sketch: an op-amp relaxation oscillator that blinks an LED, on a 30-column board with a 9 V battery. Thandi will build the real board with one wire missing.

**What the sketch shows:**
- **Pin 8 (+9 V):** tp_24 → a23.
- **Op-amp 2 parked:** b22–b21 ties out2 to in2−, and tn_19 → a20 grounds in2+.
- **The timing:** the output (col 23) runs h23 → h28, through RV1 (f28–f26, wiper tied to f26 by g27–g26) and R1 (1 kΩ, i26–i22), into pin 2 and C1 (+ on g22, − on g24, which is grounded by j24 → bn_23).
- **The thresholds on pin 3:** g21 → g17 feeds three 10 kΩ resistors: R2 (e17–f17, to +9 V via tp_16 → a17), R4 (i19–i17, to ground via j19 → bn_18) and R3 (h17–h13, positive feedback from the output via j23 → j13).
- **The LED:** the output feeds R5 (1 kΩ, g13–g10) and LED1 (anode h10, cathode h9), then j9 → bn_10 to ground.
- **The rails:** tp_30 → bp_30 and tn_29 → bn_29.

**Three things to settle before hard-coding:**
1. **Pin 4 (V−, f20) has no wire in the sketch.** As sketched, the simulator flags "U1 no supply" and the LED never lights. This file adds j20 → bn_20. It is also a natural candidate for the wire Thandi leaves out.
2. **R4 (i19–i17) spans 2 columns.** A build (`place_resistor`) refuses that: "a resistor's leads must be 3–5 columns apart". The `.sparky` loads it anyway, but the samples' `board:` list can't. An equivalent that builds: R4 at i17–i14, with the ground wire j14 → bn_14 instead of j19 → bn_18.
3. **The sketch shows no values for C1 and RV1.** This file guesses 100 µF and 10 kΩ. Use the real parts' values.

**The simulator can't run this oscillator yet.** The output goes high, the LED lights at about 5 mA, and C1 charges. But about 0.5 s in, the op-amp model drops into an in-between state where both inputs sit at about 3.5 V and the output flickers. Real parts can't rest there, but the solver accepts it as a solution of a circuit with positive feedback (a Schmitt trigger). It's a simulator bug to fix separately.

**The board as a samples.js `board:` list.** It is tested through the photo-build path (`SparkyChat.applyBuild`). Everything places except R4 (item 2); with R4 moved, all 10 parts and 16 wires build.

```js
board: [
  { tool: 'place_battery' },
  { tool: 'place_tl072', hole: 'f23', direction: 'right' },
  { tool: 'place_potentiometer', hole: 'f28', direction: 'right', resistance: 10000 },
  { tool: 'place_capacitor', holeA: 'g22', holeB: 'g24', capacitance: '100µF' },   // holeA the + lead; the stripe (−) on g24
  { tool: 'place_resistor', holeA: 'i26', holeB: 'i22', resistance: 1000 },
  { tool: 'place_resistor', holeA: 'e17', holeB: 'f17', resistance: 10000 },
  { tool: 'place_resistor', holeA: 'h17', holeB: 'h13', resistance: 10000 },
  { tool: 'place_resistor', holeA: 'i19', holeB: 'i17', resistance: 10000 },     // refused (span 2): see item 2
  { tool: 'place_resistor', holeA: 'g13', holeB: 'g10', resistance: 1000 },
  { tool: 'place_led', holeA: 'h9', holeB: 'h10', color: 'red' },                // holeA the cathode (the flat edge)
  { tool: 'add_wire', from: 'BAT1.0', to: 'tp_1', color: 'red' },
  { tool: 'add_wire', from: 'BAT1.1', to: 'tn_2', color: 'black' },
  { tool: 'add_wire', from: 'tp_24', to: 'a23', color: 'red' },
  { tool: 'add_wire', from: 'tn_19', to: 'a20', color: 'black' },
  { tool: 'add_wire', from: 'tp_16', to: 'a17', color: 'red' },
  { tool: 'add_wire', from: 'b22', to: 'b21', color: 'green' },
  { tool: 'add_wire', from: 'tp_30', to: 'bp_30', color: 'red' },
  { tool: 'add_wire', from: 'tn_29', to: 'bn_29', color: 'black' },
  { tool: 'add_wire', from: 'g27', to: 'g26', color: 'green' },
  { tool: 'add_wire', from: 'h28', to: 'h23', color: 'blue' },
  { tool: 'add_wire', from: 'g21', to: 'g17' },
  { tool: 'add_wire', from: 'j23', to: 'j13', color: 'blue' },
  { tool: 'add_wire', from: 'j24', to: 'bn_23', color: 'black' },
  { tool: 'add_wire', from: 'j19', to: 'bn_18', color: 'black' },
  { tool: 'add_wire', from: 'j9', to: 'bn_10', color: 'black' },
  { tool: 'add_wire', from: 'j20', to: 'bn_20', color: 'black' },                // not in the sketch: pin 4 to ground (item 1)
],
```
