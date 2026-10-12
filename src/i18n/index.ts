// The public face of src/i18n. Screens import from '@/src/i18n' and nothing deeper.
//
//   import { useTranslation, useFormat, useErrorMessage } from '@/src/i18n';
//   const { t } = useTranslation();       // t('cart.title')
//   const fmt = useFormat();              // fmt.money(249) -> ₹249, fmt.date(order.created_at), fmt.eta(12)
//
// Outside a component: import { t, getFormat } from '@/src/i18n'.
import { makeFormatter } from './format';
import { i18n } from './runtime';

export { useTranslation, Trans } from 'react-i18next';
export { i18n, t, LANGUAGE_KEY } from './runtime';
export { I18nProvider, useLanguage, useT } from './provider';
export { LanguageFirstRun, useShowFirstRun } from './first-run';
export { LanguagePicker } from './language-picker';
export { ProfileLanguageSync } from './profile-sync';
export { useFormat, useErrorMessage } from './hooks';
export { orderStatusKey, paymentStatusKey, paymentMethodKey, errorKey, errorMessage } from './codes';
export { safeLineHeight, WEB_FONT_STACK } from './typography';
export { LOCALES, SUPPORTED, localeMeta } from './locales';
export type { Formatter } from './format';

/** The formatter for use outside components (it does not follow language changes by itself — call it when you need a value). */
export const getFormat = () => makeFormatter({ lng: i18n.resolvedLanguage ?? i18n.language ?? 'en', t: i18n.t.bind(i18n) });
