// "Use current location" never applies the phone's position on its own: this full-screen map shows where the
// phone thinks it is, names the place and says what One Local offers there, and the person confirms it (or moves
// the pin first). A wrong fix (an emulator in California, a stale GPS reading) is caught here instead of on Home.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { Text } from '@/src/ui/text';
import type { Point } from '../delivery-location';
import { MapView, mapsAvailable } from './map-view';
import { coverageAt, Coverage, isCoordinateText, placeLine, reverseGeocode } from '../places';
import { useFormat, useTranslation } from '../i18n';
import { colors } from '../theme';

type Found = { coverage: Coverage; street: string | null; locality: string | null };
type Status = { kind: 'loading' } | { kind: 'found'; found: Found } | { kind: 'error' };

export function ConfirmLocation({ start, onConfirm, onCancel, onLatur }: {
  start: Point;
  // The place name to show across the app, and the confirmed point.
  onConfirm: (label: string | null, coverage: Coverage, point: Point) => void;
  onCancel: () => void;
  onLatur: () => void;
}) {
  const insets = useSafeAreaInsets(); const { t } = useTranslation(); const fmt = useFormat();
  const [center, setCenter] = useState<Point>(start);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [moving, setMoving] = useState(false);
  const [retry, setRetry] = useState(0);
  const lift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(lift, { toValue: moving ? 1 : 0, useNativeDriver: true, speed: 22, bounciness: moving ? 0 : 8 }).start();
  }, [moving, lift]);

  // Coverage (our own data, always) plus the street from Google when Maps is set up (a 503 there is fine).
  useEffect(() => {
    setStatus({ kind: 'loading' });
    let gone = false;
    const timer = setTimeout(async () => {
      try {
        const [coverage, geo] = await Promise.all([coverageAt(center), reverseGeocode(center).catch(() => null)]);
        const street = geo?.formatted && !isCoordinateText(geo.formatted) ? geo.formatted : null;
        if (!gone) setStatus({ kind: 'found', found: { coverage, street, locality: geo?.locality || geo?.city || null } });
      } catch { if (!gone) setStatus({ kind: 'error' }); }
    }, 400);
    return () => { gone = true; clearTimeout(timer); };
  }, [center, retry]);

  const found = status.kind === 'found' ? status.found : null;
  const level = found?.coverage.level;
  const place = found?.coverage.place;
  const title = found?.locality || place?.name || t('location.confirm.pinned');
  const sub = found?.street ?? (place ? placeLine(place) : '');
  const label = place ? (placeLine(place) ? `${place.name}, ${placeLine(place)}` : place.name) : found?.locality ?? null;
  const canConfirm = !!found && level !== 'soon';

  const pinStyle = { transform: [{ translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) }] };

  return (
    <View testID="confirm-location-screen" style={s.screen}>
      <MapView initial={start} onMoveStart={() => setMoving(true)} onSettle={p => { setMoving(false); setCenter(p); }} style={StyleSheet.absoluteFill} />
      {mapsAvailable && (
        <View pointerEvents="none" style={s.pinWrap}>
          <Animated.View testID="confirm-location-pin" style={[s.pin, pinStyle]}>
            <View style={s.pinHead}><View style={s.pinDot} /></View>
            <View style={s.pinTail} />
          </Animated.View>
          <View style={s.pinShadow} />
        </View>
      )}

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="confirm-location-back" accessibilityLabel={t('common.goBack')} onPress={onCancel} style={s.round}><Icon name="arrow-back" size={21} color={colors.onSurface} /></Pressable>
        <View style={s.hint}><Text style={s.hintText}>{t('location.confirm.hint')}</Text></View>
      </View>

      <View style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <View style={s.card}>
          <Text style={s.head}>{t('location.confirm.title')}</Text>
          {status.kind === 'loading' && <View style={s.loading}><ActivityIndicator color={colors.forest} /><Text style={s.muted}>{t('location.confirm.finding')}</Text></View>}
          {status.kind === 'error' && (
            <View style={s.loading}>
              <Text testID="confirm-location-error" style={s.error}>{t('location.confirm.error')}</Text>
              <Pressable onPress={() => setRetry(r => r + 1)} style={s.retry}><Text style={s.link}>{t('common.retry')}</Text></Pressable>
            </View>
          )}
          {found && (
            <>
              <View style={s.placeRow}>
                <Icon name="location" size={20} color={colors.forest} />
                <Text testID="confirm-location-name" style={s.place} numberOfLines={1}>{title}</Text>
              </View>
              {!!sub && <Text style={s.sub} numberOfLines={2}>{sub}</Text>}
              {level === 'live' && <View testID="confirm-location-live" style={[s.note, s.noteOk]}><Icon name="bicycle" size={16} color={colors.forest} /><Text style={[s.noteText, { color: colors.forest }]}>{t('location.confirm.live')}</Text></View>}
              {level === 'discover' && <View testID="confirm-location-discover" style={[s.note, s.noteWarn]}><Text style={s.noteText}>{t('location.confirm.discover', { city: found.coverage.nearest_live.name, distance: fmt.distance(Math.round(found.coverage.nearest_live.distance_km)) })}</Text></View>}
              {level === 'soon' && <View testID="confirm-location-outside" style={[s.note, s.noteWarn]}><Icon name="alert-circle-outline" size={16} color={colors.onWarning} /><Text style={s.noteText}>{t('location.confirm.outside')}</Text></View>}
            </>
          )}
          {level === 'soon'
            ? <View style={s.row}>
                <Pressable testID="confirm-location-latur" onPress={onLatur} style={[s.cta, s.flex]}><Text style={s.ctaText}>{t('location.confirm.goLatur')}</Text></Pressable>
                <Pressable testID="confirm-location-search" onPress={onCancel} style={[s.secondary, s.flex]}><Text style={s.secondaryText}>{t('location.confirm.search')}</Text></Pressable>
              </View>
            : <Pressable testID="confirm-location" disabled={!canConfirm} onPress={() => found && onConfirm(label, found.coverage, center)} style={[s.cta, !canConfirm && s.off]}>
                <Text style={s.ctaText}>{t('location.confirm.cta')}</Text>
              </Pressable>}
        </View>
      </View>
    </View>
  );
}

