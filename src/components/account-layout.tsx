// The frame of every page under the profile: the brand's soft green wash under the status bar, a round back button with
// the page's name beside it, and the page scrolling below, its line about itself first. Back goes to where you came from,
// or to `fallback` when the page was opened directly.
import type { ReactElement, ReactNode } from 'react';
import { ActivityIndicator, View, Pressable, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, type RefreshControlProps } from 'react-native';
import { Text } from '@/src/ui/text';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { safeLineHeight } from '../i18n';
import { colors, lightPane, radius, soft } from '../theme';

type Props = { id: string; title: string; subtitle?: string; children: ReactNode; fallback?: Href; refreshControl?: ReactElement<RefreshControlProps> };

export function AccountLayout({ id, title, subtitle, children, fallback = '/account', refreshControl }: Props) {
  const router = useRouter(); const { t } = useTranslation(); const insets = useSafeAreaInsets();
  return <KeyboardAvoidingView testID={`${id}-screen`} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.screen}>
    <Wash />
    <View style={[s.bar, { paddingTop: insets.top + 8 }]}>
      <Pressable testID={`${id}-back`} accessibilityRole="button" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace(fallback)} style={s.back}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
      <Text testID={`${id}-title`} accessibilityRole="header" style={s.heading}>{title}</Text>
    </View>
    <ScrollView testID={`${id}-scroll`} keyboardShouldPersistTaps="handled" refreshControl={refreshControl} contentContainerStyle={s.content}>
      {!!subtitle && <Text testID={`${id}-subtitle`} style={s.subtitle}>{subtitle}</Text>}
      {children}
    </ScrollView>
  </KeyboardAvoidingView>;
}

/** The profile's soft green wash, from under the status bar down into the page's grey. */
export function Wash() {
  const insets = useSafeAreaInsets();
  return <LinearGradient pointerEvents="none" colors={[colors.cityMid, colors.cityFade, colors.surfaceSecondary]} locations={[0, 0.45, 1]} style={[s.wash, { height: insets.top + 300 }]} />;
}

/** A small heading above a card or a list. */
export function Group({ children }: { children: string }) {
  return <Text accessibilityRole="header" style={s.group}>{children}</Text>;
}

/** What just happened, on a soft green band, or on a soft red one when it went wrong. */
export function Message({ text, error = false, id }: { text: string; error?: boolean; id: string }) {
  return text ? <View style={[s.note, error && s.noteError]}>
    <Icon name={error ? 'alert-circle' : 'checkmark-circle'} size={18} color={error ? colors.onError : colors.forest} />
    <Text testID={id} accessibilityLiveRegion="polite" style={[s.noteText, error && s.noteTextError]}>{text}</Text>
  </View> : null;
}

// A full-width pill button for account screens (Notifications: mark read, clear).
export function ActionButton({ id, title, onPress, busy, disabled }: { id: string; title: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return <Pressable testID={id} accessibilityRole="button" disabled={busy || disabled} onPress={onPress} style={({ pressed }) => [s.button, (pressed || busy || disabled) && s.dim]}>{busy && <ActivityIndicator color={colors.surface} />}<Text testID={`${id}-label`} style={s.buttonText}>{title}</Text></Pressable>;
}

export const accountStyles = StyleSheet.create({
  card: { padding: 18, borderRadius: radius.md, backgroundColor: colors.surface, boxShadow: soft.lifted, gap: 14 },
  label: { color: colors.onSurface, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  // Filled in the page's grey, so it reads as a place to type.
  input: { color: colors.onSurface, minHeight: 52, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  title: { color: colors.onSurface, fontSize: 17, lineHeight: 24, fontWeight: '800', letterSpacing: -0.2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  // A ChipRow inside a card runs to the card's edges, so its chips scroll out of sight there rather than at the padding.
  chips: { flexGrow: 0, marginHorizontal: -18 },
  chipContent: { paddingHorizontal: 18, gap: 8 },
  // The soft mint tile an icon sits on (the same tile as in the lists).
  tile: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintTile },
});
const s = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, backgroundColor: colors.forest, paddingHorizontal: 20, marginVertical: 10 },
  buttonText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  dim: { opacity: 0.55 },
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  wash: { position: 'absolute', top: 0, left: 0, right: 0 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  back: { ...lightPane, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, color: colors.onSurface, fontSize: 24, lineHeight: safeLineHeight(24), fontWeight: '800', letterSpacing: -0.6 },
  content: { gap: 14, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 40 },
  subtitle: { color: colors.inkSoft, fontSize: 14, lineHeight: 21, marginHorizontal: 2, marginBottom: 4 },
  group: { color: colors.onSurface, fontSize: 15, lineHeight: 21, fontWeight: '800', marginTop: 10, marginBottom: -4, marginLeft: 4 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.limeSoft },
  noteError: { backgroundColor: colors.error },
  noteText: { flex: 1, color: colors.forest, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  noteTextError: { color: colors.onError },
});
