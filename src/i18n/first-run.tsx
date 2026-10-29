// First launch only: "Choose your language" before anything else (the location question waits for it).
// Rendered inside the app column in app/_layout.tsx, just under the intro splash, so the intro plays first and
// dissolves into this. Picking a row switches the app at once (live), Continue remembers it.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from '@react-native-vector-icons/ionicons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '../components/brand-logo';
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
  // Light or dark look for this first screen, remembered on the phone (the rest of the app is light for now).
  const [dark, setDark] = useState(true);
  useEffect(() => { AsyncStorage.getItem(APPEARANCE_KEY).then(v => { if (v === 'light') setDark(false); }).catch(() => {}); }, []);
  const flip = () => setDark(d => { const next = !d; AsyncStorage.setItem(APPEARANCE_KEY, next ? 'dark' : 'light').catch(() => {}); return next; });
  if (!show) return null;
  return <View testID="language-first-run" accessibilityViewIsModal aria-modal style={[s.screen, !dark && s.screenLight]}>
    <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
      <View style={s.top}>
        <BrandLogo tone={dark ? 'dark' : 'light'} height={30} />
        <Pressable testID="appearance-toggle" accessibilityRole="switch" accessibilityState={{ checked: dark }} accessibilityLabel={t(dark ? 'language.appearance.toLight' : 'language.appearance.toDark')}
          onPress={flip} hitSlop={8} style={[s.toggle, !dark && s.toggleLight]}>
          <View style={[s.toggleSide, !dark && s.toggleOn]}><Icon name="sunny" size={15} color={!dark ? '#050605' : 'rgba(255,255,255,0.6)'} /></View>
          <View style={[s.toggleSide, dark && s.toggleOn]}><Icon name="moon" size={14} color={dark ? '#050605' : 'rgba(5,6,5,0.45)'} /></View>
        </Pressable>
      </View>
      <View style={s.hero}>
        {locales.filter(l => !l.dev).map(l => <Text key={l.code} accessibilityLanguage={l.code} style={[s.title, !dark && s.titleLight]}>{l.chooser}</Text>)}
      </View>
      <LanguagePicker tone={dark ? 'dark' : 'light'} />
      <Text style={[s.note, !dark && s.noteLight]}>{t('language.changeLater')}</Text>
      <Pressable testID="language-continue" accessibilityRole="button" accessibilityState={{ busy: state.status === 'loading', disabled: state.status === 'loading' }} disabled={state.status === 'loading'}
        onPress={() => void confirm()} style={({ pressed }) => [s.primary, (pressed || state.status === 'loading') && { opacity: 0.7 }]}>
        <Text style={s.primaryText}>{t('common.continue')}</Text>
      </Pressable>
    </ScrollView>
  </View>;
}

const APPEARANCE_KEY = 'onecity.appearance';

const s = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, zIndex: 900, backgroundColor: '#050605' },
  screenLight: { backgroundColor: '#F8F9F5' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggle: { flexDirection: 'row', padding: 3, gap: 2, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  toggleLight: { backgroundColor: 'rgba(5,6,5,0.05)', borderColor: 'rgba(5,6,5,0.10)' },
  toggleSide: { width: 36, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.electricLime },
  titleLight: { color: '#0B1F16' },
  noteLight: { color: 'rgba(11,31,22,0.6)' },
  content: { paddingHorizontal: 22, flexGrow: 1 },
  brand: { flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  hero: { marginTop: 30, marginBottom: 22, gap: 6 },
  title: { color: '#fff', fontSize: 28, lineHeight: 40, fontWeight: '800' },
  note: { color: 'rgba(255,255,255,0.62)', fontSize: 12, lineHeight: 19, marginTop: 16 },
  primary: { marginTop: 22, minHeight: 56, borderRadius: 18, backgroundColor: colors.electricLime, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  primaryText: { color: '#050605', fontSize: 16, lineHeight: 24, fontWeight: '800' },
});
