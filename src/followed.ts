import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "onelatur.followed.v1";

let cache: string[] | null = null;
const listeners = new Set<(ids: string[]) => void>();

async function load(): Promise<string[]> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(KEY);
  cache = raw ? (() => { try { return JSON.parse(raw) as string[]; } catch { return []; } })() : [];
  return cache;
}

async function save(ids: string[]) {
  cache = ids;
  await AsyncStorage.setItem(KEY, JSON.stringify(ids));
  listeners.forEach((fn) => fn(ids));
}

export function useFollowedStores() {
  const [ids, setIds] = useState<string[]>(cache ?? []);
  const [ready, setReady] = useState<boolean>(cache !== null);

  useEffect(() => {
    load().then((v) => { setIds(v); setReady(true); });
    const listener = (v: string[]) => setIds([...v]);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const isFollowing = useCallback((id: string) => ids.includes(id), [ids]);
  const toggle = useCallback(async (id: string) => {
    const current = await load();
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    await save(next);
  }, []);

  return { ids, ready, isFollowing, toggle };
}
