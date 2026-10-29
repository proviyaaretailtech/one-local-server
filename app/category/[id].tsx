import { useEffect, useRef, useState } from 'react';
import { useAppDimensions } from '@/src/layout';
import { Animated, View, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCustomer } from '@/src/customer';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '@/src/theme';
import { useCatalog } from '@/src/use-catalog';
import { LoadState } from '@/src/components/catalog-sections';
import { SubcategoryProduct } from '@/src/components/subcategory-product';
import { CategoryNotice, SubcategoryHeader } from '@/src/components/subcategory-header';
import { CategoryOption, SubcategoryOptions } from '@/src/components/subcategory-options';
import { useMotionAllowed } from '@/src/motion';
import { useFormat, useTranslation } from '@/src/i18n';

type Sheet = 'filters' | 'sort' | 'brand' | 'type' | null;
const BUDGET_MAX = 99; // the "Under ₹99" filter
const NOTICE_TEXT = { linkCopied: 'category.linkCopied', shareFailed: 'category.shareFailed', saveFailed: 'category.saveFailed' } as const;
export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { data, isError, refetch } = useCatalog();
  const [query, setQuery] = useState(''); const [sort, setSort] = useState('recommended'); const [budget, setBudget] = useState(false); const [brand, setBrand] = useState(''); const [pack, setPack] = useState(''); const [offers, setOffers] = useState(false); const [savedOnly, setSavedOnly] = useState(false); const [sheet, setSheet] = useState<Sheet>(null);
  const { saved, toggleSaved } = useCustomer(); const [notice, setNotice] = useState<CategoryNotice | ''>(''); const { t } = useTranslation(); const fmt = useFormat();
  const sidebar = useRef<ScrollView>(null); const list = useRef<ScrollView>(null); const y = useRef(new Animated.Value(0)).current;
  const motion = useMotionAllowed(); const { width } = useAppDimensions(); const railWidth = Math.max(80, Math.min(114, Math.round(width*0.23)));
  const itemWidth = (width-railWidth-32)/2;
  useEffect(() => { setQuery(''); setBrand(''); setPack(''); setSheet(null); setBudget(false); setOffers(false); setSavedOnly(false); setSort('recommended'); y.setValue(0); list.current?.scrollTo({ y: 0, animated: false }); }, [id, y]);
  useEffect(() => { list.current?.scrollTo({ y: 0, animated: false }); y.setValue(0); }, [query, y]);
  const categories = data?.categories.filter(c => c.department === data.categories.find(c => c.id === id)?.department) || [];
  const activeIndex = categories.findIndex(c => c.id === id);
  const revealSelected = () => sidebar.current?.scrollTo({ y: Math.max(0, activeIndex*94-188), animated: motion });
  useEffect(() => { sidebar.current?.scrollTo({ y: Math.max(0, activeIndex*94-188), animated: motion }); }, [activeIndex, motion]);
  if (!data) return <LoadState error={isError} retry={refetch} />;
  const cat = data.categories.find(c => c.id === id); const original = data.products.filter(p => p.category_id === id);
  const products = original.filter(p => (!budget || p.price < BUDGET_MAX) && (!brand || p.brand_id === brand) && (!pack || p.weight === pack) && (!offers || p.price < p.mrp) && (!savedOnly || saved.includes(p.id)) && p.name.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sort === 'low' ? a.price-b.price : sort === 'high' ? b.price-a.price : sort === 'rating' ? b.rating-a.rating : 0);
  const brands = data.brands.filter(b => original.some(p => p.brand_id === b.id)); const packs = [...new Set(original.map(p => p.weight))];
  const reset = () => { setQuery(''); setBudget(false); setBrand(''); setPack(''); setOffers(false); setSavedOnly(false); setSort('recommended'); };
  const filterCount = Number(budget)+Number(offers)+Number(savedOnly);
  const options: CategoryOption[] = sheet === 'filters' ? [
    { id: 'category-budget', label: t('category.filterBudget', { price: fmt.money(BUDGET_MAX) }), selected: budget, onPress: () => setBudget(!budget) },
    { id: 'category-offers-only', label: t('category.filterOffers'), selected: offers, onPress: () => setOffers(!offers) },
    { id: 'category-saved-only', label: t('category.filterSaved'), selected: savedOnly, onPress: () => setSavedOnly(!savedOnly) },
  ] : sheet === 'sort' ? [['recommended', t('category.sortRecommended')], ['low', t('category.sortLow')], ['high', t('category.sortHigh')], ['rating', t('category.sortRating')]].map(([value,label]) => ({ id: `category-sort-${value}`, label, selected: sort === value, onPress: () => setSort(value) })) : sheet === 'brand' ? [{ id: 'category-brand-all', label: t('category.allBrands'), selected: !brand, onPress: () => setBrand('') }, ...brands.map(b => ({ id: `category-brand-${b.id}`, label: b.name, selected: brand === b.id, onPress: () => setBrand(b.id) }))] : [{ id: 'category-pack-all', label: t('category.allPacks'), selected: !pack, onPress: () => setPack('') }, ...packs.map((p,i) => ({ id: `category-pack-${i}`, label: p, selected: pack === p, onPress: () => setPack(p) }))];
  return <KeyboardAvoidingView testID="category-screen" behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
    <SubcategoryHeader id={id} title={cat?.name || t('category.notFound')} query={query} setQuery={setQuery} scroll={y} onNotice={setNotice} />
    {!!notice && <View testID="subcategory-notice" accessibilityLiveRegion="polite" style={styles.notice}><Text style={styles.noticeText}>{t(NOTICE_TEXT[notice])}</Text><Pressable testID="subcategory-notice-dismiss" accessibilityLabel={t('category.dismissMessage')} onPress={() => setNotice('')} style={styles.dismiss}><Icon name="close" size={18} color={colors.forest} /></Pressable></View>}
    <View style={styles.body}>
      <ScrollView ref={sidebar} testID="category-sidebar" style={[styles.sidebar, { width: railWidth }]} contentContainerStyle={styles.sidebarContent} onContentSizeChange={revealSelected} showsVerticalScrollIndicator={false}>{categories.map(c => <Pressable key={c.id} testID={`sidebar-${c.id}`} accessibilityLabel={c.name} accessibilityState={{ selected: c.id === id }} onPress={() => router.setParams({ id: c.id })} style={({ pressed }) => [styles.sideItem, c.id === id && styles.activeItem, pressed && styles.pressed]}><Image testID={`sidebar-image-${c.id}`} source={c.image} contentFit="contain" style={styles.sideImage} /><Text testID={`sidebar-label-${c.id}`} style={[styles.sideText, c.id === id && styles.activeText]}>{c.name}</Text>{c.id === id && <View style={styles.indicator} />}</Pressable>)}</ScrollView>
      <View style={styles.products}>
        <ScrollView horizontal testID="subcategory-filter-row" showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filterContent}>{[{ id: 'filters', test: 'category-filters', icon: 'options-outline', label: filterCount ? t('category.filtersCount', { n: fmt.number(filterCount) }) : t('category.filters'), active: !!filterCount, a11y: t('category.chooseFilters') }, { id: 'sort', test: 'category-sort', icon: 'swap-vertical-outline', label: t('category.sort'), active: sort !== 'recommended', a11y: t('category.chooseSort') }, { id: 'brand', test: 'category-brand-filter', label: t('category.brand'), active: !!brand, a11y: t('category.chooseBrand') }, { id: 'type', test: 'category-type-filter', label: t('category.type'), active: !!pack, a11y: t('category.chooseType') }].map(f => <Pressable key={f.id} testID={f.test} accessibilityLabel={f.a11y} accessibilityState={{ selected: f.active }} onPress={() => setSheet(f.id as Sheet)} style={styles.filter}>{f.icon && <Icon name={f.icon as any} size={14} color={f.active ? colors.forest : colors.onSurface} />}<Text style={[styles.filterText, f.active && styles.activeText]}>{f.label}</Text><Icon name="chevron-down" size={10} color={f.active ? colors.forest : colors.onSurface} /></Pressable>)}</ScrollView>
        <Animated.ScrollView ref={list} testID="category-products-scroll" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: false })} contentContainerStyle={styles.productContent}>
          <View key={`${id}-${sort}-${brand}-${pack}-${budget}-${savedOnly}-${offers}`} style={styles.grid}>{products.map((p,index) => <View key={p.id} style={[styles.gridItem, { width: itemWidth, maxWidth: itemWidth }]}><SubcategoryProduct product={p} index={index} saved={saved.includes(p.id)} onSave={() => { void toggleSaved(p.id).catch(() => setNotice('saveFailed' /* i18n-ignore: notice code */)); }} /></View>)}</View>
          {!products.length && <View testID="category-empty" style={styles.empty}><Icon name="search-outline" size={28} color={colors.muted} /><Text style={styles.emptyTitle}>{t('category.empty')}</Text><Pressable testID="category-clear-filters" onPress={reset} style={styles.clear}><Text style={styles.clearText}>{t('category.clearFilters')}</Text></Pressable>{!cat && <Pressable testID="category-all" onPress={() => router.replace('/categories')} style={styles.clear}><Text style={styles.clearText}>{t('category.browse')}</Text></Pressable>}</View>}
          <Text testID="category-count" style={styles.footnote}>{t('category.count', { count: products.length, value: fmt.number(products.length) })}</Text><Text testID="subcategory-estimate-note" style={styles.footnote}>{t('category.estimateNote')}</Text>
        </Animated.ScrollView>
      </View>
    </View>
    {!!sheet && <SubcategoryOptions title={sheet === 'filters' ? t('category.filters') : sheet === 'sort' ? t('category.sortBy') : sheet === 'brand' ? t('category.chooseABrand') : t('category.packSize')} options={options} close={() => { setSheet(null); list.current?.scrollTo({ y: 0, animated: motion }); }} reset={reset} />}
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.surface }, body: { flex: 1, flexDirection: 'row' }, sidebar: { flexGrow: 0, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border }, sidebarContent: { paddingBottom: 110 }, sideItem: { minHeight: 94, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', gap: 6 }, activeItem: { backgroundColor: colors.limeSoft }, sideImage: { width: 49, height: 49, borderRadius: 7 }, sideText: { color: colors.muted, fontSize: 10, lineHeight: 13, textAlign: 'center' }, activeText: { color: colors.forest, fontWeight: '700' }, indicator: { position: 'absolute', width: 3, right: 0, top: 19, bottom: 19, borderRadius: 2, backgroundColor: colors.forest }, products: { flex: 1, minWidth: 0 }, filters: { maxHeight: 53, minHeight: 53, flexGrow: 0, backgroundColor: colors.surface }, filterContent: { paddingHorizontal: 10, gap: 18, alignItems: 'center' }, filter: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }, filterText: { fontSize: 11, color: colors.onSurface }, productContent: { paddingHorizontal: 10, paddingTop: 5, paddingBottom: 130 }, grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 30 }, gridItem: { width: '47.7%', maxWidth: '49%', flexGrow: 1 }, empty: { alignItems: 'center', paddingVertical: 30, gap: 14 }, emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.onSurface }, clear: { minHeight: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.limeSoft }, clearText: { color: colors.forest, fontSize: 12, fontWeight: '600' }, footnote: { fontSize: 9, color: colors.muted, textAlign: 'center', marginTop: 15 }, notice: { paddingLeft: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.limeSoft }, noticeText: { flex: 1, color: colors.forest, fontSize: 11 }, dismiss: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }, pressed: { opacity: 0.7 } });