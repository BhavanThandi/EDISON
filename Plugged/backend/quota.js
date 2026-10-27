// ─────────────────────────────────────────────────────────────
//  backend/quota.js: daily counters for the AI routes (deploy D3).
//  take(key, limit, { store, now }) → { ok, used, limit }. `key` is undated
//  ('u:<uid>:ask', 'g:photo'); the UTC date is appended, so every count
//  starts again at 1 each UTC day. A refused take still counts.
//  The store is Upstash Redis over REST (one pipeline: INCR, EXPIRE 48 h)
//  when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are both set,
//  else KV_REST_API_URL and KV_REST_API_TOKEN (the names Vercel's Upstash
//  integration sets; read per call), else this process's memory. A URL
//  without its own token is no store. A store error counts in memory
//  instead: the limit still holds per instance, never unlimited.
//  Node built-ins only: the global fetch.
// ─────────────────────────────────────────────────────────────
const KEY_TTL_S        = 172800;   // 2 days: a dated key outlives its day, then Redis drops it
const STORE_TIMEOUT_MS = 3000;
const WARN_EVERY_MS    = 60000;

// date → Map(dated key → count). Days before the current one are dropped.
const memory = new Map();
function resetMemory() { memory.clear(); }

function dayOf(date) {
  for (const d of memory.keys()) if (d < date) memory.delete(d);
  if (!memory.has(date)) memory.set(date, new Map());
  return memory.get(date);
}
// Counts one in memory and returns the count.
function countInMemory(dated, date) {
  const day = dayOf(date);
  const n = (day.get(dated) || 0) + 1;
  day.set(dated, n);
  return n;
}
// Keeps the store's count, so a later fallback starts from what this instance last saw.
function remember(dated, date, n) {
  const day = dayOf(date);
  day.set(dated, Math.max(day.get(dated) || 0, n));
}

// { url, token } of the Upstash REST store, or null. Each pair only with its own token.
function upstashConfig(env = process.env) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) return { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN };
  return null;
}
// 'upstash' or 'memory': where take() counts right now (for /api/health).
const storeName = () => (upstashConfig() ? 'upstash' : 'memory');

// The key's new count from Upstash; throws on any failure (no count, no 200, no answer in time).
async function upstashIncr(dated, { url, token }) {
  const base = String(url).replace(/\/+$/, '');
  const res = await fetch(`${base}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['INCR', dated], ['EXPIRE', dated, KEY_TTL_S]]),
    signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const out = await res.json();
  const n = Array.isArray(out) && out[0] ? out[0].result : undefined;
  if (!Number.isInteger(n)) throw new Error('no count in the reply');
  return n;
}

let warnedAt = 0;
function warnStore(e) {
  if (Date.now() - warnedAt < WARN_EVERY_MS) return;
  warnedAt = Date.now();
  console.warn(`[quota] counter store failed (${String((e && e.message) || e).slice(0, 80)}); counting in memory`);
}

// `store` (optional, for a caller with its own counter): { incr(datedKey) → count }.
async function take(key, limit, { store, now = Date.now } = {}) {
  if (typeof key !== 'string' || !key) throw new TypeError('quota key must be a non-empty string');
  let ms = Number(now());
  if (!Number.isFinite(ms)) ms = Date.now();
  const date  = new Date(ms).toISOString().slice(0, 10);
  const dated = `${key}:${date}`;
  const conf  = store ? null : upstashConfig();
  const incr  = store ? k => store.incr(k) : conf ? k => upstashIncr(k, conf) : null;
  let used;
  if (incr) {
    try {
      used = await incr(dated);
      if (!Number.isInteger(used)) throw new Error('no count from the store');
      remember(dated, date, used);
    } catch (e) {
      warnStore(e);
      used = countInMemory(dated, date);
    }
  } else {
    used = countInMemory(dated, date);
  }
  return { ok: used <= limit, used, limit };
}

module.exports = { take, resetMemory, storeName };
