import { Fragment, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import Icon from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams } from 'expo-router';
import { AccountLayout, Group, Message, accountStyles as s } from '@/src/components/account-layout';
import { ChipRow } from '@/src/components/chip-row';
import { Button } from '@/src/ui/button';
import { apiPost, isComingSoon } from '@/src/api';
import { colors } from '@/src/theme';
import { useTranslation } from '@/src/i18n';
const FAQ = [1, 2, 3, 4] as const; // help.faq.q1..q4 / a1..a4 in the catalogue
const TOPICS = ['order', 'payment', 'profile', 'other'] as const; // codes sent to the API as they are; the label is help.topic.<code>
export default function Help() {
  // /help?order=<id> (from an order's "Get help with this order"): the order id goes in the reference the request already carries.
  const { order } = useLocalSearchParams<{ order?: string }>(); const orderRef = typeof order === 'string' ? order.slice(0, 100) : '';
  const { t } = useTranslation(); const [open, setOpen] = useState(-1); const [topic, setTopic] = useState('order'); const [message, setMessage] = useState(''); const [reference, setReference] = useState(orderRef); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [receipt, setReceipt] = useState<string | null>(null);
  const send = async () => { setError(''); if (message.trim().length < 10) return setError(t('help.error.short')); setBusy(true); try { const result = await apiPost<{ id: string }>('/support-requests', { topic, message: message.trim(), reference: reference.trim() }); setReceipt(result.id); setMessage(''); } catch (e) { if (!isComingSoon(e)) setError(t('help.error.save')); } finally { setBusy(false); } };
  return <AccountLayout id="help" title={t('help.title')} subtitle={t('help.subtitle')}>
    <View style={[s.card, st.faqs]}>{FAQ.map((n, i) => <Fragment key={n}>
      {i > 0 && <View style={st.line} />}
      <Pressable testID={`help-faq-${i}`} accessibilityState={{ expanded: open === i }} style={st.faq} onPress={() => setOpen(open === i ? -1 : i)}>
        <Text style={[st.question, s.flex]}>{t(`help.faq.q${n}`)}</Text>
        <View style={[st.sign, open === i && st.signOpen]}><Icon name={open === i ? 'remove' : 'add'} size={18} color={open === i ? colors.surface : colors.forest} /></View>
      </Pressable>
      {open === i && <Text testID={`help-answer-${i}`} style={[s.hint, st.answer]}>{t(`help.faq.a${n}`)}</Text>}
    </Fragment>)}</View>
    <Group>{t('help.requestTitle')}</Group>
    <View style={s.card}>
      <Text testID="help-service-notice" style={s.hint}>{t('help.serviceNotice')}</Text>
      <ChipRow style={s.chips} contentContainerStyle={s.chipContent} selected={topic} onSelect={setTopic} chips={TOPICS.map(code => ({ id: code, testID: `help-topic-${code}`, label: t(`help.topic.${code}`) }))} />
      <TextInput testID="help-reference" accessibilityLabel={t('help.referenceLabel')} placeholder={t('help.referencePlaceholder')} value={reference} onChangeText={setReference} maxLength={100} style={s.input} placeholderTextColor={colors.muted} />
      <TextInput testID="help-message" accessibilityLabel={t('help.messageLabel')} placeholder={t('help.messagePlaceholder')} value={message} onChangeText={setMessage} maxLength={2000} multiline textAlignVertical="top" style={[s.input, st.message]} placeholderTextColor={colors.muted} />
      <Message id="help-error" text={error} error />
      <Button testID="help-submit" icon="send" title={t('help.submit')} onPress={send} busy={busy} />
      {receipt && <View testID="help-receipt" style={st.receipt}><Icon name="checkmark-circle" size={24} color={colors.forest} /><Text selectable testID="help-reference-number" style={[s.hint, s.flex]}>{t('help.receipt', { reference: receipt })}</Text></View>}
    </View>
  </AccountLayout>;
}
const st = StyleSheet.create({
  faqs: { gap: 0, paddingVertical: 6 },
  faq: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 },
  question: { color: colors.onSurface, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  sign: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintTile },
  signOpen: { backgroundColor: colors.forest },
  answer: { paddingBottom: 12 },
  line: { height: 1, backgroundColor: colors.border },
  message: { minHeight: 120 },
  receipt: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.limeSoft },
});
