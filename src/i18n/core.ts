// Builds the i18next instance. No React, no React Native: scripts/i18n-checks.ts creates its own instance with
// this same function, so what is tested is exactly what the app runs.
import { createInstance, type i18n as I18n, type Module } from 'i18next';
import en from './locales/en.json';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const warned = new Set<string>();

export function createI18n(plugins: Module[] = []): I18n {
  const instance = createInstance();
  plugins.forEach(p => instance.use(p));
  // English is always on board (it is the fallback for any string another language is missing). It is the
  // language the app starts in; runtime.ts switches to the saved/device language before the first screen.
  void instance.init({
    resources: { en: { translation: en } },
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'translation',
    ns: ['translation'],
    initAsync: false,                // resources are in memory: init completes synchronously
    returnNull: false,
    returnEmptyString: false,        // an empty Hindi value falls back to English, it is never shown blank
    interpolation: { escapeValue: false }, // React Native does not render HTML
    react: { useSuspense: false },
    saveMissing: IS_DEV,
    missingKeyHandler: IS_DEV
      ? (lngs, _ns, key) => {
          const id = `${lngs.join(',')}:${key}`;
          if (!warned.has(id)) { warned.add(id); console.warn(`[i18n] missing "${key}" in ${lngs.join(', ')} — showing the English text`); }
        }
      : undefined,
  });
  return instance;
}

/** Adds a catalogue (replacing nothing already there) and makes it the language. Resolves when React has been told. */
export async function applyLocale(instance: I18n, code: string, catalogue: Record<string, unknown>): Promise<void> {
  if (!instance.hasResourceBundle(code, 'translation')) instance.addResourceBundle(code, 'translation', catalogue, true, true);
  await instance.changeLanguage(code);
}
