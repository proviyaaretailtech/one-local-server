// First sign-in (mobile code, Google, email): ask the few things an order needs: who to deliver to, and where.
// Name and delivery location are required; email is optional. The mobile number is already known from the code.
// ProfileGate (src/components/profile-gate.tsx) sends a signed-in customer with no name here.
import { useCallback, useState } from 'react';
import { View, Pressable, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from '@react-native-vector-icons/ionicons';
import { useAuth } from '@/src/auth';
import { useCustomer } from '@/src/customer';
import { useDeliveryLocation } from '@/src/delivery-location';
import { supabase } from '@/src/lib/supabase';
import { colors } from '@/src/theme';
import { useTranslation } from '@/src/i18n';
import { BrandLogo } from '@/src/components/brand-logo';

const LOCATION_KEY = 'one-latur-location';

export default function Welcome() {
  const { t } = useTranslation(); const router = useRouter(); const insets = useSafeAreaInsets();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { profile, update, ready } = useCustomer(); const { signOut } = useAuth(); const { location } = useDeliveryLocation();
  const [name, setName] = useState(profile.name); const [email, setEmail] = useState(profile.email);
  const [placeChosen, setPlaceChosen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  // Whether the customer has picked a place (not just the Latur default): re-checked when they come back from the picker.
  useFocusEffect(useCallback(() => { AsyncStorage.getItem(LOCATION_KEY).then(v => setPlaceChosen(!!v)).catch(() => {}); }, [location]));

  const finish = async () => {
    setError('');
    if (name.trim().length < 2) return setError(t('profile.error.name'));
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t('profile.error.email'));
    if (!placeChosen) return setError(t('welcome.locationNeeded'));
    setBusy(true);
    try {
      await update({ profile: { ...profile, name: name.trim(), email: email.trim() } });
      // The account remembers the name too, so signing in on another phone does not ask again (best effort).
      await supabase?.auth.updateUser({ data: { full_name: name.trim() } }).catch(() => {});
      if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('/welcome')) router.replace(next as never); else router.replace('/(tabs)');
    } catch { setError(t('welcome.saveError')); }
    finally { setBusy(false); }
  };

  return <KeyboardAvoidingView testID="welcome-screen" behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.screen}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}>
      <BrandLogo tone="light" height={30} />
      <Text accessibilityRole="header" style={s.title}>{t('welcome.title')}</Text>
      <Text style={s.subtitle}>{t('welcome.subtitle')}</Text>

      <Text style={s.label}>{t('profile.label.name')}</Text>
      <View style={s.field}><Icon name="person-outline" size={19} color={colors.muted} />
        <TextInput testID="welcome-name" accessibilityLabel={t('profile.label.name')} value={name} onChangeText={setName} placeholder={t('profile.placeholder.name')} placeholderTextColor={colors.muted} autoComplete="name" textContentType="name" autoCapitalize="words" returnKeyType="next" style={s.input} />
      </View>

      {!!profile.phone && <>
        <Text style={s.label}>{t('welcome.mobileLabel')}</Text>
        <View style={[s.field, s.readOnly]}><Icon name="call-outline" size={19} color={colors.muted} /><Text testID="welcome-mobile" style={s.fixed}>+91 {profile.phone}</Text><Icon name="checkmark-circle" size={19} color={colors.onSuccess} /></View>
      </>}

      <Text style={s.label}>{t('profile.label.email')}</Text>
      <View style={s.field}><Icon name="mail-outline" size={19} color={colors.muted} />
        <TextInput testID="welcome-email" accessibilityLabel={t('profile.label.email')} value={email} onChangeText={setEmail} placeholder="you@example.com" /* i18n-ignore: example address */ placeholderTextColor={colors.muted} autoComplete="email" textContentType="emailAddress" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={s.input} />
      </View>

      <Text style={s.label}>{t('welcome.locationLabel')}</Text>
      <Pressable testID="welcome-location" accessibilityRole="button" accessibilityLabel={t('shell.changeLocation')} onPress={() => router.push('/location?back=1' as never)} style={({ pressed }) => [s.field, s.place, pressed && s.dim]}>
        <Icon name="location-outline" size={19} color={placeChosen ? colors.forest : colors.muted} />
        <Text numberOfLines={2} style={[s.fixed, !placeChosen && { color: colors.muted }]}>{placeChosen ? location : t('welcome.chooseLocation')}</Text>
        <Icon name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>

      {!!error && <Text testID="welcome-error" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
      <Pressable testID="welcome-continue" accessibilityRole="button" disabled={busy || !ready} onPress={finish} style={({ pressed }) => [s.button, (pressed || busy || !ready) && s.dim]}>
        {busy ? <ActivityIndicator color="#050605" /> : <Text style={s.buttonText}>{t('welcome.finish')}</Text>}
      </Pressable>
      <Pressable testID="welcome-sign-out" accessibilityRole="button" onPress={() => { void signOut().catch(() => {}); router.replace('/(tabs)'); }} hitSlop={8} style={s.link}><Text style={s.linkText}>{t('welcome.differentNumber')}</Text></Pressable>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 22, gap: 6, maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { marginTop: 26, fontSize: 30, lineHeight: 42, fontWeight: '800', letterSpacing: -0.8, color: '#050605' },
  subtitle: { fontSize: 15, lineHeight: 22, color: colors.muted, marginBottom: 14 },
  label: { marginTop: 12, marginBottom: 6, fontSize: 13, fontWeight: '700', color: colors.onSurface },
  field: { minHeight: 54, borderRadius: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, minHeight: 52, fontSize: 16, color: colors.onSurface },
  readOnly: { backgroundColor: colors.surfaceTertiary },
  fixed: { flex: 1, fontSize: 16, lineHeight: 22, paddingVertical: 12, color: colors.onSurface },
  place: { borderColor: colors.borderStrong },
  error: { marginTop: 14, fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.onError },
  button: { marginTop: 22, minHeight: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.electricLime },
  buttonText: { fontSize: 17, fontWeight: '800', color: '#050605' },
  dim: { opacity: 0.6 },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  linkText: { fontSize: 14, fontWeight: '700', color: colors.forest },
});
