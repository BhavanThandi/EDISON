// backend/auth.js (task D3): Firebase ID-token verification with node:crypto.
//
// Interface assumed (stated for the builder):
// - require('../backend/auth.js').verifyIdToken(token, { projectId, fetchCerts, now })
//   returns a Promise of { uid, email } (uid = the token's `sub`), or rejects
//   with an Error (any message).
// - fetchCerts: async () => ({ [kid]: pem }). Google's real endpoint gives
//   X.509 certificate PEMs; node can't mint certs without a library, so the
//   test passes PUBLIC-KEY PEMs (SPKI). The module must hand the PEM to
//   crypto.createPublicKey, which takes a certificate or a key. The module
//   caches the map for a default lifetime of at least a minute (the default
//   fetchCerts, used when none is passed, reads Cache-Control itself; not
//   exercised here).
// - now: () => epoch milliseconds (default Date.now). Clock skew allowed on
//   `iat` is 5 minutes.
// - Certs are cached in the module between calls (so two verifications within
//   max-age call fetchCerts once). auth.js also exports resetCache() so tests
//   start clean.

const assert = require('node:assert');
const { makeKeys, sign, b64u, PROJECT, NOW_S } = require('./helpers/jwt.js');

const Auth = () => require('../backend/auth.js');
const keys = makeKeys();
const other = makeKeys();
const now = () => NOW_S * 1000;
const fetchCerts = async () => ({ kid1: keys.publicPem });

async function verify(token, opts = {}) {
  const A = Auth();
  if (A.resetCache) A.resetCache();
  return A.verifyIdToken(token, { projectId: PROJECT, fetchCerts, now, ...opts });
}
async function refused(token, why, opts) {
  let out;
  try { out = await verify(token, opts); } catch (e) {
    assert.ok(e instanceof Error, 'rejects with an Error');
    // A missing module must not pass as "refused".
    assert.notEqual(e.code, 'MODULE_NOT_FOUND', `backend/auth.js can't be loaded: ${e.message.split('\n')[0]}`);
    return;
  }
  assert.fail(`${why} was accepted: ${JSON.stringify(out)}`);
}

test('a good token gives { uid: sub, email }', async () => {
  const out = await verify(sign(keys.privateKey));
  assert.deepStrictEqual(out, { uid: 'user-1', email: 'a@example.com' });
});

test('a token without an email still verifies (uid only needed)', async () => {
  const out = await verify(sign(keys.privateKey, { payload: { email: undefined } }));
  assert.equal(out.uid, 'user-1');
});

test('tokens with a bad signature, an old exp, or another aud are refused', async () => {
  await refused(sign(other.privateKey), 'a token signed by another key');
  await refused(sign(keys.privateKey, { tamper: (input, sig) => `${input}.${sig.slice(0, -4)}AAAA` }), 'a corrupted signature');
  await refused(sign(keys.privateKey, { tamper: (input, sig) => {
    const [h, , s] = `${input}.${sig}`.split('.');
    return `${h}.${b64u({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'someone-else', iat: NOW_S - 60, exp: NOW_S + 3600 })}.${s}`;
  } }), 'a payload swapped after signing');
  await refused(sign(keys.privateKey, { payload: { exp: NOW_S - 1 } }), 'an expired token');
  await refused(sign(keys.privateKey, { payload: { aud: 'another-project' } }), 'another aud');
});

test('iat in the future: 5 minutes of skew is fine, more is refused', async () => {
  const ok = await verify(sign(keys.privateKey, { payload: { iat: NOW_S + 240 } }));
  assert.equal(ok.uid, 'user-1');
  await refused(sign(keys.privateKey, { payload: { iat: NOW_S + 600 } }), 'iat 10 minutes ahead');
});

test('another iss is refused', async () => {
  await refused(sign(keys.privateKey, { payload: { iss: 'https://securetoken.google.com/another-project' } }), 'another project in iss');
  await refused(sign(keys.privateKey, { payload: { iss: 'https://accounts.google.com' } }), 'accounts.google.com as iss');
  await refused(sign(keys.privateKey, { payload: { iss: undefined } }), 'no iss');
});

test('an unknown kid is refused', async () => {
  await refused(sign(keys.privateKey, { header: { kid: 'nope' } }), 'an unknown kid');
  await refused(sign(keys.privateKey, { header: { kid: undefined } }), 'no kid');
});

test('alg none and alg HS256 are refused (only RS256)', async () => {
  await refused(sign(keys.privateKey, { header: { alg: 'none' } }), 'alg none');
  await refused(sign(keys.privateKey, { header: { alg: 'HS256' } }), 'alg HS256');
  // HS256 signed with the public PEM as the secret: the classic confusion attack.
  const crypto = require('node:crypto');
  const input = `${b64u({ alg: 'HS256', kid: 'kid1', typ: 'JWT' })}.${b64u({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'user-1', iat: NOW_S - 60, exp: NOW_S + 3600 })}`;
  await refused(`${input}.${crypto.createHmac('sha256', keys.publicPem).update(input).digest('base64url')}`, 'HS256 keyed with the public key');
});

test('a missing or empty sub is refused', async () => {
  await refused(sign(keys.privateKey, { payload: { sub: undefined } }), 'no sub');
  await refused(sign(keys.privateKey, { payload: { sub: '' } }), 'an empty sub');
});

test('malformed tokens are refused: not 3 parts, bad base64, empty, not a string', async () => {
  const good = sign(keys.privateKey);
  const [h, p, s] = good.split('.');
  await refused('', 'an empty token');
  await refused('abc', 'one part');
  await refused(`${h}.${p}`, 'two parts');
  await refused(`${good}.extra`, 'four parts');
  await refused(`!!!.${p}.${s}`, 'a header that is not base64/JSON');
  await refused(`${h}.not json at all.${s}`, 'a payload that is not JSON');
  await refused(undefined, 'undefined');
  await refused(null, 'null');
});

test('certs are cached: two verifications within max-age call fetchCerts once', async () => {
  const A = Auth();
  A.resetCache();
  let calls = 0;
  const counting = async () => { calls++; return { kid1: keys.publicPem }; };
  const opts = { projectId: PROJECT, fetchCerts: counting, now };
  await A.verifyIdToken(sign(keys.privateKey), opts);
  await A.verifyIdToken(sign(keys.privateKey, { payload: { sub: 'user-2' } }), opts);
  assert.equal(calls, 1);
});

test('a failing fetchCerts refuses the token (never lets it through)', async () => {
  await refused(sign(keys.privateKey), 'a token while the cert fetch fails', { fetchCerts: async () => { throw new Error('offline'); } });
});

test('only Google sign-in counts: firebase.sign_in_provider must be google.com (anonymous, password, missing are refused)', async () => {
  const ok = await verify(sign(keys.privateKey, { payload: { firebase: { sign_in_provider: 'google.com' } } }));
  assert.equal(ok.uid, 'user-1');
  await refused(sign(keys.privateKey, { payload: { firebase: { sign_in_provider: 'anonymous' } } }), 'an anonymous sign-in');
  await refused(sign(keys.privateKey, { payload: { firebase: { sign_in_provider: 'password' } } }), 'a password sign-in');
  await refused(sign(keys.privateKey, { payload: { firebase: {} } }), 'a firebase claim with no provider');
  await refused(sign(keys.privateKey, { payload: { firebase: undefined } }), 'no firebase claim');
});
