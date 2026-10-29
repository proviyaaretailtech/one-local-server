import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/src/ui/text';
import Icon from '@react-native-vector-icons/ionicons';
import { useCustomer } from '@/src/customer';
import { colors } from '@/src/theme';
import { PaymentOptions } from '@/src/components/payment-options';
import { AccountLayout, ActionButton, Message, accountStyles as s } from '@/src/components/account-layout';
import { useTranslation } from '@/src/i18n';
export default function Payments() {
  const { t } = useTranslation(); const { payment, update, ready } = useCustomer(); const [selected, setSelected] = useState(payment); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => { setSelected(payment); }, [payment]);
  const save = async () => { setBusy(true); setMessage(''); setError(''); try { await update({ payment: selected }); setMessage(t('payments.saved')); } catch { setError(t('payments.saveFailed')); } finally { setBusy(false); } };
  return <AccountLayout id="payments" title={t('payments.title')} subtitle={t('payments.subtitle')}><PaymentOptions scope="preferences" value={selected} onChange={setSelected} disabled={!ready || busy} /><ActionButton id="payment-save" title={t('payments.save')} onPress={save} busy={busy} disabled={!ready} /><Message id="payment-success" text={message} /><Message id="payment-error" text={error} error /><View style={s.card}><Icon name="shield-checkmark-outline" size={26} color={colors.shops} /><Text testID="payment-sample-notice" style={s.hint}>{t('payments.sampleNotice')}</Text></View></AccountLayout>;
}