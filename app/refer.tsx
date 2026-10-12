import { useState } from 'react';
import { View, Text, Share, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Icon from '@react-native-vector-icons/ionicons';
import { useCustomer } from '@/src/customer';
import { AccountLayout, ActionButton, Message, accountStyles as s } from '@/src/components/account-layout';
import { colors } from '@/src/theme';
import { safeLineHeight, useTranslation } from '@/src/i18n';
export default function Refer() {
  const { t } = useTranslation(); const { referral, ready } = useCustomer(); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const copy = async () => { try { await Clipboard.setStringAsync(referral); setMessage(t('refer.copied')); setError(''); } catch { setError(t('refer.copyFailed')); } };
  const share = async () => { try { const result = await Share.share({ message: t('refer.shareMessage', { code: referral }) }); if (result.action === Share.sharedAction) setMessage(t('refer.shareReady')); setError(''); } catch { setError(t('refer.shareFailed')); } };
  return <AccountLayout id="refer" title={t('refer.title')} subtitle={t('refer.subtitle')}>
    <View style={st.hero}><View style={st.gift}><Icon name="gift-outline" size={62} color={colors.shops} /></View><Text testID="referral-hero-title" style={st.title}>{t('refer.heroTitle')}</Text><Text style={s.hint}>{t('refer.codeLabel')}</Text><Text testID="referral-code" selectable style={st.code}>{referral || t('common.loading')}</Text></View>
    <ActionButton id="referral-share" title={t('refer.share')} onPress={share} disabled={!ready || !referral} /><ActionButton id="referral-copy" title={t('refer.copy')} onPress={copy} disabled={!ready || !referral} />
    <Message id="referral-success" text={message} /><Message id="referral-error" text={error} error />
    <View style={s.card}><Text testID="referral-status" style={s.title}>{t('refer.statusTitle')}</Text><Text testID="referral-terms" style={s.hint}>{t('refer.terms')}</Text></View>
  </AccountLayout>;
}
const st = StyleSheet.create({ hero: { alignItems: 'center', paddingVertical: 20, gap: 15 }, gift: { height: 120, width: 120, borderRadius: 45, backgroundColor: colors.shopsTop, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-7deg' }] }, title: { color: colors.shops, fontSize: 27, fontWeight: '700', textAlign: 'center', lineHeight: safeLineHeight(27, 35), marginVertical: 10 }, code: { fontSize: 26, letterSpacing: 3, color: colors.onSurface, fontWeight: '800', padding: 18, backgroundColor: colors.surface, borderRadius: 20 } });