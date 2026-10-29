import { useQuery } from '@tanstack/react-query';
import { api, Catalog } from './api';
import { withoutHiddenListings } from './hidden-listings';
export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: async () => withoutHiddenListings(await api<Catalog>('/catalog')), staleTime: 60000, retry: 1 });
}