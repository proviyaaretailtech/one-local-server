// Customer notifications: this phone's push token goes to the server once the customer is signed in (PUT /api/customer/devices), and
// every notification that reaches the phone is kept in a small inbox on the phone (the Notifications screen), so one missed in the
// tray is still there. The inbox holds only what the notification said; nothing leaves the phone.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API, identity } from './api';

const TOKEN_KEY = 'onecity.push-token.v1';
const INBOX_KEY = 'onecity.inbox.v1';
const MAX_ITEMS = 50;

type Notifications = typeof import('expo-notifications');
const notifications = (): Notifications | null => {
  if (Platform.OS === 'web') return null;
  try { return require('expo-notifications') as Notifications; } catch { return null; }
};

// ---------- the inbox ----------
export type InboxItem = { id: string; title: string; body: string; at: number; url?: string; read: boolean };
let items: InboxItem[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => AsyncStorage.setItem(INBOX_KEY, JSON.stringify(items)).catch(() => {});

async function load() {
  if (loaded) return;
  loaded = true;
  try { const raw = await AsyncStorage.getItem(INBOX_KEY); if (raw) items = (JSON.parse(raw) as InboxItem[]).filter(i => i && typeof i.id === 'string'); } catch { items = []; }
  emit();
}

type Incoming = { request: { identifier: string; content: { title: string | null; body: string | null; data?: Record<string, unknown> } }; date: number };
function add(n: Incoming, read = false) {
  const id = n.request.identifier;
  const existing = items.find(i => i.id === id);
  if (existing) { if (read && !existing.read) { existing.read = true; items = [...items]; save(); emit(); } return; }
  const url = typeof n.request.content.data?.url === 'string' ? (n.request.content.data.url as string) : undefined;
  const at = n.date > 1e12 ? n.date : n.date * 1000; // expo reports seconds on some platforms
  items = [{ id, title: n.request.content.title ?? '', body: n.request.content.body ?? '', at: at || Date.now(), url, read }, ...items].slice(0, MAX_ITEMS);
  save(); emit();
}

let started = false;
// Call once at launch. Keeps the inbox up to date for the life of the app.
export async function startInbox(onOpen?: (url: string) => void) {
  const N = notifications();
  await load();
  if (!N || started) return;
  started = true;
  try {
    N.addNotificationReceivedListener(n => add(n as unknown as Incoming));
    N.addNotificationResponseReceivedListener(r => {
      add(r.notification as unknown as Incoming, true);
      const url = r.notification.request.content.data?.url;
      if (typeof url === 'string' && onOpen) onOpen(url);
    });
    // Notifications that arrived while the app was closed and are still in the tray.
    for (const n of await N.getPresentedNotificationsAsync()) add(n as unknown as Incoming);
  } catch { /* the inbox is a convenience: never break the app for it */ }
}

export const markAllRead = () => { if (items.some(i => !i.read)) { items = items.map(i => ({ ...i, read: true })); save(); emit(); } };
export const clearInbox = () => { items = []; save(); emit(); };

export function useInbox() {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick(n => n + 1); listeners.add(l); void load(); return () => { listeners.delete(l); }; }, []);
  return { items, unread: items.filter(i => !i.read).length };
}

// ---------- this phone's push token ----------
export type PushResult = 'ok' | 'denied' | 'unavailable' | 'error';

// Ask for permission (Android 13+ and iOS show a prompt), get this phone's Expo push token and give it to the server.
// Needs a signed-in customer: the server stores it against that account. Safe to call at every launch.
export async function registerPush(): Promise<PushResult> {
  const N = notifications();
  if (!N) return 'unavailable';
  try {
    const current = await N.getPermissionsAsync();
    const status = current.granted ? current : await N.requestPermissionsAsync();
    if (!status.granted) return 'denied';
    if (Platform.OS === 'android') await N.setNotificationChannelAsync('default', { name: 'Order updates', importance: N.AndroidImportance.HIGH });
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    // On Android this needs Firebase set up for the project: until then it throws and the customer simply gets no push.
    const { data: token } = await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const headers: Record<string, string> = { ...(await identity()), 'Content-Type': 'application/json' };
    if (!headers.Authorization) return 'unavailable';
    const r = await fetch(`${API}/customer/devices`, { method: 'PUT', headers, body: JSON.stringify({ expo_push_token: token, platform: Platform.OS === 'ios' ? 'ios' : 'android' }) });
    if (!r.ok) return 'error';
    await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
    return 'ok';
  } catch {
    return 'error';
  }
}

// On sign-out, while the session still exists: stop alerts to this phone.
export async function unregisterPush(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const headers: Record<string, string> = { ...(await identity()), 'Content-Type': 'application/json' };
    if (!headers.Authorization) return;
    await fetch(`${API}/customer/devices`, { method: 'DELETE', headers, body: JSON.stringify({ expo_push_token: token }) });
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch { /* offline: the server drops dead tokens by itself */ }
}
