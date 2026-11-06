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
import { IndiaPlace, listDistricts, listPlaces, listStates, placeLine, rememberPlace } from '@/src/places';
import { Wash, accountStyles as a } from '@/src/components/account-layout';
import { ListRow } from '@/src/ui/list-row';
import { colors, lightPane, radius, soft } from '@/src/theme';
import { safeLineHeight, useFormat, useTranslation } from '@/src/i18n';

// A row keeps the raw kind and population (not a sentence), so what a person reads is made at render time
// and follows the language even though the list itself is cached.
type Row = { key: string; title: string; kind?: IndiaPlace['kind']; population?: number; onPress: () => void };
const KIND_TEXT = { city: 'india.kindCity', town: 'india.kindTown', locality: 'india.kindLocality', village: 'india.kindVillage' } as const;
const KIND_ICON = { city: 'business-outline', town: 'business-outline', locality: 'navigate-circle-outline', village: 'leaf-outline' } as const;

export default function BrowseIndia() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const delivery = useDeliveryLocation(); const { t } = useTranslation(); const fmt = useFormat();
  const { state, district, name } = useLocalSearchParams<{ state?: string; district?: string; name?: string }>();
  const [filter, setFilter] = useState('');
  const level = district ? 'places' : state ? 'districts' : 'states';
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['india', state ?? '', district ?? ''], staleTime: Infinity,
    queryFn: async (): Promise<Row[]> => {
      if (level === 'states') return (await listStates()).map(s => ({ key: s.code, title: s.name, onPress: () => router.push(`/india?state=${s.code}&name=${encodeURIComponent(s.name)}`) }));
      if (level === 'districts') return (await listDistricts(state!)).map(d => ({ key: d.code, title: d.name, onPress: () => router.push(`/india?state=${state}&district=${d.code}&name=${encodeURIComponent(d.name)}`) }));
      return (await listPlaces(state!, district!)).map(p => ({
        key: p.id, title: p.name, kind: p.kind, population: p.population,
        onPress: () => {
          const line = placeLine(p);
          delivery.setLocation(`${p.name}, ${line}`, { lat: p.lat, lng: p.lng });
          void rememberPlace({ title: p.name, subtitle: line, lat: p.lat, lng: p.lng });
          router.dismissTo('/(tabs)');
        },
      }));
    },
  });
  const rows = useMemo(() => { const f = filter.trim().toLowerCase(); return (data ?? []).filter(r => !f || r.title.toLowerCase().includes(f)); }, [data, filter]);
  const title = level === 'states' ? t('india.all') : name ?? '';
  const hint = level === 'states' ? t('india.filterStates') : level === 'districts' ? t('india.filterDistricts') : t('india.filterPlaces');
  const rowSub = (r: Row) => !r.kind ? undefined : r.population ? t('india.kindPeople', { kind: t(KIND_TEXT[r.kind]), value: fmt.number(r.population) }) : t(KIND_TEXT[r.kind]);
  const icon = (r: Row) => (r.kind ? KIND_ICON[r.kind] : level === 'states' ? 'map-outline' : 'location-outline');

  return <View testID="browse-india-screen" style={s.screen}>
    <Wash />
    <View style={[s.bar, { paddingTop: insets.top + 8 }]}>
      <Pressable testID="browse-india-back" accessibilityRole="button" accessibilityLabel={t('common.goBack')} onPress={() => router.back()} style={s.round}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
      <View style={a.flex}>
        <Text accessibilityRole="header" style={s.title} numberOfLines={1}>{title}</Text>
        <Text style={s.sub}>{level === 'states' ? t('india.chooseState') : level === 'districts' ? t('india.chooseDistrict') : t('india.placesHint')}</Text>
      </View>
    </View>
    <View style={s.search}>
      <Icon name="search" size={18} color={colors.forest} />
      <TextInput testID="browse-india-filter" accessibilityLabel={hint} value={filter} onChangeText={setFilter} placeholder={hint} placeholderTextColor={colors.muted} style={s.input} autoCorrect={false} />
    </View>
    {isLoading && <ActivityIndicator style={s.pad} color={colors.forest} />}
    {isError && <Pressable accessibilityRole="button" onPress={() => refetch()} style={[a.card, s.failed]}><Text style={a.hint}>{t('india.loadFailed')}</Text></Pressable>}
    <FlatList data={rows} keyExtractor={r => r.key} keyboardShouldPersistTaps="handled" initialNumToRender={30}
      style={s.list} contentContainerStyle={rows.length ? [s.card, { marginBottom: insets.bottom + 30 }] : undefined}
      ItemSeparatorComponent={() => <View style={s.line} />}
      renderItem={({ item, index }) => <ListRow testID={`browse-row-${index}`} icon={icon(item)} title={item.title} subtitle={rowSub(item)} onPress={item.onPress} />} />
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  round: { ...lightPane, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.onSurface, fontSize: 24, lineHeight: safeLineHeight(24), fontWeight: '800', letterSpacing: -0.6 },
  sub: { color: colors.inkSoft, fontSize: 13, lineHeight: 18 },
  search: { marginHorizontal: 16, marginBottom: 14, height: 52, borderRadius: radius.pill, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, boxShadow: soft.lifted },
  input: { flex: 1, fontSize: 15, color: colors.onSurface, minHeight: 48 },
  pad: { padding: 24 },
  failed: { marginHorizontal: 16 },
  list: { flex: 1 },
  // The whole list sits on one white card, like the other lists.
  card: { marginHorizontal: 16, marginTop: 2, borderRadius: radius.md, backgroundColor: colors.surface, boxShadow: soft.lifted },
  line: { height: 1, marginLeft: 70, backgroundColor: colors.border },
});
