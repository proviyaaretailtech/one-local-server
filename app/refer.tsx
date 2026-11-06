import { useState } from 'react';
import { View, Share, StyleSheet } from 'react-native';
import { Text } from '@/src/ui/text';
import * as Clipboard from 'expo-clipboard';
import Icon from '@react-native-vector-icons/ionicons';
import { useCustomer } from '@/src/customer';
import { AccountLayout, Message, accountStyles as s } from '@/src/components/account-layout';
import { Button } from '@/src/ui/button';
import { colors, mintCard, neuWell, radius } from '@/src/theme';
import { safeLineHeight, useTranslation } from '@/src/i18n';
export default function Refer() {
  const { t } = useTranslation(); const { referral, ready } = useCustomer(); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const copy = async () => { try { await Clipboard.setStringAsync(referral); setMessage(t('refer.copied')); setError(''); } catch { setError(t('refer.copyFailed')); } };
  const share = async () => { try { const result = await Share.share({ message: t('refer.shareMessage', { code: referral }) }); if (result.action === Share.sharedAction) setMessage(t('refer.shareReady')); setError(''); } catch { setError(t('refer.shareFailed')); } };
  return <AccountLayout id="refer" title={t('refer.title')} subtitle={t('refer.subtitle')}>
    <View style={[s.card, st.hero]}>
      <View style={st.gift}><Icon name="gift-outline" size={44} color={colors.forest} /></View>
      <Text testID="referral-hero-title" style={st.title}>{t('refer.heroTitle')}</Text>
      <Text style={s.hint}>{t('refer.codeLabel')}</Text>
      <View style={st.well}><Text testID="referral-code" selectable style={st.code}>{referral || t('common.loading')}</Text></View>
      <View style={st.actions}>
        <Button testID="referral-share" icon="share-social-outline" title={t('refer.share')} onPress={share} disabled={!ready || !referral} />
        <Button testID="referral-copy" variant="quiet" icon="copy-outline" title={t('refer.copy')} onPress={copy} disabled={!ready || !referral} />
      </View>
    </View>
    <Message id="referral-success" text={message} /><Message id="referral-error" text={error} error />
    <View style={s.card}><Text testID="referral-status" style={s.title}>{t('refer.statusTitle')}</Text><Text testID="referral-terms" style={s.hint}>{t('refer.terms')}</Text></View>
  </AccountLayout>;
}
const st = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: 26, gap: 10 },
  gift: { width: 92, height: 92, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: 6, backgroundColor: colors.mintTile, boxShadow: mintCard.glow },
  title: { color: colors.forest, fontSize: 24, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center', lineHeight: safeLineHeight(24, 31) },
  // The code sits pressed into the card, spaced out so it is easy to read aloud.
  well: { alignSelf: 'stretch', paddingVertical: 16, borderRadius: 18, backgroundColor: colors.surfaceSecondary, boxShadow: neuWell },
  code: { textAlign: 'center', fontSize: 24, letterSpacing: 4, fontWeight: '800', color: colors.onSurface },
  actions: { alignSelf: 'stretch', gap: 12, marginTop: 8 },
});
