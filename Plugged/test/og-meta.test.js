// The link preview (Open Graph / Twitter card) a shared Edison link shows:
// the old landing page's schematic (og-image.png, 1200×630). `/` redirects to
// the editor, and a crawler may read either page, so both carry the tags.
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT  = path.join(__dirname, '..');
const SITE  = 'https://edison-snowy.vercel.app';
const PAGES = ['index.html', 'circuit3d/index.html'];

const meta = (html, attr, key) => {
  const m = new RegExp(`<meta[^>]*${attr}="${key.replace(/[:]/g, '\\:')}"[^>]*content="([^"]*)"`, 'i').exec(html)
         || new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attr}="${key.replace(/[:]/g, '\\:')}"`, 'i').exec(html);
  return m && m[1];
};

test.each(PAGES)('%s carries the link-preview tags, pointing at the schematic image', page => {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  assert.match(meta(html, 'property', 'og:title') || '', /Edison/);
  assert.ok((meta(html, 'property', 'og:description') || '').length > 40, 'og:description');
  assert.equal(meta(html, 'property', 'og:image'), `${SITE}/og-image.png`);
  assert.equal(meta(html, 'property', 'og:image:width'), '1200');
  assert.equal(meta(html, 'property', 'og:image:height'), '630');
  assert.equal(meta(html, 'name', 'twitter:card'), 'summary_large_image');
  assert.equal(meta(html, 'name', 'twitter:image'), `${SITE}/og-image.png`);
  assert.ok(meta(html, 'name', 'description'), 'a plain description too');
});

test('og-image.png exists, is a 1200×630 PNG, and ships (not ignored for Vercel)', () => {
  const file = path.join(ROOT, 'og-image.png');
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  assert.deepStrictEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [1200, 630]);
  assert.ok(buf.length < 300 * 1024, 'small enough for link crawlers');
  const ignore = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8');
  assert.ok(!/^\/?og-image\.png$/m.test(ignore));
});
