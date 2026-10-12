import { useQuery } from '@tanstack/react-query';
import { api, Catalog } from './api';
export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: () => api<Catalog>('/catalog'), staleTime: 60000, retry: 1 });
}