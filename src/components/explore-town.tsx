// A town One Local doesn't deliver to yet: real local restaurants, grocers, shops and pharmacies
// to find, call and get directions to, plus "Launch One Local here". Listings come from our
// /api/nearby (Google Places once the Maps key is set, OpenStreetMap until then) and have no
// photos, so each row gets a tinted icon for its kind instead of an empty image.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { CityScroll } from '../motion';
import { useDeliveryLocation } from '../delivery-location';
import { CITY_CENTER, nearbyAt, NearbyKind, NearbyPlace, placeLine, requestLaunch } from '../places';
import { useFormat, useTranslation } from '../i18n';
import { useLineHeight } from '../layout';

// `label` is the English fallback (kept for other screens); this screen shows t(`explore.kind.${id}`).
export const KINDS: { id: NearbyKind; label: string; icon: string; color: string; soft: string }[] = [
  { id: 'food', label: 'Food', icon: 'restaurant-outline', color: colors.food, soft: colors.foodSoft }, // i18n-ignore: English fallback
  { id: 'grocery', label: 'Groceries', icon: 'basket-outline', color: colors.grocery, soft: colors.groceryFade }, // i18n-ignore: English fallback
  { id: 'shops', label: 'Shops', icon: 'storefront-outline', color: colors.shops, soft: colors.shopsFade }, // i18n-ignore: English fallback
  { id: 'care', label: 'Pharmacy & care', icon: 'medkit-outline', color: colors.pharmacy, soft: colors.pharmacySoft }, // i18n-ignore: English fallback
];
// A few place types get their own icon; everything else uses its kind's icon.
const TYPE_ICON: Record<string, string> = {
  cafe: 'cafe-outline', bakery: 'nutrition-outline', 'ice cream': 'ice-cream-outline', 'fast food': 'fast-food-outline', pharmacy: 'medkit-outline',
  chemist: 'medkit-outline', hospital: 'medical-outline', clinic: 'medical-outline', doctors: 'medical-outline', dentist: 'medical-outline',
  'mobile phone': 'phone-portrait-outline', electronics: 'tv-outline', clothes: 'shirt-outline', jewelry: 'diamond-outline', books: 'book-outline',
  hairdresser: 'cut-outline', beauty: 'sparkles-outline', supermarket: 'cart-outline', hardware: 'hammer-outline',
};
const LAUNCH_KEY = (id: string) => `onecity.launch-asked.${id}`;

