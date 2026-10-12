// First launch only: "Choose your language" before anything else (the location question waits for it).
// Rendered inside the app column in app/_layout.tsx, just under the intro splash, so the intro plays first and
// dissolves into this. Picking a row switches the app at once (live), Continue remembers it.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { OneGlyph } from '../components/one-button';
import { colors } from '../theme';
import { LanguagePicker } from './language-picker';
import { useLanguage } from './provider';

/**
 * True when the first-run chooser should be on screen. A launch where the intro has already played in this
 * session (a returning visitor, or the Playwright fixtures that pre-set it) is never interrupted.
 */
export function useShowFirstRun(): boolean {
  const { firstRun } = useLanguage();
  const [introWasPlayed] = useState(() => !!(globalThis as unknown as { __onecityIntroPlayed?: boolean }).__onecityIntroPlayed);
  return firstRun && !introWasPlayed;
}

export function LanguageFirstRun() {
  const show = useShowFirstRun();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { state, locales, confirm } = useLanguage();
  if (!show) return null;
  return <View testID="language-first-run" accessibilityViewIsModal aria-modal style={s.screen}>
    <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
      <View style={s.brand}><OneGlyph size={30} /><Text style={s.brandWord}>neCity</Text></View>
      <View style={s.hero}>
        {locales.filter(l => !l.dev).map(l => <Text key={l.code} accessibilityLanguage={l.code} style={s.title}>{l.chooser}</Text>)}
      </View>
      <LanguagePicker tone="dark" />
      <Text style={s.note}>{t('language.changeLater')}</Text>
      <Pressable testID="language-continue" accessibilityRole="button" accessibilityState={{ busy: state.status === 'loading', disabled: state.status === 'loading' }} disabled={state.status === 'loading'}
        onPress={() => void confirm()} style={({ pressed }) => [s.primary, (pressed || state.status === 'loading') && { opacity: 0.7 }]}>
        <Text style={s.primaryText}>{t('common.continue')}</Text>
      </Pressable>
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, zIndex: 900, backgroundColor: '#050605' },
  content: { paddingHorizontal: 22, flexGrow: 1 },
  brand: { flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  brandWord: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.6, marginBottom: 1 },
  hero: { marginTop: 30, marginBottom: 22, gap: 6 },
  title: { color: '#fff', fontSize: 28, lineHeight: 40, fontWeight: '800' },
  note: { color: 'rgba(255,255,255,0.62)', fontSize: 12, lineHeight: 19, marginTop: 16 },
  primary: { marginTop: 22, minHeight: 56, borderRadius: 18, backgroundColor: colors.electricLime, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  primaryText: { color: '#050605', fontSize: 16, lineHeight: 24, fontWeight: '800' },
});
