/**
 * Vercel function for every /api/* route (CommonJS, no dependencies).
 *
 * It hands each request to the same handler `node backend/server.js` uses; the
 * server is required once and never listens here (it only listens under
 * `node server.js`). Static files (circuit3d/, edison/, ...) come from Vercel's
 * CDN, not the server's static-file branch, so that branch is never reached.
 * Timeout and no-cache headers are set in ../vercel.json.
 */
const { server } = require('../backend/server.js');

module.exports = (req, res) => server.emit('request', req, res);
