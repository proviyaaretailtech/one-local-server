// Keeps profile.language (src/customer.tsx, the field the Profile screen has always had) in step with the
// language the app is actually in. One-way: the Language screen is the only place that changes it.
import { useEffect } from 'react';
import { useCustomer } from '../customer';
import { useLanguage } from './provider';

export function ProfileLanguageSync() {
  const { state } = useLanguage();
  const { profile, update, ready } = useCustomer();
  useEffect(() => {
    if (!ready || (state.active !== 'en' && state.active !== 'hi')) return;
    if (profile.language !== state.active) void update({ profile: { ...profile, language: state.active } }).catch(() => {});
  }, [ready, state.active, profile, update]);
  return null;
}
