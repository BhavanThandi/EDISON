// ─────────────────────────────────────────────────────────────
//  backend/auth.js: Firebase ID-token checks for the AI routes (deploy D3).
//  verifyIdToken(token, { projectId, fetchCerts, now }) → { uid, email, emailVerified },
//  or throws an AuthError (its `code` says why; never the token itself).
//  Only Google sign-ins (firebase.sign_in_provider 'google.com') pass.
//  Node built-ins only: node:crypto for RS256, the global fetch for
//  Google's public certs (cached for the reply's Cache-Control max-age).
// ─────────────────────────────────────────────────────────────
const crypto = require('node:crypto');

const CERTS_URL      = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const ISSUER         = 'https://securetoken.google.com/';
const IAT_SKEW_S     = 300;              // a token issued up to 5 minutes "ahead" (clock skew)
const MAX_TOKEN_LEN  = 8192;             // a Firebase ID token is ~1 KB
const MAX_SUB_LEN    = 128;              // Firebase uids are at most 128 characters
const DEFAULT_TTL_MS = 60 * 60 * 1000;   // certs from an injected fetchCerts, or a reply without max-age
const MIN_TTL_MS     = 60 * 1000;
const MAX_TTL_MS     = 24 * 60 * 60 * 1000;
const CERTS_TIMEOUT  = 5000;
const B64URL         = /^[A-Za-z0-9_-]+$/;

class AuthError extends Error {
  constructor(code) { super(`ID token refused: ${code}`); this.name = 'AuthError'; this.code = code; }
}
const refuse = code => { throw new AuthError(code); };

// A base64url JSON object, or null (bad characters, not JSON, not an object).
function decodePart(s) {
  if (!B64URL.test(s)) return null;
  try {
    const o = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch { return null; }
}

// Google's certs: { certs: { kid: pem }, ttlMs } from Cache-Control max-age.
async function fetchGoogleCerts() {
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(CERTS_TIMEOUT) });
  if (!res.ok) throw new Error(`certs HTTP ${res.status}`);
  const m = /max-age=(\d+)/i.exec(String((res.headers && res.headers.get('cache-control')) || ''));
  const ttlMs = m ? Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Number(m[1]) * 1000)) : DEFAULT_TTL_MS;
  return { certs: await res.json(), ttlMs };
}

// kid → RSA KeyObject. A PEM may be an X.509 certificate or a public key;
// one that doesn't parse, or isn't RSA, is left out.
function toKeys(certs) {
  if (!certs || typeof certs !== 'object' || Array.isArray(certs)) throw new Error('certs not an object');
  const keys = new Map();
  for (const [kid, pem] of Object.entries(certs)) {
    if (typeof pem !== 'string') continue;
    try {
      const key = crypto.createPublicKey(pem);
      if (key.asymmetricKeyType === 'rsa') keys.set(kid, key);
    } catch { /* skip it */ }
  }
  if (!keys.size) throw new Error('no usable certs');
  return keys;
}

// One cache, kept per cert source: an injected fetchCerts never shares Google's.
let cache = null;   // { source, keys, expires }
function resetCache() { cache = null; }

async function certKeys(fetchCerts, nowMs) {
  const source = fetchCerts || fetchGoogleCerts;
  if (cache && cache.source === source && nowMs < cache.expires) return cache.keys;
  let got;
  try {
    got = fetchCerts ? { certs: await fetchCerts(), ttlMs: DEFAULT_TTL_MS } : await fetchGoogleCerts();
  } catch { refuse('CERTS_UNAVAILABLE'); }
  let keys;
  try { keys = toKeys(got.certs); } catch { refuse('CERTS_UNAVAILABLE'); }
  cache = { source, keys, expires: nowMs + got.ttlMs };
  return keys;
}

async function verifyIdToken(token, { projectId, fetchCerts, now = Date.now } = {}) {
  if (typeof projectId !== 'string' || !projectId) refuse('NO_PROJECT');
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LEN) refuse('NO_TOKEN');
  const parts = token.split('.');
  if (parts.length !== 3) refuse('MALFORMED');
  const [h, p, s] = parts;
  const header = decodePart(h), payload = decodePart(p);
  if (!header || !payload || !B64URL.test(s)) refuse('MALFORMED');

  // Only RS256 (never none, never HS256 keyed with a public cert), and a kid.
  if (header.alg !== 'RS256') refuse('BAD_ALG');
  if (typeof header.kid !== 'string' || !header.kid) refuse('BAD_KID');

  const nowMs = Number(now());
  const nowS  = nowMs / 1000;
  const { aud, iss, sub, exp, iat, email } = payload;
  if (aud !== projectId) refuse('BAD_AUD');
  if (iss !== ISSUER + projectId) refuse('BAD_ISS');
  if (typeof exp !== 'number' || !Number.isFinite(exp) || !(exp > nowS)) refuse('EXPIRED');
  if (typeof iat !== 'number' || !Number.isFinite(iat) || !(iat <= nowS + IAT_SKEW_S)) refuse('BAD_IAT');
  if (typeof sub !== 'string' || !sub || sub.length > MAX_SUB_LEN) refuse('BAD_SUB');
  // Google sign-ins only: not anonymous, password, or any other provider.
  const fb = payload.firebase;
  if (!fb || typeof fb !== 'object' || fb.sign_in_provider !== 'google.com') refuse('NOT_GOOGLE');

  const key = (await certKeys(fetchCerts, nowMs)).get(header.kid);
  if (!key) refuse('BAD_KID');
  let good = false;
  try {
    good = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`)
      .verify({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(s, 'base64url'));
  } catch { good = false; }
  if (!good) refuse('BAD_SIGNATURE');

  // emailVerified: only Google's own `email_verified: true` counts (the owner allow-list relies on it).
  return { uid: sub, email: typeof email === 'string' ? email : null, emailVerified: payload.email_verified === true };
}

module.exports = { verifyIdToken, resetCache, AuthError, CERTS_URL };
