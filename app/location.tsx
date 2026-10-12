// Choose where you are: any city, town or village in India (our own list — free, instant), the
// current location, popular cities, a state-by-state browser, saved delivery addresses and recent
// places. Street-level address search (Google) joins in once the Maps key is set. On first launch
// this screen asks "Where are you?" and can be skipped (Latur).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { randomId } from '@/src/api';
import { Address, useCustomer } from '@/src/customer';
import { Point, useDeliveryLocation } from '@/src/delivery-location';
import { useFeatures } from '@/src/features';
import {
  addressText, CITY_CENTER, coverageAt, currentPoint, distanceKm, IndiaPlace, isLocationError, knownPoint, LocationOffError, placeDetails, placeLine, popularCities,
  Recent, recentPlaces, rememberPlace, searchIndia, searchPlaces, Suggestion,
} from '@/src/places';
import { useErrorMessage, useFormat, useTranslation } from '@/src/i18n';
import { colors } from '@/src/theme';

const kindIcon = (a: Address) => (a.kind === 'work' || a.label === 'Work' ? 'briefcase-outline' : a.kind === 'other' || a.label === 'Other' ? 'location-outline' : 'home-outline');
const mapHref = (p?: Point | null, extra = '') => `/address-map?${p ? `lat=${p.lat}&lng=${p.lng}` : ''}${extra}` as never;
const KIND_KEY = { city: 'location.kind.city', town: 'location.kind.town', locality: 'location.kind.locality', village: 'location.kind.village' } as const;

