// Makes t('some.key') type-checked against the English catalogue: a typo or a missing key is a tsc error,
// not a screen that shows "cart.titel". (Hindi must have the same keys: `npm run i18n:check` enforces it.)
import 'i18next';
import type en from './locales/en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
