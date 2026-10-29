// The order's realtime topic (database 0580): the database broadcasts the order's stage on the private channel `ol-order:<id>` the moment
// it changes (sent to the restaurant, kitchen ticket created, preparing, ready, cancelled and why, refunded). Only the signed-in customer
// who owns the order may listen (a database policy); nobody can send on it. The message is only a nudge: the screen reads the order again
// through the API (src/use-live-tracking.ts), so no order data comes from the database to the app directly. A guest (not signed in)
// has no topic and keeps polling, as does anyone whose socket drops.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { accessToken, supabase } from './lib/supabase';
import { parseStage, type OrderStage } from './utils/tracking';

export function useOrderRealtime(orderId: string | undefined, onStage: (stage: OrderStage) => void, enabled = true) {
  const latest = useRef(onStage);
  // Kept current after each commit, not during render: React may render and throw a render away, and a ref written there would leak it.
  useLayoutEffect(() => { latest.current = onStage; });
  useEffect(() => {
    const client = supabase;
    if (!enabled || !client || !orderId) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    (async () => {
      try {
        const token = await accessToken();
        if (!token || cancelled) return; // a guest: polling only
        await client.realtime.setAuth(token);
        if (cancelled) return;
        channel = client.channel(`ol-order:${orderId}`, { config: { private: true } })
          .on('broadcast', { event: 'stage' }, msg => {
            const stage = parseStage((msg as { payload?: unknown }).payload);
            if (stage) latest.current(stage);
          })
          .subscribe();
      } catch {
        // realtime is a speed-up, never a requirement
      }
    })();
    return () => {
      cancelled = true;
      if (channel) client.removeChannel(channel).catch(() => {});
    };
  }, [orderId, enabled]);
}
