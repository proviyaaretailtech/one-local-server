// Checks the customer app's Supabase session storage adapter (X-254): keystore in chunks, migration of a session saved in
// AsyncStorage by an older build (nobody is signed out), keystore failure keeps the old copy, sign-out removes everything.
// Pure logic with fake backends, no device needed. Run from frontend/:  npx tsx scripts/session-storage-checks.ts
import { createSessionStorage, type KeyValueBackend } from '../src/lib/secure-session-storage';

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => {
  if (!ok) { console.error(`FAIL  ${what}`, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; return; }
  passed++; console.log(`ok    ${what}`);
};
const memory = (failWrites = false): KeyValueBackend & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    get: async k => map.get(k) ?? null,
    set: async (k, v) => { if (failWrites) throw new Error('keystore unavailable'); map.set(k, v); },
    del: async k => { map.delete(k); },
  };
};
const KEY = 'sb-test-auth-token';
const session = JSON.stringify({ access_token: 'a'.repeat(1200), refresh_token: 'r'.repeat(40), user: { id: 'u1', email: 'c@example.test', meta: 'x'.repeat(2500) } });

async function main() {
  { // round trip, chunked
    const secure = memory(); const s = createSessionStorage(secure, memory());
    await s.setItem(KEY, session);
    check('a session larger than one keystore value round-trips', (await s.getItem(KEY)) === session);
    check('stored in several chunks of at most 1800 chars', Number(secure.map.get(`${KEY}.n`)) > 1 && [...secure.map].every(([k, v]) => k === `${KEY}.n` || v.length <= 1800));
    await s.setItem(KEY, 'short');
    check('shrinking leaves no stale chunks', [...secure.map.keys()].sort().join() === `${KEY}.0,${KEY}.n`, [...secure.map.keys()]);
  }
  { // migration
    const secure = memory(); const legacy = memory(); legacy.map.set(KEY, session);
    const s = createSessionStorage(secure, legacy);
    check('a session saved in AsyncStorage by an older build is still found (user stays signed in)', (await s.getItem(KEY)) === session);
    check('...and the plaintext copy is removed after the move', !legacy.map.has(KEY));
    check('...and the keystore now serves it', (await s.getItem(KEY)) === session && secure.map.has(`${KEY}.n`));
  }
  { // keystore failure
    const legacy = memory(); legacy.map.set(KEY, session);
    const s = createSessionStorage(memory(true), legacy);
    check('keystore refuses the write: old session still returned', (await s.getItem(KEY)) === session);
    check('...and kept, so the next launch can try again', legacy.map.get(KEY) === session);
  }
  { // empty, torn
    const secure = memory(); const s = createSessionStorage(secure, memory());
    check('nothing stored is null', (await s.getItem(KEY)) === null);
    secure.map.set(`${KEY}.n`, '3'); secure.map.set(`${KEY}.0`, 'abc');
    check('a torn write is treated as no session, not half a token', (await s.getItem(KEY)) === null);
  }
  { // sign-out
    const secure = memory(); const legacy = memory(); const s = createSessionStorage(secure, legacy);
    await s.setItem(KEY, session); legacy.map.set(KEY, session);
    await s.removeItem(KEY);
    check('sign-out removes the keystore entry and any leftover plaintext copy', secure.map.size === 0 && legacy.map.size === 0 && (await s.getItem(KEY)) === null);
  }
  console.log(`${passed} checks passed`);
}
main().catch(e => { console.error(e); process.exit(1); });
