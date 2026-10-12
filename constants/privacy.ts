// Privacy (DPDP Act 2023 + DPDP Rules 2025): the facts the privacy notice states, in ONE place.
// The notice screen, the Privacy & your data screen, the data-download file and the server's replies
// all read from here, so each fact is filled once. Plain TypeScript with no app imports: the server
// (server/privacy.ts) imports it too. See docs/DPDP.md. Not legal advice — a lawyer must review the
// notice before launch.
//
// Everything marked [FOUNDER TO FILL] must be filled before launch.
//
// i18n: this file is the ENGLISH source of the facts, read by the server (its data download, its replies) and
// as the fallback; it must stay plain TypeScript with no app imports. What a person reads on the screens is
// in the catalogue (privacy.* and privacyNotice.*, English + Hindi), looked up by the ids below through
// purposeText / noticeItemsText / sharedWithText / keptByLawText in src/privacy.ts. When you change a sentence
// here, change the same sentence in both catalogues, and raise PRIVACY.noticeVersion if its meaning changed.
// i18n-ignore-file: English facts for the server and the data download; the screens read the catalogue.
export const FILL = '[FOUNDER TO FILL]';
export const isPlaceholder = (value: string) => value.includes(FILL);

export const PRIVACY = {
  // Raise the version whenever the notice's meaning changes; every consent is recorded with it.
  noticeVersion: '2026-09-27.1',
  noticeDate: '27 September 2026',
  // The same day, for showing it in the reader's language (fmt.date). Keep the two in step.
  noticeDateIso: '2026-09-27',
  brand: 'One Local (OneCity)',
  // The Data Fiduciary: the company that decides why and how personal data is used.
  legalEntity: `${FILL}: registered company name`,
  registeredAddress: `${FILL}: registered office address`,
  // DPDP Act s.8(9) and Rule 9: someone who answers questions about personal data, published and
  // named in every reply to a privacy request.
  grievanceOfficer: {
    name: `${FILL}: grievance officer's name`,
    email: `${FILL}: e.g. privacy@yourdomain.in`,
    phone: `${FILL}: phone number`,
    hours: 'Monday to Saturday, 10 am to 6 pm',
  },
  // Rule 14: the longest we take to answer a grievance or a rights request (the Rules' outer limit is 90 days).
  responseDays: 90,
  // Data Protection Board of India: where a person can complain after using our grievance process.
  board: {
    name: 'Data Protection Board of India',
    complaintLink: `${FILL}: the Board's official online complaint link, once confirmed`,
  },
  // Accounts are for adults only; a parent or guardian uses their own account for a child (s.9).
  minimumAge: 18,
  // Where the database and sign-in live (Supabase project, AWS Mumbai ap-south-1 per docs/CENTRAL_DB_MAP.md).
  hosting: 'Supabase (database and sign-in), Mumbai region, India',
} as const;

