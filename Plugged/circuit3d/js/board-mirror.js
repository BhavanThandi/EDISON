// ─────────────────────────────────────────────────────────────
//  board-mirror.js — the row map T_A and the v1 → v2 saved-record migration.
//
//  T_A flips the board's rows end to end (a↔j … e↔f, tp↔bp, tn↔bn) and keeps
//  every column. v1 records were saved in the old frame; migrateRecords maps
//  their holes once and stamps them v: 2. Pure: no DOM, no Three.js, and it
//  never mutates its input.
//
//  EXPORTS
//  ───────
//  Browser: window.App.BoardMirror
//  Node:    module.exports
//    RECORD_VERSION, MIRROR_ROW, mirrorRef(ref), mirrorHoleName(name),
//    isCurrent(record), migrateRecords(data)
// ─────────────────────────────────────────────────────────────

(function (root, factory) {
  const geometry = typeof module === 'object' && module.exports
    ? require('./board-geometry.js')
    : root && root.App && root.App.BOARD_GEOMETRY;
  const MIRROR = factory(geometry);
  if (typeof module === 'object' && module.exports) module.exports = MIRROR;
  if (root) (root.App = root.App || {}).BoardMirror = MIRROR;
})(typeof window !== 'undefined' ? window : null, function (geometry) {

  const RECORD_VERSION = 2;

  const MIRROR_ROW = {
    a: 'j', b: 'i', c: 'h', d: 'g', e: 'f', f: 'e', g: 'd', h: 'c', i: 'b', j: 'a',
    tp: 'bp', tn: 'bn', bn: 'tn', bp: 'tp',
  };

  // Hole names: body "a12" (row + column), rail "tp_5" (row + _ + column).
  const ROWS_RE = geometry.ALL_ROWS.join('|');
  const HOLE_NAME = new RegExp('^(' + ROWS_RE + ')(_?)(\\d+)$');

  const has = (obj, key) => Object.hasOwn(obj, key);

  function mirrorRef(ref) {
    if (!ref) return null;
    return has(MIRROR_ROW, ref.row) ? { ...ref, row: MIRROR_ROW[ref.row] } : { ...ref };
  }

  function mirrorHoleName(name) {
    const m = typeof name === 'string' && HOLE_NAME.exec(name);
    return m ? MIRROR_ROW[m[1]] + m[2] + m[3] : name;
  }

  const isCurrent = record => !!record && record.v >= RECORD_VERSION;

  // A null / non-object record is returned as it is (the loader turns it into
  // a placeholder, as before the mirror).
  function migrateComponent(c) {
    if (!c || typeof c !== 'object' || isCurrent(c)) return c;
    const out = { ...c, v: RECORD_VERSION };
    if (Array.isArray(c.holeRefs)) out.holeRefs = c.holeRefs.map(mirrorRef);
    return out;
  }

  function migrateWire(w) {
    if (!w || typeof w !== 'object' || isCurrent(w)) return w;
    const out = { ...w, v: RECORD_VERSION };
    if (has(w, 'startHole')) out.startHole = mirrorRef(w.startHole);
    if (has(w, 'endHole'))   out.endHole   = mirrorRef(w.endHole);
    return out;
  }

  function migrateRecords(data) {
    const out = { ...data };
    if (Array.isArray(data.components)) out.components = data.components.map(migrateComponent);
    if (Array.isArray(data.wires))      out.wires      = data.wires.map(migrateWire);
    return out;
  }

  return { RECORD_VERSION, MIRROR_ROW, mirrorRef, mirrorHoleName, isCurrent, migrateRecords };
});
