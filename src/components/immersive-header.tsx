// Full-width photo header for brand/store-style pages: the image runs edge to edge (under the
// status bar), a dark scrim keeps the white title readable, glass buttons float on top, and the
// page content slides up over its bottom edge.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { useTranslation } from '../i18n';

type Props = {
  image: string; title: string; subtitle?: string; eyebrow?: string;
  logo?: string; monogram?: string; height?: number; testID?: string;
  right?: React.ReactNode; children?: React.ReactNode;
};

export function ImmersiveHeader({ image, title, subtitle, eyebrow, logo, monogram, height = 340, testID, right, children }: Props) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { t } = useTranslation();
  return <View testID={testID} style={{ height: height + insets.top }}>
    <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" />
    <LinearGradient colors={['rgba(5,6,5,0.55)', 'rgba(5,6,5,0)', 'rgba(5,6,5,0.25)', 'rgba(5,6,5,0.88)']} locations={[0, 0.3, 0.55, 1]} style={StyleSheet.absoluteFill} />
    <View style={[s.bar, { top: insets.top + 8 }]}>
      <Pressable testID={testID ? `${testID}-back` : undefined} accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)' as never)} style={s.glass}><Icon name="chevron-back" size={22} color="#fff" /></Pressable>
      {right}
    </View>
    <View style={s.bottom}>
      {(logo || monogram) && <View style={s.logoTile}>{logo ? <Image source={logo} style={s.logo} contentFit="contain" /> : <Text style={s.monogram}>{monogram}</Text>}</View>}
      {!!eyebrow && <Text style={s.eyebrow}>{eyebrow}</Text>}
      <Text style={s.title} numberOfLines={2}>{title}</Text>
      {!!subtitle && <Text style={s.subtitle} numberOfLines={2}>{subtitle}</Text>}
      {children}
    </View>
  </View>;
}

export function GlassPill({ label, icon, onPress, active, testID }: { label: string; icon?: string; onPress: () => void; active?: boolean; testID?: string }) {
  return <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [s.pill, active && s.pillOn, pressed && { transform: [{ scale: 0.96 }] }]}>
    {!!icon && <Icon name={icon as any} size={15} color={active ? '#050605' : '#fff'} />}<Text style={[s.pillText, active && { color: '#050605' }]}>{label}</Text>
  </Pressable>;
}

const s = StyleSheet.create({
  bar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  glass: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 20, right: 20, bottom: 40 },
  logoTile: { width: 64, height: 64, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 14, boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 24, color: 'rgba(0,0,0,0.3)' }] },
  logo: { width: 48, height: 48 },
  monogram: { fontSize: 24, fontWeight: '800', color: '#050605' },
  eyebrow: { color: colors.electricLime, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  title: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: -1, marginTop: 6 },
  subtitle: { color: 'rgba(255,255,255,0.78)', fontSize: 14, marginTop: 6, lineHeight: 20 },
  pill: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' },
  pillOn: { backgroundColor: colors.electricLime, borderColor: colors.electricLime },
  pillText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
