// Food: the brand header on a wash of the food colour, the kinds of food to pick from, ads for featured restaurants that
// move on by themselves, the well-known kitchens in two rows under a line about them, then every restaurant as a card.
import { useMemo } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Quote } from 'lucide-react-native';
import { Text } from '@/src/ui/text';
import { Tap } from '@/src/components/tap';
import { BrandHeader } from '@/src/components/brand-header';
import { AdCarousel } from '@/src/components/ad-carousel';
import { RestaurantCard } from '@/src/components/restaurant-card';
import { ExploreTown } from '@/src/components/explore-town';
import { LoadState } from '@/src/components/catalog-sections';
import { colors, goldIconShadow, listTints } from '@/src/theme';
import { logoSize, logoTile } from '@/src/logo-tile';
import { storeBanner } from '@/src/api';
import { CityScroll } from '@/src/motion';
import { useBrowseCatalog } from '@/src/use-catalog';
import { useStores } from '@/src/use-stores';
import { useScreenPalette } from '@/src/use-screen-path';
import { useDeliveryLocation } from '@/src/delivery-location';
import { byShop, categoryIcon } from '@/src/shop-categories';
import { useFormat, useTranslation } from '@/src/i18n';
import { useLineHeight } from '@/src/layout';

const SIDE = 16;
const FEATURED = 6; // restaurants in the ads (the catalogue has no ads feed yet, so the first ones with a photo)

export default function Food() {
  // Outside our delivery cities, Food shows the town's real local places.
  const { coverage } = useDeliveryLocation();
  if (coverage && coverage.level !== 'live') return <ExploreTown initial="food" />;
  return <LiveFood />;
}

function LiveFood() {
  const { data, isError, refetch } = useBrowseCatalog(); const stores = useStores(); const router = useRouter(); const palette = useScreenPalette(); const { t } = useTranslation(); const lineHeight = useLineHeight(); const fmt = useFormat();
  // Every restaurant with its dishes and its best offer (%).
  const restaurants = useMemo(() => data ? byShop(data.products.filter(p => p.department === 'food'), stores).map(r => ({ ...r, offer: Math.max(0, ...r.products.map(p => p.discount_pct ?? 0)) })) : [], [data, stores]);
  if (!data) return <LoadState error={isError} retry={refetch} />;
  // A delivery city with no restaurants in the catalogue yet: show what's around instead.
  if (!restaurants.length) return <ExploreTown initial="food" empty />;
  const kinds = data.categories.filter(c => c.department === 'food');
  const tints = listTints(restaurants.map(r => r.store.id));
  // Two to a column, so the brands scroll sideways in two rows.
  const pairs = Array.from({ length: Math.ceil(restaurants.length / 2) }, (_, n) => restaurants.slice(n * 2, n * 2 + 2));
  return <CityScroll testID="department-screen-food" bleed showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, { backgroundColor: palette.fade }]}>
    {/* A wash of the food colour, settling into the page's soft peach, which the restaurant cards rise out of. */}
    <LinearGradient pointerEvents="none" colors={[palette.top, palette.mid, palette.fade]} locations={[0, 0.5, 1]} style={s.wash} />
    <BrandHeader tone="light" />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.kinds}>
      {kinds.map(c => <Tap key={c.id} testID={`food-kind-${c.id}`} accessibilityRole="button" accessibilityLabel={c.name} onPress={() => router.push(`/category/shops/${c.id}`)} style={s.kind}>
        <View style={goldIconShadow}><Image source={categoryIcon(c.id) ?? c.image} style={s.kindIcon} contentFit="contain" cachePolicy="memory-disk" /></View>
        <Text numberOfLines={2} style={[s.kindName, { lineHeight: lineHeight(12, 15) }]}>{c.name}</Text>
      </Tap>)}
    </ScrollView>
    <AdCarousel slides={restaurants.filter(r => storeBanner(r.store)).slice(0, FEATURED)} accent={palette.color} />
    <View style={s.quote}>
      <Quote size={22} color={palette.color} fill={palette.color} strokeWidth={0} />
      <Text style={s.quoteText}>{t('foodPage.quote')}</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.brands}>
      {pairs.map(pair => <View key={pair[0].store.id} style={s.brandColumn}>
        {pair.map(({ store }) => <Tap key={store.id} testID={`food-brand-${store.id}`} accessibilityRole="button" accessibilityLabel={t('home.shopStore', { name: store.name })} onPress={() => router.push(`/store/${store.id}`)} style={s.brand}>
          <View style={s.brandLogo}>{!!store.logo && <Image source={store.logo} style={s.brandImage} contentFit="contain" />}</View>
          <Text numberOfLines={2} style={[s.brandName, { lineHeight: lineHeight(12, 15) }]}>{store.name}</Text>
        </Tap>)}
      </View>)}
    </ScrollView>
    <Text testID="food-count" style={s.count}>{t('foodPage.count', { count: restaurants.length, value: fmt.number(restaurants.length) })}</Text>
    {restaurants.map(({ store, products, offer }, n) => <RestaurantCard key={store.id} store={store} dishes={products} offer={offer} tint={tints[n]} surface={palette.fade} shade={colors.neuShadeWarm} />)}
  </CityScroll>;
}

const s = StyleSheet.create({
  content: { paddingBottom: 24 },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 480 },
  kinds: { paddingHorizontal: SIDE, paddingTop: 16, paddingBottom: 20, gap: 14 },
  kind: { width: 72, alignItems: 'center', gap: 8 },
  kindIcon: { width: 64, height: 64, borderRadius: 16 },
  kindName: { fontSize: 12, lineHeight: 15, minHeight: 30, fontWeight: '600', textAlign: 'center', color: colors.onSurface },
  quote: { flexDirection: 'row', gap: 10, paddingHorizontal: SIDE, marginTop: 30, marginBottom: 16 },
  quoteText: { flex: 1, fontSize: 19, lineHeight: 26, fontWeight: '800', letterSpacing: -0.3, color: colors.onSurface },
  brands: { paddingHorizontal: SIDE, gap: 14 },
  brandColumn: { gap: 16 },
  brand: { width: 84, alignItems: 'center', gap: 8 },
  brandLogo: logoTile(68),
  brandImage: { width: logoSize(68), height: logoSize(68) },
  brandName: { fontSize: 12, lineHeight: 15, minHeight: 30, fontWeight: '600', textAlign: 'center', color: colors.onSurface },
  count: { marginTop: 32, marginBottom: 16, paddingHorizontal: SIDE, fontSize: 13, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', color: colors.muted },
});
