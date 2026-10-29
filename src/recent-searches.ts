// The last few things this phone searched for, kept on the phone only (nothing is sent anywhere). Newest first, no repeats, at most 6.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'onecity.recent-searches.v1';
const MAX = 6;

export async function readRecent(): Promise<string[]> {
  try { const v = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : []; } catch { return []; }
}
/** Adds a search to the list; returns the new list. Very short or empty searches are not kept. */
export async function addRecent(query: string): Promise<string[]> {
  const text = query.trim().replace(/\s+/g, ' ');
  const list = await readRecent();
  if (text.length < 2) return list;
  const next = [text, ...list.filter(x => x.toLowerCase() !== text.toLowerCase())].slice(0, MAX);
  try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { /* a convenience, not a record */ }
  return next;
}
export async function clearRecent(): Promise<void> { try { await AsyncStorage.removeItem(KEY); } catch { /* nothing to do */ } }
