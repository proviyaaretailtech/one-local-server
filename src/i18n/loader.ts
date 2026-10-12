// The language switcher's brain: a small state machine, with no React and no React Native in it, so
// scripts/i18n-checks.ts can test every rule below.
//
//   idle ──select(x)──> loading ──ready──> ready          (the app is now in x)
//                          │ └──timeout / failure──> error  (the app stays in the language it was in)
//
// Rules the UI relies on:
//   - While x loads the CURRENT language stays on screen. Nothing is swapped half-way: the catalogue (and
//     any font) is fully ready first, then ONE swap happens, so there is no half-translated flash.
//   - Last selection wins: pick Hindi, then English before Hindi has finished, and the app ends up in
//     English; the late Hindi result is thrown away.
//   - Tapping the language that is already loading does nothing (double-tap safe).
//   - A load that takes more than `timeoutMs` (8 s) or fails leaves the app in its current language with an
//     error to show and a retry(). It never leaves a blank screen.

import type { Catalogue } from './locales';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type LoadErrorKind = 'timeout' | 'load';

export type LocaleState = Readonly<{
  /** The language the UI is in right now. */
  active: string;
  /** While loading: the language being loaded. While in error: the one that failed (what retry() tries again). */
  target: string | null;
  status: LoadStatus;
  error: LoadErrorKind | null;
  /** True once the person has chosen (first-run chooser done). */
  confirmed: boolean;
  /** Counts completed swaps; lets the UI announce a change without announcing the first render. */
  swaps: number;
}>;

export type SavedLanguage = { locale: string; confirmed: boolean };

export type LocaleDeps = {
  supported: readonly string[];
  /** Where the app is right now (already applied before the controller exists). */
  initial: { active: string; confirmed: boolean };
  /** A dynamic import of the catalogue. */
  loadCatalogue: (code: string) => Promise<Catalogue>;
  /** Fonts the language needs (expo-font); resolves at once when it needs none. */
  loadFonts: (code: string) => Promise<void>;
  /** Makes the language live: adds the catalogue to i18next and switches. Called once catalogue + fonts are ready. */
  apply: (code: string, catalogue: Catalogue) => Promise<void> | void;
  /** Saves the choice (AsyncStorage). A failure never undoes the switch. */
  persist: (value: SavedLanguage) => Promise<void>;
  timeoutMs?: number;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
  onError?: (code: string, error: unknown) => void;
};

export type LocaleController = {
  getState: () => LocaleState;
  subscribe: (listener: () => void) => () => void;
  select: (code: string) => Promise<void>;
  retry: () => Promise<void>;
  /** First-run "Continue": remember the current language as a deliberate choice. */
  confirm: () => Promise<void>;
  /** Loads a catalogue quietly so a later select() is instant. Never changes state, never throws. */
  prefetch: (codes: readonly string[]) => Promise<void>;
};

export const LOAD_TIMEOUT_MS = 8000;

class LoadTimeout extends Error {
  constructor() { super('Language load timed out'); this.name = 'LoadTimeout'; }
}

export function createLocaleController(deps: LocaleDeps): LocaleController {
  const timeoutMs = deps.timeoutMs ?? LOAD_TIMEOUT_MS;
  const timers = deps.timers ?? { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const listeners = new Set<() => void>();
  let state: LocaleState = { active: deps.initial.active, target: null, status: 'idle', error: null, confirmed: deps.initial.confirmed, swaps: 0 };
  let sequence = 0; // bumped by every selection: a result only counts if it still carries the latest number
  const catalogues = new Map<string, Promise<Catalogue>>();

  const set = (patch: Partial<LocaleState>) => {
    state = { ...state, ...patch };
    listeners.forEach(l => l());
  };

  const catalogue = (code: string) => {
    let pending = catalogues.get(code);
    if (!pending) {
      pending = deps.loadCatalogue(code);
      catalogues.set(code, pending);
      // A failed load must not be remembered, or Retry would just replay the failure.
      pending.catch(() => { if (catalogues.get(code) === pending) catalogues.delete(code); });
    }
    return pending;
  };

  const withTimeout = <T,>(work: Promise<T>, code: string): Promise<T> => new Promise<T>((resolve, reject) => {
    const handle = timers.set(() => {
      catalogues.delete(code); // start from scratch next time rather than waiting on a hung load
      reject(new LoadTimeout());
    }, timeoutMs);
    work.then(
      v => { timers.clear(handle); resolve(v); },
      e => { timers.clear(handle); reject(e); },
    );
  });

  const save = () => deps.persist({ locale: state.active, confirmed: state.confirmed }).catch(e => deps.onError?.(state.active, e));

  const select = async (code: string): Promise<void> => {
    if (!deps.supported.includes(code)) return;
    if (code === state.active) {
      // Back to what is showing: cancels any load in flight and clears an error. Nothing visible changes.
      if (state.status === 'loading' || state.status === 'error') { sequence += 1; set({ target: null, status: 'ready', error: null }); }
      return;
    }
    if (code === state.target && state.status === 'loading') return; // double tap
    const mine = ++sequence;
    set({ target: code, status: 'loading', error: null });
    try {
      const [loaded] = await withTimeout(Promise.all([catalogue(code), deps.loadFonts(code)]), code);
      if (mine !== sequence) return; // a later choice took over; this result is dropped
      await deps.apply(code, loaded);
      // apply() is the single swap. If another choice arrived while it ran, the screen is in `code` for a
      // moment and the newer load is still going: report where we really are, leave the newer load alone.
      if (mine === sequence) set({ active: code, target: null, status: 'ready', error: null, swaps: state.swaps + 1 });
      else set({ active: code, swaps: state.swaps + 1 });
      await save();
    } catch (e) {
      if (mine !== sequence) return;
      deps.onError?.(code, e);
      set({ status: 'error', target: code, error: e instanceof LoadTimeout ? 'timeout' : 'load' });
    }
  };

  return {
    getState: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select,
    retry: () => (state.status === 'error' && state.target ? select(state.target) : Promise.resolve()),
    confirm: async () => { if (!state.confirmed) { set({ confirmed: true }); await save(); } },
    prefetch: async codes => {
      for (const code of codes) {
        if (code === state.active || !deps.supported.includes(code)) continue;
        await catalogue(code).catch(() => {});
      }
    },
  };
}
