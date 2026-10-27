// backend/quota.js (task D3): per-user and global daily counters.
//
// Interface assumed (stated for the builder):
// - require('../backend/quota.js').take(key, limit, { now }) → Promise of
//   { ok, used, limit }. `used` is the count including this call; ok is
//   used <= limit. A refused call still counts (used may exceed limit).
// - `key` is UNDATED ('u:<uid>:ask', 'g:ask', 'u:<uid>:photo', 'g:photo');
//   take appends ':<yyyy-mm-dd>' (the UTC date of now) so the stored key is
//   'u:<uid>:ask:2026-10-26'. now: () => epoch ms (default Date.now).
// - The store is picked per call: Upstash when UPSTASH_REDIS_REST_URL and
//   UPSTASH_REDIS_REST_TOKEN are both set (read per call), else in-memory.
//   Upstash: ONE global fetch(`${URL}/pipeline`, { method: 'POST',
//   headers: { Authorization: `Bearer ${TOKEN}`, ... }, body: JSON.stringify(
//   [['INCR', dated], ['EXPIRE', dated, 172800]]) }); the reply is
//   [{ result: <count> }, { result: 1 }]. EXPIRE's seconds may be a number
//   or a string.
// - A store error (fetch rejects, non-200, or a reply without a numeric
//   INCR result) falls back to the module's in-memory counter, which keeps
//   counting per key, so the limit still holds (never unlimited).
// - The in-memory counter is shared by the module; these tests use unique
//   keys instead of resetting it (quota.resetMemory() is used by the route
//   tests).

const assert = require('node:assert');

const Quota = () => require('../backend/quota.js');
const D1 = () => 1_800_000_000_000;                           // 2027-01-15T08:00:00Z
const NEXT_DAY = () => D1() + 24 * 3600 * 1000;
const date = ms => new Date(ms).toISOString().slice(0, 10);
let n = 0;
const uniq = p => `${p}-${process.pid}-${++n}`;

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});
afterEach(() => { vi.unstubAllGlobals(); });

test('in memory: allows up to the limit, then refuses with used and limit', async () => {
  const { take } = Quota();
  const k = uniq('u:a:ask');
  for (let i = 1; i <= 5; i++) assert.deepStrictEqual(await take(k, 5, { now: D1 }), { ok: true, used: i, limit: 5 });
  const sixth = await take(k, 5, { now: D1 });
  assert.equal(sixth.ok, false);
  assert.equal(sixth.limit, 5);
  assert.ok(sixth.used >= 5, JSON.stringify(sixth));
});

test('per-key limits: the same count is fine under one limit and refused under another', async () => {
  const { take } = Quota();
  const a = uniq('u:x:photo'), b = uniq('u:y:ask');
  assert.equal((await take(a, 1, { now: D1 })).ok, true);
  assert.equal((await take(a, 1, { now: D1 })).ok, false);
  assert.equal((await take(b, 5, { now: D1 })).ok, true);
  assert.equal((await take(b, 5, { now: D1 })).ok, true);
});

test('separate users are independent', async () => {
  const { take } = Quota();
  const u1 = uniq('u:one:ask'), u2 = uniq('u:two:ask');
  await take(u1, 1, { now: D1 });
  assert.equal((await take(u1, 1, { now: D1 })).ok, false);
  assert.deepStrictEqual(await take(u2, 1, { now: D1 }), { ok: true, used: 1, limit: 1 });
});

test('a global key is shared by every caller who takes from it', async () => {
  const { take } = Quota();
  const g = uniq('g:ask');
  assert.equal((await take(g, 2, { now: D1 })).ok, true);   // user A
  assert.equal((await take(g, 2, { now: D1 })).ok, true);   // user B
  assert.equal((await take(g, 2, { now: D1 })).ok, false);  // user C: the day's pool is used up
});

test('the UTC date rolls over: the next day starts again at 1', async () => {
  const { take } = Quota();
  const k = uniq('u:roll:ask');
  await take(k, 1, { now: D1 });
  assert.equal((await take(k, 1, { now: D1 })).ok, false);
  assert.deepStrictEqual(await take(k, 1, { now: NEXT_DAY }), { ok: true, used: 1, limit: 1 });
  // 23:59:59Z and 00:00:00Z the next day are different days.
  const m = uniq('u:edge:ask');
  const late = () => Date.parse('2027-03-01T23:59:59Z'), early = () => Date.parse('2027-03-02T00:00:00Z');
  await take(m, 1, { now: late });
  assert.equal((await take(m, 1, { now: early })).ok, true);
});

function upstash(handler) {
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'tok-123';
  const calls = [];
  const fetch = vi.fn(async (url, opts) => {
    calls.push({ url: String(url), opts, body: JSON.parse(opts.body) });
    return handler(calls.length, calls[calls.length - 1]);
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}
const reply = (status, json) => ({ ok: status === 200, status, json: async () => json, text: async () => JSON.stringify(json) });

test('Upstash: ONE pipeline request with INCR then EXPIRE 172800, bearer auth, dated key', async () => {
  const k = uniq('u:up:ask');
  const calls = upstash(() => reply(200, [{ result: 3 }, { result: 1 }]));
  const out = await Quota().take(k, 5, { now: D1 });
  assert.deepStrictEqual(out, { ok: true, used: 3, limit: 5 });
  assert.equal(calls.length, 1, 'one request');
  assert.equal(calls[0].url, 'https://fake-redis.example.test/pipeline');
  assert.equal(calls[0].opts.method, 'POST');
  const headers = Object.fromEntries(Object.entries(calls[0].opts.headers).map(([h, v]) => [h.toLowerCase(), v]));
  assert.equal(headers.authorization, 'Bearer tok-123');
  const dated = `${k}:${date(D1())}`;
  assert.equal(calls[0].body.length, 2);
  assert.deepStrictEqual(calls[0].body[0], ['INCR', dated]);
  assert.deepStrictEqual(calls[0].body[1].map(String), ['EXPIRE', dated, '172800']);
});

test('Upstash: a count past the limit is refused', async () => {
  upstash(() => reply(200, [{ result: 6 }, { result: 1 }]));
  const out = await Quota().take(uniq('u:up:over'), 5, { now: D1 });
  assert.equal(out.ok, false);
  assert.equal(out.used, 6);
  assert.equal(out.limit, 5);
});

test.each([
  ['fetch throws', () => { throw new Error('ECONNRESET'); }],
  ['a 500', () => reply(500, { error: 'boom' })],
  ['a 401', () => reply(401, { error: 'bad token' })],
  ['a reply with no count', () => reply(200, [{ error: 'ERR' }])],
])('counter store errors keep the in-memory caps: %s', async (_, handler) => {
  upstash(handler);
  const { take } = Quota();
  const k = uniq('u:down:ask');
  assert.equal((await take(k, 2, { now: D1 })).ok, true);
  assert.equal((await take(k, 2, { now: D1 })).ok, true);
  const third = await take(k, 2, { now: D1 });
  assert.equal(third.ok, false, 'a down store must not mean unlimited');
  assert.equal(third.limit, 2);
});
