// Sign in / create account (Supabase Auth). Email + password works now; a one-time code to an Indian
// mobile number, and Google, each switch themselves on as soon as Supabase has them enabled
// (auth.tsx asks Supabase's public settings). Browsing never needs an account — "Skip for now" is
// always there. Placing an order does: the cart's Pay button opens this screen with next=checkout,
// and signing in returns to the cart, which carries on paying.
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { mobileDigits, useAuth } from '@/src/auth';
import { BrandLogo } from '@/src/components/brand-logo';
import { colors } from '@/src/theme';
import { recordChoices, usePrivacyChoices } from '@/src/privacy';
import { PRIVACY } from '@/constants/privacy';
import { safeLineHeight, useFormat, useLanguage, useTranslation } from '@/src/i18n';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useMotionAllowed } from '@/src/motion';

// Light and quiet (after Glovo's sign-in): white page, soft filled fields with no borders, one bright
// action, everything else small. The page should feel like a step, not a form.
const INK = '#0D120E';
const FILL = '#F3F5F1';
const LINE = '#E7EBE4';
const SOFT = '#6B746D';

export default function SignIn() {
  const { signInWithEmail, signUpWithEmail, verifyEmailCode, resendEmailCode, signInWithGoogle, signInWithApple, googleAvailable, appleAvailable, phoneAvailable, sendPhoneCode, verifyPhoneCode } = useAuth();
  const router = useRouter(); const insets = useSafeAreaInsets(); const motion = useMotionAllowed();
  // Sections rise in one after another on arrival; nothing moves under Reduce Motion.
  const rise = (i: number) => motion ? FadeInDown.delay(60 + i * 55).duration(420).springify().damping(20) : undefined;
  const { t } = useTranslation(); const fmt = useFormat(); const deva = useLanguage().active.script === 'devanagari';
  const { welcome, next } = useLocalSearchParams<{ welcome?: string; next?: string }>();
  const checkout = next === 'checkout';
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false); const [busy, setBusy] = useState<'' | 'email' | 'google' | 'apple' | 'phone'>('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  // Mobile number + one-time code: offered first whenever Supabase has phone sign-in switched on.
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const byPhone = phoneAvailable && method === 'phone';
  const [mobile, setMobile] = useState(''); const [sentTo, setSentTo] = useState(''); const [code, setCode] = useState('');
  // The email a new account's 6-digit confirmation code went to (empty until sign-up asks for it).
  const [emailCodeFor, setEmailCodeFor] = useState('');
  const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return; const timer = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(timer); }, [wait]);

  // DPDP Act: a short notice with a link to the full one; accounts are for adults (s.9: a child's
  // data needs a parent's verifiable consent, so a parent uses their own account); marketing is an
  // optional, unticked extra. Only what an order needs is required. Choices are recorded on the
  // phone with the notice version and reach the account once signed in (src/privacy.ts).
  const privacy = usePrivacyChoices();
  // Never pre-ticked, even for someone who confirmed on this phone before (a phone can be shared).
  const [adult, setAdult] = useState(false); const [marketing, setMarketing] = useState(false); const [minor, setMinor] = useState(false);
  const confirmedAdult = () => {
    if (adult) return true;
    setError(t('auth.error.confirmAdult', { age: PRIVACY.minimumAge }));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    return false;
  };
  const recordConsent = () => recordChoices([
    { purpose: 'notice_acknowledged', granted: true }, { purpose: 'age_18_plus', granted: true },
    ...(marketing ? [{ purpose: 'marketing' as const, granted: true }] : []),
  ], 'sign_in').catch(() => {});

  const leave = () => {
    // From the cart's Pay button: back to the cart, which carries on paying once signed in.
    if (checkout) { if (router.canGoBack()) router.back(); else router.replace('/cart' as never); }
    else if (typeof next === 'string' && next.startsWith('/')) router.replace(next as never);
    else if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };
  const signedIn = () => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); leave(); };
  const failed = (e: unknown) => {
    setError(e instanceof Error ? e.message : t('common.somethingWrong'));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  };

  const sendCode = async () => {
    setError(''); setNotice('');
    const digits = mobileDigits(mobile);
    if (!/^[6-9]\d{9}$/.test(digits)) return setError(t('auth.error.mobileInvalid'));
    if (!confirmedAdult()) return;
    setBusy('phone');
    try {
      await sendPhoneCode(digits);
      setSentTo(digits); setCode(''); setWait(30);
      setNotice(t('auth.notice.codeSent', { number: `${digits.slice(0, 5)} ${digits.slice(5)}` }));
    } catch (e) { failed(e); } finally { setBusy(''); }
  };
  const verifyCode = async () => {
    setError('');
    if (code.length < 6) return setError(t('auth.error.codeShort'));
    if (!confirmedAdult()) return;
    setBusy('phone');
    try { await recordConsent(); await verifyPhoneCode(sentTo, code); signedIn(); } catch (e) { failed(e); } finally { setBusy(''); }
  };

  const submit = async () => {
    setError(''); setNotice('');
    if (mode === 'signup' && name.trim().length < 2) return setError(t('auth.error.nameShort'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t('auth.error.emailInvalid'));
    if (password.length < 6) return setError(t('auth.error.passwordShort'));
    if (!confirmedAdult()) return;
    setBusy('email');
    try {
      await recordConsent();
      if (mode === 'signin') await signInWithEmail(email, password);
      else {
        const { needsConfirmation } = await signUpWithEmail(name, email, password);
        if (needsConfirmation) { const to = email.trim().toLowerCase(); setEmailCodeFor(to); setCode(''); setWait(30); setNotice(t('auth.notice.emailCodeSent', { email: to })); return; }
      }
      signedIn();
    } catch (e) {
      // An account that was never confirmed gets a fresh code and the code box, instead of a dead end.
      if (mode === 'signin' && e instanceof Error && e.message === t('auth.error.emailNotConfirmed')) {
        const to = email.trim().toLowerCase();
        try { await resendEmailCode(to); setEmailCodeFor(to); setCode(''); setWait(30); setNotice(t('auth.notice.emailCodeSent', { email: to })); return; } catch { /* fall through to the plain error */ }
      }
      failed(e);
    } finally { setBusy(''); }
  };

  const verifyEmail = async () => {
    setError('');
    if (code.length < 6) return setError(t('auth.error.codeShort'));
    setBusy('email');
    try { await verifyEmailCode(emailCodeFor, code); signedIn(); } catch (e) { failed(e); } finally { setBusy(''); }
  };
  const resendEmail = async () => {
    setError(''); setBusy('email');
    try { await resendEmailCode(emailCodeFor); setWait(30); setNotice(t('auth.notice.emailCodeSent', { email: emailCodeFor })); } catch (e) { failed(e); } finally { setBusy(''); }
  };

  const google = async () => {
    setError('');
    if (!confirmedAdult()) return;
    setBusy('google');
    // On the web Google leaves this page; the choices are already saved and go once signed in.
    try { await recordConsent(); await signInWithGoogle(); } catch (e) { setError(e instanceof Error ? e.message : t('auth.error.googleUnfinished')); } finally { setBusy(''); }
  };

  const apple = async () => {
    setError('');
    if (!confirmedAdult()) return;
    setBusy('apple');
    try { await recordConsent(); await signInWithApple(); } catch (e) { setError(e instanceof Error ? e.message : t('auth.error.appleUnfinished')); } finally { setBusy(''); }
  };

  const switchMode = (m: 'signin' | 'signup') => { setMode(m); setError(''); setNotice(''); };
  const status = <>
    {!!error && <Text testID="sign-in-error" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
    {!!notice && <Text testID="sign-in-notice" accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text>}
  </>;

  return <KeyboardAvoidingView testID="sign-in-screen" behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.screen}>
    <StatusBar style="dark" />
    <View pointerEvents="none" style={s.blob} />
    <ScrollView keyboardShouldPersistTaps="handled" horizontal={false} showsHorizontalScrollIndicator={false} contentContainerStyle={[s.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <View style={s.top}>
        <BrandLogo tone="light" height={26} />
        <Pressable testID="sign-in-skip" accessibilityRole="button" onPress={leave} hitSlop={8} style={s.skip}><Text style={s.skipText}>{welcome ? t('auth.skipForNow') : t('common.close')}</Text></Pressable>
      </View>

      <Animated.View entering={rise(0)} style={s.hero}>
        {checkout
          ? <><Text testID="sign-in-checkout-title" style={[s.title, deva && s.noTrack]}>{t('auth.heroTitle.checkout')}</Text><Text style={s.sub}>{t('auth.heroSub.checkout')}</Text></>
          : <><Text style={[s.title, deva && s.noTrack]}>{mode === 'signin' ? t('auth.heroTitle.signin') : t('auth.heroTitle.signup')}</Text><Text style={s.sub}>{t('auth.heroSub.default')}</Text></>}
      </Animated.View>

      {phoneAvailable && <Animated.View entering={rise(1)} testID="sign-in-method" accessibilityRole="tablist" style={s.segment}>
        {(['phone', 'email'] as const).map(m => <Pressable key={m} testID={`sign-in-method-${m}`} accessibilityRole="tab" accessibilityState={{ selected: method === m }} onPress={() => { setMethod(m); setError(''); setNotice(''); }} style={[s.segmentItem, method === m && s.segmentOn]}>
          <Text style={[s.segmentText, method === m && s.segmentTextOn]}>{m === 'phone' ? t('auth.method.phone') : t('auth.method.email')}</Text>
        </Pressable>)}
      </Animated.View>}

      <Animated.View entering={rise(2)} style={s.card}>
        {byPhone ? <View testID="sign-in-phone" style={s.stack}>
          {!sentTo
            ? <Field icon="call-outline" prefix="+91" testID="sign-in-mobile" placeholder={t('auth.placeholder.mobile')} value={mobile} onChangeText={v => setMobile(v.replace(/[^\d ]/g, ''))}
                keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" maxLength={14} onSubmitEditing={sendCode} returnKeyType="go" />
            : <Field icon="keypad-outline" testID="sign-in-code" placeholder={t('auth.placeholder.code')} value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} onSubmitEditing={verifyCode} returnKeyType="go" />}
        </View> : emailCodeFor ? <View testID="sign-in-email-confirm" style={s.stack}>
          <Field icon="keypad-outline" testID="sign-in-email-code" placeholder={t('auth.placeholder.code')} value={code} onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} onSubmitEditing={verifyEmail} returnKeyType="go" />
        </View> : <View testID="sign-in-mode" style={s.stack}>
          {mode === 'signup' && <Field icon="person-outline" testID="sign-in-name" placeholder={t('auth.placeholder.name')} value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" />}
          <Field icon="mail-outline" testID="sign-in-email" placeholder={t('auth.placeholder.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" autoComplete="email" />
          <Field icon="lock-closed-outline" testID="sign-in-password" placeholder={mode === 'signup' ? t('auth.placeholder.createPassword') : t('auth.placeholder.password')} value={password} onChangeText={setPassword}
            secureTextEntry={!reveal} autoCapitalize="none" textContentType={mode === 'signup' ? 'newPassword' : 'password'} onSubmitEditing={submit} returnKeyType="go"
            trailing={<Pressable testID="sign-in-reveal" accessibilityLabel={reveal ? t('auth.hidePassword') : t('auth.showPassword')} onPress={() => setReveal(r => !r)} style={s.eye}><Icon name={reveal ? 'eye-off-outline' : 'eye-outline'} size={18} color={SOFT} /></Pressable>} />
        </View>}

        {/* DPDP: the short notice sits right where consent is given; 18+ is required, offers are optional and never pre-ticked. */}
        <View testID="sign-in-consent" style={s.consent}>
          <Check id="sign-in-age" checked={adult} onPress={() => { setAdult(a => !a); setError(''); }} label={t('auth.consent.adult', { age: PRIVACY.minimumAge })} />
          {privacy.current.marketing
            ? <Text testID="sign-in-marketing-on" style={s.consentNote}>{t('auth.consent.marketingOn')}</Text>
            : <Check id="sign-in-marketing" checked={marketing} onPress={() => setMarketing(m => !m)} label={t('auth.consent.marketing')} />}
          <Text testID="sign-in-notice-line" style={s.noticeLine}>{t('auth.consent.notice')}{' '}
            <Text testID="sign-in-privacy-link" accessibilityRole="link" onPress={() => router.push('/privacy-notice' as never)} style={s.inlineLink}>{t('auth.consent.privacyLink')}</Text>
            {'  '}<Text testID="sign-in-under-18" accessibilityRole="button" onPress={() => setMinor(m => !m)} style={s.inlineLink}>{t('auth.consent.under', { age: PRIVACY.minimumAge })}</Text>
          </Text>
          {minor && <View testID="sign-in-minor" style={s.minor}>
            <Text style={s.minorTitle}>{t('auth.minor.title')}</Text>
            <Text style={s.consentNote}>{t('auth.minor.body')}</Text>
            <Pressable testID="sign-in-minor-browse" accessibilityRole="button" onPress={leave} style={s.minorButton}><Text style={s.minorButtonText}>{t('auth.minor.browse')}</Text></Pressable>
          </View>}
        </View>

        {status}
        {byPhone
          ? <Pressable testID="sign-in-submit" accessibilityRole="button" disabled={!!busy} onPress={sentTo ? verifyCode : sendCode} style={[s.primary, busy === 'phone' && s.primaryBusy]}>
              {busy === 'phone' ? <ActivityIndicator color={INK} /> : <Text style={s.primaryText}>{sentTo ? t('auth.verify') : t('auth.sendCode')}</Text>}
            </Pressable>
          : <Pressable testID="sign-in-submit" accessibilityRole="button" disabled={!!busy} onPress={emailCodeFor ? verifyEmail : submit} style={[s.primary, busy === 'email' && s.primaryBusy]}>
              {busy === 'email' ? <ActivityIndicator color={INK} /> : <Text style={s.primaryText}>{emailCodeFor ? t('auth.verify') : mode === 'signin' ? t('auth.signIn') : t('auth.createMyAccount')}</Text>}
            </Pressable>}

        {!byPhone && !!emailCodeFor && <View style={s.codeLinks}>
          <Pressable testID="sign-in-change-email" accessibilityRole="button" onPress={() => { setEmailCodeFor(''); setCode(''); setNotice(''); setError(''); }} style={s.link}><Text style={s.linkText}>{t('auth.changeEmail')}</Text></Pressable>
          <Pressable testID="sign-in-email-resend" accessibilityRole="button" disabled={wait > 0 || !!busy} onPress={resendEmail} style={s.link}><Text style={[s.linkText, wait > 0 && { color: SOFT }]}>{wait > 0 ? t('auth.resendIn', { seconds: fmt.number(wait) }) : t('auth.resend')}</Text></Pressable>
        </View>}

        {byPhone && !!sentTo && <View style={s.codeLinks}>
          <Pressable testID="sign-in-change-number" accessibilityRole="button" onPress={() => { setSentTo(''); setCode(''); setNotice(''); setError(''); }} style={s.link}><Text style={s.linkText}>{t('auth.changeNumber')}</Text></Pressable>
          <Pressable testID="sign-in-resend" accessibilityRole="button" disabled={wait > 0 || !!busy} onPress={sendCode} style={s.link}><Text style={[s.linkText, wait > 0 && { color: SOFT }]}>{wait > 0 ? t('auth.resendIn', { seconds: fmt.number(wait) }) : t('auth.resend')}</Text></Pressable>
        </View>}
        {!byPhone && !emailCodeFor && <Pressable testID={mode === 'signin' ? 'sign-in-mode-signup' : 'sign-in-mode-signin'} accessibilityRole="button" onPress={() => switchMode(mode === 'signin' ? 'signup' : 'signin')} style={s.switch}>
          <Text style={s.switchText}>{mode === 'signin' ? t('auth.switch.toSignup') : t('auth.switch.toSignin')}</Text>
        </Pressable>}
      </Animated.View>

      <Animated.View entering={rise(3)}>
        <View style={s.orRow}><View style={s.orLine} /><Text style={s.or}>{t('common.or')}</Text><View style={s.orLine} /></View>
        {appleAvailable && <Pressable testID="sign-in-apple" accessibilityRole="button" disabled={!!busy} onPress={apple} style={s.apple}>
          {busy === 'apple' ? <ActivityIndicator color="#fff" /> : <><Icon name="logo-apple" size={19} color="#fff" /><Text style={s.appleText}>{t('auth.apple.continue')}</Text></>}
        </Pressable>}
        <Pressable testID="sign-in-google" accessibilityRole="button" accessibilityState={{ disabled: !googleAvailable }} disabled={!googleAvailable || !!busy} onPress={google} style={[s.social, !googleAvailable && s.socialOff]}>
          {busy === 'google' ? <ActivityIndicator color={INK} /> : <><Text style={s.g}>G</Text><Text style={s.socialText}>{t('auth.google.continue')}</Text></>}
          {!googleAvailable && <View testID="sign-in-google-soon" style={s.soon}><Text style={[s.soonText, deva && s.devaSoon]}>{t('common.soon').toUpperCase()}</Text></View>}
        </Pressable>
      </Animated.View>

      <Text style={s.legal}>{t('auth.legal')}{' '}
        <Text accessibilityRole="link" onPress={() => router.push('/privacy-notice' as never)} style={s.legalLink}>{t('auth.privacyNotice')}</Text> · {t('auth.noticeVersion', { version: PRIVACY.noticeVersion })}
      </Text>
    </ScrollView>
  </KeyboardAvoidingView>;
}

// A plain, unticked-by-default checkbox (never pre-ticked for consent).
function Check({ id, checked, onPress, label }: { id: string; checked: boolean; onPress: () => void; label: string }) {
  return <Pressable testID={id} accessibilityRole="checkbox" accessibilityState={{ checked }} aria-checked={checked} accessibilityLabel={label} onPress={onPress} style={s.check}>
    <View style={[s.box, checked && s.boxOn]}>{checked && <Icon name="checkmark" size={14} color="#fff" />}</View>
    <Text style={s.checkLabel}>{label}</Text>
  </Pressable>;
}

function Field({ icon, prefix, trailing, testID, ...input }: React.ComponentProps<typeof TextInput> & { icon: string; prefix?: string; trailing?: React.ReactNode }) {
  const [focused, setFocused] = useState(false);
  return <View style={[s.field, focused && s.fieldOn]}>
    <Icon name={icon as any} size={18} color={focused ? colors.forest : SOFT} />
    {!!prefix && <Text style={s.prefix}>{prefix}</Text>}
    <TextInput testID={testID} accessibilityLabel={input.placeholder} placeholderTextColor="#9AA39C" style={s.input} autoCorrect={false} {...input}
      onFocus={e => { setFocused(true); input.onFocus?.(e); }} onBlur={e => { setFocused(false); input.onBlur?.(e); }} />
    {trailing}
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff', overflow: 'hidden' },
  blob: { position: 'absolute', top: -190, right: -150, width: 320, height: 320, borderRadius: 160, backgroundColor: colors.limeSoft },
  content: { paddingHorizontal: 22, flexGrow: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.8)', justifyContent: 'center', alignItems: 'center' },
  skipText: { color: INK, fontSize: 13, fontWeight: '700' },
  hero: { marginTop: 40, marginBottom: 24 },
  title: { color: INK, fontSize: 30, lineHeight: safeLineHeight(30, 36), fontWeight: '800', letterSpacing: -0.8 },
  noTrack: { letterSpacing: 0 }, // Devanagari: letter-spacing pulls conjuncts and matras apart
  sub: { color: SOFT, fontSize: 14, lineHeight: 21, marginTop: 10, maxWidth: 330 },
  segment: { flexDirection: 'row', backgroundColor: FILL, borderRadius: 14, padding: 4, marginBottom: 14 },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: '#fff', boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: 'rgba(13,18,14,0.08)' }] },
  segmentText: { color: SOFT, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  segmentTextOn: { color: INK },
  card: { gap: 14 },
  stack: { gap: 10 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingHorizontal: 16, borderRadius: 14, backgroundColor: FILL, borderWidth: 1.5, borderColor: FILL },
  fieldOn: { backgroundColor: '#fff', borderColor: colors.forest },
  input: { flex: 1, color: INK, fontSize: 16, paddingVertical: 14 },
  prefix: { color: INK, fontSize: 16, fontWeight: '700' },
  codeLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 16 },
  link: { minHeight: 44, justifyContent: 'center', flexShrink: 1 },
  linkText: { color: colors.forest, fontSize: 13, fontWeight: '700' },
  eye: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -12 },
  error: { color: colors.onError, fontSize: 13, lineHeight: 19 },
  notice: { color: colors.forest, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  primary: { minHeight: 56, borderRadius: 16, backgroundColor: colors.electricLime, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryBusy: { opacity: 0.85 },
  primaryText: { color: INK, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  switch: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  switchText: { color: colors.forest, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, marginBottom: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: LINE },
  or: { color: SOFT, fontSize: 12 },
  social: { minHeight: 54, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1.5, borderColor: LINE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  socialOff: { opacity: 0.6 },
  socialText: { color: INK, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  apple: { marginBottom: 10, minHeight: 54, borderRadius: 16, backgroundColor: '#000', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  appleText: { color: '#fff', fontSize: 15, fontWeight: '700', flexShrink: 1 },
  g: { fontSize: 19, fontWeight: '800', color: '#4285F4' },
  soon: { position: 'absolute', right: 14, backgroundColor: FILL, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  soonText: { color: SOFT, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  devaSoon: { fontSize: 11, letterSpacing: 0 }, // 9 px Devanagari is unreadable; no tracking
  legal: { color: '#9AA39C', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 'auto', paddingTop: 28 },
  legalLink: { color: SOFT, textDecorationLine: 'underline' },
  consent: { gap: 2 },
  noticeLine: { color: SOFT, fontSize: 12, lineHeight: 18, marginTop: 4 },
  inlineLink: { color: colors.forest, fontWeight: '700', textDecorationLine: 'underline' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: '#C3CAC4', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.forest, borderColor: colors.forest },
  checkLabel: { flex: 1, color: INK, fontSize: 14, fontWeight: '500' },
  consentNote: { color: SOFT, fontSize: 12, lineHeight: 17 },
  minor: { gap: 8, padding: 12, marginTop: 6, borderRadius: 14, backgroundColor: FILL },
  minorTitle: { color: INK, fontSize: 14, fontWeight: '800' },
  minorButton: { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, justifyContent: 'center' },
  minorButtonText: { color: INK, fontSize: 13, fontWeight: '700' },
});
