// Task D1: landing.html stays in the repo but no shipped page links to it.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'out', 'test', 'e2e', '.git']);

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : htmlFiles(p);
    return e.name.endsWith('.html') && p !== path.join(ROOT, 'landing.html') ? [p] : [];
  });
}

test('no shipped page links to landing.html', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'landing.html')), 'landing.html stays in the repo');
  const hits = [];
  for (const f of htmlFiles(ROOT)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/landing\.html/.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(hits, [], 'pages still linking to landing.html:\n' + hits.join('\n'));
});

test('/ points at the Edison editor', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /circuit3d\/index\.html\?ui=edison/);
});
