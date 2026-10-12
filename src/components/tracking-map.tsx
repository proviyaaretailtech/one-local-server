// Live tracking map on phones: react-native-maps (Apple Maps on iOS, Google Maps on Android). The web version is
// tracking-map.web.tsx. The map is a fixed card inside the scrolling order page: no pan or zoom (so it never fights
// the page scroll); it frames the store, the address, the route and the rider by itself (src/use-map-frame.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import RNMapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { colors } from '../theme';
import { useTranslation } from '../i18n';
import { useGlidingFix } from '../use-gliding-fix';
import { useMapFrame } from '../use-map-frame';
import { decodePolyline } from '../utils/polyline';
import { glideDurationMs } from '../utils/tracking';
import { PinBadge, RiderBadge, StaleHint, type TrackingMapProps } from './tracking-parts';

export type { TrackingMapProps } from './tracking-parts';
/** Phones always have a map; whether Android's tiles load depends on the build's Maps SDK key. */
export const trackingMapAvailable = true;

const EDGE = { top: 56, right: 48, bottom: 56, left: 48 };

// A marker's picture is captured once and reused (cheap). When what it shows changes (`key`: heading known, faded),
// let the map re-capture it for a moment.
function useCaptureBriefly(key: string) {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(key), 600);
    return () => clearTimeout(timer);
  }, [key]);
  return settled !== key;
}

export function TrackingMap({ tracking, animate }: TrackingMapProps) {
  const { t } = useTranslation();
  const ref = useRef<RNMapView>(null);
  const [ready, setReady] = useState(false);
  const route = useMemo(() => decodePolyline(tracking.route?.polyline), [tracking.route?.polyline]);
  const frame = useMapFrame(tracking, route);
  const rider = tracking.rider;
  const glided = useGlidingFix(rider ? { lat: rider.lat, lng: rider.lng, heading: rider.heading } : null, glideDurationMs(tracking.poll_after_s), animate);
  const headingKnown = glided?.heading != null;
  const captureRider = useCaptureBriefly(`${headingKnown}|${rider?.stale}|${rider?.first_name}`);
  const capturePins = useCaptureBriefly(tracking.phase);

  useEffect(() => {
    if (!ready || !frame) return;
    ref.current?.fitToCoordinates(
      [{ latitude: frame.south, longitude: frame.west }, { latitude: frame.north, longitude: frame.east }],
      { edgePadding: EDGE, animated: animate },
    );
  }, [ready, frame, animate]);

  const line = useMemo(() => route.map(p => ({ latitude: p.lat, longitude: p.lng })), [route]);
  return (
    <View style={[styles.fill, styles.passThrough]} accessible accessibilityRole="image" accessibilityLabel={t('tracking.live.mapA11y')}>
      <RNMapView
        ref={ref}
        testID="tracking-map-native"
        style={styles.fill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{ latitude: tracking.drop.lat, longitude: tracking.drop.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
        onMapReady={() => setReady(true)}
        scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
        toolbarEnabled={false} showsMyLocationButton={false} showsUserLocation={false} moveOnMarkerPress={false}
      >
        {line.length > 1 && <Polyline coordinates={line} strokeColor={colors.forest} strokeWidth={5} lineCap="round" lineJoin="round" />}
        <Marker coordinate={{ latitude: tracking.store.lat, longitude: tracking.store.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={capturePins} zIndex={1}><PinBadge kind="store" /></Marker>
        <Marker coordinate={{ latitude: tracking.drop.lat, longitude: tracking.drop.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={capturePins} zIndex={2}><PinBadge kind="drop" /></Marker>
        {rider && glided && (
          <Marker
            coordinate={{ latitude: glided.lat, longitude: glided.lng }} anchor={{ x: 0.5, y: 0.5 }} flat
            rotation={glided.heading ?? 0} tracksViewChanges={captureRider} zIndex={3}
          >
            <RiderBadge heading={glided.heading} stale={rider.stale} rotate={false} name={rider.first_name} />
          </Marker>
        )}
      </RNMapView>
      {rider?.stale && <StaleHint />}
    </View>
  );
}

// Touches go to the page scroll underneath (the map itself has nothing to tap).
const styles = StyleSheet.create({ fill: { flex: 1 }, passThrough: { pointerEvents: 'none' } });
