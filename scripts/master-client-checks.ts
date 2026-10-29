// Checks the Master client (server/master-client.ts) with a fake fetch: no network, no Master, no database.
// Run from frontend/:  npx tsx scripts/master-client-checks.ts
let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
};

async function main() {
  const { masterFetch, checkMaster, masterStatus, masterCallerFor, resetMasterStatusCache } = await import('../server/master-client');
  // Test values only, made here; not the real keys.
  const CUSTOMER_KEY = 'test-customer-key-0123456789abcdef';
  const PARTNER_KEY = 'test-partner-key-fedcba9876543210';
  const env = { MASTER_SERVER_URL: 'http://localhost:8000/', INTERNAL_KEY_CUSTOMER: CUSTOMER_KEY, INTERNAL_KEY_PARTNER: PARTNER_KEY, NODE_ENV: 'development' };
  type Seen = { url: string; method: string; headers: Record<string, string>; body?: string; redirect?: string };
  const fake = (answers: (() => Response | Promise<Response>)[]) => {
    const seen: Seen[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body as string | undefined, redirect: init.redirect });
      const next = answers[Math.min(seen.length - 1, answers.length - 1)];
      return next();
    };
    return { seen, fetchImpl };
  };
  const reply = (status: number, body: unknown = {}) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const down = () => { throw new TypeError(`fetch failed: connect ECONNREFUSED (x-internal-key: ${CUSTOMER_KEY})`); };
  const noSleep = async () => {};
  const leaks = (e: unknown) => { const t = `${(e as Error)?.message} ${(e as Error)?.stack} ${JSON.stringify(e)}`; return t.includes(CUSTOMER_KEY) || t.includes(PARTNER_KEY); };
  const caught = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as import('../server/master-client').MasterError; } };

  // Caller per route.
  check('/api/partner/* calls as partner', masterCallerFor('/api/partner/orders') === 'partner' && masterCallerFor('/api/partner') === 'partner');
  check('customer and rider routes call as customer', ['/api/orders', '/api/rider/me', '/api/partnership', '/api/health'].every(p => masterCallerFor(p) === 'customer'));

  // Headers.
  let f = fake([reply(200, { ok: true })]);
  let out = await masterFetch('/api/internal/x', { as: 'customer', method: 'POST', body: { a: 1 }, idempotencyKey: 'idem-1', env, fetchImpl: f.fetchImpl });
  const h = f.seen[0]?.headers ?? {};
  check('URL is base (trailing slash dropped) + path', f.seen[0]?.url === 'http://localhost:8000/api/internal/x', f.seen[0]?.url);
  check('customer call sends the customer key in x-internal-key', h['x-internal-key'] === CUSTOMER_KEY);
  check('x-ol-source defaults to one-local-<caller>', h['x-ol-source'] === 'one-local-customer');
  check('Idempotency-Key is sent when given', h['Idempotency-Key'] === 'idem-1');
  check('body is JSON with content-type', f.seen[0]?.body === '{"a":1}' && h['content-type'] === 'application/json' && f.seen[0]?.method === 'POST');
  check('2xx resolves with Master\'s JSON', JSON.stringify(out) === '{"ok":true}');
  f = fake([reply(200, {})]);
  await masterFetch('/api/internal/x', { as: 'partner', source: 'vinii-partner', env, fetchImpl: f.fetchImpl });
  check('partner call sends the partner key, custom source, no Idempotency-Key', f.seen[0]?.headers['x-internal-key'] === PARTNER_KEY && f.seen[0]?.headers['x-ol-source'] === 'vinii-partner' && !('Idempotency-Key' in f.seen[0]!.headers));

  // Retry rules.
  f = fake([down]);
  let e = await caught(masterFetch('/p', { as: 'customer', method: 'POST', env, fetchImpl: f.fetchImpl, sleep: noSleep }));
  check('no Idempotency-Key: a network error is not retried', f.seen.length === 1 && e?.code === 'unreachable', f.seen.length);
  f = fake([reply(503)]);
  e = await caught(masterFetch('/p', { as: 'customer', method: 'POST', env, fetchImpl: f.fetchImpl, sleep: noSleep }));
  check('no Idempotency-Key: a 5xx is not retried', f.seen.length === 1 && e?.code === 'http' && e.status === 503);
  f = fake([down, reply(502), reply(201, { id: 7 })]);
  out = await masterFetch('/p', { as: 'customer', method: 'POST', idempotencyKey: 'k', env, fetchImpl: f.fetchImpl, sleep: noSleep });
  check('with Idempotency-Key: network error and 5xx are retried, same key each time', f.seen.length === 3 && (out as { id: number }).id === 7 && f.seen.every(s => s.headers['Idempotency-Key'] === 'k'));
  f = fake([reply(409), reply(200)]);
  e = await caught(masterFetch('/p', { as: 'customer', method: 'POST', idempotencyKey: 'k', env, fetchImpl: f.fetchImpl, sleep: noSleep }));
  check('with Idempotency-Key: a 4xx is not retried', f.seen.length === 1 && e?.status === 409);
  f = fake([reply(500)]);
  e = await caught(masterFetch('/p', { as: 'customer', method: 'POST', idempotencyKey: 'k', retries: 2, env, fetchImpl: f.fetchImpl, sleep: noSleep }));
  check('retries stop after the limit (1 + 2 tries) and the last answer is reported', f.seen.length === 3 && e?.status === 500);
  const slow = async (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
  const hold = setTimeout(() => {}, 1000); // AbortSignal.timeout does not keep Node alive on its own
  e = await caught(masterFetch('/p', { as: 'customer', timeoutMs: 30, env, fetchImpl: slow }));
  clearTimeout(hold);
  check('a call that hangs times out', e?.code === 'timeout', e?.message);

  // No key leaks.
  f = fake([down]);
  e = await caught(masterFetch('/p', { as: 'customer', idempotencyKey: 'k', env, fetchImpl: f.fetchImpl, sleep: noSleep }));
  check('a network error that mentions the key is not passed on', !!e && !leaks(e), e?.message);
  e = await caught(masterFetch('/p', { as: 'customer', env, fetchImpl: fake([reply(401, { message: 'Unauthorized' })]).fetchImpl }));
  check('a 401 error does not carry the key', !!e && !leaks(e) && e.status === 401);
  e = await caught(masterFetch('/p', { as: 'partner', env: { MASTER_SERVER_URL: 'http://localhost:8000' }, fetchImpl: fake([reply(200)]).fetchImpl }));
  check('a missing key is not_configured and names only the variable', e?.code === 'not_configured' && /INTERNAL_KEY_PARTNER/.test(e.message));

  // Plain http in production.
  const prod = { ...env, NODE_ENV: 'production' };
  f = fake([reply(200, { caller: 'customer' })]);
  e = await caught(masterFetch('/p', { as: 'customer', env: { ...prod, MASTER_SERVER_URL: 'http://master.example.com' }, fetchImpl: f.fetchImpl }));
  check('production refuses http to a remote host and sends nothing', e?.code === 'insecure_url' && f.seen.length === 0 && !leaks(e));
  f = fake([reply(200, {})]);
  await masterFetch('/p', { as: 'customer', env: { ...prod, MASTER_SERVER_URL: 'http://127.0.0.1:8000' }, fetchImpl: f.fetchImpl });
  await masterFetch('/p', { as: 'customer', env: { ...prod, MASTER_SERVER_URL: 'https://api.master-admin.example.com' }, fetchImpl: f.fetchImpl });
  check('production allows http to localhost and https anywhere', f.seen.length === 2);
  f = fake([reply(200, {})]);
  await masterFetch('/p', { as: 'customer', env: { ...env, MASTER_SERVER_URL: 'http://192.168.1.5:8000' }, fetchImpl: f.fetchImpl });
  check('development allows http to a LAN host', f.seen.length === 1);

  // Status mapping.
  const status = (answers: (() => Response)[], e2: Record<string, string | undefined> = env, as: 'customer' | 'partner' = 'customer') => checkMaster(as, { env: e2, fetchImpl: fake(answers).fetchImpl });
  check('whoami says our caller -> ok', await status([reply(200, { caller: 'customer' })]) === 'ok');
  check('partner whoami says partner -> ok', await status([reply(200, { caller: 'partner' })], env, 'partner') === 'ok');
  check('whoami says another caller (wrong key in our variable) -> wrong_key', await status([reply(200, { caller: 'pos' })]) === 'wrong_key');
  check('401 -> wrong_key', await status([reply(401)]) === 'wrong_key');
  check('403 -> wrong_key', await status([reply(403)]) === 'wrong_key');
  check('500 -> unreachable', await status([reply(500)]) === 'unreachable');
  check('network error -> unreachable', await checkMaster('customer', { env, fetchImpl: async () => { throw new TypeError('fetch failed'); } }) === 'unreachable');
  check('no MASTER_SERVER_URL -> not_configured', await status([reply(200, { caller: 'customer' })], { INTERNAL_KEY_CUSTOMER: CUSTOMER_KEY }) === 'not_configured');
  check('no key -> not_configured', await status([reply(200, { caller: 'customer' })], { MASTER_SERVER_URL: 'http://localhost:8000' }) === 'not_configured');
  check('whoami is never retried (no Idempotency-Key)', await (async () => { const g = fake([reply(503)]); await checkMaster('customer', { env, fetchImpl: g.fetchImpl }); return g.seen.length === 1 && g.seen[0].url.endsWith('/api/internal/whoami') && g.seen[0].method === 'GET'; })());

  // Redirects: never followed, so the key cannot travel to wherever a 3xx points.
  f = fake([() => new Response(null, { status: 302, headers: { location: 'http://elsewhere.example/steal' } }), reply(200, { ok: true })]);
  e = await caught(masterFetch('/api/internal/x', { as: 'customer', method: 'POST', body: {}, idempotencyKey: 'idem-r', env, fetchImpl: f.fetchImpl, sleep: noSleep }));
  check('fetch is told not to follow redirects', f.seen[0]?.redirect === 'manual', f.seen[0]?.redirect);
  check('a 3xx is an http error, sent once, not retried even with an Idempotency-Key', e?.code === 'http' && e?.status === 302 && f.seen.length === 1 && !leaks(e), { code: e?.code, n: f.seen.length });
  check('a 3xx on whoami -> unreachable', await status([() => new Response(null, { status: 307, headers: { location: 'http://elsewhere.example/' } })]) === 'unreachable');
  // The same over real sockets with Node's own fetch: Master's address answers 302 to a second local server.
  {
    const http = await import('node:http');
    let keySeenElsewhere = false; let elsewhereHits = 0;
    const elsewhere = http.createServer((req, res) => { elsewhereHits++; if (req.headers['x-internal-key']) keySeenElsewhere = true; res.end('{}'); });
    await new Promise<void>(r => elsewhere.listen(0, '127.0.0.1', r));
    const elsewherePort = (elsewhere.address() as import('node:net').AddressInfo).port;
    const redirector = http.createServer((_req, res) => { res.writeHead(302, { location: `http://localhost:${elsewherePort}/api/internal/whoami` }); res.end(); });
    await new Promise<void>(r => redirector.listen(0, '127.0.0.1', r));
    const redirectorPort = (redirector.address() as import('node:net').AddressInfo).port;
    try {
      const real = await caught(masterFetch('/api/internal/whoami', { as: 'customer', env: { ...env, MASTER_SERVER_URL: `http://127.0.0.1:${redirectorPort}` }, timeoutMs: 2000 }));
      check('real fetch: a 302 from Master is not followed and the key never reaches the other host', real?.code === 'http' && real?.status === 302 && elsewhereHits === 0 && !keySeenElsewhere && !leaks(real), { code: real?.code, status: real?.status, elsewhereHits });
    } finally {
      redirector.close(); elsewhere.close();
    }
  }

  // Cache.
  resetMasterStatusCache();
  let t = 1_000_000;
  const g = fake([reply(200, { caller: 'customer' })]);
  const opts = { env, fetchImpl: g.fetchImpl, now: () => t };
  await masterStatus('customer', opts); await masterStatus('customer', opts);
  check('masterStatus is cached (one call for two probes)', g.seen.length === 1);
  t += 31_000; await masterStatus('customer', opts);
  check('masterStatus asks again after 30 s', g.seen.length === 2);
  resetMasterStatusCache();

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
