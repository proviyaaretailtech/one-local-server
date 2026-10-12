// Privacy on the phone (DPDP Act; docs/DPDP.md): consent choices, what the app keeps on this phone,
// and the "Download my data" file.
//
// Consent choices are recorded here first, each with the time and the notice version shown, so a
// guest's choices count too. Once signed in they are sent to the server (POST /api/privacy/consents),
// which keeps them append-only; until the server confirms, they stay marked unsent and are sent
// again. Optional purposes are OFF until the person switches them on.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Platform, Share } from 'react-native';
import { apiGet, apiPost, forgetCustomerKey } from './api';
import { accessToken } from './lib/supabase';
import { errorMessage, i18n, t } from './i18n';
import type { Formatter } from './i18n';
import {
  ConsentPurpose, ConsentSource, KeptByLawId, NoticeItemId, NOTICE_ITEMS, NOTICE_ITEM_IDS, OPTIONAL_PURPOSES, OptionalPurpose, PRIVACY,
  SHARED_WITH, SHARED_WITH_IDS, SharedWithId, KEPT_BY_LAW_IDS,
} from '../constants/privacy';

const KEY = 'onecity.privacy.v1';
export type Choice = { purpose: ConsentPurpose; granted: boolean; notice_version: string; source: ConsentSource; at: string; synced: boolean };
type State = { choices: Choice[] };
const EMPTY: State = { choices: [] };
const KEEP = 200; // newest choices kept on the phone; the server keeps the full history

let state: State | null = null;
let loading: Promise<State> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

async function load(): Promise<State> {
  if (state) return state;
  return (loading ??= AsyncStorage.getItem(KEY).then(raw => {
    const parsed = raw ? JSON.parse(raw) : null;
    state = parsed && Array.isArray(parsed.choices) ? { choices: parsed.choices } : EMPTY;
    return state!;
  }).catch(() => (state = EMPTY)));
}

// Writes go one at a time, so two quick taps can never lose one of them.
function serial<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.catch(() => {}).then(action);
  queue = result.catch(() => {});
  return result;
}

async function save(next: State) {
  state = { choices: next.choices.slice(-KEEP) };
  notify();
  await AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}

const newest = (s: State, purpose: ConsentPurpose) => [...s.choices].reverse().find(c => c.purpose === purpose);
export const granted = (s: State, purpose: ConsentPurpose) => newest(s, purpose)?.granted ?? false;

// Whether an optional purpose is switched on (off until the person says yes).
export async function consentGranted(purpose: OptionalPurpose): Promise<boolean> {
  return granted(await load(), purpose);
}

// Records choices on the phone, then sends them if signed in. Never throws: a failed send is retried.
export function recordChoices(items: { purpose: ConsentPurpose; granted: boolean }[], source: ConsentSource) {
  return serial(async () => {
    const s = await load();
    const at = new Date().toISOString();
    await save({ choices: [...s.choices, ...items.map(i => ({ ...i, notice_version: PRIVACY.noticeVersion, source, at, synced: false }))] });
  }).then(() => syncConsents());
}

// Sends unsent choices to the server. Only when signed in; the server needs to know whose they are.
export function syncConsents() {
  return serial(async () => {
    if (!(await accessToken().catch(() => null))) return;
    const s = await load();
    const unsent = s.choices.filter(c => !c.synced).slice(0, 20);
    if (!unsent.length) return;
    try {
      const reply = await apiPost<{ recorded: number; stored: string }>('/privacy/consents', {
        consents: unsent.map(({ purpose, granted, notice_version, source, at }) => ({ purpose, granted, notice_version, source, at })),
      });
      // 'phone_only' = the server's consent table is not there yet: keep them unsent, try later.
      if (reply.stored === 'phone_only') return;
      const sent = new Set(unsent);
      await save({ choices: s.choices.map(c => (sent.has(c) ? { ...c, synced: true } : c)) });
    } catch {} // offline or signed out: they stay unsent and go next time
  });
}

