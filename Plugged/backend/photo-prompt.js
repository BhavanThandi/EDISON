// ─────────────────────────────────────────────────────────────
//  photo-prompt.js — what /api/photo asks the AI (#139)
//
//  One survey prompt for both readers (A4), on the whole board with the
//  page's column/row margin: every part and wire with its type, a value
//  guess, conf, a box_2d [ymin, xmin, ymax, xmax] on 0–1000 around the whole
//  item, legs included, its lead points [{pin, point:[y,x]}] (the page snaps
//  them; no points: the reader starts each leg at an end of its box), an
//  ic's pins, notch and label, plus each power rail's printed sign by
//  side. The compact example at the end is the one json_object mode
//  (DeepSeek) needs.
//
//  Guarded by the golden test/fixtures/prompts/photo.txt.
//
//  The crop prompt (#159): one per part or wire, on an enlarged crop the
//  page labelled with the board's column numbers and row letters, asking
//  where each lead (or wire tip) enters the board as [y, x] on 0–1000 over
//  the crop. Guarded by the golden test/fixtures/prompts/photo-crop.txt.
// ─────────────────────────────────────────────────────────────

const ITEM_TYPES = ['resistor', 'led', 'capacitor', 'ic', 'button', 'battery', 'diode', 'transistor', 'potentiometer', 'other', 'wire'];

const PHOTO_PROMPT = [
  'Perspective-corrected top-down photo of a real breadboard. Hole column numbers 1 to N are written above and below the photo and ' +
    'row letters are written at its left and right edges, each aligned with its line of holes. ' +
    'The board has rows a-e, a centre channel, rows f-j, and four power rails (the long strips along its two long edges, rows +/-). ' +
    'Detect every component and every jumper wire. ' +
    'For each give its type, a value guess, conf (0 to 1), and box_2d [ymin, xmin, ymax, xmax] normalized to 0-1000 ' +
    'over this whole image (the margin included) that encloses the whole item INCLUDING all its metal leads down to where they enter the board ' +
    '(leads may span many columns). Ignore hands, probes and tools.',
  'Also give leads: where each metal lead (or wire tip) disappears into the plastic of the board, not where the body is, ' +
    'as {"pin":"1","point":[y,x]} with point normalized to 0-1000 over this whole image. ' +
    'Lead counts: resistor, led, capacitor, diode and button 2 (both ends); wire 2 (both ends); potentiometer 3; ' +
    'ic: point only at pin 1 (pin "1") and at the last pin on pin 1\'s side of the chip (pin "4" of 8, "7" of 14, "8" of 16). ' +
    'For an ic also give pins (8, 14 or 16), notch (which side of the image the notch or dot is on: left, right, or unsure) and label (the printed text, or null).',
  'Also read the power rails: the long strips along the board\'s two long edges, each marked with a printed + or - ' +
    '(often a red or blue line). Name them by side using the board\'s printed row letters: aOuter is the strip ' +
    'farthest from row a, aInner the strip between it and row a, jInner the strip next to row j, jOuter the strip ' +
    'farthest from row j. Give each one\'s printed sign: "+", "-", or "?" if you can\'t read it.',
  'If there is no breadboard in the photo, answer {"visible":false,"items":[]}.',
  `Short JSON only: {"items":[{"type":"${ITEM_TYPES.join('|')}","value":"220 or null","conf":0.8,` +
    '"box_2d":[ymin,xmin,ymax,xmax],"leads":[{"pin":"1","point":[y,x]},{"pin":"2","point":[y,x]}],' +
    '"pins":8,"notch":"left|right|unsure","label":"TL072 or null"}],"rails":{"aOuter":"+","aInner":"-","jInner":"+","jOuter":"-"}}',
  '(pins, notch and label only for an ic.)',
].join('\n');

const SIGN = { type: 'STRING', enum: ['+', '-', '?'] };

// Gemini's responseSchema (upper-case type names). No anyOf.
const PHOTO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type:   { type: 'STRING', enum: ITEM_TYPES },
          value:  { type: 'STRING', nullable: true },
          conf:   { type: 'NUMBER' },
          box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
          leads:  {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { pin: { type: 'STRING' }, point: { type: 'ARRAY', items: { type: 'NUMBER' } } },
              required: ['pin', 'point'],
            },
          },
          pins:   { type: 'INTEGER', nullable: true },
          notch:  { type: 'STRING', enum: ['left', 'right', 'unsure'], nullable: true },
          label:  { type: 'STRING', nullable: true },
        },
        required: ['type', 'value', 'conf', 'box_2d', 'leads'],
      },
    },
    rails: {
      type: 'OBJECT',
      properties: { aOuter: SIGN, aInner: SIGN, jInner: SIGN, jOuter: SIGN },
      required: ['aOuter', 'aInner', 'jInner', 'jOuter'],
    },
    visible: { type: 'BOOLEAN' },
  },
  required: ['items', 'rails'],
};

