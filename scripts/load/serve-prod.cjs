// Serves the production build (dist/server) on a local port with the SAME request handler Vercel runs (api/index.js).
// Use it to load-test the API in production mode without deploying:
//   npx expo export -p web
//   set -a; . ./.env.local; set +a; NODE_ENV=production PORT=8201 node scripts/load/serve-prod.cjs
// Prints nothing but the listening line; secrets are read from the environment and never logged.
const http = require('http');
const path = require('path');
const handler = require(path.join(__dirname, '../../api/index.js'));
const port = Number(process.env.PORT || 8201);
http.createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch(err => { console.error('[serve-prod]', err && err.message); if (!res.headersSent) res.statusCode = 500; res.end(); });
}).listen(port, '127.0.0.1', () => console.log(`serve-prod listening on http://127.0.0.1:${port} pid ${process.pid}`));
