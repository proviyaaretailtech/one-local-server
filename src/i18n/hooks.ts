// What screens import. One place, so a new screen needs a single import line:
//   import { useTranslation, useFormat, useErrorMessage } from '@/src/i18n';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from './codes';
import { makeFormatter, type Formatter } from './format';

/** ₹ / distance / minutes / dates in the current language. Re-renders when the language changes. */
export function useFormat(): Formatter {
  const { t, i18n } = useTranslation();
  const lng = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  return useMemo(() => makeFormatter({ lng, t }), [lng, t]);
}

/** const message = useErrorMessage(); ... setError(message(e)) */
export function useErrorMessage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  return useMemo(() => (error: unknown) => errorMessage(t, error, lng), [t, lng]);
}
