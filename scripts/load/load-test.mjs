#!/usr/bin/env node
// Load test for the One Local API (Expo Router API routes). Plain Node, no dependencies (k6 / autocannon are not needed).
//
// Commands (run from frontend/):
//   node scripts/load/load-test.mjs setup    --env .env.local --customers 180 --riders 16 --partners 4 --fixtures /path/fixtures.json
//   node scripts/load/load-test.mjs run      --base http://127.0.0.1:8201 --fixtures F --stages 10,50,200 --duration 45 --pid <server pid> --out result.json
//   node scripts/load/load-test.mjs saturate --base http://127.0.0.1:8201 --paths /api/catalog,/api/stores --connections 50,200,500 --duration 15
//   node scripts/load/load-test.mjs probe    --base http://127.0.0.1:8201 [--base2 http://127.0.0.1:8202] --fixtures F --env .env.local
//   node scripts/load/load-test.mjs hosted   --base https://one-local-server.vercel.app --duration 60 --rps 5     (READ-ONLY)
//   node scripts/load/load-test.mjs cleanup  --env .env.local
//
// SAFETY
//   * setup / run / probe / cleanup refuse any database that is not on 127.0.0.1 / localhost (CLAUDE.md: local only).
//   * The request function refuses a non-GET request to any host that is not loopback, so the hosted server can never be written to.
//   * Test users are zz-load-*@example.test (database/purge_test_orders.sh also removes zz-%@example.test); orders carry notes "ZZ-TEST load-test".
//   * Secrets are read from the env file and never printed or written to the result files. Fixture passwords are random and local-only.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------- args
const [cmd = 'help', ...rest] = process.argv.slice(2);
const arg = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { arg[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
const num = (k, d) => (arg[k] === undefined ? d : Number(arg[k]));
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/;

function loadEnv(file) {
  const env = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
function localDb() {
  const env = loadEnv(arg.env || '.env.local');
  const url = env.SUPABASE_URL;
  if (!url || !LOOPBACK.test(new URL(url).hostname)) throw new Error('refusing to run: SUPABASE_URL is not a local database');
  return { url, service: env.SUPABASE_SERVICE_ROLE_KEY, anon: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY };
}

// ---------------------------------------------------------------- http
const agents = { 'http:': new http.Agent({ keepAlive: true, maxSockets: Infinity }), 'https:': new https.Agent({ keepAlive: true, maxSockets: Infinity }) };
function request(method, urlStr, { headers = {}, body, timeout = 30_000 } = {}) {
  const u = new URL(urlStr);
  if (!LOOPBACK.test(u.hostname) && method !== 'GET' && method !== 'HEAD') throw new Error(`refusing ${method} to non-local host ${u.hostname}`);
  const lib = u.protocol === 'https:' ? https : http;
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const t0 = performance.now();
  return new Promise(resolve => {
    const fail = e => resolve({ status: 0, ms: performance.now() - t0, bytes: 0, headers: {}, error: e.code || e.message, text: () => '' });
    const req = lib.request(u, { method, agent: agents[u.protocol], headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers }, timeout }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, ms: performance.now() - t0, bytes: buf.length, headers: res.headers, text: () => buf.toString('utf8') });
      });
      res.on('error', fail);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', fail);
    if (payload) req.write(payload);
    req.end();
  });
}
const json = r => { try { return JSON.parse(r.text()); } catch { return null; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

// ---------------------------------------------------------------- metrics
let metrics = new Map();
function record(name, r) {
  let m = metrics.get(name);
  if (!m) metrics.set(name, m = { n: 0, lat: [], status: {}, bytes: 0, errors: {} });
  m.n++; m.lat.push(r.ms); m.bytes += r.bytes;
  m.status[r.status] = (m.status[r.status] || 0) + 1;
  if (r.error) m.errors[r.error] = (m.errors[r.error] || 0) + 1;
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
function summarise(map, seconds) {
  const rows = {}; const all = { n: 0, lat: [], status: {} };
  for (const [name, m] of map) {
    const s = [...m.lat].sort((a, b) => a - b);
    rows[name] = { requests: m.n, rps: +(m.n / seconds).toFixed(1), p50: +pct(s, 50).toFixed(1), p95: +pct(s, 95).toFixed(1), p99: +pct(s, 99).toFixed(1), max: +(s[s.length - 1] || 0).toFixed(1), status: m.status, errors: m.errors, kb_per_response: +(m.bytes / m.n / 1024).toFixed(1) };
    all.n += m.n; for (const l of m.lat) all.lat.push(l);
    for (const [k, v] of Object.entries(m.status)) all.status[k] = (all.status[k] || 0) + v;
  }
  const s = all.lat.sort((a, b) => a - b);
  const sum = f => Object.entries(all.status).filter(([c]) => f(Number(c))).reduce((a, [, v]) => a + v, 0);
  rows.__ALL__ = {
    requests: all.n, rps: +(all.n / seconds).toFixed(1), p50: +pct(s, 50).toFixed(1), p95: +pct(s, 95).toFixed(1), p99: +pct(s, 99).toFixed(1), max: +(s[s.length - 1] || 0).toFixed(1), status: all.status,
    ok: sum(c => c >= 200 && c < 300), rate_limited_429: sum(c => c === 429), client_4xx_other: sum(c => c >= 400 && c < 500 && c !== 429), server_5xx: sum(c => c >= 500), network_errors: sum(c => c === 0),
  };
  return rows;
}

function printTable(rows) {
  const names = Object.keys(rows).filter(k => k !== '__ALL__').concat('__ALL__');
  console.log('endpoint'.padEnd(36) + 'reqs'.padStart(7) + 'rps'.padStart(8) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'max'.padStart(8) + '  statuses');
  for (const n of names) {
    const r = rows[n];
    console.log(n.replace('__ALL__', 'ALL').padEnd(36) + String(r.requests).padStart(7) + String(r.rps).padStart(8) + String(r.p50).padStart(8) + String(r.p95).padStart(8) + String(r.p99).padStart(8) + String(r.max).padStart(8) + '  ' + JSON.stringify(r.status));
  }
}

// ---------------------------------------------------------------- resource sampling (server process + local Supabase containers)
function cpuSeconds(pid) {
  try {
    const t = execFileSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return t.split(':').map(Number).reduce((a, p) => a * 60 + p, 0); // [h:]m:ss.xx
  } catch { return null; }
}
const rssMb = pid => { try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024; } catch { return null; } };
// Asynchronous on purpose: `docker stats` takes ~1.5 s, and a blocking call would freeze this process's event loop and show up as fake latency.
async function dockerStats() {
  try {
    const { stdout: out } = await execFileAsync('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}}', 'supabase_db_onelocal-dev', 'supabase_rest_onelocal-dev', 'supabase_auth_onelocal-dev', 'supabase_kong_onelocal-dev'], { encoding: 'utf8', timeout: 15_000 });
    return Object.fromEntries(out.trim().split('\n').map(l => { const [n, c] = l.split(' '); return [n.replace('supabase_', '').replace('_onelocal-dev', ''), parseFloat(c)]; }));
  } catch { return {}; }
}
const psql = sql => execFileSync('docker', ['exec', 'supabase_db_onelocal-dev', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim();
const pgConnections = () => { try { return Number(psql("select count(*) from pg_stat_activity where datname='postgres'")); } catch { return null; } };

function startSampler(pid) {
  const s = { cpu: [], rss: [], docker: [], stop: false };
  let last = pid ? { t: performance.now(), c: cpuSeconds(pid) } : null;
  const timer = setInterval(() => {
    if (!pid) return;
    const c = cpuSeconds(pid), now = performance.now();
    if (c != null && last?.c != null) s.cpu.push(((c - last.c) / ((now - last.t) / 1000)) * 100);
    last = { t: now, c };
    const r = rssMb(pid); if (r) s.rss.push(r);
  }, 2000);
  (async () => { while (!s.stop) { s.docker.push(await dockerStats()); } })();
  s.finish = () => {
    clearInterval(timer); s.stop = true;
    const avg = a => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(0) : null);
    const mx = a => (a.length ? +Math.max(...a).toFixed(0) : null);
    const dk = {};
    for (const d of s.docker) for (const [k, v] of Object.entries(d)) (dk[k] ??= []).push(v);
    return { server_cpu_pct_avg: avg(s.cpu), server_cpu_pct_max: mx(s.cpu), server_rss_mb_max: mx(s.rss), supabase_cpu_pct: Object.fromEntries(Object.entries(dk).map(([k, v]) => [k, { avg: avg(v), max: mx(v) }])) };
  };
  return s;
}

// ---------------------------------------------------------------- setup / cleanup (LOCAL database only)
const rand = () => randomBytes(9).toString('base64url') + 'aA1!';
async function sb(db, method, path, body) {
  const r = await request(method, db.url + path, { headers: { apikey: db.service, authorization: `Bearer ${db.service}`, prefer: 'return=representation' }, body });
  return { status: r.status, data: json(r) };
}
async function pool(items, size, fn) {
  let i = 0; const out = [];
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function setup() {
  const db = localDb();
  const file = arg.fixtures; if (!file) throw new Error('--fixtures <path> required');
  const fx = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { run: Date.now().toString(36), customers: [], riders: [], partners: [] };
  const nC = num('customers', 180), nR = num('riders', 16), nP = num('partners', 4);
  const mkUser = async (kind, i) => {
    const email = `zz-load-${kind}-${fx.run}-${i}@example.test`, password = rand();
    const r = await sb(db, 'POST', '/auth/v1/admin/users', { email, password, email_confirm: true });
    if (r.status >= 300) throw new Error(`createUser ${kind} ${i}: ${r.status}`);
    return { id: r.data.id, email, password };
  };
  console.log(`creating ${nC} customers, ${nR} riders, ${nP} partners (local database only)`);
  const from = fx.customers.length;
  fx.customers.push(...await pool(Array.from({ length: Math.max(0, nC - from) }, (_, i) => i + from), 8, i => mkUser('cust', i)));
  const org = (await sb(db, 'GET', '/rest/v1/organizations?name=eq.Demo%20Spice&select=id')).data?.[0]?.id; if (!org) throw new Error('organization Demo Spice not found');
  const role = (await sb(db, 'GET', '/rest/v1/roles?slug=eq.manager&select=id')).data?.[0]?.id;
  fx.org = org;
  for (let i = fx.partners.length; i < nP; i++) {
    const u = await mkUser('partner', i);
    const r = await sb(db, 'POST', '/rest/v1/org_users', { organization_id: org, user_id: u.id, role_id: role, email: u.email, full_name: 'ZZ Load Partner', status: 'active' });
    if (r.status >= 300) throw new Error(`org_users insert: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    fx.partners.push(u);
  }
  for (let i = fx.riders.length; i < nR; i++) {
    const u = await mkUser('rider', i);
    const r = await sb(db, 'POST', '/rest/v1/riders', { user_id: u.id, full_name: `ZZ Load Rider ${i}`, phone: `+9190000${String(10000 + i)}`, type: 'store', status: 'approved', organization_id: org });
    if (r.status >= 300) throw new Error(`riders insert: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    const rider = r.data[0];
    const a = await sb(db, 'POST', '/rest/v1/rider_availability', { rider_id: rider.id, online: true, lat: 18.4088 + i * 0.001, lng: 76.5604, last_seen_at: new Date().toISOString() });
    if (a.status >= 300) throw new Error(`rider_availability insert: ${a.status} ${JSON.stringify(a.data).slice(0, 200)}`);
    fx.riders.push({ ...u, rider_id: rider.id });
  }
  writeFileSync(file, JSON.stringify(fx));
  console.log(`fixtures written to ${file} (${fx.customers.length} customers, ${fx.riders.length} riders, ${fx.partners.length} partners)`);
}

// Removes every zz-load user, the orders / checkouts / delivery rows made for them, and the shared rate-limit counters.
// Append-only guard triggers are lifted only inside this one transaction, on the tables that are deleted from.
async function cleanup() {
  localDb(); // refuse unless the env file points at the local stack
  const sql = readFileSync(new URL('./cleanup.sql', import.meta.url), 'utf8');
  const out = execFileSync('docker', ['exec', '-i', 'supabase_db_onelocal-dev', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: sql, encoding: 'utf8' });
  console.log(out.trim());
}

// ---------------------------------------------------------------- scenarios
async function signIn(db, u) {
  const r = await request('POST', `${db.url}/auth/v1/token?grant_type=password`, { headers: { apikey: db.anon }, body: { email: u.email, password: u.password } });
  const token = json(r)?.access_token;
  if (!token) throw new Error(`sign-in failed for ${u.email}: ${r.status}`);
  return token;
}

const TERMS = ['milk', 'bread', 'rice', 'soap', 'chips', 'butter', 'tea', 'oil', 'paneer', 'naan', 'dettol', 'cheese', 'xyzzy-no-match'];

async function loadCatalogShape(base) {
  const cat = json(await request('GET', `${base}/api/catalog`, { headers: { 'x-forwarded-for': '10.1.1.1' } }));
  // Only a store that belongs to a live organization can take an order ("merchant_unavailable" otherwise): Demo Spice on the local database.
  const orderStore = arg['order-store'] || 'demo-spice';
  const stores = [{ id: orderStore, items: cat.products.filter(p => p.store_id === orderStore) }].filter(s => s.items.length);
  if (!stores.length) throw new Error(`no products for order store ${orderStore}`);
  return { stores, productIds: cat.products.map(p => p.id), storeIds: [...new Set(cat.products.map(p => p.store_id))] };
}

function hdr(vu, token, ctx) {
  const h = { 'x-customer-key': `zzload${vu.id}`.padEnd(32, 'k') };
  // 'spread' = every virtual user has its own network address (phones on mobile data); 'single' = all behind one address (an office or one carrier gateway).
  h['x-forwarded-for'] = ctx.ipMode === 'spread' ? `10.${ctx.stageNo % 250}.${Math.floor(vu.id / 250) % 250}.${(vu.id % 250) + 1}` : '10.99.99.99';
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function hit(ctx, name, method, path, h, body) {
  const r = await request(method, ctx.base + path, { headers: h, body });
  record(name, r);
  return r;
}

async function customerVU(vu, ctx, end) {
  const h = hdr(vu, vu.token, ctx);
  await sleep(rnd(0, 1500)); // spread the start
  while (performance.now() < end) {
    const roll = Math.random();
    if (roll < 0.25) { // app launch: the home screen asks for four things at once
      await Promise.all([hit(ctx, 'GET /api/catalog', 'GET', '/api/catalog', h), hit(ctx, 'GET /api/categories', 'GET', '/api/categories', h), hit(ctx, 'GET /api/banners', 'GET', '/api/banners', h), hit(ctx, 'GET /api/stores', 'GET', '/api/stores', h)]);
    } else if (roll < 0.50) {
      await hit(ctx, 'GET /api/products?q= (search)', 'GET', `/api/products?q=${encodeURIComponent(pick(TERMS))}`, h);
    } else if (roll < 0.66) {
      const lat = 18.4088 + rnd(-0.05, 0.05), lng = 76.5604 + rnd(-0.05, 0.05);
      await hit(ctx, 'GET /api/serviceability', 'GET', `/api/serviceability?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`, h);
    } else if (roll < 0.76) {
      await hit(ctx, 'GET /api/stores/:id/products', 'GET', `/api/stores/${pick(ctx.shape.storeIds)}/products`, h);
    } else if (roll < 0.86) {
      await hit(ctx, 'GET /api/products/:id', 'GET', `/api/products/${pick(ctx.shape.productIds)}`, h);
    } else if (roll < 0.94) {
      await hit(ctx, 'GET /api/orders (my orders)', 'GET', '/api/orders', h);
    } else if (ctx.orders) { // place a cash-on-delivery order
      const store = pick(ctx.shape.stores);
      const items = store.items.slice(0, 1 + Math.floor(Math.random() * 2)).map(p => ({ id: p.id, qty: 1 + Math.floor(Math.random() * 2) }));
      const body = { items, address: { label: 'Home', text: 'Load test address, Latur', lat: 18.4088, lng: 76.5604, notes: 'ZZ-TEST load-test' } };
      await hit(ctx, 'POST /api/orders (COD)', 'POST', '/api/orders', { ...h, 'idempotency-key': `zz${randomBytes(12).toString('hex')}` }, body);
    }
    await sleep(rnd(500, 2500));
  }
}

async function partnerVU(vu, ctx, end) {
  const h = hdr(vu, vu.token, ctx);
  await sleep(rnd(0, 3000));
  while (performance.now() < end) {
    const tab = pick(['new', 'new', 'new', 'preparing', 'ready', 'past']);
    const list = await hit(ctx, 'GET /api/partner/orders (partner)', 'GET', `/api/partner/orders?tab=${tab}`, h);
    // The kitchen answers new orders. If nobody does, the restaurant auto-pauses after 3 missed orders (ol_merchant_channels.auto_pause_after).
    if (tab === 'new' && list.status === 200) {
      for (const o of (json(list) ?? []).filter(o => o.status === 'placed').slice(0, 3)) await hit(ctx, 'POST /api/partner/orders/:id/accept', 'POST', `/api/partner/orders/${o.id}/accept`, h, { version: o.version, prep_minutes: 15 });
    }
    await sleep(rnd(2500, 3500));
  }
}

async function riderVU(vu, ctx, end) {
  const h = hdr(vu, vu.token, ctx);
  await sleep(rnd(0, 5000));
  while (performance.now() < end) {
    await hit(ctx, 'POST /api/rider/heartbeat', 'POST', '/api/rider/heartbeat', h, { lat: 18.4088 + rnd(-0.01, 0.01), lng: 76.5604 + rnd(-0.01, 0.01), accuracy_m: 12, battery: 80 });
    await hit(ctx, 'GET /api/rider/offers/current', 'GET', '/api/rider/offers/current', h);
    await sleep(5500); // the app polls every ~5 s (the server's limit is 12 heartbeats a minute)
  }
}

async function run() {
  const db = localDb();
  const fx = JSON.parse(readFileSync(arg.fixtures, 'utf8'));
  const base = arg.base || 'http://127.0.0.1:8201';
  if (!LOOPBACK.test(new URL(base).hostname)) throw new Error('run is for a local server only; use `hosted` for the hosted one');
  const stages = String(arg.stages || '10,50,200').split(',').map(Number);
  const duration = num('duration', 45);
  const shape = await loadCatalogShape(base);
  const result = { base, started: new Date().toISOString(), duration_s: duration, ip_mode: arg.ip || 'spread', orders_enabled: arg.orders !== 'off', stages: [] };
  const maxN = Math.max(...stages);
  const need = { r: Math.max(1, Math.round(maxN * 0.07)), p: Math.max(1, Math.round(maxN * 0.05)) };
  if (fx.customers.length < maxN - need.r - need.p || fx.riders.length < need.r) throw new Error(`fixtures too small for ${maxN} VUs (customers ${fx.customers.length}, riders ${fx.riders.length}); run setup with more`);
  console.log('signing in test users…');
  const tok = async arr => pool(arr, 16, async u => ({ ...u, token: await signIn(db, u) }));
  const customers = await tok(fx.customers.slice(0, maxN - need.r - need.p)), riders = await tok(fx.riders.slice(0, need.r)), partners = await tok(fx.partners);

  let stageNo = 0;
  for (const n of stages) {
    stageNo++;
    metrics = new Map();
    const nR = Math.max(1, Math.round(n * 0.07)), nP = Math.max(1, Math.round(n * 0.05)), nC = n - nR - nP;
    const ctx = { base, shape, ipMode: arg.ip || 'spread', stageNo: stageNo + num('stage-offset', 0), orders: arg.orders !== 'off' };
    console.log(`\n=== stage ${stageNo}: ${n} virtual users (${nC} customers, ${nR} riders, ${nP} partner screens), ${duration}s ===`);
    const pgBefore = pgConnections();
    const sampler = startSampler(num('pid', 0));
    const t0 = performance.now(), end = t0 + duration * 1000;
    await Promise.all([
      ...customers.slice(0, nC).map((u, i) => customerVU({ id: i, token: u.token }, ctx, end)),
      ...riders.slice(0, nR).map((u, i) => riderVU({ id: 1000 + i, token: u.token }, ctx, end)),
      ...Array.from({ length: nP }, (_, i) => partnerVU({ id: 2000 + i, token: partners[i % partners.length].token }, ctx, end)),
    ]);
    const secs = (performance.now() - t0) / 1000;
    const res = sampler.finish();
    const rows = summarise(metrics, secs);
    printTable(rows);
    const pgAfter = pgConnections();
    console.log('resources:', JSON.stringify(res), 'pg connections before/after:', pgBefore, pgAfter);
    result.stages.push({ virtual_users: n, mix: { customers: nC, riders: nR, partners: nP }, seconds: +secs.toFixed(1), endpoints: rows, resources: res, pg_connections: { before: pgBefore, after: pgAfter } });
    await sleep(num('pause', 8) * 1000);
  }
  if (arg.out) writeFileSync(arg.out, JSON.stringify(result, null, 1));
}

// ---------------------------------------------------------------- saturate: no think time, find the ceiling of one server process
async function saturate() {
  const base = arg.base || 'http://127.0.0.1:8201';
  if (!LOOPBACK.test(new URL(base).hostname)) throw new Error('saturate is for a local server only');
  const paths = String(arg.paths || '/api/catalog').split(',');
  const duration = num('duration', 15);
  const out = [];
  let authToken = null; // --auth partner|customer uses one test user's token (read-only requests)
  if (arg.auth) { const fx = JSON.parse(readFileSync(arg.fixtures, 'utf8')); authToken = await signIn(localDb(), arg.auth === 'partner' ? fx.partners[0] : fx.customers[0]); }
  for (const c of String(arg.connections || '50,200,500').split(',').map(Number)) {
    metrics = new Map();
    const sampler = startSampler(num('pid', 0));
    const t0 = performance.now(), end = t0 + duration * 1000;
    let k = 0;
    await Promise.all(Array.from({ length: c }, async (_, i) => {
      let h = { 'x-forwarded-for': `10.7.${Math.floor(i / 250)}.${(i % 250) + 1}`, 'x-customer-key': `zzsat${i}`.padEnd(32, 'k'), ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) };
      while (performance.now() < end) {
        // --rotate: every request comes from a new address and a new device, so no per-caller limit is reached and the cost of the limiter itself is measured.
        if (arg.rotate) h = { ...h, 'x-forwarded-for': `10.${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`, 'x-customer-key': randomBytes(16).toString('hex') };
        const p = paths[k++ % paths.length]; await hit({ base }, `GET ${p.split('?')[0]}`, 'GET', p, h);
      }
    }));
    const secs = (performance.now() - t0) / 1000, res = sampler.finish();
    console.log(`\n=== saturate: ${c} concurrent connections, ${duration}s, paths ${paths.join(' ')} ===`);
    const rows = summarise(metrics, secs); printTable(rows); console.log('resources:', JSON.stringify(res));
    out.push({ connections: c, paths, endpoints: rows, resources: res });
    await sleep(3000);
  }
  if (arg.out) writeFileSync(arg.out, JSON.stringify(out, null, 1));
}

// ---------------------------------------------------------------- probe: how the rate limiters and the cache behave
async function probe() {
  const db = localDb();
  const fx = JSON.parse(readFileSync(arg.fixtures, 'utf8'));
  const A = arg.base || 'http://127.0.0.1:8201', B = arg.base2;
  const shape = await loadCatalogShape(A);
  const out = {};
  const user = fx.customers[fx.customers.length - 1], rider = fx.riders[fx.riders.length - 1];
  const [tUser, tRider] = [await signIn(db, user), await signIn(db, rider)];
  const ip = () => `10.${200 + Math.floor(Math.random() * 50)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  const seq = r => r.map(x => x.status).join(' ');
  const orderBody = () => ({ items: [{ id: shape.stores[0].items[0].id, qty: 1 }], address: { label: 'Home', text: 'Load test address, Latur', lat: 18.4088, lng: 76.5604, notes: 'ZZ-TEST load-test probe' } });
  const orderReq = (base, h) => request('POST', `${base}/api/orders`, { headers: { ...h, 'idempotency-key': `zzprobe${randomBytes(10).toString('hex')}` }, body: orderBody() });

  // 1. Orders: one signed-in customer, limit 5 per minute per account (shared counter in the database).
  {
    const h = { authorization: `Bearer ${tUser}`, 'x-forwarded-for': ip() };
    const res = []; for (let i = 0; i < 8; i++) res.push(await orderReq(A, h));
    const last = res[res.length - 1];
    out.orders_per_account = { statuses: seq(res), retry_after_header: last.headers['retry-after'] ?? null, body: json(last) };
    if (B) out.orders_per_account_other_instance = { status: (await orderReq(B, h)).status };
  }
  // 2. Serviceability with a device key: 240 per minute per device (shared counter) - the limiter itself writes to the database.
  {
    const h = { 'x-customer-key': `zzprobe${randomBytes(10).toString('hex')}`.padEnd(32, 'k'), 'x-forwarded-for': ip() };
    const res = []; for (let i = 0; i < 250; i++) res.push(await request('GET', `${A}/api/serviceability?lat=18.40&lng=76.56`, { headers: h }));
    const s = res.map(r => r.ms).sort((a, b) => a - b);
    out.serviceability_per_device = { sent: 250, ok: res.filter(r => r.status === 200).length, limited_429: res.filter(r => r.status === 429).length, first_429_at_request: res.findIndex(r => r.status === 429) + 1, sequential_p50_ms: +pct(s, 50).toFixed(1), sequential_p95_ms: +pct(s, 95).toFixed(1) };
    if (B) out.serviceability_per_device_other_instance = { status: (await request('GET', `${B}/api/serviceability?lat=18.40&lng=76.56`, { headers: h })).status };
  }
  // 3. Rider heartbeat: limit 12 per minute, counted ONLY inside one server process (http.ts limit).
  {
    const h = { authorization: `Bearer ${tRider}`, 'x-forwarded-for': ip() }, body = { lat: 18.4088, lng: 76.5604 };
    const beat = base => request('POST', `${base}/api/rider/heartbeat`, { headers: h, body });
    const a = []; for (let i = 0; i < 15; i++) a.push(await beat(A));
    out.rider_heartbeat_instance_A = { statuses: seq(a), accepted: a.filter(r => r.status === 200).length };
    if (B) { const b = []; for (let i = 0; i < 15; i++) b.push(await beat(B)); out.rider_heartbeat_instance_B = { statuses: seq(b), accepted: b.filter(r => r.status === 200).length }; out.rider_heartbeat_total_accepted_within_one_minute = out.rider_heartbeat_instance_A.accepted + out.rider_heartbeat_instance_B.accepted; }
  }
  // 4. Catalogue cache: how many times the database is read while the catalogue is being served.
  {
    const reads = () => Number(psql("select coalesce(sum(coalesce(seq_scan,0)+coalesce(idx_scan,0)),0) from pg_stat_user_tables where relname='ol_products'"));
    const seconds = num('cache-seconds', 70);
    await sleep(2500); const before = reads(); let served = 0; const lat = [];
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      for (const base of [A, B].filter(Boolean)) { const r = await request('GET', `${base}/api/catalog`, { headers: { 'x-forwarded-for': ip() } }); served++; lat.push(r.ms); }
      await sleep(100);
    }
    await sleep(2500);
    const s = lat.sort((a, b) => a - b);
    out.catalogue_cache = { instances: B ? 2 : 1, seconds, catalogue_requests_served: served, database_reads_of_ol_products: reads() - before, p50_ms: +pct(s, 50).toFixed(1), p99_ms: +pct(s, 99).toFixed(1), slowest_ms: +s[s.length - 1].toFixed(1) };
  }
  console.log(JSON.stringify(out, null, 1));
  if (arg.out) writeFileSync(arg.out, JSON.stringify(out, null, 1));
}

// ---------------------------------------------------------------- hosted: read-only, gentle (GET only, never a rate-limited route: those write a counter row)
const HOSTED_OK = ['/api/catalog', '/api/categories', '/api/banners', '/api/stores', '/api/products?q=milk', '/api/health'];
async function hosted() {
  const base = (arg.base || 'https://one-local-server.vercel.app').replace(/\/$/, '');
  const rps = Math.min(5, num('rps', 5)), seconds = num('duration', 60);
  const n = Math.round(rps * seconds);
  metrics = new Map();
  const info = {};
  console.log(`hosted READ-ONLY: ${base}, ${rps} requests/second for ${seconds}s (GET only: ${HOSTED_OK.join(', ')})`);
  // The first request of a run is the best chance of a cold start; record it on its own.
  const first = await request('GET', `${base}/api/categories`);
  info.first_request = { status: first.status, ms: +first.ms.toFixed(0), vercel_cache: first.headers['x-vercel-cache'], vercel_id: first.headers['x-vercel-id'], cache_control: first.headers['cache-control'] ?? null, content_encoding: first.headers['content-encoding'] ?? null };
  console.log('first request:', JSON.stringify(info.first_request));
  if (seconds === 0) { // --duration 0: only the cold-start probe, run it after the server has been idle for a while
    const again = await request('GET', `${base}/api/categories`);
    info.second_request_ms = +again.ms.toFixed(0);
    console.log(JSON.stringify(info, null, 1));
    if (arg.out) writeFileSync(arg.out, JSON.stringify({ base, info }, null, 1));
    return;
  }
  const seen = {}, timeline = [];
  const t0 = performance.now(); let sent = 0; const pending = [];
  await new Promise(resolve => {
    const timer = setInterval(() => {
      if (sent >= n) { clearInterval(timer); Promise.all(pending).then(resolve); return; }
      const p = HOSTED_OK[sent % HOSTED_OK.length]; sent++;
      pending.push(request('GET', base + p, { headers: { 'accept-encoding': 'gzip, br' } }).then(r => {
        const k = p.split('?')[0];
        record(`GET ${k}${p.includes('?') ? '?q=' : ''}`, r);
        timeline.push({ at_s: +((performance.now() - t0 - r.ms) / 1000).toFixed(1), path: k, ms: +r.ms.toFixed(0), vercel_id: r.headers['x-vercel-id'] });
        (seen[k] ??= { cache_control: r.headers['cache-control'] ?? null, content_encoding: r.headers['content-encoding'] ?? null, bytes_on_wire: r.bytes, x_vercel_cache: new Set() }).x_vercel_cache.add(r.headers['x-vercel-cache'] ?? '-');
      }));
    }, 1000 / rps);
  });
  const secs = (performance.now() - t0) / 1000;
  const rows = summarise(metrics, secs); printTable(rows);
  info.headers = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, { ...v, x_vercel_cache: [...v.x_vercel_cache] }]));
  info.slow_requests = timeline.filter(t => t.ms > 600).sort((x, y) => x.at_s - y.at_s); // requests over 600 ms, in time order: a cache reload or a new instance shows as a burst
  console.log(JSON.stringify(info, null, 1));
  if (arg.out) writeFileSync(arg.out, JSON.stringify({ base, rps, seconds: +secs.toFixed(1), info, endpoints: rows, timeline }, null, 1));
}

// ---------------------------------------------------------------- main
const commands = { setup, run, saturate, probe, hosted, cleanup };
if (!commands[cmd]) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n')); process.exit(cmd === 'help' ? 0 : 1); }
commands[cmd]().then(() => process.exit(0), e => { console.error('FAILED:', e.message); process.exit(1); });
