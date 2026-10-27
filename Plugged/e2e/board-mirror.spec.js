// Board mirror, task 3: circuits saved before the flip (v1) open through the
// row map T_A (a<->j, b<->i, c<->h, d<->g, e<->f, tp<->bp, tn<->bn), and
// everything the editor saves carries v: 2. Opens circuits the way the
// dashboard does (sessionStorage); saves by catching the .sparky download.
// /api/ask is stubbed; no real AI.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, '..', 'test', 'fixtures', 'mirror');
const readFixture = name => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));

const TL072_V2 = ['e30', 'e31', 'e32', 'e33', 'f33', 'f32', 'f31', 'f30'];

async function boot(page) {
  await page.route('**/api/ask', route => route.fulfill({ json: { reply: '', actions: [] } }));
  await page.goto('/circuit3d/index.html');
  await page.waitForFunction(() => window.App && App.state && App.state.breadboard && App.renderer);
}

// Open a saved-file object as the dashboard hands it over.
async function openSaved(page, data) {
  await boot(page);
  await page.evaluate(d => sessionStorage.setItem('sparky_load_circuit', JSON.stringify(d)), data);
  await page.reload();
  await page.waitForFunction(() => window.App && App.state && App.state.breadboard && App.renderer
                                   && App.state.components.length > 0);
}

// Each part's holes by label, from the page; direction of the TL072 (or null).
const holesOf = page => page.evaluate(() => {
  const out = {};
  for (const c of App.state.components) out[c.label] = (App.saveHoleRefs(c) || []).map(r => r.row + (r.col + 1));
  return out;
});
const directionOfChip = page => page.evaluate(() => {
  const c = App.state.components.find(x => x.type === 'tl072');
  const want = (App.saveHoleRefs(c) || []).map(r => r.row + (r.col + 1)).join();
  return Object.keys(SparkyChat.ROTATION).find(dir => {
    const legs = Parts.footprintLegs('tl072', want.split(',')[0], SparkyChat.ROTATION[dir]);
    return legs && legs.map(l => l.hole).join() === want;
  }) || null;
});
const wireEnds = page => page.evaluate(() => App.state.wires.map(w => [w.startHole, w.endHole]
  .filter(Boolean).map(h => `${h.row}_${h.col + 1}`)));

// Press Save and return the parsed .sparky it downloads.
async function saveAndRead(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => App.saveCircuit())]);
  return JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
}

const simText = async page => (await page.locator('#sim-results .sim-line').allTextContents()).join(' | ');

test('a v1 circuit opens with its chip at the mirrored holes', async ({ page }) => {
  await openSaved(page, readFixture('v1-tl072.sparky'));
  expect((await holesOf(page)).U1).toEqual(TL072_V2);
  expect(await directionOfChip(page)).toBe('right');
});

test('a v1 demo circuit simulates the same after migration', async ({ page }) => {
  await openSaved(page, readFixture('v1-demo.sparky'));
  const ends = await wireEnds(page);
  // The battery's two off-board wires ended on tp/tn in v1; they now end on bp/bn.
  const battery = await page.evaluate(() => App.state.wires
    .filter(w => !w.startHole).map(w => `${w.endHole.row}_${w.endHole.col + 1}`).sort());
  expect(battery).toEqual(['bn_16', 'bp_4']);
  expect(ends.length).toBe(5);

  await page.locator('#sim-run-btn').click();
  expect(await simText(page)).toContain('Circuit open');
  await page.evaluate(() => {
    App.toggleButton(App.state.components.find(c => c.type === 'button'));
    App.runSimulation();
  });
  // Same current the unmigrated demo gives with the button pressed.
  expect(await simText(page)).toContain('LED ON  (14.9 mA)');
});

test('reopening a saved v2 circuit keeps every hole', async ({ page }) => {
  await openSaved(page, readFixture('v1-tl072.sparky'));
  const first = await holesOf(page);
  const firstWires = await wireEnds(page);

  const saved = await saveAndRead(page);
  expect(saved.version).toBe(2);
  expect(saved.components.length).toBeGreaterThan(0);
  expect(saved.wires.length).toBeGreaterThan(0);
  for (const rec of [...saved.components, ...saved.wires]) expect(rec.v).toBe(2);

  await openSaved(page, saved);   // fresh page load of the saved file
  expect(await holesOf(page)).toEqual(first);
  expect(await wireEnds(page)).toEqual(firstWires);
});

test('autosave and reload keeps a v2 board as it is', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const hole = s => { const { col, row } = App.parseHole(s); return App.state.breadboard.getHole(col, row); };
    App.placePart('tl072', ['e30', 'e31', 'e32', 'e33', 'f33', 'f32', 'f31', 'f30'].map(hole));
  });
  expect((await holesOf(page)).U1).toEqual(TL072_V2);
  await page.waitForTimeout(1200);   // auto-save runs 800 ms after the last change

  const saved = await page.evaluate(() => {
    const key = SparkyStorage.projectsKey(SparkyStorage.currentUid(localStorage));
    return JSON.parse(localStorage.getItem(key) || '[]').find(p => p.id === App.state.circuitId);
  });
  expect(saved, 'autosave wrote the circuit').toBeTruthy();
  for (const rec of saved.components) expect(rec.v).toBe(2);

  // Reopen the autosaved entry the way the dashboard does.
  await openSaved(page, saved);
  expect((await holesOf(page)).U1).toEqual(TL072_V2);
  expect(await directionOfChip(page)).toBe('right');
});

// Ruling 28 (guard): a v1 file opened the way a student opens one (the file
// chooser, the preview, Load Circuit, which is App.loadCircuitData), then an
// edit, undo and redo: every snapshot restores through the same migrating
// rebuild, and a v2 record passes through it unchanged, so the holes stay where
// the migration put them. A second flip would send the TL072 back to its v1 holes.
test('open a v1 file, edit, undo, redo: the holes stay migrated (no second flip)', async ({ page }) => {
  await boot(page);
  const chooser = page.waitForEvent('filechooser');
  await page.evaluate(() => { App.loadCircuit(); });
  await (await chooser).setFiles(path.join(FIX, 'v1-tl072.sparky'));
  await expect(page.locator('#lpm-confirm')).toBeVisible();
  await page.locator('#lpm-confirm').click();
  await page.waitForFunction(() => App.state.components.some(c => c.type === 'tl072'));

  const opened = await holesOf(page);
  const openedWires = await wireEnds(page);
  expect(opened.U1, 'File -> Open migrates the v1 chip').toEqual(TL072_V2);

  // An edit: one more resistor, in free holes.
  await page.evaluate(() => {
    const hole = s => { const { col, row } = App.parseHole(s); return App.state.breadboard.getHole(col, row); };
    App.placePart('resistor', [hole('d50'), hole('d54')], { resistance: 1000 });
  });
  const edited = await holesOf(page);
  expect(Object.keys(edited).length, 'the edit added a part').toBe(Object.keys(opened).length + 1);
  expect(edited.U1).toEqual(TL072_V2);

  await page.evaluate(() => App.undo());
  expect(await holesOf(page), 'undo restores the opened board, still migrated').toEqual(opened);
  expect(await wireEnds(page)).toEqual(openedWires);

  await page.evaluate(() => App.redo());
  expect(await holesOf(page), 'redo restores the edited board, still migrated').toEqual(edited);
  expect((await holesOf(page)).U1).toEqual(TL072_V2);
  expect(await wireEnds(page)).toEqual(openedWires);
});
