// Picking a shop for a catalogue category: the category's icon and how many shops have it, then a card for each shop (most
// items first) raised out of the page in soft neumorphism: its logo and name, a strip of what it has in the category on
// its own tint, and how many on a badge (in its own colour) at the card's corner. A card opens the category at that shop.
import { useMemo } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { Text } from '@/src/ui/text';
import { IconTile } from '@/src/ui/icon-tile';
import { Tap } from '@/src/components/tap';
import { LoadState } from '@/src/components/catalog-sections';
import { colors, lightPane, listTints, neu, neuWell, radius } from '@/src/theme';
import { logoSize, logoTile } from '@/src/logo-tile';
import { useBrowseCatalog } from '@/src/use-catalog';
import { useStores } from '@/src/use-stores';
import { useScreenPalette } from '@/src/use-screen-path';
import { byShop, categoryTile } from '@/src/shop-categories';
import { useFormat, useTranslation } from '@/src/i18n';
import { useMotionAllowed } from '@/src/motion';
import { duration, reEasing, stagger } from '@/src/motion-tokens';
import Reanimated, { FadeInDown } from 'react-native-reanimated';

const SIDE = 16;
const THUMBS = 4; // items shown on a card; its badge counts them all
const RISE_IN = 4;

export default function CategoryShops() {
  const { id, tile: tileId } = useLocalSearchParams<{ id: string; tile?: string }>(); const router = useRouter(); const insets = useSafeAreaInsets(); const palette = useScreenPalette();
  const { data, isError, refetch } = useBrowseCatalog(); const stores = useStores(); const { t } = useTranslation(); const fmt = useFormat(); const motion = useMotionAllowed();
  const shops = useMemo(() => data ? byShop(data.products.filter(p => p.category_id === id), stores).sort((a, b) => b.products.length - a.products.length) : [], [data, stores, id]);
  if (!data) return <LoadState error={isError} retry={refetch} />;
  // Opened from a Categories tile: that tile's own name and 3D icon. Several tiles can share one catalogue category, and a
  // server's catalogue may lack a tile's category or name it differently, so the catalogue's name is only for other ways in.
  const tile = categoryTile(tileId);
  const name = tile ? t(tile.name) : data.categories.find(c => c.id === id)?.name ?? t('category.notFound');
  const icon = tile?.icon;
  const tints = listTints(shops.map(shop => shop.store.id)); const page = palette.mid;
  return <View testID="category-shops-screen" style={[s.screen, { backgroundColor: page }]}>
    {/* A solid panel a shade deeper than the page, its rounded bottom edge setting the title apart from the shops. */}
    <View style={[s.header, { paddingTop: insets.top, backgroundColor: palette.top }]}>
      <View style={s.bar}><Tap testID="category-shops-back" accessibilityRole="button" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/categories')} style={s.back}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Tap></View>
      <View style={s.hero}>
        <View style={s.heroCopy}>
          <Text testID="category-shops-title" numberOfLines={2} style={s.title}>{name}</Text>
          <View style={s.howMany}><Icon name="storefront-outline" size={14} color={palette.color} /><Text style={[s.subtitle, { color: palette.color }]}>{t('categoryShops.subtitle', { count: shops.length, value: fmt.number(shops.length) })}</Text></View>
        </View>
        {icon !== undefined && <View style={s.icon}><IconTile source={icon} variant="mint" /></View>}
      </View>
    </View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.list}>
      {shops.length ? shops.map(({ store, products }, n) => {
        const [wash, ink] = tints[n]; const items = t('categoryShops.items', { count: products.length, value: fmt.number(products.length) });
        // The first few cards rise in one after another as the page opens; the rest are below the fold.
        return <Reanimated.View key={store.id} entering={motion && n < RISE_IN ? FadeInDown.duration(duration.gentle).delay(n * stagger * 1.4).easing(reEasing.enter) : undefined}><Tap testID={`category-shop-${store.id}`} accessibilityRole="button" accessibilityLabel={`${t('home.shopStore', { name: store.name })}, ${items}`} onPress={() => router.push(`/category/${id}?store=${store.id}`)} style={[s.card, { backgroundColor: page }]}>
          <View style={s.head}>
            <View style={s.logoTile}>{!!store.logo && <Image source={store.logo} style={s.logo} contentFit="contain" />}</View>
            <View style={s.copy}>
              <Text numberOfLines={1} style={s.name}>{store.name}</Text>
              <View style={s.meta}>
                <Icon name="flash" size={12} color={colors.forest} /><Text style={s.metaText}>{fmt.deliveryTime(store.delivery_time)}</Text>
                <View style={s.dot} />
                <Icon name="star" size={11} color={colors.gold} /><Text style={s.metaText}>{fmt.number(store.rating, { maxFractionDigits: 1 })}</Text>
              </View>
            </View>
          </View>
          <View style={[s.strip, { backgroundColor: wash }]}>
            {products.slice(0, THUMBS).map(p => <Image key={p.id} source={p.image} style={s.thumb} contentFit="cover" />)}
            <View style={[s.go, { backgroundColor: ink }]}><Icon name="chevron-forward" size={16} color={colors.surface} /></View>
          </View>
          <View testID={`category-shop-count-${store.id}`} style={[s.count, { backgroundColor: ink }]}><Text style={s.countText}>{fmt.number(products.length)}</Text></View>
        </Tap></Reanimated.View>;
      }) : <View testID="category-shops-empty" style={s.empty}>
        <View style={[s.emptyWell, { backgroundColor: page }]}><Icon name="storefront-outline" size={26} color={palette.color} /></View>
        <Text style={s.emptyText}>{t('categoryShops.empty')}</Text>
      </View>}
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  bar: { paddingHorizontal: SIDE, paddingTop: 12 },
  back: { ...lightPane, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: SIDE, paddingTop: 14, paddingBottom: 24 },
  heroCopy: { flex: 1, gap: 6 },
  title: { fontSize: 26, lineHeight: 31, fontWeight: '800', letterSpacing: -0.5, color: colors.onSurface },
  howMany: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subtitle: { fontSize: 13, fontWeight: '700' },
  icon: { width: 92 },
  header: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  // Room above for the first card's count badge, and below for the dock.
  list: { gap: 22, paddingHorizontal: SIDE, paddingTop: 22, paddingBottom: 130 },
  card: { padding: 14, gap: 12, borderRadius: radius.lg, boxShadow: neu(6) },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoTile: logoTile(52),
  logo: { width: logoSize(52), height: logoSize(52) },
  copy: { flex: 1, minWidth: 0, gap: 4, paddingRight: 18 },
  name: { fontSize: 17, lineHeight: 22, fontWeight: '800', letterSpacing: -0.2, color: colors.onSurface },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  dot: { width: 3, height: 3, borderRadius: 2, marginHorizontal: 4, backgroundColor: colors.muted },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.md },
  thumb: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.surface },
  go: { marginLeft: 'auto', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', top: -9, right: -6, minWidth: 30, height: 30, paddingHorizontal: 8, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  countText: { fontSize: 13, fontWeight: '800', color: colors.surface },
  empty: { alignItems: 'center', gap: 16, paddingVertical: 48 },
  emptyWell: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', boxShadow: neuWell },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: 'center', color: colors.muted },
});
