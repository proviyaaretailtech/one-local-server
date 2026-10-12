// Fetching pop-ups and sending their events. Events are fire and forget: a lost impression never bothers the customer.
import Constants from 'expo-constants';
import { API, identity, mediaUrl } from '../api';
import type { Popup, PopupContent } from './types';

export const appVersion = Constants.expoConfig?.version ?? '';

export async function fetchPopups(screen: string, lang: string, hasCart: boolean): Promise<Popup[]> {
  const qs = new URLSearchParams({ screen, lang, cart: hasCart ? '1' : '0', ...(appVersion ? { app_version: appVersion } : {}) });
  const r = await fetch(`${API}/popups?${qs}`, { headers: await identity() });
  if (!r.ok) throw new Error(`popups ${r.status}`);
  const body = await r.json() as { popups?: Popup[] };
  return Array.isArray(body.popups) ? body.popups : [];
}

export function sendPopupEvent(id: string, event: 'impression' | 'tap' | 'close') {
  identity()
    .then(headers => fetch(`${API}/popups/${encodeURIComponent(id)}/events`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) }))
    .catch(() => {});
}

// The customer's language, falling back to English (English is required on the server).
export function contentFor(p: Popup, lang: string): PopupContent {
  const en = p.content.en ?? {};
  const own = (p.content as Record<string, PopupContent | undefined>)[lang];
  return own?.title ? { ...en, ...own } : en;
}

// A media key ('popups/navratri.webp') or an absolute address.
export const imageUrl = (image?: string) => (!image ? null : /^https?:\/\//.test(image) ? image : mediaUrl(image.replace(/^\/+/, '')));