// On a phone the person has just signed in on: adopt choices made on another phone when newer.
export function pullConsents() {
  return serial(async () => {
    if (!(await accessToken().catch(() => null))) return;
    try {
      const reply = await apiGet<{ consents: { purpose: ConsentPurpose; granted: boolean; notice_version: string; at: string }[] }>('/privacy/consents');
      const s = await load();
      const adopt = reply.consents.filter(r => {
        const local = newest(s, r.purpose);
        return !local || (local.synced && local.granted !== r.granted && r.at > local.at);
      });
      if (adopt.length) await save({ choices: [...s.choices, ...adopt.map(r => ({ ...r, source: 'privacy_screen' as const, synced: true }))] });
    } catch {}
  });
}

// After sign-in (auth.tsx): send what this phone recorded, then pick up choices from other phones.
export async function afterSignIn() {
  await syncConsents();
  await pullConsents();
  await syncConsents();
}

// For screens: the current optional choices, live.
export function usePrivacyChoices() {
  const [snapshot, setSnapshot] = useState<State | null>(state);
  useEffect(() => {
    const update = () => setSnapshot(state);
    listeners.add(update);
    void load().then(update);
    return () => { listeners.delete(update); };
  }, []);
  const current = Object.fromEntries(OPTIONAL_PURPOSES.map(p => [p, snapshot ? granted(snapshot, p) : false])) as Record<OptionalPurpose, boolean>;
  return {
    ready: !!snapshot, current,
    ageConfirmed: !!snapshot && granted(snapshot, 'age_18_plus'),
    unsent: snapshot?.choices.filter(c => !c.synced).length ?? 0,
    history: snapshot?.choices ?? [],
    set: (purpose: OptionalPurpose, value: boolean) => recordChoices([{ purpose, granted: value }], 'privacy_screen'),
  };
}

// ---------- What this app keeps on this phone ----------
// Every key the app writes (grep AsyncStorage in src/ and app/). `secret` values are never shown or
// put in the download: the device key would let someone see this phone's guest orders, and the
// sign-in session would let them act as you.
// `fileKey` is the English name: it is the KEY in the downloaded file (file keys stay English). What the screen
// shows is the catalogue text for `id` (privacy.phoneItem.<id>).
export type PhoneItemId = 'profile' | 'wishlist' | 'carts' | 'cartOld' | 'place' | 'placePoint' | 'recentPlaces' | 'followed' | 'bookings' | 'demoWallet'
  | 'aiSession' | 'locationAsked' | 'language' | 'privacyChoices' | 'reelLikes' | 'launchAsked' | 'deviceKey' | 'session';
type PhoneItem = { id: PhoneItemId; key: string; fileKey: string; secret?: boolean; prefix?: boolean };
export const PHONE_ITEMS: PhoneItem[] = [
  { id: 'profile', key: 'onecity.customer.v1', fileKey: 'Profile, saved addresses, payment preference and invite code' },
  { id: 'wishlist', key: 'onecity.saved-products.v1', fileKey: 'Wishlist' },
  { id: 'carts', key: 'onelatur.cart.v2', fileKey: 'Food and shopping carts' },
  { id: 'cartOld', key: 'onelatur.cart.v1', fileKey: 'Cart (older app version)' },
  { id: 'place', key: 'one-latur-location', fileKey: 'The place you shop for' },
  { id: 'placePoint', key: 'one-latur-location-point', fileKey: 'Map point of that place' },
  { id: 'recentPlaces', key: 'onecity.recent-places.v1', fileKey: 'Places you picked recently' },
  { id: 'followed', key: 'onelatur.followed.v1', fileKey: 'Stores you follow' },
  { id: 'bookings', key: 'onelatur.booking-enquiries', fileKey: 'Your booking requests' },
  { id: 'demoWallet', key: 'onecity-demo-wallet', fileKey: 'Demo wallet (no real money)' },
  { id: 'aiSession', key: 'onecity-ai-session', fileKey: 'AI assistant conversation id' },
  { id: 'locationAsked', key: 'onecity.location-asked.v1', fileKey: 'Whether we asked where you are' },
  { id: 'language', key: 'onecity.language.v1', fileKey: 'Your language choice' },
  { id: 'privacyChoices', key: KEY, fileKey: 'Your privacy choices' },
  { id: 'reelLikes', key: 'reel-like-', fileKey: 'Reels you liked', prefix: true },
  { id: 'launchAsked', key: 'onecity.launch-asked.', fileKey: 'Towns you asked us to launch in', prefix: true },
  { id: 'deviceKey', key: 'onecity.customer-key.v1', fileKey: 'Device key (keeps orders placed without an account private to this phone)', secret: true },
  { id: 'session', key: 'sb-', fileKey: 'Sign-in session', secret: true, prefix: true },
];
export type PhoneEntry = { id: PhoneItemId; fileKey: string; keys: string[]; bytes: number; secret: boolean };

