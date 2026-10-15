// Customer sign-in through Supabase Auth: email + password; a one-time code by SMS to an Indian
// mobile number once Supabase's Phone provider is on; Google and Apple once their keys exist. Browsing and
// filling the cart never need an account; placing an order does (the cart opens sign-in at Pay).
import { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';
import { supabase, SUPABASE_KEY, SUPABASE_URL } from './lib/supabase';
import { useCustomer } from './customer';
import { afterSignIn } from './privacy';
import { unregisterPush } from './push';
import { t } from '@/src/i18n';

type AuthState = {
  ready: boolean; session: Session | null; googleAvailable: boolean; appleAvailable: boolean; phoneAvailable: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (name: string, email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  verifyEmailCode: (email: string, code: string) => Promise<void>;
  resendEmailCode: (email: string) => Promise<void>;
  sendPhoneCode: (mobile: string) => Promise<void>;
  verifyPhoneCode: (mobile: string, code: string) => Promise<void>;
  signOut: (everywhere?: boolean) => Promise<void>;
};

// Supabase's own messages, in words a customer can act on. The regexes match Supabase's English text;
// what comes back is in the app language at the moment the error happens (t is read at call time).
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return t('auth.error.invalidCredentials');
  if (/already registered|already exists/i.test(message)) return t('auth.error.alreadyRegistered');
  if (/password should be at least/i.test(message)) return t('auth.error.passwordWeak');
  if (/email not confirmed/i.test(message)) return t('auth.error.emailNotConfirmed');
  if (/token has expired or is invalid|otp.*(expired|invalid)|invalid.*otp/i.test(message)) return t('auth.error.codeWrong');
  const wait = message.match(/after (\d+) seconds/i);
  if (wait) return t('auth.error.waitSeconds', { seconds: wait[1] });
  if (/phone.*(disabled|not enabled)|unsupported phone provider|signups not allowed for otp/i.test(message)) return t('auth.error.phoneOff');
  if (/sending.*(sms|otp)|sms.*(send|fail)/i.test(message)) return t('auth.error.smsFailed');
  if (/invalid phone|phone number/i.test(message)) return t('auth.error.mobileInvalid');
  if (/rate limit|too many/i.test(message)) return t('errors.code.rate_limited');
  return message;
}
const AuthContext = createContext<AuthState | null>(null);

// Ask Supabase (public settings) which sign-in methods are switched on, so a customer is never
// offered one that ends on a raw error page.
async function providers(): Promise<{ google: boolean; apple: boolean; phone: boolean }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY ?? '' } });
    const external = (await r.json())?.external ?? {};
    return { google: !!external.google, apple: !!external.apple, phone: !!external.phone };
  } catch {
    return { google: false, apple: false, phone: false };
  }
}

type OAuth = 'google' | 'apple';
// The words for each provider's failures (same flow, different name on screen).
const OAUTH_ERRORS = {
  google: { off: 'auth.error.googleOff', start: 'auth.error.googleStart', retry: 'auth.error.googleUnfinishedRetry' },
  apple: { off: 'auth.error.appleOff', start: 'auth.error.appleStart', retry: 'auth.error.appleUnfinishedRetry' },
} as const;

