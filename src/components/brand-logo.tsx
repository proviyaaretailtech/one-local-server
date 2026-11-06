// The OneLocal wordmark (founder's logo, 10 Oct 2026), bundled with the app so it shows instantly and offline.
// tone 'light' = on white/light screens (black "One", green "Local", the founder's green #72D400, 2026-10-29);
// 'dark' = on photos and coloured headers: black "One", white "Local", no background (founder, 2026-10-29).
import { Image } from 'expo-image';
import type { StyleProp, ImageStyle } from 'react-native';

const SOURCES = { light: require('../../assets/images/brand/onelocal-logo.png'), dark: require('../../assets/images/brand/onelocal-logo-on-dark.png') };
const RATIO = { light: 900 / 188, dark: 900 / 188 };

// `tint` paints the whole wordmark one colour (home's white logo on its photo).
export function BrandLogo({ tone, height, tint, testID, style, onLoad }: { tone: 'light' | 'dark'; height: number; tint?: string; testID?: string; style?: StyleProp<ImageStyle>; onLoad?: () => void }) {
  // i18n-ignore: the brand name, not UI copy
  return <Image testID={testID} accessibilityRole="image" accessibilityLabel="OneLocal" source={SOURCES[tone]} tintColor={tint} onLoad={onLoad} onError={onLoad} contentFit="contain" style={[{ height, width: Math.round(height * RATIO[tone]) }, style]} />;
}
