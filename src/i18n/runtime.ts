// Wires the pure pieces to the phone: the saved language (AsyncStorage), the phone's own language list
// (expo-localization), the app-wide i18next instance, and the first-launch sequence.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initReactI18next } from 'react-i18next';
import { applyLocale, createI18n } from './core';
import { loadLocaleFonts } from './fonts';
import { createLocaleController, LOAD_TIMEOUT_MS, type LocaleController, type SavedLanguage } from './loader';
import { LOCALES, localeMeta, SOURCE_LOCALE, SUPPORTED } from './locales';
import { parseStored, resolveStartLocale } from './resolve';

export const LANGUAGE_KEY = 'onecity.language.v1';

/** The one i18next instance the whole app shares. Starts in English; boot() moves it to the right language before the first screen. */
export const i18n = createI18n([initReactI18next]);

/** Translate outside a component (an error message, an Alert, a notification). Inside components use useTranslation(). */
export const t = i18n.t.bind(i18n) as typeof i18n.t;

async function readSaved() {
  try { return parseStored(await AsyncStorage.getItem(LANGUAGE_KEY)); } catch { return null; }
}
const writeSaved = (value: SavedLanguage) => AsyncStorage.setItem(LANGUAGE_KEY, JSON.stringify(value));

/** The phone's languages, most preferred first. expo-localization needs a native build; Intl is the fallback if it is absent. */
export function deviceLanguageTags(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLocales } = require('expo-localization') as typeof import('expo-localization');
    const tags = getLocales().map(l => l.languageTag).filter(Boolean);
    if (tags.length) return tags;
  } catch { /* native module missing in this build: use Intl below */ }
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    const nav = typeof navigator !== 'undefined' ? [...(navigator.languages ?? [])] : [];
    return [...nav, tag].filter(Boolean);
  } catch { return []; }
}

const withDeadline = <T,>(work: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const h = setTimeout(() => reject(new Error('timeout')), ms);
  work.then(v => { clearTimeout(h); resolve(v); }, e => { clearTimeout(h); reject(e); });
});

/**
 * Start-up, run once before the first screen: read the saved language, work out the right one (saved ->
 * phone -> English), load it, switch i18next to it, then return the controller that runs later changes.
 * If the saved language cannot be loaded in time, the app starts in English (never blocked) and the provider keeps trying in the background.
 */
export async function bootI18n(): Promise<{ controller: LocaleController; retryLocale: string | null }> {
  let active = SOURCE_LOCALE; let confirmed = false; let retryLocale: string | null = null;
  try {
    const saved = await readSaved();
    const start = resolveStartLocale({ stored: saved, deviceTags: deviceLanguageTags(), supported: SUPPORTED, fallback: SOURCE_LOCALE });
    confirmed = start.confirmed;
    if (start.locale !== SOURCE_LOCALE) {
      try {
        const [catalogue] = await withDeadline(Promise.all([localeMeta(start.locale).load(), loadLocaleFonts(start.locale)]), LOAD_TIMEOUT_MS);
        await applyLocale(i18n, start.locale, catalogue);
        active = start.locale;
      } catch (e) {
        console.warn(`[i18n] could not load "${start.locale}" at start-up; using English for now`, e); // i18next is already in English
        retryLocale = start.locale; // the provider keeps trying in the background: the saved language is swapped in as soon as it arrives
      }
    }
  } catch (e) {
    console.warn('[i18n] start-up failed; using English', e); // never leave the app without a language
  }
  const controller = createLocaleController({
    supported: SUPPORTED,
    initial: { active, confirmed },
    loadCatalogue: code => localeMeta(code).load(),
    loadFonts: loadLocaleFonts,
    apply: (code, catalogue) => applyLocale(i18n, code, catalogue),
    persist: writeSaved,
    onError: (code, e) => console.warn(`[i18n] language "${code}" did not load`, e),
  });
  return { controller, retryLocale };
}

/** Quietly loads the other catalogues once the app is idle, so choosing one later is instant. */
export function prefetchWhenIdle(controller: LocaleController) {
  const run = () => { void controller.prefetch(LOCALES.map(l => l.code)); };
  const g = globalThis as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => void };
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2500);
}
