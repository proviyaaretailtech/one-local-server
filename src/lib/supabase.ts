// Supabase is used by the app ONLY to sign customers in. Data never goes from the app straight
// to the database: it goes through app/api, which checks who is asking (plan: one API).
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { createSessionStorage } from './secure-session-storage';

if (Platform.OS !== 'web') require('react-native-url-polyfill/auto');

export const SUPABASE_URL: string | undefined = Constants.expoConfig?.extra?.supabaseUrl;
export const SUPABASE_KEY: string | undefined = Constants.expoConfig?.extra?.supabaseAnonKey;
const inBrowser = typeof window !== 'undefined';
// Sign-in goes through our own server (/api/sb, server/supabase-relay.ts), never straight to *.supabase.co: Jio, Airtel
// and ACT have blocked that domain on and off since February 2026, and phones on those networks could not sign in
// ("Unable to resolve host"). Same backend address as src/api.ts, worked out here because api.ts imports this file.
const devServer = Constants.expoConfig?.hostUri ? `http://${Constants.expoConfig.hostUri}` : '';
const backend = Platform.OS === 'web' && inBrowser ? window.location.origin : (Constants.expoConfig?.extra?.backendUrl || devServer).replace(/\/$/, '');
export const AUTH_URL: string | undefined = backend ? `${backend}/api/sb` : SUPABASE_URL;
// The key the session was saved under before the relay, so nobody is signed out by the update.
const STORAGE_KEY = SUPABASE_URL ? `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token` : undefined;

// The session (access + refresh token) lives in the OS keystore on iOS/Android (X-254), not plain AsyncStorage.
// A session saved in AsyncStorage by an older build is moved over on first read, so nobody is signed out by the update.
// The web has no keystore and keeps the browser's own storage (storage: undefined below).
const nativeSessionStorage = Platform.OS === 'web' ? undefined : createSessionStorage(
  { get: k => SecureStore.getItemAsync(k), set: (k, v) => SecureStore.setItemAsync(k, v), del: k => SecureStore.deleteItemAsync(k) },
  { get: k => AsyncStorage.getItem(k), set: (k, v) => AsyncStorage.setItem(k, v), del: k => AsyncStorage.removeItem(k) },
);

export const supabase: SupabaseClient | null = AUTH_URL && SUPABASE_KEY
  ? createClient(AUTH_URL, SUPABASE_KEY, {
      auth: {
        flowType: 'pkce',
        storage: nativeSessionStorage,
        storageKey: STORAGE_KEY,
        // The web page is also rendered on the server, where there is no browser storage.
        persistSession: Platform.OS !== 'web' || inBrowser,
        autoRefreshToken: Platform.OS !== 'web' || inBrowser,
        detectSessionInUrl: Platform.OS === 'web' && inBrowser,
      },
    })
  : null;

// Live order updates are a WebSocket, which the relay cannot carry, so they still connect to Supabase itself; the
// session's token is handed over by src/use-order-realtime.ts. Where that is blocked, the order screen keeps polling.
export const realtime: SupabaseClient | null = SUPABASE_URL && SUPABASE_KEY && AUTH_URL !== SUPABASE_URL
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-realtime-only' } })
  : supabase;

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
