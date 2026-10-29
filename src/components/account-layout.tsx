import { ReactNode } from 'react';
import { View, Pressable, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '@/src/ui/text';
import Icon from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme';

export function AccountLayout({ title, subtitle, children, id }: { title: string; subtitle?: string; children: ReactNode; id: string }) {
  const router = useRouter(); const { t } = useTranslation();
  return <KeyboardAvoidingView testID={`${id}-screen`} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.screen}>
    <View style={s.header}><Pressable testID={`${id}-back`} accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/account')} style={s.back}><Icon name="arrow-back" size={22} color={colors.onSurface} /></Pressable><Text testID={`${id}-title`} style={s.heading}>{title}</Text></View>
    <ScrollView testID={`${id}-scroll`} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>{subtitle && <Text testID={`${id}-subtitle`} style={s.subtitle}>{subtitle}</Text>}{children}</ScrollView>
  </KeyboardAvoidingView>;
}
export function ActionButton({ id, title, onPress, busy, disabled }: { id: string; title: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return <Pressable testID={id} accessibilityRole="button" disabled={busy || disabled} onPress={onPress} style={({ pressed }) => [s.button, (pressed || busy || disabled) && s.dim]}>{busy && <ActivityIndicator color={colors.surface} />}<Text testID={`${id}-label`} style={s.buttonText}>{title}</Text></Pressable>;
}
export function Message({ text, error = false, id }: { text: string; error?: boolean; id: string }) { return text ? <Text testID={id} accessibilityLiveRegion="polite" style={[s.message, error && s.error]}>{text}</Text> : null; }
export const accountStyles = StyleSheet.create({ card: { padding: 20, borderRadius: 24, backgroundColor: colors.surface, marginBottom: 16, gap: 14 }, label: { color: colors.onSurface, fontSize: 13, fontWeight: '600', marginBottom: 8 }, input: { color: colors.onSurface, minHeight: 50, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 14, padding: 14, backgroundColor: colors.surface }, hint: { color: colors.muted, fontSize: 12, lineHeight: 19 }, title: { color: colors.onSurface, fontSize: 18, fontWeight: '700' }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, flex: { flex: 1 } });
const s = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.shopsFade }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12, backgroundColor: colors.surface }, back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.shopsFade, alignItems: 'center', justifyContent: 'center' }, heading: { flex: 1, color: colors.onSurface, fontSize: 21, fontWeight: '700' }, content: { padding: 20, paddingBottom: 40 }, subtitle: { color: colors.muted, fontSize: 13, lineHeight: 21, marginBottom: 24 }, button: { minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, backgroundColor: colors.shops, paddingHorizontal: 20, marginVertical: 10 }, buttonText: { color: colors.surface, fontSize: 14, fontWeight: '700' }, dim: { opacity: 0.55 }, message: { color: colors.shops, fontSize: 13, lineHeight: 20, marginVertical: 10 }, error: { color: colors.onError } });