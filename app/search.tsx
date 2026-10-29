import { useEffect, useMemo, useState } from 'react';
import { useAppDimensions } from '@/src/layout';
import { View, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '@/src/theme';
import { useCatalog } from '@/src/use-catalog';
import { ProductCard } from '@/src/components/product-card';
import { LoadState } from '@/src/components/catalog-sections';
import { departments, inDepartment } from '@/src/departments';
import { matchesProductQuery, normaliseQuery } from '@/src/catalog-search';
import { useQuery } from '@tanstack/react-query';
import { useDeliveryLocation } from '@/src/delivery-location';
import { useFormat, useTranslation } from '@/src/i18n';
import { CITY_CENTER, nearbyAt, NearbyKind, NearbyPlace } from '@/src/places';
import { KINDS, PlaceRow } from '@/src/components/explore-town';
import { addRecent, clearRecent, readRecent } from '@/src/recent-searches';

// Department filter → kind of local place ('care' covers pharmacy and beauty).
const PLACE_KIND: Record<string, NearbyKind | undefined> = { food: 'food', grocery: 'grocery', shops: 'shops', care: 'care' };
const BUDGET_LIMIT = 99; // the "Little finds under ₹99" collection
// The department chips: ids are codes, the words come from the catalogue.
const DEPARTMENT_KEY = { food: 'search.dept.food', grocery: 'search.dept.grocery', shops: 'search.dept.shops', care: 'search.dept.care' } as const;
const placeMatches = (p: NearbyPlace, text: string) => {
  const hay = normaliseQuery(`${p.name} ${p.type} ${p.cuisine ?? ''} ${p.address ?? ''}`);
  return text.split(' ').every(w => hay.includes(w));
};
export default function Search() {
  const { collection, q } = useLocalSearchParams<{ collection?: string; q?: string }>();
  const { t } = useTranslation(); const fmt = useFormat();
  const { data, isError, refetch } = useCatalog();
  const [query, setQuery] = useState(q || '');
  useEffect(() => { if (q !== undefined) setQuery(q); }, [q]);
  const [department, setDepartment] = useState('all');
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { void readRecent().then(setRecent); }, []);
  const remember = (text: string) => { void addRecent(text).then(setRecent); };
  const router = useRouter();
  const width = useAppDimensions().width;
  const cols = width > 600 ? 3 : 2;
  // Real local places around the chosen location (the same answer the explore page uses), so search
  // is useful in every town and while a city's One Local catalogue is still being filled.
  const { point, coverage } = useDeliveryLocation(); const at = point ?? CITY_CENTER;
  const { data: nearby, isLoading: nearbyLoading } = useQuery({ queryKey: ['nearby', at.lat, at.lng], queryFn: () => nearbyAt(at), staleTime: 10 * 60_000, retry: 1 });
  const places = useMemo(() => {
    if (!nearby) return [];
    const text = normaliseQuery(query);
    const kinds = department === 'all' ? KINDS : KINDS.filter(k => k.id === PLACE_KIND[department]);
    return kinds.flatMap(k => nearby.groups[k.id].filter(p => !text || placeMatches(p, text)).map(p => ({ p, k })))
      .sort((a, b) => a.p.distance_km - b.p.distance_km).slice(0, text ? 40 : 12);
  }, [nearby, query, department]);
  const departmentLabel = (d: { id: string; label: string }) => (d.id in DEPARTMENT_KEY ? t(DEPARTMENT_KEY[d.id as keyof typeof DEPARTMENT_KEY]) : d.label); // i18n-ignore: d.label is the English fallback for a department with no key yet
  const town = coverage?.place?.name; // the place name as the API returns it; without one the lines say "near you"
  if (!data) return <LoadState error={isError} retry={refetch} />;
  const collectionIds = collection === 'trending' ? ['f1', 'f5', 'b1', 'f3'] : collection === 'picks' ? ['p3', 'f3', 'b1', 'p4', 'f6'] : null;
  const products = data.products.filter(p => (collection !== 'budget' || p.price < BUDGET_LIMIT) && (!collectionIds || query || collectionIds.includes(p.id)) && (department === 'all' || inDepartment(p.department, department)) && matchesProductQuery(p, query, data));
  return <KeyboardAvoidingView testID="search-screen" behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
    <View style={styles.titleRow}><Pressable testID="search-back" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)' as any)} style={styles.back}><Icon name="arrow-back" size={22} color={colors.onSurface} /></Pressable><Text style={styles.title}>{collection === 'budget' ? t('search.title.budget', { amount: fmt.money(BUDGET_LIMIT) }) : collection === 'trending' ? t('search.title.trending') : collection === 'picks' ? t('search.title.picks') : t('search.title.default')}</Text></View>
    <View style={styles.inputWrap}><Icon name="search" size={20} color={colors.muted} /><TextInput testID="search-input" value={query} onChangeText={setQuery} onSubmitEditing={() => remember(query)} placeholder={town ? t('search.near.placeholder', { town }) : t('search.near.placeholderYou')} placeholderTextColor={colors.muted} style={styles.input} autoFocus={!collection} returnKeyType="search" />{!!query && <Pressable testID="clear-search" accessibilityLabel={t('search.clear')} onPress={() => setQuery('')} style={styles.back}><Icon name="close" size={20} color={colors.muted} /></Pressable>}</View>
    <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{[{ id: 'all', label: t('search.everything') }, ...departments.filter(d => d.id !== 'book-it').map(d => ({ id: d.id as string, label: departmentLabel(d) }))].map(d => <Pressable testID={`search-filter-${d.id}`} key={d.id} onPress={() => setDepartment(d.id)} style={[styles.chip, department === d.id && styles.active]}><Text style={[styles.chipText, department === d.id && styles.activeText]}>{d.label}</Text></Pressable>)}</ScrollView></View>
    {!query && recent.length > 0 && <View testID="search-recent" style={styles.recent}>
      <View style={styles.recentHead}><Text style={styles.section}>{t('search.recent')}</Text><Pressable testID="search-recent-clear" accessibilityRole="button" onPress={() => { void clearRecent(); setRecent([]); }} hitSlop={8}><Text style={styles.clear}>{t('search.clearRecent')}</Text></Pressable></View>
      <View style={styles.recentChips}>{recent.map(r => <Pressable key={r} testID={`search-recent-${r}`} accessibilityRole="button" onPress={() => { setQuery(r); remember(r); }} style={styles.recentChip}><Icon name="time-outline" size={14} color={colors.muted} /><Text style={styles.recentText}>{r}</Text></Pressable>)}</View>
    </View>}
    {(!!query || products.length > 0) && <Text testID="search-result-count" style={styles.count}>{t('search.finds', { value: fmt.number(products.length + (query ? places.length : 0)) })}</Text>}
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
      {products.length > 0 && <View style={styles.grid}>{products.map(p => <ProductCard key={p.id} product={p} scope="search" width={(width - 40 - 12 * (cols - 1)) / cols} />)}</View>}
      {places.length > 0 && <View testID="search-places" style={styles.places}>
        <Text style={styles.section}>{query ? (town ? t('search.near.places', { town }) : t('search.near.placesYou')) : (town ? t('search.near.around', { town }) : t('search.near.aroundYou'))}</Text>
        {places.map(({ p, k }) => <PlaceRow key={p.id} p={p} kind={k} />)}
        <Text style={styles.credit}>{nearby?.source === 'Google' ? t('search.creditGoogle') : t('search.creditOsm')}</Text>
      </View>}
      {!products.length && !places.length && (nearbyLoading
        ? <View style={styles.empty}><Text style={styles.count}>{town ? t('search.near.finding', { town }) : t('search.near.findingYou')}</Text></View>
        : !!query && <View testID="search-no-results" style={styles.empty}><Icon name="search-outline" size={36} color={colors.muted} /><Text style={styles.title}>{t('search.noResults', { query })}</Text><Text style={styles.count}>{t('search.noResultsHint')}</Text></View>)}
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface }, titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, gap: 5 },
  back: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }, title: { fontSize: 20, fontWeight: '700', color: colors.onSurface, letterSpacing: -0.5 },
  inputWrap: { margin: 20, marginTop: 12, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingLeft: 14 }, input: { flex: 1, minHeight: 50, fontSize: 14, paddingHorizontal: 10, color: colors.onSurface },
  filters: { paddingHorizontal: 20, gap: 8 }, chip: { paddingHorizontal: 14, minHeight: 44, borderRadius: 24, justifyContent: 'center', backgroundColor: colors.cream }, active: { backgroundColor: colors.forest }, chipText: { fontSize: 11, fontWeight: '600', color: colors.onSurface }, activeText: { color: colors.surface },
  count: { margin: 20, color: colors.muted, fontSize: 12 }, results: { paddingBottom: 140, gap: 18 }, grid: { paddingHorizontal: 20, gap: 12, flexDirection: 'row', flexWrap: 'wrap' },
  recent: { paddingHorizontal: 20, gap: 10 }, recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, clear: { fontSize: 12, fontWeight: '700', color: colors.forest }, recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, recentChip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.cream }, recentText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  places: { paddingHorizontal: 16, gap: 10 }, section: { fontSize: 13, fontWeight: '800', color: colors.onSurface, marginLeft: 4, marginTop: 14 }, credit: { fontSize: 11, color: colors.muted, marginLeft: 4 }, empty: { width: '100%', alignItems: 'center', paddingTop: 25, gap: 15 },
});