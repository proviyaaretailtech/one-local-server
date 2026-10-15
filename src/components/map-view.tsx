// Native map (iOS: Apple Maps, Android: Google Maps). The web version is map-view.web.tsx.
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Icon from '@react-native-vector-icons/ionicons';
import RNMapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import type { Point } from '../delivery-location';
import { LIGHT_MAP_STYLE } from './map-style';
import { nativeMapsReady } from '../native-maps';
import { useTranslation } from '../i18n';
import { colors } from '../theme';

export type MapViewProps = {
  initial: Point;
  // Change the object (e.g. add a new `at` timestamp) to move the map there.
  moveTo?: (Point & { at: number }) | null;
  onSettle: (center: Point) => void;
  // Called while the map is moving (drag, pinch, recenter), before onSettle; used to lift the pin.
  onMoveStart?: () => void;
  style?: StyleProp<ViewStyle>;
};

const ZOOM = { latitudeDelta: 0.004, longitudeDelta: 0.004 };

// Without a native maps key the Google map would abort the app; the address form still works without it.
export function MapView(props: MapViewProps) {
  return nativeMapsReady ? <NativeMap {...props} /> : <MapMissing style={props.style} />;
}

function MapMissing({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  return (
    <View testID="address-map-missing" style={[style, styles.missing]}>
      <Icon name="map-outline" size={34} color={colors.muted} />
      <Text style={styles.title}>{t('address.map.missingTitle')}</Text>
      <Text style={styles.body}>{t('address.map.missingBody')}</Text>
    </View>
  );
}

function NativeMap({ initial, moveTo, onSettle, onMoveStart, style }: MapViewProps) {
  const ref = useRef<RNMapView>(null);
  useEffect(() => {
    if (moveTo) ref.current?.animateToRegion({ latitude: moveTo.lat, longitude: moveTo.lng, ...ZOOM }, 450);
  }, [moveTo]);
  return (
    <RNMapView
      ref={ref}
      testID="address-map"
      style={style}
      // Android: Google tiles in the same light style as the web map. iOS: Apple's muted map (Google on iOS needs its native SDK).
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      customMapStyle={Platform.OS === 'android' ? LIGHT_MAP_STYLE : undefined}
      mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
      initialRegion={{ latitude: initial.lat, longitude: initial.lng, ...ZOOM }}
      showsUserLocation
      showsMyLocationButton={false}
      showsCompass={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      onRegionChange={onMoveStart ? () => onMoveStart() : undefined}
      onRegionChangeComplete={r => onSettle({ lat: r.latitude, lng: r.longitude })}
    />
  );
}

export const mapsAvailable = nativeMapsReady;

const styles = StyleSheet.create({
  missing: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 28, backgroundColor: colors.surfaceSecondary },
  title: { fontSize: 15, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  body: { fontSize: 12, color: colors.muted, textAlign: 'center', maxWidth: 300, lineHeight: 17 },
});