// `empty`: a delivery city whose catalogue has no stores yet (e.g. right after the demo catalogue
// is cleared and before the Master adds real ones) — show what's around instead of empty shelves.
export function ExploreTown({ initial = 'food', empty = false }: { initial?: NearbyKind; empty?: boolean }) {
  const { coverage, point, edit } = useDeliveryLocation(); const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat(); const lineHeight = useLineHeight();
  const at = point ?? CITY_CENTER; const place = coverage?.place;
  const [kind, setKind] = useState<NearbyKind>(initial);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['nearby', at.lat, at.lng], queryFn: () => nearbyAt(at), staleTime: 10 * 60_000, retry: 1, enabled: empty || coverage?.level === 'discover' });
  const [launch, setLaunch] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  useEffect(() => { setKind(initial); }, [initial]);
  useEffect(() => { if (place) AsyncStorage.getItem(LAUNCH_KEY(place.id)).then(v => setLaunch(v ? 'done' : 'idle')).catch(() => {}); }, [place]);
  const ask = async () => {
    if (!place) return; setLaunch('busy');
    try { await requestLaunch(place.id); setLaunch('done'); void AsyncStorage.setItem(LAUNCH_KEY(place.id), '1'); } catch { setLaunch('error'); }
  };

  if (coverage?.level === 'soon') return <View testID="explore-outside-india" style={s.center}>
    <Icon name="globe-outline" size={34} color={colors.forest} />
    <Text style={s.title}>{t('explore.outsideTitle')}</Text>
    <Text style={s.body}>{t('explore.outsideBody')}</Text>
    <Pressable testID="explore-change-location" onPress={edit} style={s.primary}><Text style={s.primaryText}>{t('explore.choosePlace')}</Text></Pressable>
  </View>;

  const k = KINDS.find(x => x.id === kind)!; const list = data?.groups[kind] ?? [];
  return <CityScroll testID="explore-town" showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
    <View style={s.hero}>
      <Text style={s.eyebrow}>{t('explore.eyebrow', { place: place ? (place.district && place.district !== place.name ? place.district.toUpperCase() : place.state.toUpperCase()) : '' })}</Text>
      <Text testID="explore-town-name" style={[s.town, { lineHeight: lineHeight(30, 34) }]}>{place?.name ?? t('explore.yourTown')}</Text>
      {!!place && <Text style={s.sub}>{placeLine(place)}</Text>}
      <View style={s.status}>
        <Icon name="bicycle-outline" size={16} color={colors.forest} />
        <Text testID="explore-status" style={s.statusText}>{empty
          ? (place ? t('explore.statusEmpty', { place: place.name }) : t('explore.statusEmptyNoPlace'))
          : coverage ? t('explore.statusNearest', { city: coverage.nearest_live.name, distance: fmt.distance(Math.round(coverage.nearest_live.distance_km)) }) : t('explore.statusNoDelivery')}</Text>
      </View>
      {empty ? null : launch === 'done'
        ? <View testID="explore-launch-done" style={s.done}><Icon name="checkmark-circle" size={18} color={colors.forest} /><Text style={s.doneText}>{place ? t('explore.launchDone', { place: place.name }) : t('explore.launchDoneNoPlace')}</Text></View>
        : <Pressable testID="explore-launch" disabled={launch === 'busy' || !place} onPress={ask} style={[s.primary, (launch === 'busy' || !place) && s.off]}>
            {launch === 'busy' ? <ActivityIndicator color={colors.onSurface} /> : <Text style={s.primaryText}>{place ? t('explore.launchCta', { place: place.name }) : t('explore.launchCtaNoPlace')}</Text>}
          </Pressable>}
      {launch === 'error' && <Text style={s.error}>{t('explore.launchError')}</Text>}
    </View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
      {KINDS.map(x => {
        const on = x.id === kind; const n = data?.groups[x.id].length;
        return <Pressable key={x.id} testID={`explore-tab-${x.id}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setKind(x.id)} style={[s.tab, on && { backgroundColor: x.color, borderColor: x.color }]}>
          <Icon name={x.icon as never} size={15} color={on ? colors.surface : x.color} />
          <Text style={[s.tabText, on && { color: colors.surface }]}>{t(`explore.kind.${x.id}`)}{n ? ` · ${fmt.number(n)}` : ''}</Text>
        </Pressable>;
      })}
    </ScrollView>

    <View style={s.list}>
      {isLoading && <View testID="explore-loading" style={s.loading}><ActivityIndicator color={colors.forest} /><Text style={s.body}>{place ? t('explore.loading', { place: place.name }) : t('explore.loadingNoPlace')}</Text></View>}
      {isError && <View testID="explore-error" style={s.loading}><Text style={s.body}>{t('explore.loadError')}</Text><Pressable onPress={() => refetch()} style={s.secondary}><Text style={s.secondaryText}>{t('common.retry')}</Text></Pressable></View>}
      {!!data && !list.length && <Text testID="explore-empty" style={s.body}>{t(`explore.empty.${k.id}`, { distance: fmt.distance(Math.round(data.radius_km)) })}</Text>}
      {list.map(p => <PlaceRow key={p.id} p={p} kind={k} />)}
    </View>

    {!!data && <Text testID="explore-credit" style={s.credit}>{data.source === 'Google' ? t('explore.creditGoogle') : t('explore.creditOsm')}</Text>}
    <Pressable testID="explore-other-place" onPress={() => router.push('/location' as never)} style={s.link}><Icon name="location-outline" size={15} color={colors.forest} /><Text style={s.linkText}>{t('explore.another')}</Text></Pressable>
  </CityScroll>;
}

export function PlaceRow({ p, kind }: { p: NearbyPlace; kind: (typeof KINDS)[number] }) {
  const { t } = useTranslation(); const fmt = useFormat();
  const detail = [p.cuisine ?? p.type, p.rating ? `★ ${fmt.number(p.rating, { maxFractionDigits: 1, minFractionDigits: 1 })}${p.rating_count ? ` (${fmt.number(p.rating_count)})` : ''}` : null].filter(Boolean).join(' · ');
  const open = (url: string) => Linking.openURL(url).catch(() => {});
  return <View testID={`explore-place-${p.id}`} style={s.row}>
    <View style={[s.mark, { backgroundColor: kind.soft }]}><Icon name={(TYPE_ICON[p.type] ?? kind.icon) as never} size={20} color={kind.color} /></View>
    <View style={s.rowBody}>
      <Text style={s.name} numberOfLines={2}>{p.name}</Text>
      <Text style={s.meta} numberOfLines={1}>{detail}</Text>
      <Text style={s.meta} numberOfLines={2}>{fmt.distance(p.distance_km)}{p.address ? ` · ${p.address}` : ''}</Text>
      {p.open_now != null && <Text style={[s.meta, { color: p.open_now ? colors.onSuccess : colors.onError }]}>{p.open_now ? t('explore.openNow') : t('explore.closedNow')}</Text>}
      <View style={s.actions}>
        {!!p.phone && <Pressable testID={`explore-call-${p.id}`} accessibilityLabel={t('explore.callLabel', { name: p.name, phone: p.phone_display ?? '' })} onPress={() => open(`tel:${p.phone}`)} style={s.action}>
          <Icon name="call-outline" size={14} color={colors.forest} /><Text style={s.actionText}>{p.phone_display}</Text>
        </Pressable>}
        <Pressable testID={`explore-directions-${p.id}`} accessibilityLabel={t('explore.directionsLabel', { name: p.name })} onPress={() => open(p.directions_url)} style={s.action}>
          <Icon name="navigate-outline" size={14} color={colors.forest} /><Text style={s.actionText}>{t('explore.directions')}</Text>
        </Pressable>
      </View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  content: { paddingBottom: 120 },
  hero: { marginHorizontal: 16, marginTop: 12, padding: 20, borderRadius: 26, backgroundColor: colors.glassBright, gap: 6 },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: '700', color: colors.inkSoft },
  // i18n-ignore: Latin design value; the Text overrides it with useLineHeight() in other languages
  town: { fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.8, color: colors.onSurface },
  sub: { fontSize: 13, color: colors.muted },
  status: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 8, padding: 12, borderRadius: 16, backgroundColor: colors.limeSoft },
  statusText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.forest },
  primary: { marginTop: 10, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime, paddingHorizontal: 18 },
  primaryText: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  off: { opacity: 0.5 },
  done: { marginTop: 10, flexDirection: 'row', gap: 8, alignItems: 'center' },
  doneText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.forest },
  error: { fontSize: 12, color: colors.onError },
  tabs: { paddingHorizontal: 16, paddingVertical: 16, gap: 8 },
  tab: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  list: { marginHorizontal: 16, gap: 10 },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  row: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  mark: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  meta: { fontSize: 12, lineHeight: 17, color: colors.muted, textTransform: 'none' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  action: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 18, backgroundColor: colors.limeSoft },
  actionText: { fontSize: 12, fontWeight: '700', color: colors.forest },
  credit: { marginHorizontal: 20, marginTop: 18, fontSize: 11, lineHeight: 16, color: colors.muted },
  link: { marginHorizontal: 20, marginTop: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { fontSize: 13, fontWeight: '700', color: colors.forest },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  title: { fontSize: 20, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  body: { fontSize: 13, lineHeight: 19, color: colors.muted, textAlign: 'center' },
  secondary: { minHeight: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
});
