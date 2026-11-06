// The public face of src/i18n. Screens import from '@/src/i18n' and nothing deeper.
//
//   import { useTranslation, useFormat, useErrorMessage } from '@/src/i18n';
//   const { t } = useTranslation();       // t('cart.title')
//   const fmt = useFormat();              // fmt.money(249) -> ₹249, fmt.date(order.created_at), fmt.eta(12)
//
// Outside a component: import { t } from '@/src/i18n'.

export { useTranslation, Trans } from 'react-i18next';
export { i18n, t, LANGUAGE_KEY } from './runtime';
export { I18nProvider, useLanguage } from './provider';
export { LanguageFirstRun, useShowFirstRun } from './first-run';
export { LanguagePicker } from './language-picker';
export { ProfileLanguageSync } from './profile-sync';
export { useFormat, useErrorMessage } from './hooks';
export { orderStatusKey, paymentStatusKey, paymentMethodKey, errorKey, errorMessage } from './codes';
export { safeLineHeight, WEB_FONT_STACK } from './typography';
export { LOCALES, SUPPORTED, localeMeta } from './locales';
export type { Formatter } from './format';
