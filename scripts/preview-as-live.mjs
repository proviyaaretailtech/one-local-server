// Runs this checkout's web app the way the shipped app behaves: pages come from the local Expo dev
// server (so your changes show), but every /api call is forwarded to the live One Local server.
// The web app always calls its own page address (src/api.ts), so BACKEND_URL cannot do this on web.
//   node scripts/preview-as-live.mjs            -> http://localhost:8084
// Supabase comes from frontend/.env (the live project); start Expo with those values (see launch.json).
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const LIVE = new URL(process.env.LIVE_BACKEND || 'https://one-local-server.vercel.app');
const EXPO = { host: '127.0.0.1', port: Number(process.env.EXPO_PORT || 8085) };
const PORT = Number(process.env.PORT || 8084);

const server = http.createServer((req, res) => {
  const toLive = req.url.startsWith('/api/') || req.url === '/api';
  const headers = { ...req.headers };
  let options;
  if (toLive) {
    // The live server sees a request from its own site.
    headers.host = LIVE.host;
    if (headers.origin) headers.origin = LIVE.origin;
    if (headers.referer) headers.referer = LIVE.origin + '/';
    options = { host: LIVE.hostname, port: 443, path: req.url, method: req.method, headers };
  } else {
    options = { ...EXPO, path: req.url, method: req.method, headers };
  }
  const upstream = (toLive ? https : http).request(options, up => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res); });
  upstream.on('error', e => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(`proxy error: ${e.message}`); });
  req.pipe(upstream);
});

// Expo's hot reload socket.
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(EXPO.port, EXPO.host, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, () => console.log(`as-live preview on http://localhost:${PORT}  (pages: Expo :${EXPO.port}, /api: ${LIVE.origin})`));
