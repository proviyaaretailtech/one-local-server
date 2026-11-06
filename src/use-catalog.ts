import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Catalog } from './api';
import { withoutHiddenListings } from './hidden-listings';
import { useOrigin } from './origin';

const fetchCatalog = async () => withoutHiddenListings(await api<Catalog>('/catalog'));
export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog, staleTime: 60000, retry: 1 });
}
// The catalogue as the browsing screens show it: only the products of the customer's Local / National mode. The cart,
// orders, product pages and a brand's or store's own page keep the whole catalogue (useCatalog).
export function useBrowseCatalog() {
  const { shows } = useOrigin();
  const select = useCallback((c: Catalog) => ({ ...c, products: c.products.filter(shows) }), [shows]);
  return useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog, staleTime: 60000, retry: 1, select });
}
