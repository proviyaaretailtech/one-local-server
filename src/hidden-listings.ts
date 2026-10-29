// Test and placeholder listings that must never show in the customer app: the simulation kitchens the partner
// onboarding tests create, the "Demo" placeholder store, and the Mysore Dining Hall hotel (founder, 16 Oct 2026:
// "remove the mysore hotel"). The real fix is to delete them in the database; until then the app hides them.
import type { Catalog } from './api';

const HIDDEN = [/^sim kitchen\b/i, /^demo\b/i, /^mysore dining hall\b/i];
export const isHiddenListing = (name?: string | null) => !!name && HIDDEN.some(r => r.test(name.trim()));

/** The catalogue without hidden brands, and without the products that belong to them. */
export function withoutHiddenListings(c: Catalog): Catalog {
  const brands = c.brands.filter(b => !isHiddenListing(b.name));
  const hiddenIds = new Set(c.brands.filter(b => isHiddenListing(b.name)).map(b => b.id));
  if (!hiddenIds.size) return c;
  return { ...c, brands, products: c.products.filter(p => !hiddenIds.has(p.brand_id ?? '') && !hiddenIds.has(p.store_id)) };
}
