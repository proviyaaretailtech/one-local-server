// Choose where you are: any city, town or village in India (our own list — free, instant), the
// current location, popular cities, a state-by-state browser, saved delivery addresses and recent
// places. Street-level address search (Google) joins in once the Maps key is set. On first launch
// this screen asks "Where are you?" and can be skipped (Latur).
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { randomId } from '@/src/api';
import { Address, useCustomer } from '@/src/customer';
import { Point, useDeliveryLocation } from '@/src/delivery-location';
import { useFeatures } from '@/src/features';
import { COMING_SOON_ALL } from '@/src/coming-soon-mode';
import {
  addressText, areaName, CITY_CENTER, coverageAt, currentPoint, distanceKm, IndiaPlace, isLocationError, knownPoint, LocationOffError, placeDetails, placeLine, popularCities,
  Recent, recentPlaces, rememberPlace, searchIndia, searchPlaces, Suggestion,
} from '@/src/places';
import { safeLineHeight, useErrorMessage, useFormat, useTranslation } from '@/src/i18n';
import { Group, Message, Wash, accountStyles as a } from '@/src/components/account-layout';
import { Button } from '@/src/ui/button';
import { ListGroup, ListRow } from '@/src/ui/list-row';
import { Sheet } from '@/src/ui/sheet';
import { colors, lightPane, popBase, radius, soft } from '@/src/theme';

const kindIcon = (x: Address) => (x.kind === 'work' || x.label === 'Work' ? 'briefcase-outline' : x.kind === 'other' || x.label === 'Other' ? 'location-outline' : 'home-outline');
const placeIcon = (p: IndiaPlace) => (p.kind === 'village' ? 'leaf-outline' : p.kind === 'locality' ? 'navigate-circle-outline' : 'business-outline');
const mapHref = (p?: Point | null, extra = '') => `/address-map?${p ? `lat=${p.lat}&lng=${p.lng}` : ''}${extra}` as Href;
const KIND_KEY = { city: 'location.kind.city', town: 'location.kind.town', locality: 'location.kind.locality', village: 'location.kind.village' } as const;
const LATUR = { name: 'Latur', district: 'Latur', state: 'Maharashtra', ...CITY_CENTER }; // i18n-ignore: a town's name is data

