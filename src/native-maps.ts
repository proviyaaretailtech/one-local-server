// Whether this phone build can draw a native map. iOS uses Apple Maps (no key). Android uses Google
// Maps, which needs its key baked into the APK (app config android.config.googleMaps.apiKey); without
// it the native map aborts the whole app, so screens fall back to their map-less layout instead.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

type AndroidMapsConfig = { android?: { config?: { googleMaps?: { apiKey?: string } } } };

export const nativeMapsReady =
  Platform.OS === 'ios' || !!(Constants.expoConfig as AndroidMapsConfig | null)?.android?.config?.googleMaps?.apiKey;
