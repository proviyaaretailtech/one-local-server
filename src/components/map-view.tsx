// Native map (iOS: Apple Maps, Android: Google Maps). The web version is map-view.web.tsx.
import { useEffect, useRef } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import RNMapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import type { Point } from '../delivery-location';
import { LIGHT_MAP_STYLE } from './map-style';

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

export function MapView({ initial, moveTo, onSettle, onMoveStart, style }: MapViewProps) {
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

export const mapsAvailable = true;
