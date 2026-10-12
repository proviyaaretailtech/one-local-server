import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useAppDimensions } from '@/src/layout';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, Store } from '@/src/api';
import { colors } from '@/src/theme';
import { useCatalog } from '@/src/use-catalog';
import { ProductCard } from '@/src/components/product-card';
import { LoadState } from '@/src/components/catalog-sections';
import { ComingSoonBrand } from '@/src/components/coming-soon-brand';
import { useFollowedStores } from '@/src/followed';
import { GlassPill, ImmersiveHeader } from '@/src/components/immersive-header';
import { useFormat, useTranslation } from '@/src/i18n';

const monogram = (name: string) => name.split(/[\s'’&-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export default function BrandCollection() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { data, isError, refetch } = useCatalog(); const router = useRouter(); const width = useAppDimensions().width; const { isFollowing, toggle } = useFollowedStores(); const { t } = useTranslation(); const fmt = useFormat();
  // A brand's own store shares its id (server/marketplace.ts listingCatalog: "its id is the organization's first listing's id";
  // the demo catalogue's brands and stores use the same ids). /api/catalog carries no stores, so ask for that store and offer
  // "Store profile" only when it exists in this city — a brand without a live store (paused, removed, other city) hides it.
  const ownStore = useQuery({ queryKey: ['store', id], queryFn: () => api<Store>(`/stores/${id}`), enabled: !!id, staleTime: 60000, retry: false });
  if (!data) return <LoadState error={isError} retry={refetch} />;
  const brand = data.brands.find(b => b.id === id); const products = data.products.filter(p => p.brand_id === id || (!p.brand_id && p.store_id === id));
  if (!brand) return <View style={styles.empty}><Text style={styles.emptyTitle}>{t('brand.notFound')}</Text><Pressable testID="brand-not-found-home" style={styles.link} onPress={() => router.replace('/(tabs)' as any)}><Text style={styles.linkText}>{t('brand.backHome')}</Text></Pressable></View>;
  const followed = isFollowing(id); const cols = width >= 760 ? 4 : width > 600 ? 3 : 2;
  // A brand with nothing to order yet shows the coming-soon receipt instead of an empty page.
  if (!products.length) return <ComingSoonBrand name={brand.name} logo={brand.logo} line={brand.tagline} />;
  const hero = brand.image || products[0]?.image || '';
  return <ScrollView testID={`brand-screen-${id}`} style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <ImmersiveHeader testID="brand-hero" image={hero} eyebrow={t('brand.eyebrow')} title={brand.name} subtitle={brand.tagline} logo={brand.logo || undefined} monogram={brand.logo ? undefined : monogram(brand.name)}
      right={ownStore.data ? <GlassPill testID={`brand-store-${id}`} label={t('brand.storeProfile')} icon="storefront-outline" onPress={() => router.push(`/store/${ownStore.data.id}` as any)} /> : undefined}>
      <View style={styles.heroActions}>
        <GlassPill testID={`brand-follow-${id}`} label={followed ? t('brand.following') : t('brand.follow')} icon={followed ? 'heart' : 'heart-outline'} active={followed} onPress={() => toggle(id)} />
        <View style={styles.countPill}><Text testID="brand-product-count-pill" style={styles.countText}>{t('brand.finds', { count: products.length, value: fmt.number(products.length) })}</Text></View>
      </View>
    </ImmersiveHeader>
    <View style={styles.sheet}>
      <View style={styles.heading}><Text testID="brand-product-count" style={styles.collectionTitle}>{t('brand.moreFrom', { name: brand.name })}</Text><Text style={styles.count}>{t('brand.countLine', { count: products.length, value: fmt.number(products.length) })}</Text></View>
      <View style={styles.grid}>{products.map(p => <ProductCard key={p.id} product={p} width={(width - 40 - (cols - 1) * 12) / cols} scope={`brand-${id}`} />)}</View>
      <Text testID="brand-sample-notice" style={styles.notice}>{t('brand.sampleNotice')}</Text>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface }, content: { paddingBottom: 120 },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 16 },
  countPill: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: 'rgba(5,6,5,0.55)', justifyContent: 'center' },
  countText: { color: colors.electricLime, fontSize: 12, fontWeight: '800' },
  sheet: { marginTop: -24, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface },
  heading: { padding: 20, paddingTop: 26 },
  collectionTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface, letterSpacing: -0.4 },
  count: { fontSize: 12, color: colors.muted, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 12 },
  notice: { color: colors.muted, fontSize: 10, lineHeight: 15, margin: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }, emptyTitle: { fontSize: 22, fontWeight: '700', color: colors.onSurface },
  link: { minHeight: 44, justifyContent: 'center' }, linkText: { color: colors.forest, fontSize: 13, fontWeight: '700' },
});
