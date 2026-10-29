// Pieces shared by the live tracking maps (native, Google web map, and the no-map drawing): the rider, store and
// address markers, and the "location is a little behind" hint. Each marker is an ordinary view, so the same look
// is used inside react-native-maps markers, Google AdvancedMarkers and the plain drawing.
import { StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import Svg, { Path } from 'react-native-svg';
import Icon from '@react-native-vector-icons/ionicons';
import { colors, radius } from '../theme';
import { useTranslation } from '../i18n';
import type { TrackingLive } from '../utils/tracking';

export type TrackingMapProps = {
  tracking: TrackingLive;
  /** false when the phone asks for reduced motion (or the app is in the background): the marker snaps, the map does not animate. */
  animate: boolean;
};

export const RIDER_BADGE = 44;
export const PIN_BADGE = 32;

/**
 * The rider. With a heading it is an arrow turned that way; before a direction is known it is a bicycle that
 * does not turn. `rotate` is false where the map rotates the whole marker itself (react-native-maps `rotation`).
 * A rider whose position is old (`stale`) is drawn faded.
 */
export function RiderBadge({ heading, stale, rotate = true, name }: { heading: number | null; stale: boolean; rotate?: boolean; name: string }) {
  const { t } = useTranslation();
  return (
    <View
      testID="rider-marker"
      accessible accessibilityRole="image" accessibilityLabel={t('tracking.live.riderMarkerA11y', { name })}
      style={[styles.rider, stale && styles.riderStale]}
    >
      {heading === null
        ? <Icon name="bicycle" size={24} color={colors.brandSecondary} />
        : (
          <View style={rotate ? { transform: [{ rotate: `${heading}deg` }] } : undefined}>
            <Svg width={24} height={24} viewBox="0 0 24 24"><Path d="M12 2.5 L19.5 20.5 L12 16.5 L4.5 20.5 Z" fill={colors.brandSecondary} /></Svg>
          </View>
        )}
    </View>
  );
}

/** The store and the customer's address. */
export function PinBadge({ kind }: { kind: 'store' | 'drop' }) {
  const { t } = useTranslation();
  const store = kind === 'store';
  return (
    <View
      testID={store ? 'store-marker' : 'drop-marker'}
      accessible accessibilityRole="image" accessibilityLabel={t(store ? 'tracking.live.storeMarkerA11y' : 'tracking.live.dropMarkerA11y')}
      style={[styles.pin, { backgroundColor: store ? colors.brandSecondary : colors.onSuccess }]}
    >
      <Icon name={store ? 'storefront' : 'home'} size={16} color={store ? colors.onBrandSecondary : '#FFFFFF'} />
    </View>
  );
}

/** Shown on the map while the rider's phone has not reported for a while (the server says `rider.stale`). */
export function StaleHint() {
  const { t } = useTranslation();
  return (
    <View testID="tracking-stale-hint" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.stale}>
      <Icon name="time-outline" size={14} color={colors.onWarning} />
      <Text style={styles.staleText}>{t('tracking.live.staleHint')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rider: {
    width: RIDER_BADGE, height: RIDER_BADGE, borderRadius: RIDER_BADGE / 2, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFFFFF',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  riderStale: { opacity: 0.55 },
  pin: {
    width: PIN_BADGE, height: PIN_BADGE, borderRadius: PIN_BADGE / 2, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  stale: {
    position: 'absolute', left: 8, right: 8, bottom: 8, pointerEvents: 'none', flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.warning, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, minHeight: 28,
  },
  staleText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: colors.onWarning, lineHeight: 17 },
});
