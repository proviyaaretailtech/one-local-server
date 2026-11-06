// The top of a shop's page, in pop-art: the shop's banner photo, ending in a curve into a block of the shop's deep colour
// under faint halftone dots, holding its sign (logo beside its name and line, on a darker panel of that colour, the
// delivery time on a lime sticker), its rating and a follow sticker. The page puts its category tiles in the same block as
// `children`.
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Path, Pattern, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import Icon from '@react-native-vector-icons/ionicons';
import { Text } from '../ui/text';
import { Tap } from './tap';
import { colors, glassPane, popBase, radius, type NameTint } from '../theme';
import { logoSize, logoTile } from '../logo-tile';
import { useFormat, useTranslation } from '../i18n';
import { storeBanner, type Store } from '../api';

const DOT_GAP = 14;
const BANNER = 132; // the banner's height below `top`
const CURVE = 40; // how far its curved lower edge dips in the middle

type Props = { store: Store; tint: NameTint; top: number; following: boolean; onFollow: () => void; children?: React.ReactNode };

export function ShopHero({ store, tint: [, ink], top, following, onFollow, children }: Props) {
  const { t } = useTranslation(); const fmt = useFormat();
  const banner = storeBanner(store);
  return <View testID="shop-hero" style={[s.block, { backgroundColor: ink, paddingTop: banner ? 0 : top }]}>
    <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs><Pattern id="halftone" width={DOT_GAP} height={DOT_GAP} patternUnits="userSpaceOnUse"><Circle cx={DOT_GAP / 2} cy={DOT_GAP / 2} r={2} fill={colors.surface} /></Pattern></Defs>
      <Rect width="100%" height="100%" fill="url(#halftone)" opacity={0.1} />
    </Svg>
    {!!banner && <View testID="shop-banner" style={{ height: top + BANNER }}>
      <Image source={banner} style={StyleSheet.absoluteFill} contentFit="cover" />
      {/* Shade under the status bar and back button, so they read on any photo. */}
      <LinearGradient pointerEvents="none" colors={[colors.overlay, 'transparent']} style={[s.scrim, { height: top + 40 }]} />
      {/* The photo's lower edge: one smooth curve dipping in the middle, the shop's colour below it. Stretched to the
          width, so only the curve's width scales. */}
      <Svg pointerEvents="none" width="100%" height={CURVE} viewBox={`0 0 100 ${CURVE}`} preserveAspectRatio="none" style={s.curve}>
        <Path d={`M0,0 Q50,${CURVE * 2} 100,0 L100,${CURVE} L0,${CURVE} Z`} fill={ink} />
      </Svg>
    </View>}
    {/* Opaque in the shop's colour (so the dots stop at its edge), then shaded darker. Over a banner it sits on the curve. */}
    <View style={[s.sign, !!banner && s.signOnBanner, { backgroundColor: ink }]}>
      <View style={s.shade} />
      <View style={s.logoTile}>{!!store.logo && <Image source={store.logo} style={s.logo} contentFit="contain" />}</View>
      <View style={s.copy}>
        <Text testID="shop-name" numberOfLines={2} style={s.name}>{store.name}</Text>
        {!!store.tagline && <Text numberOfLines={2} style={s.tagline}>{store.tagline}</Text>}
      </View>
      <View style={s.sticker}><Icon name="flash" size={12} color={colors.forestDeep} /><Text style={s.stickerText}>{fmt.deliveryTime(store.delivery_time)}</Text></View>
    </View>
    <View style={s.meta}>
      <View style={s.chip}><Icon name="star" size={12} color={colors.surface} /><Text style={s.chipText}>{fmt.number(store.rating, { maxFractionDigits: 1 })}</Text></View>
      <View style={s.chip}><Text style={s.chipText}>{t('store.sampleBadge')}</Text></View>
      <Tap testID="follow-btn" accessibilityRole="button" accessibilityState={{ selected: following }} onPress={onFollow} style={s.follow}>
        <Icon name={following ? 'heart' : 'heart-outline'} size={15} color={following ? colors.onError : ink} />
        <Text style={[s.followText, { color: ink }]}>{following ? t('store.following') : t('store.follow')}</Text>
      </Tap>
    </View>
    {children}
  </View>;
}

const s = StyleSheet.create({
  // Room at the bottom for the page's white sheet, which rises over it.
  block: { overflow: 'hidden', paddingBottom: 52 },
  sign: { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 20, borderRadius: radius.md, borderWidth: 1, borderColor: colors.whiteGlassLine },
  signOnBanner: { marginTop: -28 },
  shade: { ...StyleSheet.absoluteFill, borderRadius: radius.md, backgroundColor: colors.popShade },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  curve: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  logoTile: logoTile(60),
  logo: { width: logoSize(60), height: logoSize(60) },
  copy: { flex: 1, gap: 4 },
  name: { fontSize: 20, lineHeight: 25, fontWeight: '800', letterSpacing: -0.3, color: colors.surface },
  tagline: { fontSize: 13, lineHeight: 18, fontWeight: '500', color: colors.surface, opacity: 0.85 },
  // On the sign's top right corner.
  sticker: { position: 'absolute', top: -13, right: 16, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.electricLime, boxShadow: popBase(3) },
  stickerText: { fontSize: 12, fontWeight: '800', color: colors.forestDeep },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: 16 },
  chip: { ...glassPane, flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30, paddingHorizontal: 10, borderRadius: radius.pill },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.surface },
  follow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 34, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface, boxShadow: popBase(3) },
  followText: { fontSize: 13, fontWeight: '800' },
});
