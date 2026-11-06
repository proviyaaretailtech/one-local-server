// Shown in place of a feature that isn't live yet (see src/features.ts) — a clear, branded promise
// instead of an error or a half-working screen.
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { colors, lightPane, mintCard, radius } from '../theme';
import { OneGlyph } from './one-button';
import { Wash } from './account-layout';
import { Button } from '../ui/button';
import { useFormat, useTranslation } from '../i18n';

// Which features have a "coming soon" page and their icon. The words live in the catalogue under comingSoon.<key>.
const FEATURES = {
  ai_search: { icon: 'scan-outline', key: 'aiSearch' },
  assistant: { icon: 'sparkles-outline', key: 'assistant' },
  wallet: { icon: 'wallet-outline', key: 'wallet' },
} as const;

export function ComingSoon({ feature }: { feature: keyof typeof FEATURES }) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { t } = useTranslation(); const fmt = useFormat(); const c = FEATURES[feature];
  const points = [t(`comingSoon.${c.key}.point1`), t(`comingSoon.${c.key}.point2`), t(`comingSoon.${c.key}.point3`)];
  return <View testID={`coming-soon-${feature}`} style={[s.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 110 }]}>
    <Wash />
    <Pressable testID="coming-soon-back" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={s.back}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
    <View style={s.body}>
      <View style={s.badgeRow}><OneGlyph size={22} /><View style={s.pill}><Text style={s.pillText}>{t('comingSoon.badge')}</Text></View></View>
      <View style={s.iconWrap}><Icon name={c.icon} size={34} color={colors.forest} /></View>
      <Text style={s.title}>{t(`comingSoon.${c.key}.title`)}</Text>
      <Text style={s.text}>{t(`comingSoon.${c.key}.body`, { amount: fmt.money(2000) })}</Text>
      <View style={s.points}>{points.map((p, i) => <View key={i} style={s.point}><Icon name="checkmark-circle" size={18} color={colors.forest} /><Text style={s.pointText}>{p}</Text></View>)}</View>
      <Button testID="coming-soon-search" icon="search" title={t('comingSoon.cta')} onPress={() => router.replace('/search')} style={s.cta} />
    </View>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 22, backgroundColor: colors.surfaceSecondary },
  back: { ...lightPane, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', maxWidth: 480, alignSelf: 'center', width: '100%' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { borderWidth: 1, borderColor: colors.forest, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { color: colors.forest, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  iconWrap: { marginTop: 28, width: 84, height: 84, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintTile, boxShadow: mintCard.glow },
  title: { color: colors.onSurface, fontSize: 30, lineHeight: 37, fontWeight: '800', letterSpacing: -0.8, marginTop: 22 },
  text: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 10 },
  points: { marginTop: 22, gap: 12 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pointText: { color: colors.onSurface, fontSize: 14, fontWeight: '600', flex: 1 },
  cta: { marginTop: 32 },
});
