// Task D1: `/` opens straight into the Edison editor with a welcome card
// (title, one-line pitch, three demo buttons, a close x). The card is dismissed
// for the session (sessionStorage), so a reload keeps it hidden and a new
// browser context shows it again. D2 wires the buttons; here they only have to
// exist and be clickable without errors. /api/* is stubbed so no AI is called.
//
// The card is #welcome-card.
const { test, expect } = require('@playwright/test');

const PITCH = 'An AI agent that builds working circuits — and rebuilds a real breadboard from a photo.';
const DEMOS = [
  ['build', 'Build me an LED circuit'],
  ['photo', 'Rebuild a breadboard from a photo'],
  ['run', 'Run it'],
];

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"reply":"ok","actions":[]}' }));
  await page.goto('/');
  await page.waitForURL(/circuit3d\/index\.html/);   // / redirects; wait for the editor itself
  return errors;
}
const card = page => page.locator('#welcome-card');

test('/ ends in the Edison editor, not the landing page', async ({ page }) => {
  const errors = await open(page);
  await expect(page).toHaveURL(/\/circuit3d\/index\.html\?(.*&)?ui=edison/);
  expect(page.url()).not.toContain('landing.html');
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'edison');
  await expect(page.locator('canvas').first()).toBeAttached();
  expect(errors).toEqual([]);
});

test('the welcome card shows the title, the pitch and three demo buttons, visible and enabled', async ({ page }) => {
  const errors = await open(page);
  const c = card(page);
  await expect(c).toBeVisible();
  await expect(c.getByText('Edison', { exact: true })).toBeVisible();
  await expect(c.getByText(PITCH, { exact: true })).toBeVisible();
  for (const [demo, label] of DEMOS) {
    const b = page.locator(`[data-demo="${demo}"]`);
    await expect(b).toHaveCount(1);
    await expect(b).toBeVisible();
    await expect(b).toHaveText(label);
    await expect(b).toBeEnabled();
  }
  // Visible and enabled only: clicking one starts its demo and hides the card
  // (welcome-demos.spec.js covers what each does).
  for (const [demo] of DEMOS) {
    const b = page.locator(`[data-demo="${demo}"]`);
    await expect(b).toBeVisible();
    await expect(b).toBeEnabled();
  }
  expect(errors).toEqual([]);
});

test('x hides the card, a reload keeps it hidden, a new session shows it again', async ({ page, browser }) => {
  const errors = await open(page);
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: /close|×/i }).click();
  await expect(page.locator('[data-demo="build"]')).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'edison');
  await expect(page.locator('[data-demo="build"]')).toBeHidden();

  const ctx = await browser.newContext();
  try {
    const fresh = await ctx.newPage();
    await fresh.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await fresh.goto('/');
    await fresh.waitForURL(/circuit3d\/index\.html/);
    await expect(fresh.locator('[data-demo="build"]')).toBeVisible();
  } finally { await ctx.close(); }
  expect(errors).toEqual([]);
});
