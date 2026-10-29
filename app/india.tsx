// Browse all of India without typing: state → district → every city, town and village in it.
// Choosing a place sets it as the customer's location and goes home.
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { useDeliveryLocation } from '@/src/delivery-location';
import { listDistricts, listPlaces, listStates, placeLine, rememberPlace } from '@/src/places';
import { colors } from '@/src/theme';
import { useFormat, useTranslation } from '@/src/i18n';

// A row keeps the raw kind and population (not a sentence), so what a person reads is made at render time
// and follows the language even though the list itself is cached.
type Row = { key: string; title: string; kind?: keyof typeof KIND_TEXT; population?: number; onPress: () => void };
const KIND_TEXT = { city: 'india.kindCity', town: 'india.kindTown', locality: 'india.kindLocality', village: 'india.kindVillage' } as const;

export default function BrowseIndia() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const delivery = useDeliveryLocation(); const { t } = useTranslation(); const fmt = useFormat();
  const { state, district, name } = useLocalSearchParams<{ state?: string; district?: string; name?: string }>();
  const [filter, setFilter] = useState('');
  const level = district ? 'places' : state ? 'districts' : 'states';
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['india', state ?? '', district ?? ''], staleTime: Infinity,
    queryFn: async (): Promise<Row[]> => {
      if (level === 'states') return (await listStates()).map(s => ({ key: s.code, title: s.name, onPress: () => router.push(`/india?state=${s.code}&name=${encodeURIComponent(s.name)}` as never) }));
      if (level === 'districts') return (await listDistricts(state!)).map(d => ({ key: d.code, title: d.name, onPress: () => router.push(`/india?state=${state}&district=${d.code}&name=${encodeURIComponent(d.name)}` as never) }));
      return (await listPlaces(state!, district!)).map(p => ({
        key: p.id, title: p.name, kind: p.kind, population: p.population,
        onPress: () => {
          const line = placeLine(p);
          delivery.setLocation(`${p.name}, ${line}`, { lat: p.lat, lng: p.lng });
          void rememberPlace({ title: p.name, subtitle: line, lat: p.lat, lng: p.lng });
          router.dismissTo('/(tabs)' as never);
        },
      }));
    },
  });
  const rows = useMemo(() => { const f = filter.trim().toLowerCase(); return (data ?? []).filter(r => !f || r.title.toLowerCase().includes(f)); }, [data, filter]);
  const title = level === 'states' ? t('india.all') : name ?? '';
  const hint = level === 'states' ? t('india.filterStates') : level === 'districts' ? t('india.filterDistricts') : t('india.filterPlaces');
  const rowSub = (r: Row) => !r.kind ? undefined : r.population ? t('india.kindPeople', { kind: t(KIND_TEXT[r.kind]), value: fmt.number(r.population) }) : t(KIND_TEXT[r.kind]);

  return <View testID="browse-india-screen" style={[s.screen, { paddingTop: insets.top }]}>
    <View style={s.header}>
      <Pressable testID="browse-india-back" accessibilityLabel={t('common.goBack')} onPress={() => router.back()} style={s.back}><Icon name="arrow-back" size={21} color={colors.onSurface} /></Pressable>
      <View style={s.flex}><Text style={s.title} numberOfLines={1}>{title}</Text><Text style={s.sub}>{level === 'states' ? t('india.chooseState') : level === 'districts' ? t('india.chooseDistrict') : t('india.placesHint')}</Text></View>
    </View>
    <View style={s.search}><Icon name="funnel-outline" size={16} color={colors.muted} /><TextInput testID="browse-india-filter" value={filter} onChangeText={setFilter} placeholder={hint} placeholderTextColor={colors.muted} style={s.input} autoCorrect={false} /></View>
    {isLoading && <ActivityIndicator style={s.pad} color={colors.forest} />}
    {isError && <Pressable onPress={() => refetch()} style={s.pad}><Text style={s.sub}>{t('india.loadFailed')}</Text></Pressable>}
    <FlatList data={rows} keyExtractor={r => r.key} keyboardShouldPersistTaps="handled" initialNumToRender={30}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 30 }}
      renderItem={({ item, index }) => <Pressable testID={`browse-row-${index}`} onPress={item.onPress} style={[s.row, index > 0 && s.divider]}>
        <View style={s.flex}><Text style={s.rowTitle}>{item.title}</Text>{!!item.kind && <Text style={s.rowSub}>{rowSub(item)}</Text>}</View>
        <Icon name="chevron-forward" size={16} color={colors.muted} />
      </Pressable>} />
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 60 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  title: { fontSize: 18, fontWeight: '800', color: colors.onSurface },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  search: { margin: 16, marginTop: 4, minHeight: 44, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceSecondary },
  input: { flex: 1, fontSize: 15, color: colors.onSurface, minHeight: 42 },
  pad: { padding: 24, alignItems: 'center' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
