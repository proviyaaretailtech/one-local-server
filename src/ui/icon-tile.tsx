// A soft tile holding a 3D cut-out icon, lit from the middle, the icon casting a shadow in its own shape. It fills its
// parent's width. 'gold' for Home's services, 'mint' for the Categories grid, 'sky' for Book It.
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { colors, goldCard, goldIconShadow, mintCard, mintIconShadow, skyCard, skyIconShadow } from '../theme';

type Variant = 'gold' | 'mint' | 'sky';
type Props = { source: string | number; variant?: Variant; testID?: string };

export function IconTile({ source, variant = 'gold', testID }: Props) {
  const look = LOOKS[variant];
  return <View style={[s.box, look.box]}>
    <View style={[s.light, look.light]} />
    <View style={look.shadow}><Image testID={testID} source={source} style={s.icon} contentFit="contain" cachePolicy="memory-disk" /></View>
  </View>;
}

const s = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', height: 92, borderRadius: 22 },
  goldBox: { backgroundColor: colors.goldTile, boxShadow: goldCard.glow },
  mintBox: { backgroundColor: colors.mintTile, boxShadow: mintCard.glow },
  skyBox: { backgroundColor: colors.bookTop, boxShadow: skyCard.glow },
  light: { position: 'absolute', width: 32, height: 32, borderRadius: 16 },
  goldLight: { backgroundColor: colors.goldGlow, boxShadow: goldCard.light },
  mintLight: { backgroundColor: colors.mintGlow, boxShadow: mintCard.light },
  skyLight: { backgroundColor: colors.bookFade, boxShadow: skyCard.light },
  icon: { width: 64, height: 64 },
});
const LOOKS = {
  gold: { box: s.goldBox, light: s.goldLight, shadow: goldIconShadow },
  mint: { box: s.mintBox, light: s.mintLight, shadow: mintIconShadow },
  sky: { box: s.skyBox, light: s.skyLight, shadow: skyIconShadow },
} satisfies Record<Variant, object>;
