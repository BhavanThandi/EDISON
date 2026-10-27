/**
 * Vercel function for every /api/* route (CommonJS, no dependencies).
 *
 * It hands each request to the same handler `node backend/server.js` uses; the
 * server is required once and never listens here (it only listens under
 * `node server.js`). Static files (circuit3d/, edison/, ...) come from Vercel's
 * CDN, not the server's static-file branch, so that branch is never reached.
 * Timeout and no-cache headers are set in ../vercel.json.
 *
 * Vercel's catch-all route passes the matched segments back as a `path`
 * query parameter (and may show the file name `[...path]` in the URL). The
 * server matches exact URLs (`req.url === '/api/health'`), so the original
 * URL is restored first: the segments rebuilt, the injected parameter dropped,
 * any real query kept.
 */
const { server } = require('../backend/server.js');

function originalUrl(url) {
  const q = url.indexOf('?');
  const pathname = q === -1 ? url : url.slice(0, q);
  const params = new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
  const segs = params.getAll('path').concat(params.getAll('...path')).filter(Boolean);
  params.delete('path');
  params.delete('...path');
  const rest = params.toString();
  const named = /\[\.\.\.path\]/.test(decodeURIComponent(pathname));
  const p = named && segs.length ? `/api/${segs.join('/')}` : pathname;
  return p + (rest ? `?${rest}` : '');
}

module.exports = (req, res) => {
  req.url = originalUrl(req.url || '/');
  server.emit('request', req, res);
};
module.exports.originalUrl = originalUrl;
