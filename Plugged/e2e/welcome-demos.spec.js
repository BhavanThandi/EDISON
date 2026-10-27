// Task D2: the welcome card's three demo buttons work with no login and no AI.
// Every AI endpoint is stubbed with a 500 and counted; each test ends by
// asserting all three counts are 0. The brief is silent on the card after a
// demo, so: the card is hidden once a demo starts.
const { test, expect } = require('@playwright/test');

const simLines = page => page.locator('#sim-results .sim-line').allTextContents();
const partCount = page => page.evaluate(() => App.state.components.length);
const labels = page => page.evaluate(() => App.exportBoard().parts.map(p => p.type + ':' + p.label));

async function open(page) {
  const errors = [];
  const calls = { ask: 0, photo: 0, leads: 0 };
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    // the deliberate 500s are not app errors
    if (m.type() === 'error' && !/status of 500/.test(m.text())) errors.push('console: ' + m.text());
  });
  for (const [pat, key] of [['**/api/ask', 'ask'], ['**/api/photo', 'photo'], ['**/api/photo/leads', 'leads']]) {
    await page.route(pat, r => { calls[key]++; return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"no AI in a demo"}' }); });
  }
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.state && App.state.breadboard && App.renderer);
  await expect(page.locator('#welcome-card')).toBeVisible();
  return { errors, calls };
}

test('Build me an LED circuit: the prompt is posted, a saved build previews, Accept puts an LED and a resistor on the board, Run shows LED ON', async ({ page }) => {
  test.setTimeout(60_000);
  const { errors, calls } = await open(page);
  await page.locator('[data-demo="build"]').click();
  await expect(page.locator('.chat-msg.user').last()).toContainText(/LED circuit/i);
  await expect(page.locator('#welcome-card'), 'the card is hidden once a demo starts').toBeHidden();
  await expect(page.locator('#sparky-pending-bar'), 'the preview appears within 5 s').toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => labels(page)).toEqual(expect.arrayContaining([expect.stringMatching(/led/i), expect.stringMatching(/resistor/i)]));
  await page.locator('#sim-run-btn').click();
  await expect.poll(async () => (await simLines(page)).join(' | ')).toContain('LED ON');
  expect(calls, 'no AI request').toEqual({ ask: 0, photo: 0, leads: 0 });
  expect(errors).toEqual([]);
});

test('Rebuild a breadboard from a photo: opens the thandi-blinker sample ("Reading your board…", its credit), then builds its parts', async ({ page }) => {
  test.setTimeout(90_000);
  const { errors, calls } = await open(page);
  const credit = await page.evaluate(() => window.PhotoSamples['thandi-blinker'].credit);
  await page.locator('[data-demo="photo"]').click();
  await expect(page.locator('#welcome-card')).toBeHidden();
  await expect(page.locator('#photo-status')).toHaveText('Reading your board…');
  await expect(page.locator('#photo-modal')).toContainText(credit);
  await expect(page.locator('#photo-modal'), 'the overlay closes for the board').toBeHidden({ timeout: 25_000 });
  const want = await page.evaluate(() => window.PhotoSamples['thandi-blinker'].board.filter(a => a.tool.startsWith('place_')).length);
  await expect.poll(() => partCount(page), { message: 'the blinker parts are on the board' }).toBeGreaterThanOrEqual(want);
  expect(calls, 'no AI request').toEqual({ ask: 0, photo: 0, leads: 0 });
  expect(errors).toEqual([]);
});

test('Run it: on the empty board it loads the demo circuit and runs the simulation', async ({ page }) => {
  test.setTimeout(60_000);
  const { errors, calls } = await open(page);
  expect(await partCount(page), 'the editor opens empty').toBe(0);
  await page.locator('[data-demo="run"]').click();
  await expect(page.locator('#welcome-card')).toBeHidden();
  await expect.poll(() => partCount(page), { message: 'the demo circuit loads' }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => App.simRunning === true)).toBe(true);
  await expect(page.locator('#sim-run-btn'), 'Run shows running').toBeHidden();
  await expect.poll(async () => (await simLines(page)).length).toBeGreaterThan(0);
  expect(calls, 'no AI request').toEqual({ ask: 0, photo: 0, leads: 0 });
  expect(errors).toEqual([]);
});
