// Is the phone reaching our server? A JavaScript-only answer (no native network module, so it ships over the air):
//
//   - src/api.ts reports every request: a failed fetch (TypeError "Network request failed" / "Failed to fetch")
//     and every answer from the server, whatever its status (an answer means we are reachable).
//   - One failed request is not enough to say "offline" (a single dropped request is common on mobile data):
//     a probe confirms it first. While offline the probe repeats every 8 s; the first success brings us back.
//   - On web the browser's own online/offline events are used as well.
//   - react-query follows this state (onlineManager), so queries pause while offline and refetch when back.
//
// The probe itself is registered by src/network/network-status.tsx (this file imports nothing from src/api.ts,
// which imports it).
import { onlineManager } from '@tanstack/react-query';

type Listener = () => void;
const PROBE_EVERY_MS = 8_000;

let online = true;
let probing = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let probe: (() => Promise<boolean>) | null = null;
const listeners = new Set<Listener>();

export function isOnline() { return online; }

export function subscribeOnline(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setOnline(next: boolean) {
  if (next === online) return;
  online = next;
  if (online && timer) { clearTimeout(timer); timer = null; }
  if (!online) schedule();
  listeners.forEach(l => l());
}

/** True for a fetch that never reached a server; false for an abort or anything else. */
export function isNetworkError(error: unknown): boolean {
  const e = (error && typeof error === 'object' ? error : {}) as { name?: unknown; message?: unknown };
  if (e.name === 'AbortError') return false;
  const message = typeof e.message === 'string' ? e.message : '';
  return error instanceof TypeError || /network request failed|failed to fetch|load failed|network ?error/i.test(message);
}

/** The server answered (any status). */
export function reportNetworkSuccess() { setOnline(true); }

/** A request never reached the server. Confirmed with a probe before the app says "offline". */
export function reportNetworkFailure() {
  if (!online) return;
  void checkNow().then(ok => { if (!ok) setOnline(false); });
}

/** Wire the reachability check (GET /api/health). Called once by NetworkStatus. */
export function configureProbe(fn: () => Promise<boolean>) { probe = fn; }

async function runProbe(): Promise<boolean> {
  if (!probe) return true; // nothing to check with yet: never claim offline without evidence
  try { return await probe(); } catch { return false; }
}

/** Probe once now (the Retry button). Resolves true when the server answered. */
export async function checkNow(): Promise<boolean> {
  if (probing) return online;
  probing = true;
  try {
    const ok = await runProbe();
    if (ok) setOnline(true);
    else if (!online) schedule();
    return ok;
  } finally { probing = false; }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; if (!online) void checkNow(); }, PROBE_EVERY_MS);
}

// Web: the browser knows when the network interface goes away or comes back.
const w = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
if (w && typeof navigator !== 'undefined' && 'onLine' in navigator) {
  w.addEventListener('offline', () => setOnline(false));
  w.addEventListener('online', () => { void checkNow(); });
}

// react-query pauses fetches while offline and refetches (refetchOnReconnect) when this flips back.
onlineManager.setEventListener(setQueryOnline => {
  setQueryOnline(online);
  return subscribeOnline(() => setQueryOnline(online));
});
