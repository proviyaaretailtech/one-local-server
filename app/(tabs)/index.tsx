import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '@/src/theme';
import { api, Store } from '@/src/api';
import { useCatalog } from '@/src/use-catalog';
import { useFollowedStores } from '@/src/followed';
import { HomeHero } from '@/src/components/home-hero';
import { StoreRail } from '@/src/components/store-rail';
import { CityScroll } from '@/src/motion';
import { BrandRail, CategoryRail, EventRail, LoadState, ProductGrid as ProductRail, SectionTitle } from '@/src/components/catalog-sections';
import { ExploreTown } from '@/src/components/explore-town';
import { useDeliveryLocation } from '@/src/delivery-location';
import { useFormat, useTranslation } from '@/src/i18n';

export default function HomeScreen() {
  // Outside our delivery cities, home becomes the town's real local places.
  const { coverage } = useDeliveryLocation();
  if (coverage && coverage.level !== 'live') return <ExploreTown />;
  return <LiveHome />;
}

function LiveHome() {
  const { data, isLoading, isError, refetch } = useCatalog();
  const router = useRouter();
  const { isFollowing } = useFollowedStores(); const { t } = useTranslation(); const fmt = useFormat();
  const [stores, setStores] = useState<Store[]>([]);
  useEffect(() => { api<Store[]>('/stores').then(setStores).catch(() => {}); }, []);
  if (isLoading || !data) return <LoadState error={isError} retry={refetch} />;
  // A delivery city with no stores in the catalogue yet: show what's around instead of empty rails.
  if (!data.products.length) return <ExploreTown empty />;
  const followed = stores.filter(s => isFollowing(s.id));
  const go = (route: string) => () => router.navigate(route as any);
  const selected = (ids: string[]) => ids.flatMap(id => data.products.filter(p => p.id === id));
  return <CityScroll testID="home-screen" bleed showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
    <HomeHero catalog={data} />
    {followed.length > 0 && <><SectionTitle id="followed" title={t('home.followedTitle')} subtitle={t('home.followedSubtitle')} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stores}>{followed.map(s => <Pressable testID={`followed-store-${s.id}`} key={s.id} style={styles.store} onPress={go(`/store/${s.id}`)}><Image source={s.logo} style={styles.storeImage} /><Text style={styles.storeName}>{s.name}</Text><Icon name="heart" size={13} color={colors.forest} /></Pressable>)}</ScrollView></>}
    <View style={styles.sheet}>
    <SectionTitle id="home-shop-by-store" title={t('home.storesTitle')} subtitle={t('home.storesSubtitle')} onPress={go('/categories')} />
    <StoreRail stores={data.themed_stores || []} scope="home" />
    <SectionTitle id="trending" title={t('home.trendingTitle')} subtitle={t('home.trendingSubtitle')} onPress={go('/search?collection=trending')} />
    <ProductRail products={selected(['f1', 'f5', 'b1', 'f3', 'p3', 'a1'])} scope="trending-home" />
    <SectionTitle id="top-picks" title={t('home.picksTitle')} subtitle={t('home.picksSubtitle')} onPress={go('/search?collection=picks')} />
    <ProductRail products={selected(['p3', 'f3', 'b1', 'p4', 'f6', 'a1'])} scope="picks" />
    <View style={styles.rule} />
    <SectionTitle id="home-food" title={t('home.foodTitle')} subtitle={t('home.foodSubtitle')} onPress={go('/food')} />
    <BrandRail brands={data.brands.filter(b => b.department === 'food')} scope="home-food" />
    <View style={styles.railSpace}><ProductRail products={selected(['f4', 'f2', 'f5'])} scope="food-home" /></View>
    <SectionTitle id="home-grocery" title={t('home.groceryTitle')} subtitle={t('home.grocerySubtitle')} onPress={go('/grocery')} />
    <CategoryRail categories={data.categories.filter(c => c.department === 'grocery').slice(0, 6)} scope="grocery-home" />
    <SectionTitle id="home-shops" title={t('home.shopsTitle')} subtitle={t('home.shopsSubtitle')} onPress={go('/shops')} />
    <BrandRail brands={data.brands.filter(b => b.department === 'shops')} scope="home-shops" />
    <View style={styles.railSpace}><ProductRail products={selected(['sneak1', 'audio1', 'home1'])} scope="shops-home" /></View>
    <SectionTitle id="home-pharmacy" title={t('home.pharmacyTitle')} subtitle={t('home.pharmacySubtitle')} onPress={go('/care')} />
    <BrandRail brands={data.brands.filter(b => b.department === 'pharmacy')} scope="home-pharmacy" />
    <View style={styles.railSpace}><ProductRail products={selected(['h2', 'h1', 'h3'])} scope="pharmacy-home" /></View>
    <SectionTitle id="home-beauty" title={t('home.beautyTitle')} subtitle={t('home.beautySubtitle')} onPress={go('/care')} />
    <BrandRail brands={data.brands.filter(b => b.department === 'beauty')} scope="home-beauty" />
    <View style={styles.railSpace}><ProductRail products={selected(['b2', 'b3', 'b4'])} scope="beauty-home" /></View>
    <SectionTitle id="home-book" title={t('home.bookTitle')} subtitle={t('home.bookSubtitle')} onPress={go('/book-it')} />
    <EventRail events={data.events} scope="home-book" />
    <SectionTitle id="home-stores" title={t('home.neighbourhoodTitle')} subtitle={t('home.neighbourhoodSubtitle')} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stores}>{stores.filter(s => s.id.startsWith('s') || s.id.startsWith('org-')).map(s => <Pressable testID={`store-card-${s.id}`} key={s.id} style={styles.store} onPress={go(`/store/${s.id}`)}><Image source={s.logo} style={styles.storeImage} /><View><Text style={styles.storeName}>{s.name}</Text><Text style={styles.meta}>{t('home.storeMeta', { time: fmt.deliveryTime(s.delivery_time), rating: fmt.number(s.rating, { maxFractionDigits: 2 }) })}</Text></View></Pressable>)}</ScrollView>
    <SectionTitle id="home-budget" title={t('home.budgetTitle')} subtitle={t('home.budgetSubtitle', { amount: fmt.money(99) })} onPress={go('/search?collection=budget')} /><ProductRail products={data.products.filter(p => p.price < 99).slice(-10)} scope="home-budget" />
    <SectionTitle id="home-brand-discovery" title={t('home.brandsTitle')} subtitle={t('home.brandsSubtitle', { value: fmt.number(data.brands.length) })} /><BrandRail brands={data.brands.slice(16)} scope="home-new-brands" />
    <View style={styles.footer}><Text style={styles.footerTitle}>{t('home.footerTitle')}</Text><Text style={styles.footerSub}>{t('home.footerSub')}</Text><Text testID="sample-catalog-notice" style={styles.notice}>{t('home.sampleNotice')}</Text></View>
    </View>
  </CityScroll>;
}
const styles = StyleSheet.create({
  content: { paddingBottom: 20 }, sheet: { backgroundColor: colors.glassBright, borderTopLeftRadius: 34, borderTopRightRadius: 34, paddingTop: 1, overflow: 'hidden' }, rule: { height: 7, backgroundColor: colors.cream, marginTop: 26 }, railSpace: { marginTop: 18 },
  stores: { paddingHorizontal: 20, gap: 12 }, store: { padding: 12, borderRadius: 16, backgroundColor: colors.cream, flexDirection: 'row', alignItems: 'center', gap: 10 },
  storeImage: { width: 42, height: 42, borderRadius: 13 }, storeName: { color: colors.onSurface, fontSize: 12, fontWeight: '700' }, meta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  footer: { marginTop: 38, paddingHorizontal: 24, paddingVertical: 30, backgroundColor: colors.limeSoft }, footerTitle: { color: colors.forest, fontSize: 25, letterSpacing: -1, fontWeight: '700', maxWidth: 250 },
  footerSub: { color: colors.forest, fontSize: 12, marginTop: 10 }, notice: { color: colors.muted, fontSize: 9, lineHeight: 15, marginTop: 22 },
});