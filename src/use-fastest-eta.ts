// The quickest delivery the catalogue promises right now (minutes), or null when none is known. Real data, never a fixed claim:
// the home hero and the header chip show it, and show nothing when it is null. A store's real time (src/use-store-etas.ts) wins
// over the time it was listed with.
import { useMemo } from 'react';
import { useCatalog } from './use-catalog';
import { useStoreEtas } from './use-store-etas';

export function useFastestEta(): number | null {
  const { data } = useCatalog(); const etas = useStoreEtas();
  return useMemo(() => {
    const minutes = (data?.products ?? []).map(p => etas[p.store_id] || p.delivery_min).filter(m => m > 0);
    return minutes.length ? Math.min(...minutes) : null;
  }, [data, etas]);
}