export default function LocationPicker() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { first, back } = useLocalSearchParams<{ first?: string; back?: string }>();
  const { t } = useTranslation(); const fmt = useFormat(); const message = useErrorMessage();
  const { addresses, update } = useCustomer(); const delivery = useDeliveryLocation(); const { maps } = useFeatures();
  const [session] = useState(() => randomId(16));
  const [query, setQuery] = useState(''); const [places, setPlaces] = useState<IndiaPlace[]>([]); const [streets, setStreets] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false); const [error, setError] = useState(''); const [locating, setLocating] = useState(false);
  const [here, setHere] = useState<Point | null>(null); const [recent, setRecent] = useState<Recent[]>([]); const [menu, setMenu] = useState('');
  const [settings, setSettings] = useState(false); // location refused for good: offer the way to Settings
  const [sheet, setSheet] = useState(false); // location refused: offer cities instead of a dead end
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

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));
  // Opened from the "One last step" screen (back=1): return to it, so what was typed there is kept.
  const done = () => (back && router.canGoBack() ? router.back() : router.replace('/(tabs)'));
  const choosePlace = (p: Pick<IndiaPlace, 'name' | 'district' | 'state' | 'lat' | 'lng'>) => {
    const line = placeLine(p);
    delivery.setLocation(line ? `${p.name}, ${line}` : p.name, { lat: p.lat, lng: p.lng });
    void rememberPlace({ title: p.name, subtitle: line, lat: p.lat, lng: p.lng });
    done();
  };
  const pickStreet = async (s: Suggestion) => {
    try {
      const place = await placeDetails(s.place_id, session);
      await rememberPlace({ title: s.title, subtitle: s.subtitle, lat: place.lat, lng: place.lng });
      // First run and the coming-soon build: take the place as it is and carry on (the pin-on-map screen saves an
      // address, which is not open there, so it used to stop onboarding on the coming-soon page).
      if (first || COMING_SOON_ALL) { delivery.setLocation(s.subtitle ? `${s.title}, ${s.subtitle}` : s.title, { lat: place.lat, lng: place.lng }); done(); return; }
      router.push(mapHref(place));
    } catch (e) { setError(message(e)); }
  };
  // Current location: the area the phone's map service names (Baner, Pune) where it can, else the town it falls in from
  // our own list (no Google needed), and browsing starts there.
  const useCurrent = async () => {
    setLocating(true); setError(''); setSettings(false);
    try {
      const p = await currentPoint(); setHere(p);
      const area = await areaName(p);
      if (area) {
        const [title, ...rest] = area.split(', ');
        delivery.setLocation(area, p); void rememberPlace({ title, subtitle: rest.join(', '), lat: p.lat, lng: p.lng }); done();
        return;
      }
      const c = await coverageAt(p);
      if (c.place) choosePlace({ ...c.place, lat: p.lat, lng: p.lng });
      else { delivery.setLocation(t('location.current'), p); done(); }
    } catch (e) {
      if (e instanceof LocationOffError) setSheet(true);
      else setError(isLocationError(e) ? e.message : message(e));
      setSettings(e instanceof LocationOffError && !e.canAskAgain && Platform.OS !== 'web');
    }
    finally { setLocating(false); }
  };
  const choose = (x: Address) => {
    delivery.setLocation(addressText(x), x.lat != null && x.lng != null ? { lat: x.lat, lng: x.lng } : null);
    close();
  };
  const remove = async (x: Address) => { setMenu(''); await update({ addresses: addresses.filter(y => y.id !== x.id) }); };
  const selected = useMemo(() => addresses.find(x => addressText(x) === delivery.location)?.id, [addresses, delivery.location]);
  const searchingNow = query.trim().length >= 2;
  const openSettings = () => Linking.openSettings().catch(() => {});

  return (
    <View testID="location-screen" style={s.screen}>
      <Wash />
      <View style={[s.bar, { paddingTop: insets.top + 8 }]}>
        {!first && <Pressable testID="location-back" accessibilityRole="button" accessibilityLabel={t('common.goBack')} onPress={close} style={s.round}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>}
        <Text accessibilityRole="header" style={[s.title, !!first && s.firstTitle]}>{first ? t('location.title.first') : t('location.title.choose')}</Text>
        {!!first && <Pressable testID="location-skip" accessibilityRole="button" onPress={() => choosePlace(LATUR)} style={s.skip}><Text style={s.skipText}>{t('common.skip')}</Text></Pressable>}
      </View>
      {!!first && <Text style={s.lede}>{t('location.lede')}</Text>}
      <View style={s.search}>
        <Icon name="search" size={18} color={colors.forest} />
        <TextInput testID="location-search" accessibilityLabel={maps ? t('location.searchMaps') : t('location.searchPlain')} value={query} onChangeText={setQuery} placeholder={maps ? t('location.searchMaps') : t('location.searchPlain')} placeholderTextColor={colors.muted} style={s.input} autoCorrect={false} returnKeyType="search" />
        {searching ? <ActivityIndicator size="small" color={colors.forest} /> : !!query && <Pressable accessibilityLabel={t('search.clear')} onPress={() => setQuery('')} hitSlop={10}><Icon name="close-circle" size={18} color={colors.muted} /></Pressable>}
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 30 }]} keyboardShouldPersistTaps="handled">
        <Message id="location-error" text={error} error />
        {settings && <Button testID="location-open-settings" variant="quiet" icon="settings-outline" title={t('location.openSettings')} onPress={openSettings} />}
        {searchingNow ? <>
          {!searching && !places.length && !streets.length ? <View style={a.card}><Text style={a.hint}>{t('location.noPlaces')}</Text></View>
            : !!places.length && <ListGroup>{places.map((p, i) => <ListRow key={p.id} testID={`india-result-${i}`} icon={placeIcon(p)} title={p.name}
                subtitle={[t(KIND_KEY[p.kind]), placeLine(p), p.distance_km != null ? fmt.distance(p.distance_km) : ''].filter(Boolean).join(' · ')} onPress={() => choosePlace(p)} />)}</ListGroup>}
          {!!streets.length && <>
            <Group>{t('location.section.streets')}</Group>
            <ListGroup>{streets.map((r, i) => <ListRow key={r.place_id} testID={`place-result-${i}`} icon="location-outline" title={r.title} subtitle={r.subtitle} onPress={() => pickStreet(r)} />)}</ListGroup>
          </>}
        </> : <>
          <Pressable testID="use-current-location" accessibilityRole="button" accessibilityState={{ busy: locating }} disabled={locating} onPress={useCurrent} style={({ pressed }) => [s.current, pressed && s.currentDown]}>
            <View style={s.locate}>{locating ? <ActivityIndicator color={colors.forestDeep} /> : <Icon name="navigate" size={22} color={colors.forestDeep} />}</View>
            <View style={a.flex}>
              <Text style={s.currentTitle}>{t('location.useCurrent')}</Text>
              <Text style={s.currentSub}>{locating ? t('location.finding') : t('location.useCurrentSub')}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.surface} />
          </Pressable>
          {!COMING_SOON_ALL && <ListGroup><ListRow testID="add-new-address" icon="add-circle-outline" title={t('location.addAddress')} onPress={() => router.push(mapHref(here ?? delivery.point ?? CITY_CENTER))} /></ListGroup>}

          {!!addresses.length && <>
            <Group>{t('location.section.saved')}</Group>
            <ListGroup>{addresses.map(x => {
              const km = here && x.lat != null && x.lng != null ? distanceKm(here, { lat: x.lat, lng: x.lng }) : null;
              return <View key={x.id} style={s.saved}>
                <Pressable testID={`saved-address-${x.id}`} accessibilityRole="button" onPress={() => choose(x)} style={s.savedMain}>
                  <View style={s.tile}><Icon name={kindIcon(x)} size={20} color={colors.forest} /></View>
                  <View style={a.flex}>
                    <View style={s.labelRow}><Text style={s.rowTitle}>{x.label}</Text>{selected === x.id && <Text style={s.badge}>{t('location.selected')}</Text>}</View>
                    <Text style={s.rowSub} numberOfLines={2}>{[km != null ? fmt.distance(km) : '', [x.line, x.locality || x.area, x.pin].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</Text>
                  </View>
                </Pressable>
                <Pressable testID={`address-menu-${x.id}`} accessibilityLabel={t('location.optionsFor', { label: x.label })} onPress={() => setMenu(menu === x.id ? '' : x.id)} hitSlop={8} style={s.more}><Icon name="ellipsis-horizontal" size={18} color={colors.muted} /></Pressable>
                {menu === x.id && <View style={s.menu}>
                  <Pressable testID={`edit-address-${x.id}`} onPress={() => { setMenu(''); router.push(x.lat != null && x.lng != null ? mapHref({ lat: x.lat, lng: x.lng }, `&id=${x.id}`) : `/address-form?id=${x.id}&manual=1`); }} style={s.menuItem}><Icon name="create-outline" size={16} color={colors.onSurface} /><Text style={s.menuText}>{t('common.edit')}</Text></Pressable>
                  <Pressable testID={`delete-address-${x.id}`} onPress={() => remove(x)} style={s.menuItem}><Icon name="trash-outline" size={16} color={colors.onError} /><Text style={[s.menuText, s.danger]}>{t('common.delete')}</Text></Pressable>
                </View>}
              </View>;
            })}</ListGroup>
          </>}

          {!!recent.length && <>
            <Group>{t('location.section.recent')}</Group>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipsRow} contentContainerStyle={s.chips}>
              {recent.map((r, i) => <Pressable key={`${r.title}-${i}`} testID={`recent-place-${i}`} accessibilityRole="button" onPress={() => choosePlace({ name: r.title, district: null, state: r.subtitle, lat: r.lat, lng: r.lng })} style={s.chip}>
                <Icon name="time-outline" size={15} color={colors.forest} /><Text style={s.chipText}>{r.title}</Text>
              </Pressable>)}
            </ScrollView>
          </>}

          <Group>{t('location.section.live')}</Group>
          <ListGroup><ListRow testID="live-city-latur" icon="bicycle" title={LATUR.name} subtitle={t('location.liveBlurb')} onPress={() => choosePlace(LATUR)} /></ListGroup>

          {!!popular.length && <>
            <Group>{t('location.section.popular')}</Group>
            <View style={s.tiles}>{popular.map(p => <Pressable key={p.id} testID={`popular-${p.name.toLowerCase()}`} accessibilityRole="button" onPress={() => choosePlace(p)} style={s.cityTile}>
              <Text style={s.tileMark}>{p.name.slice(0, 1)}</Text>
              <Text style={s.tileName} numberOfLines={1}>{p.name}</Text>
              <Text style={s.tileState} numberOfLines={1}>{p.state}</Text>
            </Pressable>)}</View>
          </>}

          <ListGroup><ListRow testID="browse-india" icon="map-outline" title={t('location.browse.title')} subtitle={t('location.browse.sub')} onPress={() => router.push('/india')} /></ListGroup>
        </>}
      </ScrollView>

      <Sheet testID="city-sheet" visible={sheet} onClose={() => setSheet(false)} title={t('location.sheet.title')} body={t('location.sheet.sub')}>
        <ListGroup><ListRow testID="sheet-city-latur" icon="bicycle" title={LATUR.name} subtitle={t('location.liveBlurb')} onPress={() => { setSheet(false); choosePlace(LATUR); }} /></ListGroup>
        <View style={s.sheetCities}>{popular.slice(0, 6).map(p => <Pressable key={p.id} testID={`sheet-city-${p.name.toLowerCase()}`} accessibilityRole="button" onPress={() => { setSheet(false); choosePlace(p); }} style={s.sheetCity}>
          <Text style={s.chipText} numberOfLines={1}>{p.name}</Text>
        </Pressable>)}</View>
        <Button testID="sheet-search" variant="quiet" icon="search" title={t('location.sheet.search')} onPress={() => setSheet(false)} />
        {settings && <Button testID="sheet-open-settings" variant="quiet" icon="settings-outline" title={t('location.openSettings')} onPress={openSettings} />}
      </Sheet>
    </View>
  );
}

