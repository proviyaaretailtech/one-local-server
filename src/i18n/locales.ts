// The language registry: ONE row per language the app can show. Adding a language = a catalogue file in
// ./locales/ plus a row here (and a row in app_locales on the server). Nothing else in the app lists languages.
//
// Lazy loading: English is bundled with the app because it is the fallback for every missing string.
// Every other catalogue is loaded on demand with a dynamic import() — when the person picks it, or in the
// background when the app is idle (see runtime.ts) — so the first screen only pays for the language in use.
import en from './locales/en.json';
import { pseudoLocalize } from './pseudo';

export type Catalogue = Record<string, unknown>;

export type LocaleMeta = {
  /** BCP-47 language code, also the i18next language and the catalogue file name. */
  code: string;
  /** Its own name, in its own script. Never translated. */
  nativeName: string;
  englishName: string;
  /** What Intl (numbers, dates) is told. Latin digits by default for Hindi: "-u-nu-latn". */
  intl: string;
  /** Shown in the Language screen BEFORE the catalogue is loaded, in that language, so the person sees what they are choosing. */
  sample: string;
  /** "Choose your language" in that language (first-run screen shows every language's line). */
  chooser: string;
  /** Script, so the UI knows when a font fallback or taller line height matters. */
  script: 'latin' | 'devanagari';
  /** Development builds only (the pseudo-locale). */
  dev?: boolean;
  load: () => Promise<Catalogue>;
};

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

const asCatalogue = (m: unknown): Catalogue => ((m as { default?: Catalogue })?.default ?? m) as Catalogue;

export const SOURCE_LOCALE = 'en';

const ALL_LOCALES: LocaleMeta[] = [
  {
    code: 'en', nativeName: 'English', englishName: 'English', intl: 'en-IN',
    sample: 'Your order is out for delivery', chooser: 'Choose your language', script: 'latin',
    load: async () => en as Catalogue,
  },
  {
    code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', intl: 'hi-IN-u-nu-latn',
    sample: 'आपका ऑर्डर डिलीवरी के लिए निकला है', chooser: 'अपनी भाषा चुनें', script: 'devanagari',
    load: async () => asCatalogue(await import('./locales/hi.json')),
  },
  {
    code: 'en-XA', nativeName: 'Pseudo (en-XA)', englishName: 'Pseudo-locale for developers', intl: 'en-IN',
    sample: '[Ýöûŕ öŕðéŕ îš öûţ ƒöŕ ðéļîvéŕý···]', chooser: '[Çĥööšé ýöûŕ ļàñĝûàĝé···]', script: 'latin', dev: true,
    load: async () => pseudoLocalize(en as Catalogue),
  },
];

/** The languages this build offers. The pseudo-locale is left out of production builds. */
export const LOCALES: readonly LocaleMeta[] = ALL_LOCALES.filter(l => !l.dev || IS_DEV);
export const SUPPORTED: readonly string[] = LOCALES.map(l => l.code);

export function localeMeta(code: string): LocaleMeta {
  return LOCALES.find(l => l.code === code) ?? LOCALES[0]!;
}

/** Intl tag for a language ('hi' -> 'hi-IN-u-nu-latn'); unknown languages format like English. */
export function intlTag(code: string, numerals: 'latn' | 'deva' = 'latn'): string {
  const meta = localeMeta(code);
  if (numerals === 'deva' && meta.script === 'devanagari') return meta.intl.replace(/-u-nu-\w+/, '') + '-u-nu-deva';
  return meta.intl;
}
