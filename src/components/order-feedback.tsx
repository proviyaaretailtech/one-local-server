// After delivery: rate the order, and report a problem with one item. Both talk to /api/orders/:id/feedback|rating|issues
// (server/order-feedback.ts). A report opens a case that a person reviews; it never refunds by itself. If the server says feedback
// is not available yet (its tables are not installed), this shows nothing at all.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Icon from '@react-native-vector-icons/ionicons';
import { api, apiPost, type Order } from '../api';
import { colors } from '../theme';
import { Text, TextInput } from '../ui/text';
import { useErrorMessage, useTranslation } from '../i18n';

type Kind = 'missing' | 'wrong' | 'damaged' | 'quality';
type Issue = { id: string; order_item_id: string; kind: Kind; qty: number; note: string | null; status: 'open' | 'approved' | 'rejected' | 'refunded' };
type Feedback = { rating: { rating: number; delivery_rating: number | null; comment: string | null } | null; issues: Issue[] };
const KINDS: Kind[] = ['missing', 'wrong', 'damaged', 'quality'];
const KIND_KEY = { missing: 'orderFeedback.kind.missing', wrong: 'orderFeedback.kind.wrong', damaged: 'orderFeedback.kind.damaged', quality: 'orderFeedback.kind.quality' } as const;
const STATUS_KEY = { open: 'orderFeedback.status.open', approved: 'orderFeedback.status.approved', rejected: 'orderFeedback.status.rejected', refunded: 'orderFeedback.status.refunded' } as const;

function Stars({ value, onChange, testID }: { value: number; onChange: (n: number) => void; testID: string }) {
  const { t } = useTranslation();
  return <View style={s.stars}>{[1, 2, 3, 4, 5].map(n => <Pressable key={n} testID={`${testID}-${n}`} accessibilityRole="button" accessibilityLabel={t('orderFeedback.stars', { count: n })} accessibilityState={{ selected: value === n }} onPress={() => onChange(n)} hitSlop={4} style={s.star}>
    <Icon name={n <= value ? 'star' : 'star-outline'} size={30} color={n <= value ? colors.gold : colors.muted} />
  </Pressable>)}</View>;
}

