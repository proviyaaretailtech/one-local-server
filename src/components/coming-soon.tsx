// Shown in place of a feature that isn't live yet (see src/features.ts) — a clear, branded promise
// instead of an error or a half-working screen.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { OneGlyph } from './one-button';
import { useFormat, useTranslation } from '../i18n';

const INK = '#050605';
// Which features have a "coming soon" page and their icon. The words live in the catalogue under comingSoon.<key>.
const FEATURES = {
  ai_search: { icon: 'scan-outline', key: 'aiSearch' },
  assistant: { icon: 'sparkles-outline', key: 'assistant' },
  wallet: { icon: 'wallet-outline', key: 'wallet' },
} as const;

export function ComingSoon({ feature }: { feature: keyof typeof FEATURES }) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { t } = useTranslation(); const fmt = useFormat(); const c = FEATURES[feature];
  const points = [t(`comingSoon.${c.key}.point1`), t(`comingSoon.${c.key}.point2`), t(`comingSoon.${c.key}.point3`)];
  return <View testID={`coming-soon-${feature}`} style={[s.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 110 }]}>
    <Pressable testID="coming-soon-back" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={s.back}><Icon name="chevron-back" size={22} color="#fff" /></Pressable>
    <View style={s.body}>
      <View style={s.badgeRow}><OneGlyph size={22} /><View style={s.pill}><Text style={s.pillText}>{t('comingSoon.badge')}</Text></View></View>
      <View style={s.iconWrap}><Icon name={c.icon as any} size={34} color={colors.electricLime} /></View>
      <Text style={s.title}>{t(`comingSoon.${c.key}.title`)}</Text>
      <Text style={s.text}>{t(`comingSoon.${c.key}.body`, { amount: fmt.money(2000) })}</Text>
      <View style={s.points}>{points.map((p, i) => <View key={i} style={s.point}><Icon name="checkmark-circle" size={16} color={colors.electricLime} /><Text style={s.pointText}>{p}</Text></View>)}</View>
      <Pressable testID="coming-soon-search" onPress={() => router.replace('/search' as any)} style={s.cta}><Icon name="search" size={16} color={INK} /><Text style={s.ctaText}>{t('comingSoon.cta')}</Text></Pressable>
    </View>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INK, paddingHorizontal: 22 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', maxWidth: 480, alignSelf: 'center', width: '100%' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { borderWidth: 1, borderColor: colors.electricLime, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { color: colors.electricLime, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  iconWrap: { marginTop: 28, width: 72, height: 72, borderRadius: 24, backgroundColor: 'rgba(179,244,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.8, marginTop: 20 },
  text: { color: 'rgba(255,255,255,0.68)', fontSize: 14, lineHeight: 21, marginTop: 10 },
  points: { marginTop: 22, gap: 12 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pointText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  cta: { marginTop: 32, minHeight: 52, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.electricLime, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { color: INK, fontSize: 15, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
});
