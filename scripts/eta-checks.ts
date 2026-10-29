// Checks the delivery-time rule (server/eta.ts). No database, no network. Run from frontend/:  npx tsx scripts/eta-checks.ts
let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
};
async function main() {
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { etaMinutes, storeEtas, MIN_ETA, MAX_ETA } = await import('../server/eta');
  check('prep 20 at the store door is 23 minutes (prep + 3 handover)', etaMinutes(20, 0) === 23, etaMinutes(20, 0));
  check('2 km adds 6 minutes', etaMinutes(20, 2) === 29, etaMinutes(20, 2));
  check('a missing prep time uses the 15 minute default', etaMinutes(null, 0) === 18 && etaMinutes(0, 0) === 18);
  check('time is rounded up, not down', etaMinutes(10, 0.1) === 14, etaMinutes(10, 0.1));
  check('never promises less than the minimum', etaMinutes(1, 0) === MIN_ETA, etaMinutes(1, 0));
  check('never promises more than the maximum', etaMinutes(60, 50) === MAX_ETA, etaMinutes(60, 50));
  check('a negative distance cannot shorten the time', etaMinutes(20, -5) === 23);
  check('no database: no stores answer (the app keeps the listed time)', Object.keys(await storeEtas({ lat: 18.4, lng: 76.5 })).length === 0);
  console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
}
main().catch(e => { console.error(e); process.exit(1); });