const PIN = 50;
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  pinWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: PIN + 12 },
  pin: { alignItems: 'center' },
  pinHead: { width: PIN, height: PIN, borderRadius: PIN / 2, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.surface, boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 10, color: colors.shadow }] },
  pinDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.lime },
  pinTail: { width: 4, height: 12, borderRadius: 2, backgroundColor: colors.forest, marginTop: -2 },
  pinShadow: { width: 16, height: 6, borderRadius: 8, backgroundColor: colors.overlayDeep, marginTop: 1, opacity: 0.5 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  round: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: colors.shadow }] },
  hint: { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.surfaceInverse },
  hintText: { fontSize: 12, fontWeight: '600', color: colors.onSurfaceInverse },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  card: { borderRadius: 22, padding: 18, gap: 8, backgroundColor: colors.surface, boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 20, color: colors.shadow }] },
  head: { fontSize: 13, fontWeight: '600', color: colors.onSurfaceTertiary },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  place: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.onSurface },
  sub: { fontSize: 14, lineHeight: 20, color: colors.muted },
  muted: { fontSize: 13, color: colors.muted },
  error: { flex: 1, fontSize: 13, color: colors.onError },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  link: { fontSize: 13, fontWeight: '700', color: colors.forest },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  noteOk: { backgroundColor: colors.limeSoft },
  noteWarn: { backgroundColor: colors.pastelYellow },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.onWarning, fontWeight: '500' },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  cta: { marginTop: 6, minHeight: 54, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest },
  off: { opacity: 0.4 },
  ctaText: { color: colors.surface, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  secondary: { marginTop: 6, minHeight: 54, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.forest },
  secondaryText: { color: colors.forest, fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
