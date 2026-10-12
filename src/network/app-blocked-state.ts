// When the server says this app cannot be used right now, the whole app shows one blocking screen
// (rendered by src/network/network-status.tsx):
//
//   - HTTP 426 Upgrade Required   -> 'update'       "Update OneLocal to keep ordering" (not dismissible)
//   - HTTP 503 + code 'maintenance' -> 'maintenance' "OneLocal is taking a short break" (+ the server's message)
//
// src/api.ts passes every response through noteResponse(). The request itself still fails as before
// (ApiError), so screens keep their own error handling.
export type AppBlock = { kind: 'update' } | { kind: 'maintenance'; message?: string };

type Listener = () => void;
let block: AppBlock | null = null;
const listeners = new Set<Listener>();

export function getAppBlock() { return block; }
export function subscribeAppBlock(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function setBlock(next: AppBlock | null) {
  if (block?.kind === 'update') return; // an update requirement only goes away with a new app version
  const message = (b: AppBlock | null) => (b?.kind === 'maintenance' ? b.message : undefined);
  if (next?.kind === block?.kind && message(next) === message(block)) return;
  block = next;
  listeners.forEach(l => l());
}

/** Reads the status (and, for a 503, the body's code from a clone) without consuming the response. */
export async function noteResponse(r: Response): Promise<void> {
  if (r.status === 426) return setBlock({ kind: 'update' });
  if (r.status === 503) {
    const body = await r.clone().json().catch(() => null) as { code?: unknown; detail?: unknown; message?: unknown } | null;
    if (body?.code === 'maintenance') {
      const text = typeof body.detail === 'string' ? body.detail : typeof body.message === 'string' ? body.message : undefined;
      return setBlock({ kind: 'maintenance', message: text?.trim() || undefined });
    }
    return;
  }
  if (r.ok && block?.kind === 'maintenance') setBlock(null);
}
