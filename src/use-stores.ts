// The shops (GET /stores), one query shared by every screen that lists them. Hidden listings are left out.
import { useQuery } from '@tanstack/react-query';
import { api, Store } from './api';
import { isHiddenListing } from './hidden-listings';

const NONE: Store[] = [];

export function useStores(): Store[] {
  const { data } = useQuery({ queryKey: ['stores'], queryFn: async () => (await api<Store[]>('/stores')).filter(s => !isHiddenListing(s.name)), staleTime: 60_000 });
  return data ?? NONE;
}
