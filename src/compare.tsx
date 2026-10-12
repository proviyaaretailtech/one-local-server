// Up to three products picked for side-by-side comparison. Kept for the session only.
import { createContext, useContext, useState } from 'react';
import type { Product } from './api';

export const COMPARE_LIMIT = 3;
type Compare = { items: Product[]; has: (id: string) => boolean; toggle: (p: Product) => 'added' | 'removed' | 'full'; clear: () => void };
const CompareContext = createContext<Compare | null>(null);

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Product[]>([]);
  const has = (id: string) => items.some(p => p.id === id);
  const toggle = (p: Product) => {
    if (has(p.id)) { setItems(list => list.filter(x => x.id !== p.id)); return 'removed' as const; }
    if (items.length >= COMPARE_LIMIT) return 'full' as const;
    setItems(list => [...list, p]); return 'added' as const;
  };
  return <CompareContext.Provider value={{ items, has, toggle, clear: () => setItems([]) }}>{children}</CompareContext.Provider>;
}

export function useCompare() {
  const value = useContext(CompareContext);
  if (!value) throw new Error('CompareProvider missing'); // i18n-ignore: developer error, never shown to a person
  return value;
}
