/**
 * Storage adapter for the Supabase session (access + refresh token): the OS keystore instead of plain AsyncStorage (X-254).
 *
 * - The keystore holds small values (iOS warns above ~2 KB) and a session is bigger, so the value is split into chunks.
 * - Sessions saved by older builds live in AsyncStorage. The first read moves them into the keystore and removes the old copy,
 *   so nobody is signed out by the update. If the keystore refuses the write, the old copy is returned and kept (still signed in).
 * - Pure logic with injected backends, so it is unit-tested without native modules. The app wires the real ones (nativeSessionStorage.ts in the Rider app, lib/supabase.ts here).
 */
export interface KeyValueBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}
export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const CHUNK = 1800;
const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

export const createSessionStorage = (secure: KeyValueBackend, legacy: KeyValueBackend): SessionStorage => {
  const readSecure = async (key: string): Promise<string | null> => {
    const n = Number(await secure.get(countKey(key)));
    if (!Number.isInteger(n) || n < 1) return null;
    let out = '';
    for (let i = 0; i < n; i++) {
      const part = await secure.get(chunkKey(key, i));
      if (part === null) return null; // torn write: treat as no session rather than hand back half a token
      out += part;
    }
    return out;
  };

  const writeSecure = async (key: string, value: string) => {
    const previous = Number(await secure.get(countKey(key))) || 0;
    const parts: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK) parts.push(value.slice(i, i + CHUNK));
    if (!parts.length) parts.push('');
    for (let i = 0; i < parts.length; i++) await secure.set(chunkKey(key, i), parts[i]);
    await secure.set(countKey(key), String(parts.length)); // the count last: a reader never sees a count without its chunks
    for (let i = parts.length; i < previous; i++) await secure.del(chunkKey(key, i));
  };

  const deleteSecure = async (key: string) => {
    const n = Number(await secure.get(countKey(key))) || 0;
    await secure.del(countKey(key));
    for (let i = 0; i < n; i++) await secure.del(chunkKey(key, i));
  };

  return {
    async getItem(key) {
      let value: string | null = null;
      try {
        value = await readSecure(key);
      } catch {
        value = null;
      }
      if (value !== null) return value;
      const old = await legacy.get(key);
      if (old === null) return null;
      try {
        await writeSecure(key, old);
        if ((await readSecure(key)) === old) await legacy.del(key);
      } catch {
        // keystore unavailable: keep the old copy so the rider stays signed in
      }
      return old;
    },
    async setItem(key, value) {
      await writeSecure(key, value);
      await legacy.del(key).catch(() => {});
    },
    async removeItem(key) {
      await legacy.del(key).catch(() => {});
      await deleteSecure(key); // a keystore failure surfaces: a token must not silently survive sign-out
    },
  };
};
