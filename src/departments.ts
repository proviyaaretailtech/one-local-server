import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { colors } from './theme';
import { storePalette } from './store-palettes';
export const departments = [
  { id: 'food', label: 'Food', icon: 'fast-food-outline', color: colors.food, soft: colors.foodSoft, image: 'burger', route: '/food', title: 'Good food.\nGreat little moments.', subtitle: 'Fresh cravings, served your way.', eyebrow: 'THE FOOD EDIT', filters: ['All', 'Burgers', 'Pizza', 'Coffee', 'Chicken'], top: colors.foodTop, mid: colors.foodMid, fade: colors.foodFade }, // i18n-ignore: English fallback data; screens show departmentName(t, id) / departmentFilterLabel(t, filter)
  { id: 'grocery', label: 'Groceries', icon: 'basket-outline', color: colors.grocery, soft: colors.groceryFade, image: 'amul-cutout', route: '/grocery', title: 'Little slices.\nBig happiness.', subtitle: 'Everyday goodness, from Amul.', eyebrow: 'FRESH FINDS, EVERY DAY', filters: ['All', 'Fruits & Veggies', 'Dairy & Eggs', 'Snacks', 'Bakery'], top: colors.groceryTop, mid: colors.groceryMid, fade: colors.groceryFade }, // i18n-ignore: English fallback data; screens show departmentName(t, id) / departmentFilterLabel(t, filter)
  { id: 'shops', label: 'Shops', icon: 'storefront-outline', color: colors.shops, soft: colors.shopsFade, image: 'sneakers', route: '/shops', title: 'Your next\n“I love that” find.', subtitle: 'Style, sound & little things for home.', eyebrow: 'THE CITY SHOPPING EDIT', filters: ['All', 'Fashion', 'Electronics', 'Homeware'], top: colors.shopsTop, mid: colors.shopsMid, fade: colors.shopsFade }, // i18n-ignore: English fallback data; screens show departmentName(t, id) / departmentFilterLabel(t, filter)
  { id: 'care', label: 'Pharmacy\n& Beauty', icon: 'sparkles-outline', color: colors.beauty, soft: colors.beautySoft, image: 'skincare', route: '/care', title: 'Feel good.\nGlow a little.', subtitle: 'A softer kind of everyday care.', eyebrow: 'CARE COMES FIRST', filters: ['All', 'Wellness', 'Hygiene', 'Skincare', 'Makeup', 'Haircare'], top: colors.careTop, mid: colors.careMid, fade: colors.careFade }, // i18n-ignore: English fallback data; screens show departmentName(t, id) / departmentFilterLabel(t, filter)
  { id: 'book-it', label: 'Book It', icon: 'ticket-outline', color: colors.book, soft: colors.bookSoft, image: 'concert', route: '/book-it', title: 'Less scrolling.\nMore living.', subtitle: 'Movies, live music & little adventures.', eyebrow: 'MAKE ROOM FOR GOOD TIMES', filters: ['All', 'Movies', 'Events', 'Activities'], top: colors.bookTop, mid: colors.bookMid, fade: colors.bookFade }, // i18n-ignore: English fallback data; screens show departmentName(t, id) / departmentFilterLabel(t, filter)
] as const;
export type DepartmentId = typeof departments[number]['id'];
const NAME_KEYS = { food: 'departments.food.name', grocery: 'departments.grocery.name', shops: 'departments.shops.name', care: 'departments.care.name', 'book-it': 'departments.bookIt.name' } as const;
/** The department's name in the current language (the Care one keeps its line break). Unknown ids fall back to the English label. */
export function departmentName(t: TFunction, id: string): string {
  const key = (NAME_KEYS as Record<string, (typeof NAME_KEYS)[DepartmentId]>)[id];
  return key ? t(key) : departments.find(d => d.id === id)?.label ?? id;
}
/** const name = useDepartmentName(); name('food') */
export function useDepartmentName() { const { t } = useTranslation(); return (id: string) => departmentName(t, id); }
// The filter chips keep their English word as the CODE (it filters the catalogue and builds test ids); only the shown label is translated.
const FILTER_KEYS = {
  Burgers: 'departments.filters.burgers', Pizza: 'departments.filters.pizza', Coffee: 'departments.filters.coffee', Chicken: 'departments.filters.chicken',
  'Fruits & Veggies': 'departments.filters.fruitsVeggies', 'Dairy & Eggs': 'departments.filters.dairyEggs', Snacks: 'departments.filters.snacks', Bakery: 'departments.filters.bakery',
  Fashion: 'departments.filters.fashion', Electronics: 'departments.filters.electronics', Homeware: 'departments.filters.homeware',
  Wellness: 'departments.filters.wellness', Hygiene: 'departments.filters.hygiene', Skincare: 'departments.filters.skincare', Makeup: 'departments.filters.makeup', Haircare: 'departments.filters.haircare',
  Explore: 'departments.filters.explore', Movies: 'departments.filters.movies', Events: 'departments.filters.events', Activities: 'departments.filters.activities',
} as const;
/** The shown label of a filter chip ('All' and any code we have no word for are handled: All is common.all, the rest show as written). */
export function departmentFilterLabel(t: TFunction, filter: string): string {
  if (filter === 'All') return t('common.all');
  const key = (FILTER_KEYS as Record<string, (typeof FILTER_KEYS)[keyof typeof FILTER_KEYS]>)[filter];
  return key ? t(key) : filter;
}
export function inDepartment(value: string | undefined, department: string) { return department === 'care' ? value === 'pharmacy' || value === 'beauty' : value === department; }
export function paletteFor(path: string) {
  if (path.startsWith('/collection/')) { const p = storePalette(path.split('/')[2]); return { top: p.top, mid: p.soft, fade: p.soft, color: p.ink }; }
  const department = departments.find(d => d.route === path) || (['/pharmacy', '/beauty'].includes(path) ? departments.find(d => d.id === 'care') : undefined);
  if (department) return department;
  if (path === '/') return { top: colors.lime, mid: colors.cityMid, fade: colors.cityFade, color: colors.forest };
  return { top: colors.shopsMid, mid: colors.shopsFade, fade: colors.surface, color: colors.shops };
}