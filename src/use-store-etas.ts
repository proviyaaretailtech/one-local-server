// Real delivery times for the customer's chosen place (server/eta.ts, GET /api/eta): store id -> minutes. A store that is not in the
// answer (no map position yet, not accepting orders, sample catalogue) keeps the time it was listed with, so nothing is ever blank.
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';
import { useDeliveryLocation } from './delivery-location';
import { CITY_CENTER } from './places';

const NONE: Record<string, number> = {};

export function useStoreEtas(): Record<string, number> {
  const { point } = useDeliveryLocation(); const at = point ?? CITY_CENTER;
  const lat = Number(at.lat.toFixed(3)); const lng = Number(at.lng.toFixed(3)); // ~100 m: one answer serves everyone standing nearby
  const { data } = useQuery({ queryKey: ['store-etas', lat, lng], queryFn: async () => (await apiGet<{ etas: Record<string, number> }>(`/eta?lat=${lat}&lng=${lng}`)).etas, staleTime: 60_000, retry: 0 });
  return data ?? NONE;
}

/** Minutes for one product: its store's real time when known, else the time it was listed with. */
export function useEtaMinutes(p: { store_id?: string | null; delivery_min: number }): number {
  const etas = useStoreEtas();
  return (p.store_id ? etas[p.store_id] : 0) || p.delivery_min;
}
