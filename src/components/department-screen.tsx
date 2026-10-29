import { useState } from 'react';
import { Tap } from './tap';
import { useAppDimensions } from '../layout';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/src/ui/text';
import { useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { departments, DepartmentId, inDepartment, departmentFilterLabel } from '../departments';
import { useTranslation } from '../i18n';
import { useCatalog } from '../use-catalog';
import { BrandRail, CategoryRail, LoadState, SectionTitle } from './catalog-sections';
import { ProductCard } from './product-card';
import { BrandSpotlight } from './brand-spotlight';
import { CityScroll } from '../motion';
import { ExploreTown } from './explore-town';
import { useDeliveryLocation } from '../delivery-location';
export function DepartmentScreen({ id }: { id: DepartmentId }) {
  // Outside our delivery cities a department shows that town's real local places of its kind.
  const { coverage } = useDeliveryLocation();
  if (coverage && coverage.level !== 'live' && id !== 'book-it') return <ExploreTown initial={id} />;
  return <LiveDepartment id={id} />;
}

function LiveDepartment({ id }: { id: DepartmentId }) {
  const d = departments.find(x => x.id === id)!; const { data, isError, refetch } = useCatalog(); const [filter, setFilter] = useState('All'); const [brand, setBrand] = useState(''); const router = useRouter(); const width = useAppDimensions().width; const { t } = useTranslation();
  if (!data) return <LoadState error={isError} retry={refetch} />;
  if (!data.products.some(p => inDepartment(p.department, id)) && id !== 'book-it') return <ExploreTown initial={id} empty />;
  const brands = data.brands.filter(b => inDepartment(b.department, id)); const categories = data.categories.filter(c => inDepartment(c.department, id));
  const products = data.products.filter(p => inDepartment(p.department, id) && (!brand || p.brand_id === brand) && (filter === 'All' || data.categories.find(c => c.id === p.category_id)?.name.toLowerCase().includes(filter.toLowerCase())));
  // 2 columns on phones, 3 on small tablets, 4 from iPad portrait up.
  const columns = width >= 760 ? 4 : width > 600 ? 3 : 2; const cardWidth = (width - 40 - 12 * (columns - 1)) / columns;
  return <CityScroll testID={`department-screen-${id}`} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
    <BrandSpotlight variant={id} />
    <View style={styles.sheet}><SectionTitle title={id === 'shops' ? t('departments.screen.brandsTitleShops') : t('departments.screen.brandsTitle')} id={`${id}-brands`} subtitle={t('departments.screen.brandsSubtitle')} /><BrandRail brands={brands} scope={`${id}-page`} onSelect={value => setBrand(brand === value ? '' : value)} active={brand} />
      {id === 'grocery' && <View style={styles.space}><CategoryRail categories={categories} scope="grocery-page" /></View>}
      <SectionTitle id={`${id}-products`} title={brand ? brands.find(b => b.id === brand)?.name || t('departments.screen.pickedForYou') : id === 'care' ? t('departments.screen.productsCare') : id === 'shops' ? t('departments.screen.productsShops') : id === 'food' ? t('departments.screen.productsFood') : t('departments.screen.productsDefault')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{d.filters.map(f => <Tap key={f} testID={`${id}-filter-${f.toLowerCase().replaceAll(' ', '-')}`} onPress={() => setFilter(f)} style={[styles.filter, filter === f && { backgroundColor: d.soft }]}><Text style={[styles.filterText, filter === f && { color: d.color }]}>{departmentFilterLabel(t, f)}</Text></Tap>)}</ScrollView>
      {!!brand && <View style={styles.brandActions}><Tap testID={`${id}-clear-brand`} onPress={() => setBrand('')} style={styles.clear}><Icon name="close-circle-outline" size={15} color={d.color} /><Text style={styles.filterText}>{t('departments.screen.clearBrand')}</Text></Tap><Tap testID={`${id}-visit-store`} onPress={() => router.push(`/brand/${brand}` as any)} style={styles.clear}><Text style={styles.filterText}>{t('departments.screen.exploreBrand')}</Text><Icon name="arrow-forward" size={15} color={d.color} /></Tap></View>}
      <View style={styles.grid}>{products.map(p => <ProductCard key={p.id} product={p} width={cardWidth} scope={id} />)}</View>
      {!products.length && <View testID={`${id}-empty-results`} style={styles.empty}><Text style={styles.noteText}>{t('departments.screen.noResults')}</Text><Tap testID={`${id}-reset-filters`} onPress={() => { setFilter('All'); setBrand(''); }} style={styles.clear}><Text style={styles.filterText}>{t('departments.screen.showAll')}</Text></Tap></View>}
      <Text testID={`${id}-sample-notice`} style={styles.note}>{id === 'care' ? t('departments.screen.noteCare') : t('departments.screen.noteDefault')}</Text>
    </View>
  </CityScroll>;
}
const styles = StyleSheet.create({ content: { paddingBottom: 20 }, sheet: { backgroundColor: colors.glassBright, borderTopLeftRadius: 34, borderTopRightRadius: 34, paddingTop: 1 }, space: { marginTop: 23 }, filters: { paddingHorizontal: 20, gap: 7, marginBottom: 18 }, filter: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.cream }, filterText: { fontSize: 10, fontWeight: '500', color: colors.onSurface }, grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 12 }, brandActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12, paddingHorizontal: 20, marginBottom: 10 }, clear: { minHeight: 44, alignItems: 'center', flexDirection: 'row', gap: 6 }, empty: { alignItems: 'center', padding: 20 }, noteText: { color: colors.muted, fontSize: 11, textAlign: 'center' }, note: { color: colors.muted, fontSize: 9, lineHeight: 15, margin: 25 } });