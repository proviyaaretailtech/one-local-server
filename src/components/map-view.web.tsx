// Web map: Google Maps JavaScript API. Needs GOOGLE_MAPS_BROWSER_KEY (restricted by referrer).
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@/src/ui/text';
import Constants from 'expo-constants';
import Icon from '@react-native-vector-icons/ionicons';
import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps';
import type { MapViewProps } from './map-view';
import { LIGHT_MAP_STYLE } from './map-style';
import { useTranslation } from '../i18n';
import { colors } from '../theme';

const KEY: string | undefined = Constants.expoConfig?.extra?.googleMapsBrowserKey;
export const mapsAvailable = !!KEY;

function Mover({ moveTo }: Pick<MapViewProps, 'moveTo'>) {
  const map = useMap();
  useEffect(() => {
    if (map && moveTo) map.panTo({ lat: moveTo.lat, lng: moveTo.lng });
  }, [map, moveTo]);
  return null;
}

export function MapView({ initial, moveTo, onSettle, onMoveStart, style }: MapViewProps) {
  const { t, i18n } = useTranslation();
  // The map's own labels follow the app language (Google loads one language per page: the one active when the map first opens).
  const mapLanguage = (i18n.resolvedLanguage ?? i18n.language ?? 'en').startsWith('hi') ? 'hi' : 'en';
  if (!KEY) {
    return (
      <View testID="address-map-missing" style={[style, styles.missing]}>
        <Icon name="map-outline" size={34} color={colors.muted} />
        <Text style={styles.title}>{t('address.map.missingTitle')}</Text>
        <Text style={styles.body}>{t('address.map.missingBody')}</Text>
      </View>
    );
  }
  return (
    <View testID="address-map" style={style}>
      <APIProvider apiKey={KEY} language={mapLanguage} region="IN">
        <Map
          style={{ width: '100%', height: '100%' }}
          defaultCenter={initial}
          defaultZoom={17}
          gestureHandling="greedy"
          disableDefaultUI
          clickableIcons={false}
          styles={LIGHT_MAP_STYLE}
          onCenterChanged={onMoveStart ? () => onMoveStart() : undefined}
          onIdle={e => {
            const c = e.map.getCenter();
            if (c) onSettle({ lat: c.lat(), lng: c.lng() });
          }}
        />
        <Mover moveTo={moveTo} />
      </APIProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  missing: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 28, backgroundColor: colors.surfaceSecondary },
  title: { fontSize: 15, fontWeight: '700', color: colors.onSurface, textAlign: 'center' },
  body: { fontSize: 12, color: colors.muted, textAlign: 'center', maxWidth: 300, lineHeight: 17 },
});
