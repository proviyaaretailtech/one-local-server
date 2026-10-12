import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '@/src/theme';
import { Tap } from '@/src/components/tap';
import { useTranslation } from '@/src/i18n';

// Any address the app does not know (an old link, a mistyped deep link): a friendly way back instead of a blank 404.
export default function NotFound() {
  const router = useRouter(); const { t } = useTranslation();
  return <View testID="not-found-screen" style={s.screen}>
    <Text style={s.code}>404</Text>
    <Text style={s.title}>{t('notFound.title')}</Text>
    <Text style={s.body}>{t('notFound.body')}</Text>
    <Tap testID="not-found-home" accessibilityRole="button" onPress={() => router.replace('/(tabs)')} style={s.cta} radius={24}><Text style={s.ctaText}>{t('notFound.home')}</Text></Tap>
  </View>;
}
const s = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.surface },
  code: { color: colors.forest, fontSize: 14, fontWeight: '800', letterSpacing: 3 },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: 10 },
  body: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: 8, lineHeight: 21 },
  cta: { marginTop: 24, minHeight: 48, paddingHorizontal: 28, borderRadius: 24, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: colors.surface, fontSize: 15, fontWeight: '800' },
});
