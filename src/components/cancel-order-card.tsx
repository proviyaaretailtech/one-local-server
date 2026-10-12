import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ApiError, apiGet, apiPost, type Order } from '@/src/api';
import { colors, radius, spacing } from '@/src/theme';
import { useErrorMessage, useFormat, useTranslation } from '@/src/i18n';
import { haptic } from '@/src/haptics';
import { HoldToConfirm } from './motion/hold-to-confirm';

// Server shapes (server/customer-cancel.ts). Amounts, percentages and stages all come from the server; this screen sends only a reason.
type Preview = {
  can_cancel: boolean; blocked_reason: 'already_cancelled' | 'too_late' | null; stage: string | null; refund_pct: number;
  paid_online: boolean; paid_amount: number; refund_amount: number; fee_amount: number;
};
type Result = { refund: { amount: number } | null; refund_pct: number | null };

// Sent to the server as the reason text; never shown, so they stay plain English codes.
const REASONS = [
  { code: 'changed_mind', label: 'orderCancel.reason.changedMind' },
  { code: 'wrong_items', label: 'orderCancel.reason.wrongItems' },
  { code: 'too_slow', label: 'orderCancel.reason.tooSlow' },
  { code: 'other', label: 'orderCancel.reason.other' },
] as const;

// "Cancel order" on the order screen: shows what the cancel would cost BEFORE the customer confirms, then cancels.
export function CancelOrderCard({ order, onCancelled }: { order: Order; onCancelled: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const errorText = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]['code']>('changed_mind');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const key = useRef(`cancel-${order.id}-${Date.now().toString(36)}`); // one tap = one key, so a retry cannot cancel twice

  const load = useCallback(() => {
    setLoadFailed(false); setPreview(null);
    apiGet<Preview>(`/orders/${order.id}/cancel`).then(setPreview).catch(() => setLoadFailed(true));
  }, [order.id]);
  useEffect(() => { if (open && !done) load(); }, [open, done, load]);

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      setDone(await apiPost<Result>(`/orders/${order.id}/cancel`, { reason }, { 'Idempotency-Key': key.current }));
      haptic.success(); onCancelled();
    } catch (e) {
      haptic.error();
      setError(e instanceof ApiError && e.code === 'too_late' ? t('orderCancel.tooLate') : errorText(e));
    } finally { setBusy(false); }
  };

  if (order.status === 'cancelled' && !done) return <View testID="order-cancelled-banner" style={styles.card}><Text style={styles.title}>{t('orderCancel.banner')}</Text></View>;
  if (!done && !['placed', 'accepted', 'packed'].includes(order.status)) return null; // out for delivery or delivered: nothing to offer
  if (!open) return (
    <TouchableOpacity testID="cancel-order-open" accessibilityRole="button" style={styles.open} onPress={() => setOpen(true)}>
      <Text style={styles.openText}>{t('orderCancel.action')}</Text>
    </TouchableOpacity>
  );

  const count = order.items.reduce((n, i) => n + i.qty, 0);
  return (
    <View testID="cancel-order-card" style={styles.card}>
      {done ? <>
        <Text testID="cancel-done-title" style={styles.title}>{t('orderCancel.doneTitle')}</Text>
        <Text testID="cancel-done-refund" style={styles.body}>
          {done.refund ? t('orderCancel.doneRefund', { amount: fmt.money(done.refund.amount) }) : preview && !preview.paid_online ? t('orderCancel.doneNothingPaid') : t('orderCancel.doneNoRefund')}
        </Text>
        <TouchableOpacity style={styles.ghost} onPress={() => setOpen(false)} testID="cancel-done-close"><Text style={styles.ghostText}>{t('orderCancel.close')}</Text></TouchableOpacity>
      </> : <>
        <Text style={styles.title}>{t('orderCancel.title')}</Text>
        <Text style={styles.body}>{t('orderCancel.items', { count })} · {t('orderCancel.orderTotal')} {fmt.money(order.total)}</Text>
        {loadFailed ? <>
          <Text testID="cancel-preview-error" style={styles.error}>{t('orderCancel.previewError')}</Text>
          <TouchableOpacity style={styles.ghost} onPress={load}><Text style={styles.ghostText}>{t('common.retry')}</Text></TouchableOpacity>
        </> : !preview ? <ActivityIndicator testID="cancel-preview-loading" color={colors.forest} accessibilityLabel={t('orderCancel.loading')} />
        : !preview.can_cancel ? <Text testID="cancel-blocked" style={styles.error}>{preview.blocked_reason === 'too_late' ? t('orderCancel.tooLate') : t('orderCancel.banner')}</Text>
        : <>
          {!preview.paid_online ? <Text testID="cancel-terms" style={styles.body}>{t('orderCancel.cashNote')}</Text> : <View testID="cancel-terms" style={{ gap: 2 }}>
            <Text style={styles.body}>{t('orderCancel.paidOnline')}: {fmt.money(preview.paid_amount)}</Text>
            {preview.refund_pct >= 100 ? <Text style={styles.strong}>{t('orderCancel.fullRefund', { amount: fmt.money(preview.refund_amount) })}</Text>
              : preview.refund_amount <= 0 ? <Text style={styles.strong}>{t('orderCancel.noRefund')}</Text>
              : <><Text style={styles.strong}>{t('orderCancel.refundLine', { amount: fmt.money(preview.refund_amount), pct: fmt.number(preview.refund_pct) })}</Text>
                  <Text style={styles.body}>{t('orderCancel.feeLine', { amount: fmt.money(preview.fee_amount) })}</Text></>}
          </View>}
          <Text style={styles.label}>{t('orderCancel.reasonLabel')}</Text>
          <View style={styles.reasons}>
            {REASONS.map(r => <TouchableOpacity key={r.code} testID={`cancel-reason-${r.code}`} accessibilityRole="radio" accessibilityState={{ selected: reason === r.code }}
              onPress={() => { haptic.select(); setReason(r.code); }} style={[styles.chip, reason === r.code && styles.chipOn]}><Text style={[styles.chipText, reason === r.code && styles.chipTextOn]}>{t(r.label)}</Text></TouchableOpacity>)}
          </View>
          {!!error && <Text testID="cancel-error" style={styles.error}>{error}</Text>}
          <HoldToConfirm testID="cancel-order-confirm" disabled={busy} style={[styles.danger, busy && { opacity: 0.6 }]} textStyle={styles.dangerText}
            label={busy ? t('orderCancel.working') : t('orderCancel.confirm')} holdLabel={t('orderCancel.holdToConfirm')} hint={t('orderCancel.holdHint')} onConfirm={confirm} />
        </>}
        <TouchableOpacity testID="cancel-order-keep" style={styles.ghost} onPress={() => setOpen(false)}><Text style={styles.ghostText}>{t('orderCancel.keep')}</Text></TouchableOpacity>
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  open: { marginTop: spacing.md, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  openText: { color: colors.onError, fontWeight: '800' },
  card: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  title: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  body: { fontSize: 13, color: colors.onSurfaceSecondary },
  strong: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  label: { fontSize: 12, fontWeight: '700', color: colors.muted, marginTop: spacing.xs },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: 13, color: colors.onSurface },
  chipTextOn: { color: colors.onBrandPrimary, fontWeight: '800' },
  error: { fontSize: 13, color: colors.onError },
  danger: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.onError, alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: '#fff', fontWeight: '800' },
  ghost: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: colors.onSurface, fontWeight: '700' },
});