async function phoneKeys(): Promise<{ item: PhoneItem; keys: string[] }[]> {
  const all = await AsyncStorage.getAllKeys().catch(() => [] as readonly string[]);
  return PHONE_ITEMS.map(item => ({ item, keys: all.filter(k => (item.prefix ? k.startsWith(item.key) : k === item.key)) }));
}

// What is stored here, by item and size (for the screen).
export async function phoneSummary(): Promise<PhoneEntry[]> {
  const found = (await phoneKeys()).filter(f => f.keys.length);
  const pairs = await AsyncStorage.multiGet(found.flatMap(f => f.keys)).catch(() => [] as readonly [string, string | null][]);
  const size = new Map(pairs.map(([k, v]) => [k, v?.length ?? 0]));
  return found.map(({ item, keys }) => ({ id: item.id, fileKey: item.fileKey, keys, bytes: keys.reduce((s, k) => s + (size.get(k) ?? 0), 0), secret: !!item.secret }));
}

// The same, with the values (secrets left out, a photo replaced by a note to keep the file small).
async function phoneValues(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const { item, keys } of await phoneKeys()) {
    if (!keys.length) continue;
    if (item.secret) { out[item.fileKey] = t('privacy.file.secret'); continue; }
    const pairs = await AsyncStorage.multiGet(keys).catch(() => [] as readonly [string, string | null][]);
    const values = pairs.map(([k, raw]) => {
      let value: unknown = raw;
      try { value = raw ? JSON.parse(raw) : raw; } catch {}
      const photo = (value as { profile?: { photo?: string } } | null)?.profile?.photo;
      if (photo && photo.length > 200) value = { ...(value as object), profile: { ...(value as { profile: object }).profile, photo: t('privacy.file.photo', { kb: Math.round(photo.length / 1024) }) } };
      return item.prefix ? { [k.slice(item.key.length)]: value } : value;
    });
    out[item.fileKey] = item.prefix ? Object.assign({}, ...values) : values[0];
  }
  return out;
}

// Removes everything the app keeps on this phone (for a guest, or after an account is deleted).
// The screens that hold some of it in memory are reset by the caller (customer profile, cart).
export async function clearPhone() {
  const keys = (await phoneKeys()).flatMap(f => f.keys);
  await AsyncStorage.multiRemove(keys);
  forgetCustomerKey();
  state = EMPTY; loading = null; notify();
}

// ---------- Download my data ----------
export type ServerExport = Record<string, unknown> & { about: { reference: string } };

// Signed in: everything the server holds plus what is on this phone. A guest: this phone only.
export async function buildDownload(signedIn: boolean) {
  const server = signedIn ? await apiGet<ServerExport>('/privacy/export') : null;
  const phone = await phoneValues();
  const file = server
    ? { ...server, on_this_phone: phone }
    : {
        about: { what: t('privacy.file.about', { brand: PRIVACY.brand }), generated_at: new Date().toISOString(), notice_version: PRIVACY.noticeVersion, data_fiduciary: PRIVACY.legalEntity },
        on_this_phone: phone,
      };
  return { file, reference: server?.about.reference ?? null };
}

// Web: a .json file download. Phones: the share sheet (save to Files, Drive, or send to yourself).
export async function deliverDownload(file: object) {
  const text = JSON.stringify(file, null, 2);
  const name = `onelocal-my-data-${new Date().toISOString().slice(0, 10)}.json`;
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return name;
  }
  await Share.share({ title: name, message: text });
  return name;
}

// ---------- The wording the screens show ----------
// constants/privacy.ts holds the facts in English (the server's data download reads them). What a person
// reads is in the catalogue, looked up by the same ids, at the moment it is shown (so it follows the language).
// Call these while rendering; never keep their result at module level.
const PURPOSE_KEYS = {
  marketing: ['privacy.purpose.marketingTitle', 'privacy.purpose.marketingBody'],
  personalisation: ['privacy.purpose.personalisationTitle', 'privacy.purpose.personalisationBody'],
  location_suggestions: ['privacy.purpose.locationSuggestionsTitle', 'privacy.purpose.locationSuggestionsBody'],
} as const;
export const purposeText = (purpose: OptionalPurpose) => ({ title: t(PURPOSE_KEYS[purpose][0]), body: t(PURPOSE_KEYS[purpose][1]) });

