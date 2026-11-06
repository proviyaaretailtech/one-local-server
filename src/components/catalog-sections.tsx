import { memo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/src/ui/text';
import { gridColumns, useAppDimensions, useLineHeight } from '../layout';
import { Image } from 'expo-image';
import Icon from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { colors, nameTints, nameTintIndex } from '../theme';
import { Brand, Category, Product } from '../api';
import { ProductCard } from './product-card';
import { Tap } from './tap';
import { OneLottie } from './one-lottie';
import { useTranslation } from '../i18n';
import { useCatalog } from '../use-catalog';
import { logoSize, logoTile } from '../logo-tile';
import { COMING_SOON_ALL } from '../coming-soon-mode';

export function SectionTitle({ title, subtitle, onPress, id }: { title: string; subtitle?: string; onPress?: () => void; id: string }) {
  const { t } = useTranslation();
  return <View style={styles.heading}><View style={styles.headingText}><Text testID={`${id}-heading`} style={styles.title}>{title}</Text>{subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}</View>{onPress && <Tap testID={`${id}-see-all`} accessibilityLabel={t('home.seeAllLabel', { title })} onPress={onPress} style={styles.seeAll}><Text style={styles.seeText}>{t('common.seeAll')}</Text><Icon name="arrow-forward" size={14} color={colors.forest} /></Tap>}</View>;
}
// The rails are memoised: a screen that re-renders (fresh data, a tab switch) passes them the same arrays and they skip.
// Two rows take the items alternately, so the first ones sit side by side on the first screen and both rows scroll as one.
export const ProductRail = memo(function ProductRail({ products, scope, accent, rows = 1 }: { products: Product[]; scope: string; accent?: string; rows?: 1 | 2 }) {
  const card = (p: Product) => <ProductCard key={p.id} product={p} scope={scope} accent={accent} />;
  return <ScrollView horizontal testID={`${scope}-rail`} showsHorizontalScrollIndicator={false} contentContainerStyle={rows === 2 ? styles.railRows : styles.rail}>
    {rows === 2 ? [0, 1].map(r => <View key={r} style={styles.railRow}>{products.filter((_, i) => i % 2 === r).map(card)}</View>) : products.map(card)}
  </ScrollView>;
});
export const ProductGrid = memo(function ProductGrid({ products, scope, accent }: { products: Product[]; scope: string; accent?: string }) {
  const { width } = useAppDimensions(); const cols = gridColumns(width); const cardWidth = (width - 32 - 8 * (cols - 1)) / cols;
  return <View testID={`${scope}-grid`} style={gridStyles.grid}>{products.map(p => <ProductCard key={p.id} product={p} scope={scope} width={cardWidth} accent={accent} />)}</View>;
});
const gridStyles = StyleSheet.create({ grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8, rowGap: 16 } });
// Brands without a logo image get a monogram (one or two initials) instead of their full name
// squeezed into the tile — long names like "Himalaya" otherwise break mid-word.
const monogram = (name: string) => name.split(/[\s'’&-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
// Each logo-less brand gets its own soft tint (picked from its name, so it never changes between visits)
// instead of every tile wearing the same maroon-on-white.
const monogramTint = (name: string) => nameTints[nameTintIndex(name)];
export const BrandRail = memo(function BrandRail({ brands, scope, onSelect, active }: { brands: Brand[]; scope: string; onSelect?: (id: string) => void; active?: string }) {
  const router = useRouter(); const { t } = useTranslation(); const { data } = useCatalog();
  // A logo that fails to load (missing file, offline) falls back to the monogram instead of an empty tile.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const hasLogo = (b: Brand) => !!b.logo && !broken.has(b.id);
  // Brands with nothing to order yet wear a "Soon" tag (their page shows the coming-soon receipt).
  // While the coming-soon switch is on nothing can be ordered, so every brand is marked SOON; otherwise only brands with nothing listed yet.
  const soon = (id: string) => COMING_SOON_ALL || (!!data && !data.products.some(p => p.brand_id === id || p.store_id === id));
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.brandRail}>
    {brands.map(b => <Tap testID={`${scope}-brand-${b.id}`} key={b.id} onPress={() => onSelect ? onSelect(b.id) : router.push(`/brand/${b.id}`)} style={styles.brandItem}>
      <View style={[styles.brandCircle, !hasLogo(b) && { backgroundColor: monogramTint(b.name)[0] }, active === b.id && styles.selectedBrand]}>{hasLogo(b) ? <Image testID={`${scope}-brand-logo-${b.id}`} source={b.logo} contentFit="contain" style={styles.brandLogo} onError={() => setBroken(prev => new Set(prev).add(b.id))} /> : <Text testID={`${scope}-brand-wordmark-${b.id}`} style={[styles.brandMonogram, { color: monogramTint(b.name)[1] }]} numberOfLines={1} accessibilityLabel={b.name}>{monogram(b.name)}</Text>}{soon(b.id) && <View testID={`${scope}-brand-soon-${b.id}`} style={styles.soon}><Text style={styles.soonText}>{t('popups.comingSoon.soon')}</Text></View>}</View><Text testID={`${scope}-brand-name-${b.id}`} style={styles.brandName} numberOfLines={2}>{b.name}</Text>
    </Tap>)}
  </ScrollView>;
});
export const CategoryRail = memo(function CategoryRail({ categories, scope }: { categories: Category[]; scope: string }) {
  const router = useRouter(); const lineHeight = useLineHeight();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>{categories.map(c => <Tap key={c.id} testID={`${scope}-category-${c.id}`} onPress={() => router.push(`/category/${c.id}`)} style={styles.category}><Image source={c.image} style={styles.categoryImage} contentFit="cover" /><Text style={[styles.categoryName, { lineHeight: lineHeight(13, 16) }]} numberOfLines={2}>{c.name}</Text></Tap>)}</ScrollView>;
});
export function LoadState({ error, retry }: { error?: boolean; retry?: () => void }) {
  const { t } = useTranslation();
  return <View style={styles.loading} testID={error ? 'catalog-error' : 'catalog-loading'}>{error ? <><Icon name="cloud-offline-outline" size={32} color={colors.muted} /><Text style={styles.title}>{t('home.loadFailed')}</Text><Tap testID="catalog-retry" style={styles.retry} onPress={retry}><Text style={styles.seeText}>{t('common.retry')}</Text></Tap></> : <OneLottie testID="catalog-loader" name="neon-loader" size={88} loop />}</View>;
}
const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginTop: 26, marginBottom: 13, gap: 8 }, headingText: { flex: 1 },
  title: { fontSize: 18, letterSpacing: -0.4, fontWeight: '600', color: colors.onSurface }, subtitle: { fontSize: 10, color: colors.muted, lineHeight: 16, marginTop: 3 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44 }, seeText: { color: colors.forest, fontSize: 11, fontWeight: '700' }, rail: { paddingHorizontal: 20, gap: 12 }, railRows: { flexDirection: 'column', paddingHorizontal: 20, gap: 18 }, railRow: { flexDirection: 'row', gap: 12 },
  brandRail: { paddingHorizontal: 20, gap: 12 }, brandItem: { width: 76, alignItems: 'center', gap: 8 },
  // Every brand sits in the same white tile with the same shadow; the logo is fitted inside a fixed padded box,
  // so square, round and wide logos (and monograms) all read at one size, Swiggy-style.
  brandCircle: logoTile(72), brandLogo: { width: logoSize(72), height: logoSize(72) }, soon: { position: 'absolute', bottom: 3, alignSelf: 'center', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: '#0B1F16' }, soonText: { color: '#9DFF00', fontSize: 8, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }, brandMonogram: { fontSize: 26, fontWeight: '800', letterSpacing: -1, textAlign: 'center' }, selectedBrand: { borderColor: colors.forest, borderWidth: 2 }, brandName: { fontSize: 10, lineHeight: 13, minHeight: 26, color: colors.onSurface, fontWeight: '600', textAlign: 'center' },
  category: { width: 94, gap: 8 }, categoryImage: { width: 94, height: 94, borderRadius: 20 }, categoryName: { color: colors.onSurface, fontSize: 13, lineHeight: 16, minHeight: 32, fontWeight: '700', textAlign: 'center' },
  loading: { flex: 1, padding: 30, alignItems: 'center', justifyContent: 'center', gap: 20 }, retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 24, backgroundColor: colors.limeSoft, borderRadius: 12 },
});