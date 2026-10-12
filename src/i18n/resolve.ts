// Which language to start in. Pure (no React Native), so it is tested by scripts/i18n-checks.ts.
// Order: the language this person saved on this phone, else the phone's own language list (first one we
// have a catalogue for), else English.

export type StoredLanguage = { locale: string; confirmed: boolean };
export type StartChoice = { locale: string; source: 'stored' | 'device' | 'fallback'; confirmed: boolean };

/** 'hi-IN' / 'hi_IN' / 'hi-Latn-IN' -> 'hi'. Anything unusable -> ''. */
export function languageOfTag(tag: unknown): string {
  if (typeof tag !== 'string') return '';
  return tag.trim().replace(/_/g, '-').split('-')[0]?.toLowerCase() ?? '';
}

/** Reads the saved value defensively: it may be missing, old, hand-edited or from a build with more languages. */
export function parseStored(raw: string | null | undefined): StoredLanguage | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { locale?: unknown; confirmed?: unknown };
    if (typeof value?.locale !== 'string' || !value.locale) return null;
    return { locale: value.locale, confirmed: value.confirmed === true };
  } catch {
    return null;
  }
}

export function resolveStartLocale(input: { stored: StoredLanguage | null; deviceTags: readonly string[]; supported: readonly string[]; fallback?: string }): StartChoice {
  const { stored, deviceTags, supported, fallback = 'en' } = input;
  if (stored && supported.includes(stored.locale)) return { locale: stored.locale, source: 'stored', confirmed: stored.confirmed };
  // Match on the language part only: hi-IN and hi-Latn both get Hindi. A saved language we no longer ship
  // is ignored (and the person is asked again).
  for (const tag of deviceTags) {
    const language = languageOfTag(tag);
    if (language && supported.includes(language)) return { locale: language, source: 'device', confirmed: false };
  }
  return { locale: fallback, source: 'fallback', confirmed: false };
}
