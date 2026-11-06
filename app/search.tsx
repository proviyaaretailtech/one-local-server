import { useEffect, useMemo, useState } from 'react';
import { useAppDimensions } from '@/src/layout';
import { View, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, TextInput } from '@/src/ui/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { colors, lightPane, neuWell, radius } from '@/src/theme';
import { Tap } from '@/src/components/tap';
import { ChipRow } from '@/src/components/chip-row';
import { useBrowseCatalog } from '@/src/use-catalog';
import { ProductCard } from '@/src/components/product-card';
import { LoadState } from '@/src/components/catalog-sections';
import { departmentArt, departments, inDepartment, type DepartmentId } from '@/src/departments';
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
const DEPARTMENT_KEY = { food: 'search.dept.food', grocery: 'search.dept.grocery', shops: 'search.dept.shops', care: 'home.services.care' } as const;
const placeMatches = (p: NearbyPlace, text: string) => {
  const hay = normaliseQuery(`${p.name} ${p.type} ${p.cuisine ?? ''} ${p.address ?? ''}`);
  return text.split(' ').every(w => hay.includes(w));
};
export default function Search() {
  const { collection, q } = useLocalSearchParams<{ collection?: string; q?: string }>();
  const { t } = useTranslation(); const fmt = useFormat(); const insets = useSafeAreaInsets();
  const { data, isError, refetch } = useBrowseCatalog();
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
    {/* A light wash of the brand green, fading to white under the search. */}
    <LinearGradient pointerEvents="none" colors={[colors.cityMid, colors.cityFade, colors.surface]} locations={[0, 0.45, 1]} style={styles.wash} />
    <View style={[styles.titleRow, { paddingTop: insets.top + 10 }]}><Tap testID="search-back" accessibilityRole="button" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)' as any)} style={styles.back}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Tap><Text numberOfLines={1} style={styles.title}>{collection === 'budget' ? t('search.title.budget', { amount: fmt.money(BUDGET_LIMIT) }) : collection === 'trending' ? t('search.title.trending') : collection === 'picks' ? t('search.title.picks') : t('search.title.default')}</Text></View>
    <View style={styles.inputWrap}><Icon name="search" size={19} color={colors.forest} /><TextInput testID="search-input" value={query} onChangeText={setQuery} onSubmitEditing={() => remember(query)} placeholder={town ? t('search.near.placeholder', { town }) : t('search.near.placeholderYou')} placeholderTextColor={colors.muted} style={styles.input} autoFocus={!collection} returnKeyType="search" />{!!query && <Tap testID="clear-search" accessibilityRole="button" accessibilityLabel={t('search.clear')} haptic={false} hitSlop={8} onPress={() => setQuery('')} style={styles.clearInput}><Icon name="close" size={14} color={colors.surface} /></Tap>}</View>
    <View><ChipRow selected={department} onSelect={setDepartment} contentContainerStyle={styles.filters} chips={[
      { id: 'all', testID: 'search-filter-all', label: t('search.everything') },
      ...departments.filter(d => d.id !== 'book-it').map(d => ({ id: d.id, testID: `search-filter-${d.id}`, label: departmentLabel(d), lead: () => <Image source={departmentArt[d.id as DepartmentId]} style={styles.chipIcon} contentFit="contain" cachePolicy="memory-disk" /> })),
    ]} /></View>
    {!query && recent.length > 0 && <View testID="search-recent" style={styles.recent}>
      <View style={styles.recentHead}><Text style={styles.section}>{t('search.recent')}</Text><Tap testID="search-recent-clear" accessibilityRole="button" haptic={false} onPress={() => { void clearRecent(); setRecent([]); }} hitSlop={8}><Text style={styles.clear}>{t('search.clearRecent')}</Text></Tap></View>
      <View style={styles.recentChips}>{recent.map(r => <Tap key={r} testID={`search-recent-${r}`} accessibilityRole="button" onPress={() => { setQuery(r); remember(r); }} style={styles.recentChip}><Icon name="time-outline" size={14} color={colors.forest} /><Text style={styles.recentText}>{r}</Text></Tap>)}</View>
    </View>}
    {(!!query || products.length > 0) && <Text testID="search-result-count" style={styles.count}>{t('search.finds', { value: fmt.number(products.length + (query ? places.length : 0)) })}</Text>}
    {/* With no query every product shows, so only the rows on screen are drawn: opening, typing and leaving stay light. */}
    <FlatList key={cols} data={products} numColumns={cols} keyExtractor={p => p.id} initialNumToRender={cols * 3} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results} columnWrapperStyle={styles.row} ItemSeparatorComponent={RowGap}
      renderItem={({ item }) => <ProductCard product={item} scope="search" width={(width - SIDE * 2 - 12 * (cols - 1)) / cols} />}
      ListFooterComponentStyle={products.length > 0 && styles.afterGrid} ListFooterComponent={<>
      {places.length > 0 && <View testID="search-places" style={styles.places}>
        <Text style={styles.section}>{query ? (town ? t('search.near.places', { town }) : t('search.near.placesYou')) : (town ? t('search.near.around', { town }) : t('search.near.aroundYou'))}</Text>
        {places.map(({ p, k }) => <PlaceRow key={p.id} p={p} kind={k} />)}
        <Text style={styles.credit}>{nearby?.source === 'Google' ? t('search.creditGoogle') : t('search.creditOsm')}</Text>
      </View>}
      {!products.length && !places.length && (nearbyLoading
        ? <View style={styles.empty}><Text style={styles.emptyHint}>{town ? t('search.near.finding', { town }) : t('search.near.findingYou')}</Text></View>
        : !!query && <View testID="search-no-results" style={styles.empty}><View style={styles.emptyWell}><Icon name="search-outline" size={26} color={colors.forest} /></View><Text style={styles.emptyTitle}>{t('search.noResults', { query })}</Text><Text style={styles.emptyHint}>{t('search.noResultsHint')}</Text></View>)}
    </>} />
  </KeyboardAvoidingView>;
}
const SIDE = 16;
const RowGap = () => <View style={styles.rowGap} />;
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SIDE },
  back: { ...lightPane, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5, color: colors.onSurface },
  // The same raised soft pill as the brand header's search bar.
  inputWrap: { ...lightPane, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SIDE, marginTop: 16, marginBottom: 14, paddingLeft: 16, paddingRight: 8, minHeight: 52, borderRadius: radius.pill },
  input: { flex: 1, minHeight: 50, fontSize: 14, color: colors.onSurface },
  clearInput: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted },
  filters: { paddingHorizontal: SIDE, paddingBottom: 4, gap: 8 },
  chipIcon: { width: 30, height: 30 },
  count: { marginHorizontal: SIDE, marginTop: 18, marginBottom: 14, fontSize: 12, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase', color: colors.muted },
  results: { paddingBottom: 140 },
  row: { paddingHorizontal: SIDE, gap: 12 },
  rowGap: { height: 20 },
  afterGrid: { marginTop: 18 },
  recent: { paddingHorizontal: SIDE, marginTop: 18, gap: 10 },
  recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clear: { fontSize: 13, fontWeight: '700', color: colors.forest },
  recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentChip: { ...lightPane, minHeight: 36, paddingHorizontal: 12, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6 },
  recentText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  places: { paddingHorizontal: SIDE, gap: 10 },
  section: { fontSize: 18, lineHeight: 23, fontWeight: '800', letterSpacing: -0.3, color: colors.onSurface },
  credit: { fontSize: 11, color: colors.muted },
  empty: { width: '100%', alignItems: 'center', paddingTop: 40, paddingHorizontal: 32, gap: 12 },
  emptyWell: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary, boxShadow: neuWell },
  emptyTitle: { fontSize: 17, lineHeight: 22, fontWeight: '800', textAlign: 'center', color: colors.onSurface },
  emptyHint: { fontSize: 13, lineHeight: 19, textAlign: 'center', color: colors.muted },
});
