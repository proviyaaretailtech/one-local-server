// Live tracking map on the web: Google Maps JavaScript API (needs GOOGLE_MAPS_BROWSER_KEY, restricted by referrer),
// same look as the phones' map. Falls back to the plain real-coordinates drawing (tracking-schematic.tsx) when there
// is no key, when the script cannot load (offline, blocked) or when Google refuses the key (gm_authFailure).
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { APIProvider, AdvancedMarker, AdvancedMarkerAnchorPoint, Map, Polyline, useMap } from '@vis.gl/react-google-maps';
import { colors } from '../theme';
import { useTranslation } from '../i18n';
import { useGlidingFix } from '../use-gliding-fix';
import { useMapFrame } from '../use-map-frame';
import { decodePolyline } from '../utils/polyline';
import { glideDurationMs, type Bounds } from '../utils/tracking';
import { PinBadge, RiderBadge, StaleHint, type TrackingMapProps } from './tracking-parts';
import { TrackingSchematic } from './tracking-schematic';

export type { TrackingMapProps } from './tracking-parts';

const KEY: string | undefined = Constants.expoConfig?.extra?.googleMapsBrowserKey;
export const trackingMapAvailable = !!KEY;

// Advanced markers (custom HTML pins) need a map id. This is Google's own placeholder id for exactly this case: it
// works with any key and carries no cloud styling.
const MAP_ID = 'DEMO_MAP_ID';
const FIT_PADDING = 48;
const toLiteral = (b: Bounds) => ({ south: b.south, west: b.west, north: b.north, east: b.east });

function Framer({ frame, animate }: { frame: Bounds | null; animate: boolean }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (!map || !frame) return;
    if (first.current) { first.current = false; return; } // the first frame is the map's defaultBounds
    map.fitBounds(toLiteral(frame), FIT_PADDING);
  }, [map, frame, animate]);
  return null;
}

function GoogleTracking({ tracking, animate, onFail }: TrackingMapProps & { onFail: () => void }) {
  const { t, i18n } = useTranslation();
  // The map's own labels follow the app language (Google loads one language per page: the one active when it first opens).
  const language = (i18n.resolvedLanguage ?? i18n.language ?? 'en').startsWith('hi') ? 'hi' : 'en';
  const route = useMemo(() => decodePolyline(tracking.route?.polyline), [tracking.route?.polyline]);
  const frame = useMapFrame(tracking, route);
  const rider = tracking.rider;
  const glided = useGlidingFix(rider ? { lat: rider.lat, lng: rider.lng, heading: rider.heading } : null, glideDurationMs(tracking.poll_after_s), animate);
  const initial = useMemo(() => (frame ? { ...toLiteral(frame), padding: FIT_PADDING } : undefined), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View testID="tracking-map-google" style={styles.fill} accessible accessibilityRole="image" accessibilityLabel={t('tracking.live.mapA11y')}>
      <APIProvider apiKey={KEY!} language={language} region="IN" onError={onFail}>
        <Map
          style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
          mapId={MAP_ID} defaultBounds={initial} defaultCenter={{ lat: tracking.drop.lat, lng: tracking.drop.lng }} defaultZoom={14}
          gestureHandling="none" disableDefaultUI keyboardShortcuts={false} clickableIcons={false}
        >
          {route.length > 1 && <Polyline path={route} strokeColor={colors.forest} strokeOpacity={0.95} strokeWeight={5} />}
          <AdvancedMarker position={{ lat: tracking.store.lat, lng: tracking.store.lng }} anchorPoint={AdvancedMarkerAnchorPoint.CENTER} zIndex={1}><PinBadge kind="store" /></AdvancedMarker>
          <AdvancedMarker position={{ lat: tracking.drop.lat, lng: tracking.drop.lng }} anchorPoint={AdvancedMarkerAnchorPoint.CENTER} zIndex={2}><PinBadge kind="drop" /></AdvancedMarker>
          {rider && glided && (
            <AdvancedMarker position={{ lat: glided.lat, lng: glided.lng }} anchorPoint={AdvancedMarkerAnchorPoint.CENTER} zIndex={3}>
              <RiderBadge heading={glided.heading} stale={rider.stale} name={rider.first_name} />
            </AdvancedMarker>
          )}
          <Framer frame={frame} animate={animate} />
        </Map>
      </APIProvider>
      {rider?.stale && <StaleHint />}
    </View>
  );
}

export function TrackingMap(props: TrackingMapProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Google calls this global when it refuses the key (wrong referrer, billing off, API not enabled).
    const w = window as unknown as { gm_authFailure?: () => void };
    const previous = w.gm_authFailure;
    w.gm_authFailure = () => { setFailed(true); previous?.(); };
    return () => { w.gm_authFailure = previous; };
  }, []);
  if (!KEY || failed) return <TrackingSchematic {...props} />;
  return <GoogleTracking {...props} onFail={() => setFailed(true)} />;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