export default function LocationPicker() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { first } = useLocalSearchParams<{ first?: string }>();
  const { t } = useTranslation(); const fmt = useFormat(); const message = useErrorMessage();
  const { addresses, update } = useCustomer(); const delivery = useDeliveryLocation(); const { maps } = useFeatures();
  const session = useRef(randomId(16)).current;
  const [query, setQuery] = useState(''); const [places, setPlaces] = useState<IndiaPlace[]>([]); const [streets, setStreets] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false); const [error, setError] = useState(''); const [locating, setLocating] = useState(false);
  const [here, setHere] = useState<Point | null>(null); const [recent, setRecent] = useState<Recent[]>([]); const [menu, setMenu] = useState('');
  const [settings, setSettings] = useState(false); // location refused for good: offer the way to Settings
  const { data: popular = [] } = useQuery({ queryKey: ['popular-cities'], queryFn: popularCities, staleTime: Infinity });

  useEffect(() => { knownPoint().then(setHere); recentPlaces().then(setRecent); }, []);

  // Debounced search: towns and villages from our own list always; street addresses from Google
  // only when Maps is switched on (each visit to this screen is one billing session there).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setPlaces([]); setStreets([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      const around = here ?? delivery.point;
      Promise.all([
        searchIndia(q, around).catch(e => { setError(message(e)); return [] as IndiaPlace[]; }),
        maps ? searchPlaces(q, session, around).catch(() => [] as Suggestion[]) : Promise.resolve([] as Suggestion[]),
      ]).then(([p, s]) => { setPlaces(p); setStreets(s); if (p.length || s.length) setError(''); }).finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, session, here, delivery.point, maps, message]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)' as never));
  const choosePlace = (p: Pick<IndiaPlace, 'name' | 'district' | 'state' | 'lat' | 'lng'>) => {
    const line = placeLine(p);
    delivery.setLocation(line ? `${p.name}, ${line}` : p.name, { lat: p.lat, lng: p.lng });
    void rememberPlace({ title: p.name, subtitle: line, lat: p.lat, lng: p.lng });
    router.replace('/(tabs)' as never);
  };
  const pickStreet = async (s: Suggestion) => {
    try {
      const place = await placeDetails(s.place_id, session);
      await rememberPlace({ title: s.title, subtitle: s.subtitle, lat: place.lat, lng: place.lng });
      router.push(mapHref(place));
    } catch (e) { setError(message(e)); }
  };
  // Current location names the town it falls in (no Google needed), and browsing starts there.
  const useCurrent = async () => {
    setLocating(true); setError(''); setSettings(false);
    try {
      const p = await currentPoint(); setHere(p);
      const c = await coverageAt(p);
      if (c.place) choosePlace({ ...c.place, lat: p.lat, lng: p.lng });
      else { delivery.setLocation(t('location.current'), p); router.replace('/(tabs)' as never); }
    } catch (e) {
      setError(Platform.OS === 'web' && e instanceof LocationOffError ? t('location.webOff') : isLocationError(e) ? e.message : message(e));
      setSettings(e instanceof LocationOffError && !e.canAskAgain && Platform.OS !== 'web');
    }
    finally { setLocating(false); }
  };
  const choose = (a: Address) => {
    delivery.setLocation(addressText(a), a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null);
    close();
  };
  const remove = async (a: Address) => { setMenu(''); await update({ addresses: addresses.filter(x => x.id !== a.id) }); };
  const selected = useMemo(() => addresses.find(a => addressText(a) === delivery.location)?.id, [addresses, delivery.location]);
  const searchingNow = query.trim().length >= 2;

  return (
    <View testID="location-screen" style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {!first && <Pressable testID="location-back" accessibilityLabel={t('common.goBack')} onPress={close} style={styles.back}><Icon name="arrow-back" size={21} color={colors.onSurface} /></Pressable>}
        <Text style={[styles.title, !!first && styles.firstTitle]}>{first ? t('location.title.first') : t('location.title.choose')}</Text>
        {!!first && <Pressable testID="location-skip" onPress={() => choosePlace({ name: 'Latur', district: 'Latur', state: 'Maharashtra', ...CITY_CENTER })} style={styles.skip}><Text style={styles.skipText}>{t('common.skip')}</Text></Pressable>}
      </View>
      {!!first && <Text style={styles.lede}>{t('location.lede')}</Text>}
      <View style={styles.search}>
        <Icon name="search-outline" size={18} color={colors.muted} />
        <TextInput testID="location-search" value={query} onChangeText={setQuery} placeholder={maps ? t('location.searchMaps') : t('location.searchPlain')} placeholderTextColor={colors.muted} style={styles.input} autoCorrect={false} returnKeyType="search" />
        {searching ? <ActivityIndicator size="small" color={colors.forest} /> : !!query && <Pressable accessibilityLabel={t('search.clear')} onPress={() => setQuery('')} hitSlop={10}><Icon name="close-circle" size={18} color={colors.muted} /></Pressable>}
      </View>
      {!!error && <Text testID="location-error" style={styles.error}>{error}</Text>}
      {settings && <Pressable testID="location-open-settings" onPress={() => Linking.openSettings().catch(() => {})} style={styles.settings}><Icon name="settings-outline" size={15} color={colors.forest} /><Text style={styles.settingsText}>{t('location.openSettings')}</Text></Pressable>}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]} keyboardShouldPersistTaps="handled">
        {searchingNow ? (
          <>
            <View style={styles.card}>
              {!searching && !places.length && !streets.length && <Text style={styles.muted}>{t('location.noPlaces')}</Text>}
              {places.map((p, i) => (
                <Pressable key={p.id} testID={`india-result-${i}`} onPress={() => choosePlace(p)} style={[styles.row, i > 0 && styles.divider]}>
                  <View style={styles.rowIcon}><Icon name={p.kind === 'village' ? 'leaf-outline' : p.kind === 'locality' ? 'navigate-circle-outline' : 'business-outline'} size={17} color={colors.onSurface} /></View>
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={2}>{[t(KIND_KEY[p.kind]), placeLine(p), p.distance_km != null ? fmt.distance(p.distance_km) : ''].filter(Boolean).join(' · ')}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
            {!!streets.length && <Text style={styles.section}>{t('location.section.streets')}</Text>}
            {!!streets.length && <View style={styles.card}>
              {streets.map((r, i) => (
                <Pressable key={r.place_id} testID={`place-result-${i}`} onPress={() => pickStreet(r)} style={[styles.row, i > 0 && styles.divider]}>
                  <View style={styles.rowIcon}><Icon name="location-outline" size={17} color={colors.onSurface} /></View>
                  <View style={styles.flex}><Text style={styles.rowTitle} numberOfLines={1}>{r.title}</Text><Text style={styles.rowSub} numberOfLines={2}>{r.subtitle}</Text></View>
                </Pressable>
              ))}
            </View>}
          </>
        ) : (
          <>
            <View style={styles.actions}>
              <Pressable testID="use-current-location" onPress={useCurrent} style={styles.action}>
                {locating ? <ActivityIndicator color={colors.forest} /> : <Icon name="locate" size={20} color={colors.forest} />}
                <Text style={styles.actionText}>{t('location.useCurrent')}</Text>
              </Pressable>
              <Pressable testID="add-new-address" onPress={() => router.push(mapHref(here ?? delivery.point ?? CITY_CENTER))} style={styles.action}>
                <Icon name="add-circle-outline" size={20} color={colors.forest} />
                <Text style={styles.actionText}>{t('location.addAddress')}</Text>
              </Pressable>
            </View>

            {!!addresses.length && <Text style={styles.section}>{t('location.section.saved')}</Text>}
            {!!addresses.length && (
              <View style={styles.card}>
                {addresses.map((a, i) => {
                  const km = here && a.lat != null && a.lng != null ? distanceKm(here, { lat: a.lat, lng: a.lng }) : null;
                  return (
                    <View key={a.id} style={[styles.row, i > 0 && styles.divider]}>
                      <Pressable testID={`saved-address-${a.id}`} onPress={() => choose(a)} style={styles.rowMain}>
                        <View style={styles.rowIcon}><Icon name={kindIcon(a) as never} size={17} color={colors.onSurface} />{km != null && <Text style={styles.km}>{fmt.distance(km)}</Text>}</View>
                        <View style={styles.flex}>
                          <View style={styles.labelRow}><Text style={styles.rowTitle}>{a.label}</Text>{selected === a.id && <Text style={styles.badge}>{t('location.selected')}</Text>}</View>
                          <Text style={styles.rowSub} numberOfLines={2}>{[a.line, a.locality || a.area, a.pin].filter(Boolean).join(', ')}</Text>
                        </View>
                      </Pressable>
                      <Pressable testID={`address-menu-${a.id}`} accessibilityLabel={t('location.optionsFor', { label: a.label })} onPress={() => setMenu(menu === a.id ? '' : a.id)} hitSlop={8} style={styles.more}><Icon name="ellipsis-vertical" size={17} color={colors.muted} /></Pressable>
                      {menu === a.id && (
                        <View style={styles.menu}>
                          <Pressable testID={`edit-address-${a.id}`} onPress={() => { setMenu(''); router.push(a.lat != null && a.lng != null ? mapHref({ lat: a.lat, lng: a.lng }, `&id=${a.id}`) : (`/address-form?id=${a.id}&manual=1` as never)); }} style={styles.menuItem}><Text style={styles.menuText}>{t('common.edit')}</Text></Pressable>
                          <Pressable testID={`delete-address-${a.id}`} onPress={() => remove(a)} style={styles.menuItem}><Text style={[styles.menuText, { color: colors.onError }]}>{t('common.delete')}</Text></Pressable>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {!!recent.length && <Text style={styles.section}>{t('location.section.recent')}</Text>}
            {!!recent.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {recent.map((r, i) => <Pressable key={`${r.title}-${i}`} testID={`recent-place-${i}`} onPress={() => choosePlace({ name: r.title, district: null, state: r.subtitle, lat: r.lat, lng: r.lng })} style={styles.chip}><Icon name="time-outline" size={14} color={colors.muted} /><Text style={styles.chipText}>{r.title}</Text></Pressable>)}
            </ScrollView>}

            <Text style={styles.section}>{t('location.section.live')}</Text>
            <Pressable testID="live-city-latur" onPress={() => choosePlace({ name: 'Latur', district: 'Latur', state: 'Maharashtra', ...CITY_CENTER })} style={styles.live}>
              <View style={styles.liveMark}><Icon name="bicycle" size={20} color={colors.forest} /></View>
              <View style={styles.flex}><Text style={styles.rowTitle}>Latur</Text><Text style={styles.rowSub}>{t('location.liveBlurb')}</Text></View>
              <Icon name="chevron-forward" size={18} color={colors.forest} />
            </Pressable>

            {!!popular.length && <Text style={styles.section}>{t('location.section.popular')}</Text>}
            <View style={styles.tiles}>
              {popular.map(p => <Pressable key={p.id} testID={`popular-${p.name.toLowerCase()}`} onPress={() => choosePlace(p)} style={styles.tile}>
                <Text style={styles.tileMark}>{p.name.slice(0, 1)}</Text>
                <Text style={styles.tileName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.tileState} numberOfLines={1}>{p.state}</Text>
              </Pressable>)}
            </View>

            <Pressable testID="browse-india" onPress={() => router.push('/india' as never)} style={styles.browse}>
              <Icon name="map-outline" size={20} color={colors.forest} />
              <View style={styles.flex}><Text style={styles.rowTitle}>{t('location.browse.title')}</Text><Text style={styles.rowSub}>{t('location.browse.sub')}</Text></View>
              <Icon name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 54 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.onSurface },
  firstTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.6, paddingLeft: 6, paddingTop: 8 },
  skip: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  skipText: { fontSize: 14, fontWeight: '700', color: colors.forest },
  lede: { marginHorizontal: 18, marginBottom: 12, fontSize: 14, lineHeight: 20, color: colors.muted },
  search: { marginHorizontal: 16, minHeight: 50, borderRadius: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, fontSize: 15, color: colors.onSurface, minHeight: 48 },
  error: { marginHorizontal: 18, marginTop: 10, fontSize: 13, lineHeight: 18, color: colors.onError },
  settings: { marginHorizontal: 18, marginTop: 6, minHeight: 40, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 },
  settingsText: { fontSize: 13, fontWeight: '700', color: colors.forest },
  content: { padding: 16, gap: 10 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 78, borderRadius: 18, padding: 14, gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  actionText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  section: { marginTop: 14, fontSize: 11, letterSpacing: 1.2, fontWeight: '700', color: colors.muted },
  card: { borderRadius: 18, backgroundColor: colors.surface, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  rowMain: { flex: 1, flexDirection: 'row', gap: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
  rowIcon: { minWidth: 42, minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary, paddingVertical: 4 },
  km: { fontSize: 11, color: colors.muted, marginTop: 2, textAlign: 'center' },
  flex: { flex: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  rowSub: { marginTop: 3, fontSize: 12, lineHeight: 17, color: colors.muted },
  badge: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: colors.forest, backgroundColor: colors.limeSoft, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  more: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  menu: { position: 'absolute', right: 30, top: 12, zIndex: 5, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingVertical: 4, boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 12, color: colors.shadow }] },
  menuItem: { paddingHorizontal: 16, paddingVertical: 12, minWidth: 110 },
  menuText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  muted: { paddingVertical: 16, fontSize: 13, color: colors.muted },
  chips: { gap: 8 },
  chip: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  live: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.limeSoft, borderWidth: 1, borderColor: colors.lime },
  liveMark: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '30%', flexGrow: 1, minHeight: 84, borderRadius: 18, padding: 12, justifyContent: 'flex-end', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tileMark: { position: 'absolute', top: 6, right: 10, fontSize: 34, fontWeight: '800', color: colors.cityMid },
  tileName: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  tileState: { fontSize: 11, color: colors.muted },
  browse: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
