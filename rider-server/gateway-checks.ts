// Run: npx tsx rider-server/gateway-checks.ts   (no database needed)
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES } from './routes.generated';
import { handle, match } from './gateway';

let failed = 0;
const ok = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) failed++; };

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : n.endsWith('+api.ts') ? [f] : []; });
const files = ['rider', 'geo'].flatMap((s) => walk(join(__dirname, '../app/api', s)));
ok(`1 route table covers all ${files.length} +api.ts files`, files.length === ROUTES.length);

ok('static beats param (jobs/current)', match('/api/rider/jobs/current')?.pattern === '/api/rider/jobs/current');
ok('param captured', match('/api/rider/jobs/abc-1')?.params.id === 'abc-1');

async function main() {
const logs: string[] = [];
const orig = console.log; console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
const get = (path: string, init?: RequestInit) => handle(new Request('http://x' + path, init), path.split('?')[0], async () => false);

const r404 = await get('/api/rider/nope/nope');
const r401 = await get('/api/rider/me?secret=1');
const r405 = await get('/api/rider/me', { method: 'DELETE' });
const health = await get('/api/rider/_health');
const ready = await get('/api/rider/_ready');
console.log = orig;

ok('unknown path 404', r404.status === 404);
ok('me without auth is 401/503 (never 200)', r401.status === 401 || r401.status === 503);
ok('unsupported method 405 with Allow', r405.status === 405 && !!r405.headers.get('allow'));
ok('health 200', health.status === 200);
ok('ready 503 when db down', ready.status === 503);
ok('request id returned', !!r404.headers.get('x-request-id'));
ok('one log line per request', logs.length === 5);
ok('log has no query string', !logs.some((l) => l.includes('secret')));
ok('log levels', logs.some((l) => l.includes('"level":"warn"')) );
}
main().then(() => process.exit(failed ? 1 : 0));
