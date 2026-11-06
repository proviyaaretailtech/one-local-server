import { startTransition, useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Platform, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { colors, radius } from '@/src/theme';
import { useBrowseCatalog } from '@/src/use-catalog';
import { useStores } from '@/src/use-stores';
import { useRevealed } from '@/src/use-revealed';
import { HOME_HERO_OVERLAP, HomeHero } from '@/src/components/home-hero';
import { CityScroll } from '@/src/motion';
import { LoadState, ProductRail, SectionTitle } from '@/src/components/catalog-sections';
import { ShopList } from '@/src/components/shop-section';
import { ExploreTown } from '@/src/components/explore-town';
import { byShop } from '@/src/shop-categories';
import { useDeliveryLocation } from '@/src/delivery-location';
import { useTranslation } from '@/src/i18n';

// Sponsored placements. Products carry no sponsored flag yet, so this hand-picked list stands in until the server sends them.
const SPOTLIGHT = ['audio1', 'b2', 'f5', 'sneak1', 'sp1', 'sc3', 'f2', 'sf6', 'sn2', 'home1', 'sp6', 'se6'];
// Shops drawn with the page, then a few more just after, then more whenever a scroll settles near the end: mounting
// every shop at once (hundreds of cards and photos) froze the first scroll. The web has no scroll-end events, so there
// all of them follow the first frame, as before.
const FIRST_SHOPS = 3;
const MORE_SHOPS = 6;

export default function HomeScreen() {
  // Outside our delivery cities, home becomes the town's real local places.
  const { coverage } = useDeliveryLocation();
  if (coverage && coverage.level !== 'live') return <ExploreTown />;
  return <LiveHome />;
}

function LiveHome() {
  const { data, isLoading, isError, refetch } = useBrowseCatalog(); const stores = useStores(); const { t } = useTranslation(); const revealed = useRevealed();
  const [count, setCount] = useState(FIRST_SHOPS + MORE_SHOPS);
  const more = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height * 3 > contentSize.height) startTransition(() => setCount(c => c + MORE_SHOPS));
  }, []);
  // Worked out only when the catalogue or the shops change, so a re-render of the page (a tab switch, fresh data
  // elsewhere) hands the memoised sections the same arrays.
  const spotlight = useMemo(() => data ? SPOTLIGHT.flatMap(id => data.products.filter(p => p.id === id)) : [], [data]);
  // Each shop's items best rated first (products carry no order counts yet); its card shows the first few of what is picked.
  const shops = useMemo(() => data ? byShop([...data.products].sort((a, b) => b.rating - a.rating), stores) : [], [data, stores]);
  if (isLoading || !data) return <LoadState error={isError} retry={refetch} />;
  // A delivery city with no stores in the catalogue yet: show what's around instead of empty rails.
  if (!data.products.length) return <ExploreTown empty />;
  const shown = !revealed ? FIRST_SHOPS : Platform.OS === 'web' ? shops.length : count;
  return <CityScroll testID="home-screen" bleed showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} onScrollEndDrag={more} onMomentumScrollEnd={more}>
    <HomeHero />
    {/* Solid white, rising over the hero's bottom edge so its rounded top corners are drawn on the backdrop. */}
    <View style={styles.sheet}>
      <SectionTitle id="home-spotlight" title={t('home.spotlight.title')} subtitle={t('home.spotlight.subtitle')} />
      <ProductRail products={spotlight} scope="spotlight" rows={2} />
      <ShopList shops={shops.slice(0, shown)} categories={data.categories} scope="home-shop" />
    </View>
  </CityScroll>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 20 }, sheet: { marginTop: -HOME_HERO_OVERLAP, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: 1, overflow: 'hidden' },
});
