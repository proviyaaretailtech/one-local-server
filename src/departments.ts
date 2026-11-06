import type { TFunction } from 'i18next';
import { colors } from './theme';
import { storePalette } from './store-palettes';
// `route` is the department's path. Groceries, Shops and Care have no page of their own any more (they are in the
// Categories tab), so for them it is only the key their colours are found by (paletteFor: a product passes /<department>).
export const departments = [
  { id: 'food', label: 'Food', color: colors.food, route: '/food', top: colors.foodTop, mid: colors.foodMid, fade: colors.foodFade }, // i18n-ignore: English fallback data; screens show departmentName(t, id)
  { id: 'grocery', label: 'Groceries', color: colors.grocery, route: '/grocery', top: colors.groceryTop, mid: colors.groceryMid, fade: colors.groceryFade }, // i18n-ignore: English fallback data; screens show departmentName(t, id)
  { id: 'shops', label: 'Shops', color: colors.shops, route: '/shops', top: colors.shopsTop, mid: colors.shopsMid, fade: colors.shopsFade }, // i18n-ignore: English fallback data; screens show departmentName(t, id)
  { id: 'care', label: 'Pharmacy\n& Beauty', color: colors.beauty, route: '/care', top: colors.careTop, mid: colors.careMid, fade: colors.careFade }, // i18n-ignore: English fallback data; screens show departmentName(t, id)
  { id: 'book-it', label: 'Book It', color: colors.book, route: '/book-it', top: colors.bookTop, mid: colors.bookMid, fade: colors.bookFade }, // i18n-ignore: English fallback data; screens show departmentName(t, id)
] as const;
export type DepartmentId = typeof departments[number]['id'];
/** Each department's picture (Home's services, the Search and Discover chips), bundled so it shows offline and at once. */
export const departmentArt: Record<DepartmentId, number> = {
  food: require('../assets/images/departments/food.png'), grocery: require('../assets/images/departments/grocery.png'), shops: require('../assets/images/departments/shops.png'),
  care: require('../assets/images/departments/care.png'), 'book-it': require('../assets/images/departments/book-it.png'),
};
const NAME_KEYS = { food: 'departments.food.name', grocery: 'departments.grocery.name', shops: 'departments.shops.name', care: 'departments.care.name', 'book-it': 'departments.bookIt.name' } as const;
/** The department's name in the current language (the Care one keeps its line break). Unknown ids fall back to the English label. */
export function departmentName(t: TFunction, id: string): string {
  const key = (NAME_KEYS as Record<string, (typeof NAME_KEYS)[DepartmentId]>)[id];
  return key ? t(key) : departments.find(d => d.id === id)?.label ?? id;
}
export function inDepartment(value: string | undefined, department: string) { return department === 'care' ? value === 'pharmacy' || value === 'beauty' : value === department; }
export function paletteFor(path: string) {
  if (path.startsWith('/collection/')) { const p = storePalette(path.split('/')[2]); return { top: p.top, mid: p.soft, fade: p.soft, color: p.ink }; }
  const department = departments.find(d => d.route === path) || (['/pharmacy', '/beauty'].includes(path) ? departments.find(d => d.id === 'care') : undefined);
  if (department) return department;
  if (path === '/') return { top: colors.lime, mid: colors.cityMid, fade: colors.cityFade, color: colors.forest };
  return { top: colors.shopsMid, mid: colors.shopsFade, fade: colors.surface, color: colors.shops };
}