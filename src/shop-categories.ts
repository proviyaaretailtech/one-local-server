// The Categories page: groups of sub-categories, in their order there. Until the server serves this tree, each
// sub-category opens the catalogue category it matches (`category`).
// Each has a 3D cut-out icon in the style of Home's service tiles, bundled with the app.
import type { Product, Store } from './api';
import { departmentArt } from './departments';

export const CATEGORY_GROUPS = [
  { id: 'fresh', name: 'categories.group.fresh', items: [
    { id: 'vegetables', name: 'categories.sub.vegetables', icon: require('../assets/images/categories/vegetables.png'), category: 'c1' },
    { id: 'fruits', name: 'categories.sub.fruits', icon: require('../assets/images/categories/fruits.png'), category: 'c1' },
    { id: 'dairy-bread', name: 'categories.sub.dairyBread', icon: require('../assets/images/categories/dairy-bread.png'), category: 'c2' },
    { id: 'meat-seafood', name: 'categories.sub.meatSeafood', icon: require('../assets/images/categories/meat-seafood.png'), category: 'c33' },
  ] },
  { id: 'groceries', name: 'categories.group.groceries', items: [
    { id: 'atta-rice-dal', name: 'categories.sub.attaRiceDal', icon: require('../assets/images/categories/atta-rice-dal.png'), category: 'c25' },
    { id: 'masalas', name: 'categories.sub.masalas', icon: require('../assets/images/categories/masalas.png'), category: 'c34' },
    { id: 'oils-ghee', name: 'categories.sub.oilsGhee', icon: require('../assets/images/categories/oils-ghee.png'), category: 'c26' },
    { id: 'cereals', name: 'categories.sub.cereals', icon: require('../assets/images/categories/cereals.png'), category: 'c24' },
  ] },
  { id: 'beauty-wellness', name: 'categories.group.beautyWellness', items: [
    { id: 'bath-body', name: 'categories.sub.bathBody', icon: require('../assets/images/categories/bath-body.png'), category: 'c31' },
    { id: 'hair-skin', name: 'categories.sub.hairSkin', icon: require('../assets/images/categories/hair-skin.png'), category: 'c15' },
    { id: 'makeup', name: 'categories.sub.makeup', icon: require('../assets/images/categories/makeup.png'), category: 'c16' },
    { id: 'health-pharma', name: 'categories.sub.healthPharma', icon: require('../assets/images/categories/health-pharma.png'), category: 'c13' },
  ] },
  { id: 'household', name: 'categories.group.household', items: [
    { id: 'electronics', name: 'categories.sub.electronics', icon: require('../assets/images/categories/electronics.png'), category: 'c19' },
    { id: 'stationery', name: 'categories.sub.stationery', icon: require('../assets/images/categories/stationery.png'), category: 'c36' },
    { id: 'home-decor', name: 'categories.sub.homeDecor', icon: require('../assets/images/categories/home-decor.png'), category: 'c20' },
    { id: 'gifts-pooja', name: 'categories.sub.giftsPooja', icon: require('../assets/images/categories/gifts-pooja.png'), category: 'c22' },
  ] },
  { id: 'snacks-drinks', name: 'categories.group.snacksDrinks', items: [
    { id: 'chips-namkeen', name: 'categories.sub.chipsNamkeen', icon: require('../assets/images/categories/chips-namkeen.png'), category: 'c3' },
    { id: 'sweets-bakery', name: 'categories.sub.sweetsBakery', icon: require('../assets/images/categories/sweets-bakery.png'), category: 'c21' },
    { id: 'drinks-juices', name: 'categories.sub.drinksJuices', icon: require('../assets/images/categories/drinks-juices.png'), category: 'c4' },
    { id: 'ice-cream', name: 'categories.sub.iceCream', icon: require('../assets/images/categories/ice-cream.png'), category: 'c35' },
  ] },
  { id: 'other-picks', name: 'categories.group.otherPicks', items: [
    { id: 'fashion', name: 'categories.sub.fashion', icon: require('../assets/images/categories/fashion.png'), category: 'c18' },
    { id: 'travel-fitness', name: 'categories.sub.travelFitness', icon: require('../assets/images/categories/travel-fitness.png'), category: 'c28' },
    { id: 'kids', name: 'categories.sub.kids', icon: require('../assets/images/categories/kids.png'), category: 'c37' },
    { id: 'imported', name: 'categories.sub.imported', icon: require('../assets/images/categories/imported.png'), category: 'c38' },
  ] },
] as const satisfies readonly { id: string; name: string; items: readonly { id: string; name: string; icon: number; category: string }[] }[];

type Tile = { id: string; name: (typeof CATEGORY_GROUPS)[number]['items'][number]['name']; icon: number; category: string };
const TILES = CATEGORY_GROUPS.flatMap<Tile>(g => g.items);
/** A Categories tile by its id. */
export const categoryTile = (id: string | undefined) => TILES.find(item => item.id === id);
const tile = (id: string) => categoryTile(id)?.icon;
// The sample catalogue's categories with no Categories tile of their own get the nearest icon; its kinds of food get the
// Food tab's.
const NEAREST: Record<string, number | undefined> = {
  c5: tile('sweets-bakery'), c7: tile('bath-body'), c8: tile('home-decor'), c14: tile('bath-body'), c17: tile('hair-skin'),
  c23: tile('cereals'), c27: tile('health-pharma'), c32: tile('gifts-pooja'),
  c6: departmentArt.grocery, c30: departmentArt.grocery,
  c9: require('../assets/images/food/burgers.png'), c10: require('../assets/images/food/chicken-sides.png'),
  c11: require('../assets/images/food/coffee-drinks.png'), c12: require('../assets/images/food/pizza.png'),
  c29: require('../assets/images/food/coffee-drinks.png'),
  c39: require('../assets/images/food/thali.png'), c40: require('../assets/images/food/street-food.png'),
  c41: require('../assets/images/food/desserts.png'),
};
/** A catalogue category's icon: its Categories tile's, else the nearest one. None (a live shop's own category): show its
 *  photo instead. */
export const categoryIcon = (category: string): number | undefined => TILES.find(item => item.category === category)?.icon ?? NEAREST[category];

/** The shops with any of `products`, in the order the shops come, each with its own (in the order given). */
export function byShop(products: readonly Product[], stores: readonly Store[]) {
  return stores.flatMap(store => { const own = products.filter(p => p.store_id === store.id); return own.length ? [{ store, products: own }] : []; });
}
