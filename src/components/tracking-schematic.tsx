// The live tracking map WITHOUT street tiles: the real store, address, route and rider drawn from their coordinates on
// a plain background. Used on the web when there is no Google Maps key (or Google refuses it). It is not the canned
// "illustrative" animation: every point here is real, and moves when the rider moves.
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import Svg, { Path } from 'react-native-svg';
import { colors, radius } from '../theme';
import { useTranslation } from '../i18n';
import { useGlidingFix } from '../use-gliding-fix';
import { useMapFrame } from '../use-map-frame';
import { decodePolyline } from '../utils/polyline';
import { glideDurationMs, makeProjector } from '../utils/tracking';
import { PIN_BADGE, PinBadge, RIDER_BADGE, RiderBadge, StaleHint, type TrackingMapProps } from './tracking-parts';

const PAD = 56; // room for a marker and for the note chip at the top

export function TrackingSchematic({ tracking, animate }: TrackingMapProps) {
  const { t } = useTranslation();
  const [size, setSize] = useState({ w: 320, h: 240 });
  const route = useMemo(() => decodePolyline(tracking.route?.polyline), [tracking.route?.polyline]);
  const frame = useMapFrame(tracking, route);
  const rider = tracking.rider;
  const glided = useGlidingFix(rider ? { lat: rider.lat, lng: rider.lng, heading: rider.heading } : null, glideDurationMs(tracking.poll_after_s), animate);
  const project = useMemo(() => (frame ? makeProjector(frame, size.w, size.h, PAD) : null), [frame, size.w, size.h]);

  const store = project?.(tracking.store);
  const drop = project?.(tracking.drop);
  const at = glided && project ? project(glided) : null;
  const line = project && route.length > 1 ? route.map((p, i) => { const q = project(p); return `${i === 0 ? 'M' : 'L'} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }).join(' ') : null;

  return (
    <View
      testID="tracking-map-schematic" style={styles.fill} onLayout={e => setSize({ w: Math.max(1, e.nativeEvent.layout.width), h: Math.max(1, e.nativeEvent.layout.height) })}
      accessible accessibilityRole="image" accessibilityLabel={t('tracking.live.mapA11y')}
    >
      <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
        {/* plain background lines: decoration, not streets */}
        {[0.25, 0.5, 0.75].map(f => <Path key={`h${f}`} d={`M 0 ${size.h * f} L ${size.w} ${size.h * f}`} stroke={colors.border} strokeWidth={1} />)}
        {[0.25, 0.5, 0.75].map(f => <Path key={`v${f}`} d={`M ${size.w * f} 0 L ${size.w * f} ${size.h}`} stroke={colors.border} strokeWidth={1} />)}
        {line && <Path testID="tracking-route" d={line} stroke={colors.forest} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      </Svg>
      {store && <View style={[styles.at, { left: store.x - PIN_BADGE / 2, top: store.y - PIN_BADGE / 2 }]}><PinBadge kind="store" /></View>}
      {drop && <View style={[styles.at, { left: drop.x - PIN_BADGE / 2, top: drop.y - PIN_BADGE / 2 }]}><PinBadge kind="drop" /></View>}
      {rider && at && <View style={[styles.at, { left: at.x - RIDER_BADGE / 2, top: at.y - RIDER_BADGE / 2 }]}><RiderBadge heading={glided?.heading ?? null} stale={rider.stale} name={rider.first_name} /></View>}
      <View testID="tracking-map-fallback" style={styles.note}><Text style={styles.noteText}>{t('tracking.live.mapUnavailable')}</Text></View>
      {rider?.stale && <StaleHint />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surfaceSecondary, overflow: 'hidden' },
  at: { position: 'absolute' },
  note: { position: 'absolute', top: 8, left: 8, right: 8, pointerEvents: 'none', alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.border },
  noteText: { fontSize: 11, color: colors.muted, lineHeight: 16 },
});