// What a crop shows: 'resistor (470)', 'led' (no value), 'jumper wire'.
function cropShows(item) {
  const it = item && typeof item === 'object' ? item : {};
  if (it.kind === 'wire') return 'jumper wire';
  const type  = typeof it.type === 'string' && it.type.trim() ? it.type.trim() : 'part';
  const value = typeof it.value === 'number' ? (Number.isFinite(it.value) && it.value ? String(it.value) : '')
    : typeof it.value === 'string' ? it.value.trim() : '';
  return value ? `${type} (${value})` : type;
}

// item: { kind: 'part' | 'wire', type, value }, as the Reading has them.
const PHOTO_CROP_PROMPT = item => [
  'Enlarged crop of a top-down breadboard photo. Hole column numbers are written above and below the photo and ' +
    'row letters a-j (rail rows +/-) at its left and right edges, each aligned with its line of holes. ' +
    `It shows a ${cropShows(item)}. ` +
    'Find where each metal lead (or wire tip) disappears into the plastic of the board - not where the part body is. ' +
    'Leads are often bent and may span any number of columns; parts often lean. Ignore hands, multimeter probes and tools. ' +
    (item && item.kind === 'wire' ? 'Point to each end of the wire ("off" if an end leaves the crop/board). ' : 'Point to each lead. ') +
    'Points are [y, x] normalized to 0-1000 over this whole image. ' +
    'LED pins "anode"/"cathode" if you can tell, else "?"; others "1","2",...',
  'Short JSON only: {"found":true,"type":"...","leads":[["1",[y,x]],["2",[y,x]]],"conf":0.8}',
].join('\n');

// The crop answer's schema. Each lead is the prompt's [pin, [y, x]] pair, or
// [pin, "off"]: a list whose entries are a string or a list of numbers.
const PHOTO_CROP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
    type:  { type: 'STRING' },
    leads: { type: 'ARRAY', items: { type: 'ARRAY', items: { anyOf: [{ type: 'STRING' }, { type: 'ARRAY', items: { type: 'NUMBER' } }] } } },
    conf:  { type: 'NUMBER' },
  },
  required: ['found', 'type', 'leads', 'conf'],
};

// The batched crop round (A3): one call holds up to 12 crops, each introduced
// by its own text part "Crop k: id <id>, <what it shows>, outlined in magenta"
// (photo-leads.js). Set-of-Mark: the page draws a thin magenta outline of the
// item's box on its crop, so the model knows which part the crop is about.
const PHOTO_CROP_PROMPT_BATCH = [
  'Enlarged crops of top-down breadboard photos, each introduced by a line "Crop k: id <id>, <what it shows>, outlined in magenta" and followed by its image. ' +
    'In each crop, hole column numbers are written above and below and row letters a-j (rail rows +/-) at the left and right edges, each aligned with its line of holes. ' +
    'The magenta box only marks WHICH part or wire the crop is about; its leads may end on or just past the outline. Ignore neighbouring parts, hands, multimeter probes and tools.',
  'For each crop, find where each metal lead (or wire tip) of the outlined part disappears into the plastic of the board - not where the part body is. ' +
    'Leads are often bent and may span any number of columns; parts often lean. For a part, point to each lead. For a wire, point to each end (null if an end leaves the crop/board). ' +
    'point is [y, x] normalized to 0-1000 over the whole crop image, not the magenta box. hole is the hole you read from the margin labels at that point (e.g. "e12"), or null. ' +
    'LED pins "anode"/"cathode" if you can tell, else "?"; others "1","2",...',
  'Answer every crop once, with its id exactly as given. Short JSON only: {"items":[{"id":"...","found":true,"conf":0.8,"leads":[{"pin":"1","point":[y,x],"hole":"e12"}]}]}',
].join('\n');

// The batch answer's schema: plain objects, no anyOf; id is an enum of the
// batch's ids.
const PHOTO_CROP_SCHEMA_BATCH = ids => ({
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id:    { type: 'STRING', enum: ids.map(String) },
          found: { type: 'BOOLEAN' },
          conf:  { type: 'NUMBER' },
          leads: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                pin:   { type: 'STRING' },
                point: { type: 'ARRAY', items: { type: 'NUMBER' }, nullable: true },
                hole:  { type: 'STRING', nullable: true },
              },
              required: ['pin', 'point', 'hole'],
            },
          },
        },
        required: ['id', 'found', 'conf', 'leads'],
      },
    },
  },
  required: ['items'],
});

module.exports = { PHOTO_PROMPT, PHOTO_SCHEMA, PHOTO_CROP_PROMPT, PHOTO_CROP_SCHEMA, PHOTO_CROP_PROMPT_BATCH, PHOTO_CROP_SCHEMA_BATCH, cropShows };
