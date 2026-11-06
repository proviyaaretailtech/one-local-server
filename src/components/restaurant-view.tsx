// A restaurant's page (shops have their own, app/store/[id].tsx). Its photo up top, held in place while the menu's white
// sheet slides over it, with round buttons floating above (back, search the menu, follow). On the sheet: its name in its
// own colour, rating, line, delivery time and best offer, filter chips, then the menu section by section (its best offers
// first, each section folding away), every dish a row with its picture and the app's "+". A Menu button jumps to a section.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { Text, TextInput } from '../ui/text';
import { Tap } from './tap';
import { AddToCart } from './add-to-cart';
import { HeartToggle } from './motion/heart-toggle';
import { colors, nameTints, nameTintIndex, photoIconShadow, radius, soft } from '../theme';
import { nativeDriver, useMotionAllowed } from '../motion';
import { useFollowedStores } from '../followed';
import { useSavedProducts } from '../customer';
import { useFormat, useTranslation } from '../i18n';
import { storeBanner, type Category, type Product, type Store } from '../api';

const SIDE = 16;
const HERO = 250; // the photo's height below the status bar
const BAR = 56; // the floating buttons' row
const OVERLAP = 24; // how far the sheet rises over the photo
const DEALS = 4; // dishes in the best-offers section
const BUDGET = 149; // the "Under ₹149" filter
const RATED = 4.6; // the "Highest rated" filter
type Filter = 'offers' | 'budget' | 'rated';