// Indian mobile numbers only for now: 10 digits starting 6–9, sent as +91…
export const mobileDigits = (value: string) => value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
function e164(mobile: string) {
  const digits = mobileDigits(mobile);
  if (!/^[6-9]\d{9}$/.test(digits)) throw new Error(t('auth.error.mobileInvalid'));
  return `+91${digits}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null); const [ready, setReady] = useState(!supabase);
  const [googleAvailable, setGoogleAvailable] = useState(false); const [appleAvailable, setAppleAvailable] = useState(false);
  const [phoneAvailable, setPhoneAvailable] = useState(false);
  const { profile, update, ready: customerReady } = useCustomer();

  useEffect(() => { void providers().then(p => { setGoogleAvailable(p.google); setAppleAvailable(p.apple); setPhoneAvailable(p.phone); }); }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  // First sign-in: fill an empty profile from the account — name and email from Google or email
  // sign-up, the mobile number from a phone sign-in (never overwrites).
  useEffect(() => {
    const user = session?.user;
    if (!user || !customerReady) return;
    const meta = user.user_metadata ?? {};
    const phone = mobileDigits(user.phone ?? '');
    const next = {
      name: profile.name || meta.full_name || meta.name || '', email: profile.email || user.email || '',
      phone: profile.phone || (/^[6-9]\d{9}$/.test(phone) ? phone : ''),
    };
    if (next.name === profile.name && next.email === profile.email && next.phone === profile.phone) return;
    update({ profile: { ...profile, ...next } }).catch(() => {});
  }, [session?.user?.id, customerReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Privacy choices made on this phone (including at sign-in) go to the account; choices made on
  // another phone come back (src/privacy.ts).
  useEffect(() => { if (session?.user?.id) void afterSignIn(); }, [session?.user?.id]);

  // Google and Apple both run as Supabase OAuth in the browser (PKCE): the web page leaves and comes
  // back to /account; on a phone a secure in-app browser opens and hands back a one-time code.
  const signInWithOAuth = async (provider: OAuth) => {
    const words = OAUTH_ERRORS[provider];
    if (!supabase) throw new Error(t('auth.error.notConfigured'));
    if (!(await providers())[provider]) throw new Error(t(words.off));
    if (Platform.OS === 'web') {
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/account` } });
      if (error) throw error;
      return; // the browser now goes to the provider and comes back to /account
    }
    const redirectTo = Linking.createURL('account');
    const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
    if (error || !data?.url) throw error ?? new Error(t(words.start));
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return; // cancelled
    const code = new URL(result.url).searchParams.get('code');
    if (!code) throw new Error(t(words.retry));
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
  };
  const signInWithGoogle = () => signInWithOAuth('google');
  const signInWithApple = () => signInWithOAuth('apple');

  const signInWithEmail = async (email: string, password: string) => {
    if (!supabase) throw new Error(t('auth.error.notConfigured'));
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(friendly(error.message));
  };

  // A new account signs straight in when the project auto-confirms emails; otherwise the customer
  // is told to confirm from their inbox first.
  const signUpWithEmail = async (name: string, email: string, password: string) => {
    if (!supabase) throw new Error(t('auth.error.notConfigured'));
    const { data, error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { full_name: name.trim() } } });
    if (error) throw new Error(friendly(error.message));
    if (name.trim() && customerReady) await update({ profile: { ...profile, name: profile.name || name.trim(), email: profile.email || email.trim().toLowerCase() } }).catch(() => {});
    return { needsConfirmation: !data.session };
  };

  // A new email account is confirmed inside the app: the OneLocal email carries a 6-digit code ({{ .Token }} in the Supabase
  // "Confirm signup" template) that the customer types here, which also signs them in.
  const verifyEmailCode = async (email: string, code: string) => {
    if (!supabase) throw new Error(t('auth.error.notConfigured'));
    const token = code.replace(/\D/g, '');
    if (token.length < 6) throw new Error(t('auth.error.codeShort'));
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'signup' });
    if (error) throw new Error(friendly(error.message));
  };
  const resendEmailCode = async (email: string) => {
    if (!supabase) throw new Error(t('auth.error.notConfigured'));
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
    if (error) throw new Error(friendly(error.message));
  };

  // Mobile number sign-in: Supabase texts a one-time code (creating the account the first time),
  // then the code signs the customer in. Needs Supabase's Phone provider and an SMS provider.
  const sendPhoneCode = async (mobile: string) => {
    if (!supabase) throw new Error(t('auth.error.notConfigured'));
    const { error } = await supabase.auth.signInWithOtp({ phone: e164(mobile) });
    if (error) throw new Error(friendly(error.message));
  };
  const verifyPhoneCode = async (mobile: string, code: string) => {
    if (!supabase) throw new Error(t('auth.error.notConfigured'));
    const token = code.replace(/\D/g, '');
    if (token.length < 4) throw new Error(t('auth.error.codeMissing'));
    const { error } = await supabase.auth.verifyOtp({ phone: e164(mobile), token, type: 'sms' });
    if (error) throw new Error(friendly(error.message));
  };

  // This phone only by default (Supabase's own default signs out every device); "everywhere"
  // ends every session of the account, e.g. after losing a phone.
  const signOut = async (everywhere = false) => {
    await unregisterPush(); // while the session still exists, so the server knows whose phone it is
    const { error } = (await supabase?.auth.signOut({ scope: everywhere ? 'global' : 'local' })) ?? { error: null };
    if (error) throw new Error(t('auth.error.signOut'));
  };

  return <AuthContext.Provider value={{ ready, session, googleAvailable, appleAvailable, phoneAvailable, signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail, verifyEmailCode, resendEmailCode, sendPhoneCode, verifyPhoneCode, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider missing'); // i18n-ignore: developer error
  return value;
}
