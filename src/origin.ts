// Local / National: which products the customer browses, picked with the switch on home and kept in their profile.
// The server marks each product's origin; one it has not marked yet shows in both modes, so nothing disappears before
// the marking arrives.
import { useCallback } from 'react';
import type { Origin, Product } from './api';
import { useCustomer } from './customer';

export function useOrigin() {
  const { profile, update } = useCustomer();
  const origin = profile.origin;
  const setOrigin = (next: Origin) => update({ profile: { ...profile, origin: next } });
  const shows = useCallback((p: Product) => !p.origin || p.origin === origin, [origin]);
  return { origin, setOrigin, shows };
}