export function RestaurantView({ store, products, categories }: { store: Store; products: Product[]; categories: Category[] }) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const focused = useIsFocused(); const { t } = useTranslation(); const fmt = useFormat();
  const { isFollowing, toggle } = useFollowedStores(); const [wash, ink] = nameTints[nameTintIndex(store.id)];
  const [searching, setSearching] = useState(false); const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ReadonlySet<Filter>>(new Set()); const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false); const [reading, setReading] = useState<string>(); const [menu] = useState(() => new Animated.Value(0));
  const motion = useMotionAllowed(); const scrolled = useRef(0);
  const scroll = useRef<ScrollView>(null); const sheetY = useRef(0); const sectionY = useRef<Record<string, number>>({});
  const [scrollY] = useState(() => new Animated.Value(0)); const [sheetUp, setSheetUp] = useState(false);
  const heroHeight = insets.top + HERO; const barBottom = insets.top + BAR;
  const best = Math.max(0, ...products.map(p => p.discount_pct ?? 0)); const onOffer = products.filter(p => (p.discount_pct ?? 0) > 0).length;
  const sections = useMemo(() => {
    const names = new Map(categories.map(c => [c.id, c.name]));
    const shown = products.filter(p => (!query || p.name.toLowerCase().includes(query.toLowerCase()))
      && (!filters.has('offers') || (p.discount_pct ?? 0) > 0) && (!filters.has('budget') || p.price < BUDGET) && (!filters.has('rated') || p.rating >= RATED));
    const deals = shown.filter(p => (p.discount_pct ?? 0) > 0).sort((a, b) => (b.discount_pct ?? 0) - (a.discount_pct ?? 0)).slice(0, DEALS);
    const kinds = Array.from(new Set(shown.map(p => p.category_id)), id => ({ id, title: names.get(id) ?? id, dishes: shown.filter(p => p.category_id === id) }));
    // The best offers lead the menu, except while searching (the dishes are then listed once, in their own sections).
    return deals.length && !query ? [{ id: 'deals', title: t('foodPage.offer', { pct: fmt.percent(deals[0].discount_pct ?? 0) }), dishes: deals }, ...kinds] : kinds;
  }, [products, categories, query, filters, t, fmt]);
  const flip = <T,>(set: ReadonlySet<T>, key: T) => { const next = new Set(set); if (!next.delete(key)) next.add(key); return next; };
  // Where each section starts in the scroll, so the menu can mark the one being read and jump to any.
  const sectionTop = (id: string) => sheetY.current + (sectionY.current[id] ?? 0) - barBottom;
  const openMenu = () => {
    setReading(sections.reduce((at, section) => sectionTop(section.id) <= scrolled.current + 24 ? section.id : at, sections[0]?.id));
    setMenuOpen(true); menu.setValue(motion ? 0 : 1);
    if (motion) Animated.spring(menu, { toValue: 1, speed: 16, bounciness: 5, useNativeDriver: nativeDriver }).start();
  };
  const closeMenu = () => {
    if (!motion) { setMenuOpen(false); return; }
    Animated.timing(menu, { toValue: 0, duration: 140, useNativeDriver: nativeDriver }).start(() => setMenuOpen(false));
  };
  const jump = (id: string) => {
    closeMenu(); setFolded(f => { const next = new Set(f); next.delete(id); return next; });
    scroll.current?.scrollTo({ y: sectionTop(id), animated: true });
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setSheetUp(e.nativeEvent.contentOffset.y > heroHeight - OVERLAP - barBottom - 12);
  useEffect(() => { const id = scrollY.addListener(({ value }) => { scrolled.current = value; }); return () => scrollY.removeListener(id); }, [scrollY]);
  const chips: { id: Filter; label: string }[] = [
    { id: 'offers', label: t('category.filterOffers') }, { id: 'budget', label: t('category.filterBudget', { price: fmt.money(BUDGET) }) }, { id: 'rated', label: t('category.sortRating') },
  ];
  return <View testID="store-screen" style={s.screen}>
    {/* Light over the photo; dark once the white bar has faded in under the status bar. */}
    {focused && <StatusBar style={sheetUp ? 'dark' : 'light'} />}
    {/* A white bar behind the floating buttons, fading in as the sheet slides up under them. */}
    <Animated.View pointerEvents="none" style={[s.band, { height: barBottom + 8, opacity: scrollY.interpolate({ inputRange: [heroHeight - OVERLAP - barBottom - 40, heroHeight - OVERLAP - barBottom], outputRange: [0, 1], extrapolate: 'clamp' }) }]} />
    <View style={[s.bar, { top: insets.top + 8 }]}>
      <Tap testID="back-btn" accessibilityRole="button" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={s.round}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Tap>
      {searching
        ? <View style={s.search}>
            <Icon name="search-outline" size={17} color={colors.muted} />
            <TextInput testID="menu-search" autoFocus value={query} onChangeText={setQuery} placeholder={t('restaurant.search')} placeholderTextColor={colors.muted} returnKeyType="search" style={s.searchInput} />
            <Tap testID="menu-search-close" accessibilityRole="button" accessibilityLabel={t('category.closeSearch')} haptic={false} hitSlop={8} onPress={() => { setQuery(''); setSearching(false); }}><Icon name="close" size={18} color={colors.onSurface} /></Tap>
          </View>
        : <Tap testID="menu-search-open" accessibilityRole="button" accessibilityLabel={t('restaurant.search')} onPress={() => setSearching(true)} style={s.search}><Icon name="search-outline" size={17} color={colors.onSurface} /><Text style={s.searchText}>{t('restaurant.search')}</Text></Tap>}
      <HeartToggle testID="follow-btn" accessibilityLabel={isFollowing(store.id) ? t('store.following') : t('store.follow')} accessibilityState={{ selected: isFollowing(store.id) }} saved={isFollowing(store.id)} onToggle={() => toggle(store.id)} style={s.round} size={20} color={colors.onSurface} savedColor={colors.onError} />
    </View>

    <Animated.ScrollView ref={scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: nativeDriver, listener: onScroll })}>
      {/* Above the top edge, so pulling the page down (iOS bounce) shows the restaurant's colour, not white. */}
      <View style={[s.pullFill, { backgroundColor: ink }]} />
      {/* Held in place as the page scrolls, so the sheet slides up over it; pulling down past the top moves it with the page. */}
      <Animated.View style={{ height: heroHeight, backgroundColor: ink, transform: [{ translateY: scrollY.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' }) }] }}>
        <Image source={storeBanner(store) ?? products[0]?.image} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient pointerEvents="none" colors={[colors.overlay, 'transparent']} style={[s.scrim, { height: barBottom + 40 }]} />
      </Animated.View>

      <View style={s.sheet} onLayout={e => { sheetY.current = e.nativeEvent.layout.y; }}>
        <View style={s.grabber} />
        <View style={s.head}>
          <View style={s.titleRow}>
            <Text testID="restaurant-name" numberOfLines={2} style={[s.name, { color: ink }]}>{store.name}</Text>
            <View style={[s.rating, { backgroundColor: ink }]}><Icon name="star" size={13} color={colors.surface} /><Text style={s.ratingText}>{fmt.number(store.rating, { maxFractionDigits: 1 })}</Text></View>
          </View>
          {!!store.tagline && <Text style={s.tagline}>{store.tagline}</Text>}
          <View style={s.timeRow}><Icon name="flash" size={14} color={colors.forest} /><Text style={s.time}>{fmt.deliveryTime(store.delivery_time)}</Text></View>
        </View>
        {best > 0 && <View testID="restaurant-offer" style={[s.offerBox, { backgroundColor: wash }]}>
          <View style={s.offerTag}><Icon name="pricetag" size={12} color={colors.forestDeep} /><Text style={s.offerTagText}>{t('foodPage.offer', { pct: fmt.percent(best) })}</Text></View>
          <Text style={[s.offerOn, { color: ink }]}>{t('restaurant.onDishes', { count: onOffer, value: fmt.number(onOffer) })}</Text>
        </View>}
        <View style={s.gap} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {chips.map(c => { const on = filters.has(c.id);
            return <Tap key={c.id} testID={`menu-filter-${c.id}`} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setFilters(f => flip(f, c.id))} style={[s.chip, on && { backgroundColor: wash, borderColor: ink }]}>
              {on && <Icon name="checkmark" size={14} color={ink} />}<Text style={[s.chipText, on && { color: ink }]}>{c.label}</Text>
            </Tap>; })}
        </ScrollView>
        <View style={s.rule} />
        {sections.length ? sections.map(section => { const open = !folded.has(section.id);
          return <View key={section.id} testID={`menu-section-${section.id}`} onLayout={e => { sectionY.current[section.id] = e.nativeEvent.layout.y; }}>
            <Tap accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={section.title} haptic={false} onPress={() => setFolded(f => flip(f, section.id))} style={s.sectionHead}>
              <Text style={s.sectionTitle}>{section.title}</Text><Text style={s.sectionCount}>{fmt.number(section.dishes.length)}</Text>
              <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.onSurface} />
            </Tap>
            {open && section.dishes.map(dish => <DishRow key={dish.id} dish={dish} ink={ink} scope={`${section.id}-${dish.id}`} />)}
            <View style={s.gap} />
          </View>; })
          : <Text testID="menu-empty" style={s.empty}>{t('category.empty')}</Text>}
      </View>
    </Animated.ScrollView>

    {/* The menu grows out of its button's corner: a dark card listing the sections, the one being read marked, over a dimmed page. */}
    {menuOpen && <>
      <Animated.View style={[StyleSheet.absoluteFill, s.dim, { opacity: menu }]}><Pressable testID="menu-backdrop" accessibilityLabel={t('common.close')} onPress={() => closeMenu()} style={StyleSheet.absoluteFill} /></Animated.View>
      <Animated.View testID="menu-sheet" style={[s.menuCard, { opacity: menu, transform: [{ translateY: menu.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { scale: menu.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
        <Text style={s.menuTitle}>{t('restaurant.menu')}</Text>
        <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
          {sections.map((section, n) => { const on = section.id === reading; const from = Math.min(0.6, n * 0.08);
            return <Animated.View key={section.id} style={{ opacity: menu.interpolate({ inputRange: [from, 1], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ translateX: menu.interpolate({ inputRange: [from, 1], outputRange: [14, 0], extrapolate: 'clamp' }) }] }}>
              <Tap testID={`menu-jump-${section.id}`} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => jump(section.id)} style={[s.menuRow, on && s.menuRowOn]}>
                <View style={[s.menuDot, on && s.menuDotOn]} />
                <Text numberOfLines={1} style={[s.menuRowText, on && s.menuRowTextOn]}>{section.title}</Text>
                <Text style={s.menuRowCount}>{fmt.number(section.dishes.length)}</Text>
              </Tap>
            </Animated.View>; })}
        </ScrollView>
      </Animated.View>
    </>}
    {sections.length > 1 && <Tap testID="menu-open" accessibilityRole="button" accessibilityLabel={menuOpen ? t('common.close') : t('restaurant.menu')} accessibilityState={{ expanded: menuOpen }} onPress={() => menuOpen ? closeMenu() : openMenu()} style={s.menuButton}>
      <Icon name={menuOpen ? 'close' : 'restaurant-outline'} size={16} color={colors.surface} /><Text style={s.menuButtonText}>{menuOpen ? t('common.close') : t('restaurant.menu')}</Text>
    </Tap>}
  </View>;
}

// One dish: its offer, name, price, size and rating beside its picture, which carries a heart and the "+".
function DishRow({ dish, ink, scope }: { dish: Product; ink: string; scope: string }) {
  const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat(); const { saved, toggleSaved, ready } = useSavedProducts();
  const isSaved = saved.includes(dish.id); const open = () => router.push(`/product/${dish.id}`);
  return <View testID={`dish-${scope}`} style={s.dish}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('product.viewItemDetails', { name: dish.name })} onPress={open} style={s.dishInfo}>
      {!!dish.discount_pct && <View style={s.dishOff}><Text style={s.dishOffText}>{t('product.off', { pct: fmt.percent(dish.discount_pct) })}</Text></View>}
      <Text numberOfLines={2} style={s.dishName}>{dish.name}</Text>
      <View style={s.prices}><Text style={s.price}>{fmt.money(dish.price)}</Text>{dish.mrp > dish.price && <Text style={s.mrp}>{fmt.money(dish.mrp)}</Text>}</View>
      <View style={s.dishMeta}><Text style={s.pack}>{dish.weight}</Text><View style={s.dot} /><Icon name="star" size={12} color={colors.gold} /><Text style={s.pack}>{fmt.number(dish.rating, { maxFractionDigits: 1 })}</Text></View>
    </Pressable>
    <View style={s.picture}>
      <Tap accessibilityLabel={t('product.viewItem', { name: dish.name })} haptic={false} onPress={open} style={s.pictureTap}><Image source={dish.image} style={s.pictureImage} contentFit="cover" /></Tap>
      <HeartToggle disabled={!ready} accessibilityLabel={isSaved ? t('product.unsaveItem', { name: dish.name }) : t('product.saveItem', { name: dish.name })} accessibilityState={{ selected: isSaved }} saved={isSaved} onToggle={() => { void toggleSaved(dish.id).catch(() => {}); }} hitSlop={8} style={s.heart} size={18} color={colors.surface} savedColor={colors.onError} />
      <View style={s.add}><AddToCart product={dish} id={scope} tint={ink} /></View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  band: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9, backgroundColor: colors.surface, boxShadow: soft.lifted },
  bar: { position: 'absolute', left: SIDE, right: SIDE, zIndex: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, boxShadow: soft.lifted },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface, boxShadow: soft.lifted },
  searchText: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  searchInput: { flex: 1, height: 40, paddingVertical: 0, fontSize: 14, color: colors.onSurface }, // Android pads inputs by default; at 40 tall that clips the text
  pullFill: { position: 'absolute', top: -600, height: 600, left: 0, right: 0 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  // Above the held-in-place photo, which it slides over.
  sheet: { zIndex: 1, marginTop: -OVERLAP, paddingTop: 10, paddingBottom: 96, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: 14, backgroundColor: colors.border },
  head: { paddingHorizontal: SIDE, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  name: { flex: 1, fontSize: 26, lineHeight: 31, fontWeight: '800', letterSpacing: -0.5 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, paddingHorizontal: 10, minHeight: 30, borderRadius: radius.pill },
  ratingText: { fontSize: 14, fontWeight: '800', color: colors.surface },
  tagline: { fontSize: 14, lineHeight: 20, color: colors.muted },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  time: { fontSize: 14, fontWeight: '700', color: colors.forest },
  offerBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: SIDE, marginTop: 14, padding: 10, borderRadius: radius.md },
  offerTag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.electricLime },
  offerTagText: { fontSize: 12, fontWeight: '800', color: colors.forestDeep },
  offerOn: { flex: 1, fontSize: 13, fontWeight: '700' },
  gap: { height: 8, marginTop: 16, backgroundColor: colors.surfaceSecondary },
  chips: { paddingHorizontal: SIDE, paddingVertical: 12, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: SIDE, paddingTop: 20, paddingBottom: 6 },
  sectionTitle: { flexShrink: 1, fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.3, color: colors.onSurface },
  sectionCount: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.muted },
  dish: { flexDirection: 'row', gap: 14, paddingHorizontal: SIDE, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  dishInfo: { flex: 1, gap: 5, alignItems: 'flex-start' },
  dishOff: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.electricLime },
  dishOffText: { fontSize: 10, fontWeight: '800', color: colors.forestDeep },
  dishName: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: colors.onSurface },
  prices: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  price: { fontSize: 16, fontWeight: '800', color: colors.onSurface },
  mrp: { fontSize: 12, color: colors.muted, textDecorationLine: 'line-through' },
  dishMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pack: { fontSize: 12, color: colors.muted },
  dot: { width: 3, height: 3, borderRadius: 2, marginHorizontal: 3, backgroundColor: colors.muted },
  picture: { width: 124, height: 124 },
  pictureTap: { flex: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.cream },
  pictureImage: { width: '100%', height: '100%' },
  // Just the heart on the photo, its shadow in its own shape so it reads on light and dark pictures alike.
  heart: { position: 'absolute', top: 4, right: 4, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', ...photoIconShadow },
  add: { position: 'absolute', right: 6, bottom: 6 },
  empty: { paddingHorizontal: 32, paddingVertical: 40, fontSize: 14, textAlign: 'center', color: colors.muted },
  menuButton: { position: 'absolute', right: SIDE, bottom: 24, zIndex: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 42, borderRadius: radius.pill, backgroundColor: colors.onSurface, boxShadow: soft.lifted },
  menuButtonText: { fontSize: 14, fontWeight: '800', color: colors.surface },
  dim: { zIndex: 11, backgroundColor: colors.overlay },
  // Above the button, growing out of its corner.
  menuCard: { position: 'absolute', right: SIDE, bottom: 24 + 42 + 10, zIndex: 12, width: 248, maxHeight: 380, padding: 8, borderRadius: radius.lg, backgroundColor: colors.onSurface, boxShadow: soft.lifted, transformOrigin: 'bottom right' },
  menuTitle: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, fontSize: 11, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', color: colors.surface, opacity: 0.55 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 12, borderRadius: radius.md },
  menuRowOn: { backgroundColor: colors.whiteGlass },
  menuDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.whiteGlassLine },
  menuDotOn: { backgroundColor: colors.electricLime },
  menuRowText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.surface, opacity: 0.85 },
  menuRowTextOn: { fontWeight: '800', opacity: 1 },
  menuRowCount: { fontSize: 13, fontWeight: '700', color: colors.surface, opacity: 0.55 },
});
