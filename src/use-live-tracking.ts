// Polls GET /orders/:id/tracking for the order screen (spec: specs/live-navigation-eta/spec.md).
//
//  - One request at a time; the next one is scheduled when the last one answers, `poll_after_s` later (10 s while a
//    rider moves, 30 s when nothing moves; the server decides, we keep it between 3 and 120 s).
//  - Paused while the screen is not the focused one or the app is in the background; the moment it is back, one
//    request goes out straight away so the screen is never showing a minutes-old rider.
//  - A failed request keeps the last good answer on screen and retries after 5, 10, 20, 40, then 60 seconds.
//  - Stops for good once the order is delivered or cancelled (nothing will move any more).
//  - Realtime (0580): a broadcast on the order's topic (src/use-order-realtime.ts) asks again at once, even after the order was
//    final (a refund that settles later); polling stays the fallback, so a dropped socket only makes the screen slower.
//  - `data` is null until the first answer; `loading` is true only until the first answer or the first failure.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { api } from './api';
import { useOrderRealtime } from './use-order-realtime';
import { isFinalStage, isTerminalPhase, nextPollDelayMs, parseTracking, type TrackingData } from './utils/tracking';

const REQUEST_TIMEOUT_MS = 12_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tracking request timed out')), ms); // i18n-ignore (developer-only)
    p.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

export type LiveTracking = { data: TrackingData | null; loading: boolean; error: Error | null };

type State = { orderId: string | undefined; data: TrackingData | null; loading: boolean; error: Error | null; finished: boolean };
const fresh = (orderId: string | undefined): State => ({ orderId, data: null, loading: true, error: null, finished: false });

export function useLiveTracking(orderId: string | undefined, { enabled = true }: { enabled?: boolean } = {}): LiveTracking {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  // One state object tagged with the order it belongs to: a different order starts from nothing without any reset effect.
  const [stored, setStored] = useState<State>(() => fresh(orderId));
  const state = stored.orderId === orderId ? stored : fresh(orderId);
  const [nudge, setNudge] = useState(0);
  useOrderRealtime(orderId, () => {
    setStored(prev => (prev.orderId === orderId && prev.finished ? { ...prev, finished: false } : prev));
    setNudge(n => n + 1);
  }, enabled);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => setForeground(next === 'active'));
    return () => sub.remove();
  }, []);

  const running = enabled && !!orderId && focused && foreground && !state.finished;
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      try {
        const parsed = parseTracking(await withTimeout(api<unknown>(`/orders/${orderId}/tracking`), REQUEST_TIMEOUT_MS));
        if (cancelled) return;
        if (!parsed) throw new Error('not a tracking response'); // i18n-ignore (developer-only)
        failures = 0;
        const finished = (parsed.live && isTerminalPhase(parsed.phase)) || isFinalStage(parsed.stage);
        setStored({ orderId, data: parsed, loading: false, error: null, finished });
        if (!finished) timer = setTimeout(poll, nextPollDelayMs(parsed.poll_after_s, 0));
      } catch (e) {
        if (cancelled) return;
        failures += 1;
        const error = e instanceof Error ? e : new Error(String(e));
        setStored(prev => ({ ...(prev.orderId === orderId ? prev : fresh(orderId)), loading: false, error }));
        timer = setTimeout(poll, nextPollDelayMs(undefined, failures, Math.random()));
      }
    };
    poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [running, orderId, nudge]);

  return { data: state.data, loading: state.loading, error: state.error };
}
