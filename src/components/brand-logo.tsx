// The OneLocal wordmark (founder's logo, 10 Oct 2026), bundled with the app so it shows instantly and offline.
// tone 'light' = on white/light screens (green "One", black "Local"); 'dark' = on dark screens and photos (white "Local").
import { Image } from 'expo-image';
import type { StyleProp, ImageStyle } from 'react-native';

const SOURCES = { light: require('../../assets/images/brand/onelocal-logo.png'), dark: require('../../assets/images/brand/onelocal-logo-on-dark.png') };
const RATIO = { light: 900 / 188, dark: 900 / 180 };

export function BrandLogo({ tone, height, testID, style, onLoad }: { tone: 'light' | 'dark'; height: number; testID?: string; style?: StyleProp<ImageStyle>; onLoad?: () => void }) {
  // i18n-ignore: the brand name, not UI copy
  return <Image testID={testID} accessibilityRole="image" accessibilityLabel="OneLocal" source={SOURCES[tone]} onLoad={onLoad} onError={onLoad} contentFit="contain" style={[{ height, width: Math.round(height * RATIO[tone]) }, style]} />;
}
