// Drop the pin: move the map under a fixed pin; the address card below follows it.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { ApiError } from '@/src/api';
import { Point, useDeliveryLocation } from '@/src/delivery-location';
import { MapView, mapsAvailable } from '@/src/components/map-view';
import { useErrorMessage, useFormat, useTranslation } from '@/src/i18n';
import { checkServiceable, CITY_CENTER, currentPoint, distanceKm, isCoordinateText, isLocationError, knownPoint, Place, reverseGeocode } from '@/src/places';
import { colors } from '@/src/theme';

const COORD = { maxFractionDigits: 5, minFractionDigits: 5 }; // coordinates are shown to 5 decimals, as technical text
const FAR_KM = 0.2; // beyond this, say how far the pin is from where the phone is

type Status = { kind: 'loading' } | { kind: 'place'; place: Place } | { kind: 'basic'; point: Point; serviceable: boolean; nearest: string } | { kind: 'error'; error: unknown };

export default function AddressMap() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const delivery = useDeliveryLocation();
  const { t } = useTranslation(); const fmt = useFormat(); const message = useErrorMessage();
  const params = useLocalSearchParams<{ lat?: string; lng?: string; id?: string }>();
  const start = useRef<Point>(params.lat && params.lng ? { lat: Number(params.lat), lng: Number(params.lng) } : delivery.point ?? CITY_CENTER).current;
  const [center, setCenter] = useState<Point>(start);
  const [moveTo, setMoveTo] = useState<(Point & { at: number }) | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [hint, setHint] = useState(true); const [locating, setLocating] = useState(false); const [locError, setLocError] = useState('');
  const [here, setHere] = useState<Point | null>(null);
  const [moving, setMoving] = useState(false);
  const lift = useRef(new Animated.Value(0)).current;

  // Where the phone is, only if already allowed (never prompts); used for the "this is X away" note.
  useEffect(() => { knownPoint().then(p => p && setHere(p)); }, []);

  // The pin lifts while the map moves and drops when it settles.
  useEffect(() => {
    Animated.spring(lift, { toValue: moving ? 1 : 0, useNativeDriver: true, speed: 22, bounciness: moving ? 0 : 8 }).start();
  }, [moving, lift]);

  // Look up the address after the map stops moving.
  useEffect(() => {
    setStatus({ kind: 'loading' });
    const timer = setTimeout(async () => {
      try {
        setStatus({ kind: 'place', place: await reverseGeocode(center) });
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          // Maps not configured: still check the delivery area (free, no Google call).
          const s = await checkServiceable(center).catch(() => null);
          setStatus({ kind: 'basic', point: center, serviceable: !!s?.serviceable, nearest: s?.nearest_city ?? 'Latur' }); // i18n-ignore: fallback place name (data)
        } else setStatus({ kind: 'error', error: e });
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [center]);

  const settle = (p: Point) => { setMoving(false); setCenter(p); };
  const startMove = () => { if (!moving) { setMoving(true); setHint(false); } };

  const recenter = async () => {
    setLocating(true); setLocError('');
    // A failed "locate me" keeps the pin and its address; it only explains why it couldn't move.
    try { const p = await currentPoint(); setHere(p); setMoveTo({ ...p, at: Date.now() }); setCenter(p); }
    catch (e) { setLocError(isLocationError(e) ? e.message : message(e)); }
    finally { setLocating(false); }
  };

  const place = status.kind === 'place' ? status.place : null;
  // Google sometimes knows no street here and the server then sends the coordinates as the "address".
  const streetKnown = !!place && !!place.formatted && !isCoordinateText(place.formatted);
  const serviceable = place ? place.serviceable : status.kind === 'basic' ? status.serviceable : false;
  const away = here ? distanceKm(here, center) : 0;
  const awayText = away < 1
    ? t('address.map.meters', { count: Math.max(10, Math.round((away * 1000) / 10) * 10) })
    : t('address.map.km', { count: fmt.number(away, { maxFractionDigits: 1 }) });

  const confirm = () => {
    const q = new URLSearchParams({ lat: String(center.lat), lng: String(center.lng) });
    if (place && streetKnown) { q.set('locality', place.locality); q.set('formatted', place.formatted); q.set('pincode', place.pincode); }
    else { q.set('manual', '1'); if (place?.locality || place?.city) q.set('locality', place.locality || place.city); }
    if (params.id) q.set('id', params.id);
    router.push(`/address-form?${q.toString()}` as never);
  };

  const pinStyle = { transform: [{ translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) }] };
  const shadowStyle = { opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.25] }), transform: [{ scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) }] };

  return (
    <View testID="address-map-screen" style={styles.screen}>
      <MapView initial={start} moveTo={moveTo} onMoveStart={startMove} onSettle={settle} style={StyleSheet.absoluteFill} />

      {/* The pin stays in the middle; the map moves under it. Its tip marks the delivery point. */}
      {mapsAvailable && (
        <View pointerEvents="none" style={styles.pinWrap}>
          {hint && <View style={styles.tooltip}><Text style={styles.tooltipText}>{t('address.map.hint')}</Text><View style={styles.tooltipTail} /></View>}
          <Animated.View testID="map-pin" style={[styles.pin, pinStyle]}>
            <View style={styles.pinHead}><View style={styles.pinDot} /></View>
            <View style={styles.pinTail} />
          </Animated.View>
          <Animated.View style={[styles.pinShadow, shadowStyle]} />
        </View>
      )}

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="address-map-back" accessibilityLabel={t('common.goBack')} onPress={() => router.back()} style={styles.round}><Icon name="arrow-back" size={21} color={colors.onSurface} /></Pressable>
        <Pressable testID="address-map-search" onPress={() => router.back()} style={styles.searchPill}>
          <Text style={styles.searchText} numberOfLines={1}>{t('address.map.searchAnother')}</Text>
          <Icon name="search-outline" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {mapsAvailable && (
          <Pressable testID="recenter-map" onPress={recenter} style={styles.recenter}>
            {locating ? <ActivityIndicator size="small" color={colors.forest} /> : <Icon name="locate" size={16} color={colors.forest} />}
            <Text style={styles.recenterText}>{t('location.current')}</Text>
          </Pressable>
        )}
        <View style={styles.card}>
          <View style={styles.cardHead}><Text style={styles.cardHeadText}>{t('address.map.deliveredHere')}</Text></View>
          <View style={styles.cardBody}>
            {status.kind === 'loading' && <View style={styles.loading}><ActivityIndicator color={colors.forest} /><Text style={styles.muted}>{t('address.map.finding')}</Text></View>}
            {place && (
              <>
                <View style={styles.placeRow}>
                  <Icon name="location" size={20} color={colors.forest} />
                  <Text testID="map-locality" style={styles.locality} numberOfLines={1}>{place.locality || place.city || (place.serviceable ? place.nearest_city : '') || t('address.map.pinned')}</Text>
                </View>
                {streetKnown
                  ? <Text testID="map-formatted" style={styles.formatted} numberOfLines={2}>{place.formatted}</Text>
                  : <Text testID="map-no-street" style={styles.formatted}>{t('address.map.noStreet')}</Text>}
              </>
            )}
            {status.kind === 'basic' && (
              <>
                <View style={styles.placeRow}><Icon name="location" size={20} color={colors.forest} /><Text style={styles.locality}>{t('address.map.pinned')}</Text></View>
                <Text style={styles.formatted}>{t('address.map.pinnedAt', { latitude: fmt.number(status.point.lat, COORD), longitude: fmt.number(status.point.lng, COORD) })}</Text>
              </>
            )}
            {status.kind === 'error' && <Text testID="map-error" style={styles.error}>{message(status.error)}</Text>}
            {!!locError && <Text testID="map-locate-error" style={styles.error}>{locError}</Text>}

            {status.kind !== 'loading' && status.kind !== 'error' && !serviceable && (
              <View testID="not-serviceable" style={[styles.note, styles.noteWarn]}>
                <Icon name="alert-circle-outline" size={16} color={colors.onWarning} />
                <Text style={styles.noteText}>{t('address.map.notServiceable', { city: place ? place.nearest_city : status.kind === 'basic' ? status.nearest : '' })}</Text>
              </View>
            )}
            {serviceable && away > FAR_KM && (
              <View testID="map-distance" style={[styles.note, styles.noteWarn]}>
                <Text style={styles.noteText}>{t('address.map.distanceAway', { distance: awayText })}</Text>
              </View>
            )}

            <Pressable testID="confirm-location" disabled={!serviceable || status.kind === 'loading'} onPress={() => { setHint(false); confirm(); }} style={[styles.cta, (!serviceable || status.kind === 'loading') && styles.ctaOff]}>
              <Text style={styles.ctaText}>{t('address.map.confirmProceed')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const PIN = 50;
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  // Centred column; the bottom padding lifts it so the pin TIP (not its middle) sits on the map centre.
  pinWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: PIN + 12 },
  tooltip: { alignItems: 'center', marginBottom: 8 },
  tooltipText: { backgroundColor: colors.surfaceInverse, color: colors.onSurfaceInverse, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, fontSize: 12, fontWeight: '600', overflow: 'hidden' },
  tooltipTail: { width: 10, height: 10, backgroundColor: colors.surfaceInverse, transform: [{ rotate: '45deg' }], marginTop: -5 },
  pin: { alignItems: 'center' },
  pinHead: { width: PIN, height: PIN, borderRadius: PIN / 2, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.surface, boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 10, color: colors.shadow }] },
  pinDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.lime },
  pinTail: { width: 4, height: 12, borderRadius: 2, backgroundColor: colors.forest, marginTop: -2 },
  pinShadow: { width: 16, height: 6, borderRadius: 8, backgroundColor: colors.overlayDeep, marginTop: 1 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 14 },
  round: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: colors.shadow }] },
  searchPill: { flex: 1, minHeight: 46, paddingVertical: 6, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: colors.shadow }] },
  searchText: { flex: 1, fontSize: 15, color: colors.muted },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  recenter: { alignSelf: 'center', marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 42, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: colors.shadow }] },
  recenterText: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  card: { borderRadius: 22, backgroundColor: colors.surface, overflow: 'hidden', boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 20, color: colors.shadow }] },
  cardHead: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: 18, paddingVertical: 11 },
  cardHeadText: { fontSize: 13, fontWeight: '500', color: colors.onSurfaceTertiary },
  cardBody: { padding: 18, paddingTop: 14, gap: 8 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locality: { fontSize: 20, fontWeight: '800', color: colors.onSurface, flex: 1 },
  formatted: { fontSize: 14, lineHeight: 20, color: colors.muted },
  muted: { fontSize: 13, color: colors.muted },
  error: { fontSize: 13, color: colors.onError },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  noteWarn: { backgroundColor: colors.pastelYellow },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.onWarning, fontWeight: '500' },
  cta: { marginTop: 6, minHeight: 54, paddingVertical: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: colors.surface, fontSize: 17, fontWeight: '700' },
});