export function OrderFeedback({ order }: { order: Order }) {
  const { t } = useTranslation(); const message = useErrorMessage();
  const [data, setData] = useState<Feedback | 'off' | null>(null);
  const [rating, setRating] = useState(0); const [delivery, setDelivery] = useState(0); const [comment, setComment] = useState('');
  const [reporting, setReporting] = useState(false); const [item, setItem] = useState(''); const [kind, setKind] = useState<Kind | ''>(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [sent, setSent] = useState(false);
  const load = useCallback(() => { api<Feedback>(`/orders/${order.id}/feedback`).then(setData).catch(() => setData('off')); }, [order.id]);
  useEffect(() => { if (order.status === 'delivered') load(); }, [order.status, load]);
  if (order.status !== 'delivered' || !data || data === 'off') return null;

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setError(''); setBusy(true);
    try { await action(); after?.(); load(); } catch (e) { setError(message(e) || t('orderFeedback.saveError')); } finally { setBusy(false); }
  };
  const submitRating = () => run(() => apiPost(`/orders/${order.id}/rating`, { rating, delivery_rating: delivery || undefined, comment: comment.trim() || undefined }));
  const submitReport = () => run(() => apiPost(`/orders/${order.id}/issues`, { order_item_id: item, kind, note: note.trim() || undefined }), () => { setReporting(false); setItem(''); setKind(''); setNote(''); setSent(true); });
  const nameOf = (id: string) => order.items.find(i => i.id === id)?.name ?? '';

  return <View testID="order-feedback" style={s.wrap}>
    {data.rating
      ? <View style={s.card}><Text testID="order-rated" style={s.title}>{t('orderFeedback.thanks')}</Text><View style={s.stars}>{[1, 2, 3, 4, 5].map(n => <Icon key={n} name={n <= data.rating!.rating ? 'star' : 'star-outline'} size={22} color={n <= data.rating!.rating ? colors.gold : colors.muted} />)}</View></View>
      : <View style={s.card}>
        <Text style={s.title}>{t('orderFeedback.rateTitle')}</Text><Stars value={rating} onChange={setRating} testID="rate-order" />
        {rating > 0 && <>
          <Text style={s.label}>{t('orderFeedback.deliveryTitle')}</Text><Stars value={delivery} onChange={setDelivery} testID="rate-delivery" />
          <TextInput testID="rate-comment" value={comment} onChangeText={setComment} maxLength={500} multiline placeholder={t('orderFeedback.commentPlaceholder')} placeholderTextColor={colors.muted} style={s.input} />
          <Pressable testID="rate-submit" accessibilityRole="button" disabled={busy} onPress={() => void submitRating()} style={[s.button, busy && s.dim]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.buttonText}>{t('orderFeedback.submit')}</Text>}</Pressable>
        </>}
      </View>}

    <View style={s.card}>
      <Text style={s.title}>{t('orderFeedback.reportTitle')}</Text>
      {!reporting && <Text style={s.hint}>{t('orderFeedback.reportHint')}</Text>}
      {sent && !reporting && <Text testID="issue-sent" style={s.ok}>{t('orderFeedback.sent')}</Text>}
      {!reporting
        ? <Pressable testID="issue-open" accessibilityRole="button" onPress={() => { setReporting(true); setSent(false); }} style={s.outline}><Icon name="alert-circle-outline" size={18} color={colors.forest} /><Text style={s.outlineText}>{t('orderFeedback.open')}</Text></Pressable>
        : <>
          <Text style={s.label}>{t('orderFeedback.choose')}</Text>
          <View style={s.chips}>{order.items.map(i => <Pressable key={i.id} testID={`issue-item-${i.id}`} accessibilityRole="button" accessibilityState={{ selected: item === i.id }} onPress={() => setItem(i.id)} style={[s.chip, item === i.id && s.chipOn]}><Text style={[s.chipText, item === i.id && s.chipTextOn]} numberOfLines={1}>{i.name}</Text></Pressable>)}</View>
          <Text style={s.label}>{t('orderFeedback.whatHappened')}</Text>
          <View style={s.chips}>{KINDS.map(k => <Pressable key={k} testID={`issue-kind-${k}`} accessibilityRole="button" accessibilityState={{ selected: kind === k }} onPress={() => setKind(k)} style={[s.chip, kind === k && s.chipOn]}><Text style={[s.chipText, kind === k && s.chipTextOn]}>{t(KIND_KEY[k])}</Text></Pressable>)}</View>
          <TextInput testID="issue-note" value={note} onChangeText={setNote} maxLength={500} multiline placeholder={t('orderFeedback.notePlaceholder')} placeholderTextColor={colors.muted} style={s.input} />
          <Pressable testID="issue-send" accessibilityRole="button" disabled={busy || !item || !kind} onPress={() => void submitReport()} style={[s.button, (busy || !item || !kind) && s.dim]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.buttonText}>{t('orderFeedback.send')}</Text>}</Pressable>
        </>}
      {!!error && <Text testID="feedback-error" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
      {data.issues.length > 0 && <View style={s.list}>
        <Text style={s.label}>{t('orderFeedback.yourReports')}</Text>
        {data.issues.map(i => <View key={i.id} testID={`issue-${i.id}`} style={s.row}><Text style={s.rowText} numberOfLines={2}>{nameOf(i.order_item_id)} · {t(KIND_KEY[i.kind])}</Text><Text style={[s.badge, i.status === 'refunded' && s.badgeOk]}>{t(STATUS_KEY[i.status])}</Text></View>)}
      </View>}
    </View>
  </View>;
}

const s = StyleSheet.create({
  wrap: { gap: 12, marginTop: 12 },
  card: { padding: 16, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 10 },
  title: { fontSize: 16, fontWeight: '800', color: colors.onSurface },
  label: { fontSize: 13, fontWeight: '700', color: colors.onSurface, marginTop: 4 },
  hint: { fontSize: 13, lineHeight: 19, color: colors.muted },
  stars: { flexDirection: 'row', gap: 6 }, star: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 64, borderRadius: 14, borderWidth: 1, borderColor: colors.borderStrong, padding: 12, fontSize: 14, color: colors.onSurface, textAlignVertical: 'top' },
  button: { minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forestDeep }, buttonText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' }, dim: { opacity: 0.5 },
  outline: { minHeight: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.forest }, outlineText: { fontSize: 14, fontWeight: '700', color: colors.forest },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 40, maxWidth: '100%', paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.forestDeep, borderColor: colors.forestDeep }, chipText: { fontSize: 13, fontWeight: '600', color: colors.onSurface }, chipTextOn: { color: '#FFFFFF' },
  error: { fontSize: 13, fontWeight: '600', color: colors.onError }, ok: { fontSize: 13, fontWeight: '700', color: colors.onSuccess },
  list: { gap: 8, marginTop: 4 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, rowText: { flex: 1, fontSize: 13, color: colors.onSurface },
  badge: { fontSize: 12, fontWeight: '800', color: colors.muted }, badgeOk: { color: colors.onSuccess },
});
