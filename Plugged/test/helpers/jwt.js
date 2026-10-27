// Test-only: a locally generated RSA key pair standing in for Google's, and
// a Firebase-style ID token signer. Not a test file (vitest only runs *.test.js).
const crypto = require('node:crypto');

const b64u = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

function makeKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, publicPem: publicKey.export({ type: 'spki', format: 'pem' }) };
}

const PROJECT = 'plugged-hackathon';
const NOW_S = 1_800_000_000;   // a fixed "now" in seconds

// overrides: header/payload fields; a key set to undefined is removed.
function sign(privateKey, { header = {}, payload = {}, now = NOW_S, tamper } = {}) {
  const h = { alg: 'RS256', kid: 'kid1', typ: 'JWT', ...header };
  const p = {
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'user-1', email: 'a@example.com',
    iat: now - 60, exp: now + 3600, auth_time: now - 60,
    firebase: { sign_in_provider: 'google.com', identities: { 'google.com': ['123'] } }, ...payload,
  };
  for (const o of [h, p]) for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  const input = `${b64u(h)}.${b64u(p)}`;
  let sig = h.alg === 'RS256' || h.alg === 'RS384'
    ? crypto.createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url') : '';
  if (h.alg === 'HS256') sig = crypto.createHmac('sha256', 'secret').update(input).digest('base64url');
  if (tamper) return tamper(input, sig);
  return `${input}.${sig}`;
}

module.exports = { makeKeys, sign, b64u, PROJECT, NOW_S };