/** The itemised "what we collect" list: whether it is needed or optional comes from the constants, the words from the catalogue. */
export const noticeItemsText = () => NOTICE_ITEM_IDS.map((id: NoticeItemId, i) => ({
  id,
  basis: NOTICE_ITEMS[i]!.basis,
  data: t(`privacyNotice.s2.${id}Data`),
  why: t(`privacyNotice.s2.${id}Why`),
  kept: t(`privacyNotice.s2.${id}Kept`, { section: t('privacyNotice.s6.title') }),
}));

/** Who else gets the data. The SMS provider's `where` is a value still to be filled, so it is shown as written in the constants. */
export const sharedWithText = () => SHARED_WITH_IDS.map((id: SharedWithId, i) => ({
  id,
  who: t(`privacyNotice.s3.${id}Who`),
  what: t(`privacyNotice.s3.${id}What`),
  where: id === 'sms' ? SHARED_WITH[i]!.where : t(`privacyNotice.s3.${id}Where`),
}));

/** What we must keep after an account is deleted (shown in the notice and in the delete confirmation). */
export const keptByLawText = () => KEPT_BY_LAW_IDS.map((id: KeptByLawId) => ({ id, text: t(`privacyNotice.s6.${id}Line`) }));

/** "27 September 2026" / "27 सितंबर 2026": the notice date in the reader's language. */
export const noticeDateText = (fmt: Formatter) => fmt.date(`${PRIVACY.noticeDateIso}T12:00:00+05:30`, 'long');

// ---------- Something went wrong ----------
// A problem is kept as its CAUSE and written when it is shown, so it follows the language. `key` is the line for
// when the cause says nothing useful. The privacy routes answer with English sentences and no code yet, so the
// ones a person can actually reach are matched by their exact text (server/privacy.ts) and shown in their language.
// Everything else goes through the shared error mapping (status/code -> translated line). When the server sends
// a `code` for these, match on that instead and drop the table.
export type ProblemKey = 'privacy.err.prepare' | 'privacy.err.clear' | 'privacy.err.delete' | 'privacy.err.send' | 'privacy.err.nominee'
  | 'privacy.err.describe' | 'privacy.err.nomineeName' | 'privacy.err.nomineeRelation' | 'privacy.err.nomineeContact';
export type Problem = { key: ProblemKey; cause?: unknown };

const SERVER_SENTENCES = {
  'Please sign in to download your data.': 'privacy.server.signInDownload',
  'Please sign in to delete your account.': 'privacy.server.signInDelete',
  'Please sign in to raise a privacy concern.': 'privacy.server.signInGrievance',
  'Please sign in to nominate someone.': 'privacy.server.signInNominee',
  'You have an order on its way. Once it is delivered or cancelled, you can delete your account.': 'privacy.server.orderOnTheWay',
  'Please describe it in 10 to 2,000 characters.': 'privacy.server.describeLength',
  'Enter your nominee’s full name.': 'privacy.err.nomineeName',
  'Choose how your nominee is related to you.': 'privacy.server.nomineeRelation',
  'Enter a valid 10-digit mobile number for your nominee.': 'privacy.server.nomineePhone',
  'Enter a valid email for your nominee.': 'privacy.server.nomineeEmail',
  'Give a mobile number or an email so we can reach your nominee.': 'privacy.server.nomineeContact',
} as const;

export function problemText({ key, cause }: Problem): string {
  if (cause === undefined) return t(key);
  const said = (cause as { message?: unknown } | null)?.message;
  const text = typeof said === 'string' ? said.trim() : '';
  const known = (SERVER_SENTENCES as Record<string, (typeof SERVER_SENTENCES)[keyof typeof SERVER_SENTENCES]>)[text];
  if (known) return t(known);
  if (!text) return t(key);
  return errorMessage(t, cause, i18n.resolvedLanguage ?? 'en');
}
