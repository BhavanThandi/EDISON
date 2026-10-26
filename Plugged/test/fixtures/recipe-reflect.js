// Ruling 21: a LOCAL COLUMN REFLECTION of a recipe/example (the AI-facing TL072
// and 7-segment content), computed from the ORIGINAL literals in
// test/fixtures/recipes-original.js. Rows and rail names are kept; only
// columns turn about the middle of the recipe's own body-hole span:
//   cmin / cmax = least / greatest column of any body hole (rows a–j) in the
//                 recipe's parts and wires;
//   body hole X{c}                          -> X{cmin + cmax − c}
//   rail hole on a wire whose other end is a body hole -> same rail, column cmin + cmax − c
//   terminal → rail (BAT1.0, PS1.2 …) and rail ↔ rail bridges   -> unchanged
//   a part's holes: each hole reflected, order unchanged (so a footprint's
//   anchor X{c} + direction becomes X{cmin + cmax − c} with right ↔ left).
// Pure: no app code is read.

const BODY = /^([a-j])(\d+)$/;
const RAIL = /^(tp|tn|bp|bn)_(\d+)$/;

const isBody = h => BODY.test(String(h));
const isRail = h => RAIL.test(String(h));

function span(ex) {
  const cols = [];
  const add = h => { const m = BODY.exec(String(h)); if (m) cols.push(Number(m[2])); };
  for (const p of ex.parts) (p.holes || []).forEach(add);
  for (const w of ex.wires) w.forEach(add);
  return { cmin: Math.min(...cols), cmax: Math.max(...cols) };
}

function reflect(ex) {
  const { cmin, cmax } = span(ex);
  const flip = c => cmin + cmax - c;
  const body = h => { const m = BODY.exec(h); return m ? m[1] + flip(Number(m[2])) : h; };
  const rail = h => { const m = RAIL.exec(h); return m ? m[1] + '_' + flip(Number(m[2])) : h; };
  return {
    ...ex,
    parts: ex.parts.map(p => (p.holes ? { ...p, holes: p.holes.map(body) } : { ...p })),
    wires: ex.wires.map(([a, b]) => {
      // a rail end is reflected only when the other end is a body hole
      if (isBody(a) && isRail(b)) return [body(a), rail(b)];
      if (isRail(a) && isBody(b)) return [rail(a), body(b)];
      return [body(a), body(b)];
    }),
  };
}

// The partition of the recipe's part pins (and off-board terminals) into
// nodes: a body hole is its column + half (a–e / f–j); a rail is its whole row.
// Pins are "LABEL#index" (holes order) or the wire's own terminal name
// ("BAT1.0"). Returns a sorted, canonical list of groups.
function partition(ex) {
  const parent = new Map();
  const find = x => { if (!parent.has(x)) parent.set(x, x); let r = x; while (parent.get(r) !== r) r = parent.get(r); parent.set(x, r); return r; };
  const union = (a, b) => parent.set(find(a), find(b));
  const nodeOf = h => {
    const m = BODY.exec(h), r = RAIL.exec(h);
    if (m) return `col${m[2]}${m[1] <= 'e' ? 'lo' : 'hi'}`;
    if (r) return `rail${r[1]}`;
    return `pin:${h}`;       // an off-board terminal such as BAT1.0
  };
  const pins = [];
  for (const p of ex.parts) (p.holes || []).forEach((h, i) => { const pin = `${p.label}#${i}`; pins.push(pin); union(pin, nodeOf(h)); });
  for (const [a, b] of ex.wires) { union(nodeOf(a), nodeOf(b)); if (!isBody(a) && !isRail(a)) pins.push(nodeOf(a)); if (!isBody(b) && !isRail(b)) pins.push(nodeOf(b)); }
  const groups = new Map();
  for (const pin of new Set(pins)) { const r = find(pin); (groups.get(r) || groups.set(r, []).get(r)).push(pin); }
  return [...groups.values()].map(g => g.sort().join(' ')).sort();
}

module.exports = { reflect, partition, span, isBody, isRail };