// ---------- Consent purposes ----------
// Optional purposes: off until the person switches them on; withdrawing is one tap, like giving.
export const OPTIONAL_PURPOSES = ['marketing', 'personalisation', 'location_suggestions'] as const;
export type OptionalPurpose = (typeof OPTIONAL_PURPOSES)[number];
// Also recorded (never optional, never used for anything else): that the notice was shown and
// acknowledged, and that the person confirmed they are 18 or older.
export const RECORDED_PURPOSES = [...OPTIONAL_PURPOSES, 'notice_acknowledged', 'age_18_plus'] as const;
export type ConsentPurpose = (typeof RECORDED_PURPOSES)[number];
export const CONSENT_SOURCES = ['sign_in', 'privacy_screen'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export const PURPOSES: Record<OptionalPurpose, { title: string; body: string }> = {
  marketing: {
    title: 'Offers and updates',
    body: 'Messages about offers, new stores and events near you, by notification, SMS, WhatsApp or email.',
  },
  personalisation: {
    title: 'Personalised suggestions',
    body: 'Suggestions based on what you ordered and saved before. Off means everyone sees the same lists.',
  },
  location_suggestions: {
    title: 'Use my location for nearby suggestions',
    body: 'Uses the location your phone already knows to sort places by distance. Tapping “Use current location” always works, whatever this says.',
  },
};

// ---------- What we collect, and why (the itemised notice; also summarised in the download) ----------
export type NoticeItem = { data: string; why: string; basis: 'needed' | 'optional'; kept: string };
// Stable ids (the catalogue keys are privacyNotice.s2.<id>Data / <id>Why / <id>Kept). The list the server
// sends is the same array as before: NOTICE_ITEMS, in this order.
export const NOTICE_ITEM_IDS = ['account', 'addresses', 'orders', 'payments', 'location', 'locationSuggestions', 'profileExtras', 'requests', 'deviceKey', 'voicePhoto', 'marketing', 'personalisation'] as const;
export type NoticeItemId = (typeof NOTICE_ITEM_IDS)[number];
const NOTICE_BY_ID: Record<NoticeItemId, NoticeItem> = {
  account: { data: 'Name, mobile number and email', why: 'To create your account, sign you in, and reach you about your orders.', basis: 'needed', kept: 'While your account is open.' },
  addresses: { data: 'Delivery addresses and map pins', why: 'To deliver your orders and check that we deliver there.', basis: 'needed', kept: 'Saved addresses: until you delete them. On an order: with the order.' },
  orders: { data: 'Orders: items, prices, taxes, coupons, store', why: 'To fulfil, bill and refund orders, and to keep the tax records the law requires.', basis: 'needed', kept: 'As tax law requires (see “What we must keep”).' },
  payments: { data: 'Payment references: Razorpay order and payment ids, method, status', why: 'To confirm payments and refunds. Card numbers, UPI PINs and bank logins are typed on Razorpay’s page and never reach us.', basis: 'needed', kept: 'As payment and tax law require.' },
  location: { data: 'Location: the town you pick, or your current location when you tap “Use current location”', why: 'To show what One Local offers where you are.', basis: 'needed', kept: 'On your phone only, until you change it.' },
  locationSuggestions: { data: 'Location for nearby suggestions', why: 'To sort nearby places by distance without asking each time.', basis: 'optional', kept: 'Not stored; used on your phone.' },
  profileExtras: { data: 'Profile extras: photo, birthday, food preference, language', why: 'To make the app feel like yours. You choose whether to add them.', basis: 'optional', kept: 'On your phone only, today.' },
  requests: { data: 'Help requests, privacy requests, booking enquiries, “launch here” requests', why: 'To answer you and to learn where people want One Local.', basis: 'needed', kept: 'Until answered, then as our retention schedule says.' },
  deviceKey: { data: 'A random device key', why: 'Keeps orders placed without an account private to this phone. We store only a scrambled (hashed) form.', basis: 'needed', kept: 'While the app is on your phone.' },
  voicePhoto: { data: 'Voice and photo searches', why: 'Switched off today. If switched on, used only to find products, and not kept.', basis: 'optional', kept: 'Not kept.' },
  marketing: { data: 'Marketing messages', why: 'Only if you say yes.', basis: 'optional', kept: 'Your choice is recorded, with the date and notice version.' },
  personalisation: { data: 'Personalised suggestions', why: 'Only if you say yes.', basis: 'optional', kept: 'Your choice is recorded, with the date and notice version.' },
};
export const NOTICE_ITEMS: NoticeItem[] = NOTICE_ITEM_IDS.map(id => NOTICE_BY_ID[id]);

// Who else handles personal data for us (processors) or receives it to deliver an order.
// Ids: privacyNotice.s3.<id>Who / <id>What / <id>Where (the SMS provider's `where` is still to be filled and is
// shown as written here).
export type SharedWith = { who: string; what: string; where: string };
export const SHARED_WITH_IDS = ['store', 'rider', 'supabase', 'razorpay', 'sms', 'googleMaps', 'osm'] as const;
export type SharedWithId = (typeof SHARED_WITH_IDS)[number];
const SHARED_BY_ID: Record<SharedWithId, SharedWith> = {
  store: { who: 'The store or restaurant fulfilling your order', what: 'The items, and the delivery address and notes for that order only.', where: 'India' },
  rider: { who: 'The delivery rider', what: 'The delivery address, map pin and notes for the order they carry.', where: 'India' },
  supabase: { who: 'Supabase', what: 'Hosts our database and sign-in (account, orders, requests).', where: 'Mumbai region, India' },
  razorpay: { who: 'Razorpay', what: 'Takes online payments; holds card, UPI and bank details under its own licence.', where: 'India' },
  sms: { who: 'SMS provider (through Supabase sign-in)', what: 'Your mobile number, to send sign-in codes.', where: `${FILL}: provider and region, once chosen` },
  googleMaps: { who: 'Google Maps (when switched on)', what: 'Address searches and map positions, to find your address.', where: 'Google’s servers, may be outside India' },
  osm: { who: 'OpenStreetMap servers', what: 'A town-sized map area (no name or phone), to list local shops.', where: 'Europe' },
};
export const SHARED_WITH: SharedWith[] = SHARED_WITH_IDS.map(id => SHARED_BY_ID[id]);

// Kept even after an account is deleted, because a law requires it.
// Ids: privacyNotice.s6.<id>Line.
export const KEPT_BY_LAW_IDS = ['tax', 'payments', 'consent', 'security'] as const;
export type KeptByLawId = (typeof KEPT_BY_LAW_IDS)[number];
const KEPT_BY_ID: Record<KeptByLawId, string> = {
  tax: 'Tax invoices and order amounts (GST records): kept for the statutory period — under the GST law, 72 months from the due date of that year’s annual return. Your name, address and notes are removed from them.',
  payments: 'Payment and refund records (Razorpay references, amounts, dates): kept as payment and tax law require. They no longer point to you.',
  consent: 'Your consent history and privacy requests (what you agreed to, when, and what you asked us): kept so we can show we followed your choices.',
  security: 'Security logs: kept for one year, as the DPDP Rules require, then deleted.',
};
export const KEPT_BY_LAW: string[] = KEPT_BY_LAW_IDS.map(id => KEPT_BY_ID[id]);
