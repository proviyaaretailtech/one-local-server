// Mounted once at the top of app/_layout.tsx. It:
//   1. reads the saved language and starts i18next in the right one BEFORE the first screen (until then it
//      renders nothing, so the native splash stays up: no flash of English for someone who chose Hindi),
//   2. runs language changes (instant: screens re-render, nothing remounts, so carts, forms and scroll stay),
//   3. loads the other languages quietly when idle,
//   4. announces a change to screen readers, in the new language, and sets <html lang> on web.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { I18nextProvider, useTranslation } from 'react-i18next';
import type { LocaleController, LocaleState } from './loader';
import { LOCALES, localeMeta, type LocaleMeta } from './locales';
import { bootI18n, i18n, prefetchWhenIdle } from './runtime';

const ControllerContext = createContext<LocaleController | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [controller, setController] = useState<LocaleController | null>(null);
  useEffect(() => {
    let live = true;
    bootI18n().then(({ controller: c, retryLocale }) => {
      if (!live) return;
      setController(c); prefetchWhenIdle(c);
      // The saved language was too slow at start-up (slow network on web): keep going quietly, swap when it lands.
      if (retryLocale) void c.select(retryLocale);
    });
    return () => { live = false; };
  }, []);

  // After a swap: tell assistive tech (in the new language) and keep <html lang> right on web.
  const announced = useRef(0);
  useEffect(() => {
    if (!controller) return;
    const sync = () => {
      const state = controller.getState();
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = state.active.split('-')[0] ?? 'en';
      if (state.swaps !== announced.current) {
        announced.current = state.swaps;
        try { AccessibilityInfo.announceForAccessibility(i18n.t('language.changedAnnouncement', { language: localeMeta(state.active).nativeName })); } catch { /* announcements are a nicety */ }
      }
    };
    sync();
    return controller.subscribe(sync);
  }, [controller]);

  if (!controller) return null; // holds the splash for the few milliseconds the saved language takes to load
  return <ControllerContext.Provider value={controller}><I18nextProvider i18n={i18n}>{children}</I18nextProvider></ControllerContext.Provider>;
}

export type LanguageApi = {
  state: LocaleState;
  locales: readonly LocaleMeta[];
  active: LocaleMeta;
  /** Switch language. Instant once loaded; while loading, the current language stays on screen. */
  select: (code: string) => Promise<void>;
  retry: () => Promise<void>;
  /** First launch: the person has chosen (or accepted the default). */
  confirm: () => Promise<void>;
  /** True on first launch until "Continue" is tapped. */
  firstRun: boolean;
};

export function useLanguage(): LanguageApi {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('I18nProvider missing');
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return {
    state, locales: LOCALES, active: localeMeta(state.active),
    select: controller.select, retry: controller.retry, confirm: controller.confirm, firstRun: !state.confirmed,
  };
}

/** Re-renders when the language changes and gives the translate function for it (a thin alias so screens import from one place). */
export function useT() { return useTranslation().t; }