const TILE = 40;
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  round: { ...lightPane, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.onSurface, fontSize: 24, lineHeight: safeLineHeight(24), fontWeight: '800', letterSpacing: -0.6 },
  firstTitle: { fontSize: 30, lineHeight: safeLineHeight(30), letterSpacing: -1, marginLeft: 2 },
  skip: { ...lightPane, minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, justifyContent: 'center' },
  skipText: { fontSize: 14, fontWeight: '700', color: colors.forest },
  lede: { marginHorizontal: 18, marginTop: -4, marginBottom: 12, fontSize: 14, lineHeight: 21, color: colors.inkSoft },
  search: { marginHorizontal: 16, marginBottom: 4, height: 52, borderRadius: radius.pill, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, boxShadow: soft.lifted },
  input: { flex: 1, fontSize: 15, color: colors.onSurface, minHeight: 48 },
  content: { gap: 14, paddingHorizontal: 16, paddingTop: 12 },
  // The way to the person's own location: the brand's green card, raised on a darker base.
  current: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: radius.lg, backgroundColor: colors.forest, boxShadow: popBase(5, colors.forestDeep) },
  currentDown: { boxShadow: popBase(2, colors.forestDeep) },
  locate: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.electricLime, boxShadow: popBase(3, colors.forestDeep) },
  currentTitle: { color: colors.surface, fontSize: 17, lineHeight: 23, fontWeight: '800' },
  currentSub: { color: colors.glass, fontSize: 13, lineHeight: 18, marginTop: 2 },
  saved: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6 },
  savedMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  tile: { width: TILE, height: TILE, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintTile },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: colors.onSurface },
  rowSub: { marginTop: 1, fontSize: 12, lineHeight: 17, color: colors.muted },
  badge: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: colors.forest, backgroundColor: colors.limeSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  more: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  menu: { position: 'absolute', right: 44, top: 10, zIndex: 5, borderRadius: 16, paddingVertical: 4, backgroundColor: colors.surface, boxShadow: soft.lifted },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 130, minHeight: 44, paddingHorizontal: 16 },
  menuText: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  danger: { color: colors.onError },
  // The chips run to the screen's edges, with room for their shadow.
  chipsRow: { flexGrow: 0, marginHorizontal: -16, marginTop: -4, marginBottom: -14 },
  chips: { gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 18 },
  chip: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.surface, boxShadow: soft.lifted },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cityTile: { width: '30%', flexGrow: 1, minHeight: 76, borderRadius: radius.md, padding: 12, justifyContent: 'flex-end', overflow: 'hidden', backgroundColor: colors.surface, boxShadow: soft.lifted },
  // The city's first letter, large and pale in the corner.
  tileMark: { position: 'absolute', top: 2, right: 10, fontSize: 30, fontWeight: '900', letterSpacing: -1, color: colors.cityMid },
  tileName: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  tileState: { fontSize: 11, color: colors.muted },
  sheetCities: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sheetCity: { minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.surfaceSecondary },
});
