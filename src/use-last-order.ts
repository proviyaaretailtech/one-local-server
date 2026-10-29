// The customer's most recent checkout that was not cancelled (all its store orders), or null: what the Home "Order again" card offers.
// GET /orders answers for this phone and, when signed in, the account, so a guest sees what they ordered here.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Order } from './api';
import { pickLastCheckout } from './reorder';

export function useLastCheckout(): Order[] | null {
  const { data } = useQuery({ queryKey: ['orders'], queryFn: () => api<Order[]>('/orders'), staleTime: 60_000, retry: 0 });
  return useMemo(() => pickLastCheckout(data), [data]);
}
