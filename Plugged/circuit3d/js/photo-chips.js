// ─────────────────────────────────────────────────────────────
//  photo-chips.js — which chip it is, and which way round it sits
//  (photo fix, part B). Pure: no DOM, no THREE.
//
//  CONTRACT (docs/API-CONTRACT.md → "PhotoChips")
//  ────────
//    identify(label)  → 'opamp' | 'other' | 'unknown'
//    seat({ pin1, pinN, pins = 8, notch, cols = 63 })
//                     → { hole, direction, sure } | { why }
//    seatFromColumns({ ends, notch, cols = 63 })
//                     → { hole, direction, sure: false } | { why }
//  Never throws: what it can't seat comes back as { why }, in plain English.
//
//  RULES
//  ─────
//  - identify: uppercase the label and drop everything but letters and
//    digits. Empty → unknown. Contains a DUAL_OPAMPS entry → opamp. Else a
//    digit in it → other (a chip we can name but don't build). Else unknown
//    (a bare "ST" is a maker's mark, not a part number).
//  - seat: pin1 and pinN are Reading body holes like e30. Only the column
//    and the half (a–e / f–j) matter; rows inside a half are free.
//      pin 1 in a–e, pin N three columns higher in a–e → pin 1 at e{c}, right
//      pin 1 in f–j, pin N three columns lower in f–j  → pin 1 at f{c}, left
//    Anything else (a clockwise pair, two halves, wrong spacing, a pin count
//    other than 8, a non-body hole) has no seat: it is never built backwards.
//  - A chip whose legs would pass the board's last column (cols) has no seat.
//  - sure: the notch agrees. `left` means pin 1 is the lower column, `right`
//    the higher. `unsure`, missing or disagreeing → sure: false.
//  - seatFromColumns (Ruling B2b): `ends` are two unnamed points, the
//    reader's box-end placeholders, never a pin cue. Only their columns
//    count (rows and order are free): they must be 3 apart and on the board.
//    The notch picks the starting seat: right → f{max} left; left, unsure or
//    missing → e{min} right. Never sure.
//
//  EXPORTS
//  ───────
//  Browser: window.PhotoChips
//  Node:    module.exports
// ─────────────────────────────────────────────────────────────

(function (root, factory) {
  const PhotoChips = factory();
  if (typeof module === 'object' && module.exports) module.exports = PhotoChips;
  if (root) root.PhotoChips = PhotoChips;
})(typeof window !== 'undefined' ? window : null, function () {

  // The dual op-amps the app builds as a TL072 (pin-for-pin the same).
  const DUAL_OPAMPS = ['TL052', 'TL062', 'TL072', 'TL082', 'LM358', 'LM2904', 'LF353', 'LF412', 'NE5532', 'MC1458', 'RC4558'];

  function identify(label) {
    const s = String(label == null ? '' : label).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) return 'unknown';
    if (DUAL_OPAMPS.some(n => s.includes(n))) return 'opamp';
    return /\d/.test(s) ? 'other' : 'unknown';
  }

  function parse(hole) {
    const m = /^([a-j])(\d+)$/.exec(String(hole == null ? '' : hole).trim().toLowerCase());
    return m ? { half: m[1] <= 'e' ? 'a' : 'f', col: parseInt(m[2], 10) } : null;
  }

  function seat({ pin1, pinN, pins = 8, notch, cols = 63 } = {}) {
    if (pins !== 8) return { why: `Only 8-pin chips can be placed; this one has ${pins} pins.` };
    const p = parse(pin1), n = parse(pinN);
    if (!p || !n) return { why: 'Pin 1 and pin 4 of the chip must both be in the board\'s main holes.' };
    if (p.half !== n.half) return { why: 'Pin 1 and pin 4 are on opposite sides of the centre gap; they must be on the same side.' };
    const step = n.col - p.col;
    const right = p.half === 'a';
    if (step !== (right ? 3 : -3)) {
      return { why: Math.abs(step) === 3
        ? 'Pin 1 and pin 4 are the wrong way round (pin 1 is at the end where the pins count clockwise); the chip cannot sit that way.'
        : `Pin 1 and pin 4 must be 3 columns apart; these are ${Math.abs(step)} apart.` };
    }
    if (Math.min(p.col, n.col) < 1 || Math.max(p.col, n.col) > cols) {
      return { why: `The chip would run off the board's ${cols} columns.` };
    }
    const direction = right ? 'right' : 'left';
    const agrees = (notch === 'left' && right) || (notch === 'right' && !right);
    return { hole: (right ? 'e' : 'f') + p.col, direction, sure: agrees };
  }

  function seatFromColumns({ ends, notch, cols = 63 } = {}) {
    const ps = (Array.isArray(ends) ? ends : []).map(parse);
    if (ps.length !== 2 || ps.some(q => !q)) return { why: 'The chip\'s two ends must both be in the board\'s main holes.' };
    const lo = Math.min(ps[0].col, ps[1].col), hi = Math.max(ps[0].col, ps[1].col);
    if (hi - lo !== 3) return { why: `The chip's two ends must be 3 columns apart; these are ${hi - lo} apart.` };
    const s = notch === 'right' ? seat({ pin1: 'f' + hi, pinN: 'f' + lo, notch, cols })
                                : seat({ pin1: 'e' + lo, pinN: 'e' + hi, notch: 'left', cols });
    return s.why ? s : { hole: s.hole, direction: s.direction, sure: false };
  }

  return { DUAL_OPAMPS, identify, seat, seatFromColumns };
});
