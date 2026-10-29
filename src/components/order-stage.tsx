// What the restaurant has done with the order (database 0580, specs/order-accept-kot): waiting for it to confirm (with the time it has
// left), accepted with its kitchen ticket number, the kitchen started, ready, or why it was cancelled and where the refund is.
// "Accepted" is only ever shown once the kitchen ticket exists. The stage comes with the tracking answer and, for a signed-in customer,
// the moment it changes over realtime (src/use-order-realtime.ts); a change also shows a short toast.
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import type { TFunction } from 'i18next';
import { colors, radius, spacing } from '@/src/theme';
import { useFormat, useTranslation } from '@/src/i18n';
import type { Formatter } from '@/src/i18n/format';
import { isCancelledStage, partnerReason, type OrderStage } from '@/src/utils/tracking';

type T = TFunction;
type F = Pick<Formatter, 'money'>;

/** The one sentence for a stage, in the app's language. */
export function stageSentence(s: OrderStage, store: string, t: T): string {
  const name = store || t('orders.storeFallback');
  switch (s.stage) {
    case 'created': return t('tracking.stage.created', { store: name });
    case 'waiting_partner': return t('tracking.stage.waiting_partner', { store: name });
    case 'kitchen_ticket_created':
      return s.prep_minutes ? t('tracking.stage.kitchen_ticket_created', { store: name, kot: s.kot_no ?? '', prep: s.prep_minutes })
        : t('tracking.stage.kitchen_ticket_created_noPrep', { store: name, kot: s.kot_no ?? '' });
    case 'preparing': return t('tracking.stage.preparing');
    case 'ready': return t('tracking.stage.ready');
    case 'out': return t('tracking.stage.out');
    case 'delivered': return t('tracking.stage.delivered');
    case 'rejected_by_partner': {
      const reason = partnerReason(s.cancel_reason);
      return reason ? t('tracking.stage.rejected_by_partner', { store: name, reason }) : t('tracking.stage.rejected_by_partner_noReason', { store: name });
    }
    case 'auto_cancelled': return t('tracking.stage.auto_cancelled', { store: name });
    case 'auto_cancelled_ghost': return t('tracking.stage.auto_cancelled_ghost', { store: name });
    case 'customer_cancelled': return t('tracking.stage.customer_cancelled');
    case 'ops_cancelled': return t('tracking.stage.ops_cancelled');
    default: return t('tracking.stage.cancelled');
  }
}

/** Where the money is, for a cancelled order (null when it was not cancelled). */
export function refundSentence(s: OrderStage, t: T, fmt: F): string | null {
  if (!isCancelledStage(s)) return null;
  const amount = s.refund_amount != null ? fmt.money(s.refund_amount) : '';
  switch (s.refund) {
    case 'initiated': return t('tracking.stageRefund.initiated', { amount });
    case 'processed': return t('tracking.stageRefund.processed', { amount });
    case 'delayed': return t('tracking.stageRefund.delayed');
    default: return t('tracking.stageRefund.none');
  }
}

const left = (deadline: string | null, now: number) => (deadline ? Math.max(0, Math.round((Date.parse(deadline) - now) / 1000)) : null);

export function OrderStageCard({ stage, store }: { stage: OrderStage | null; store: string }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [now, setNow] = useState(() => Date.now());
  const waiting = stage?.stage === 'waiting_partner' && !!stage.deadline;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);
  if (!stage) return null;
  const cancelled = isCancelledStage(stage);
  const secs = waiting ? left(stage.deadline, now) : null;
  const refund = refundSentence(stage, t, fmt);
  return (
    <View testID="order-stage" accessibilityLiveRegion="polite" style={[styles.card, cancelled && styles.cardCancelled]}>
      <Text testID="order-stage-text" style={[styles.text, cancelled && styles.textCancelled]}>{stageSentence(stage, store, t)}</Text>
      {secs != null && secs > 0 && (
        <Text testID="order-stage-countdown" style={styles.sub}>{t('tracking.stage.answerIn', { time: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` })}</Text>
      )}
      {!!refund && <Text testID="order-stage-refund" style={styles.sub}>{refund}</Text>}
    </View>
  );
}

/** A short message when the stage CHANGES while the screen is open (not for the stage it opened with). Clears itself after 6 s. */
export function useStageToast(stage: OrderStage | null, store: string): string | null {
  const { t } = useTranslation();
  const fmt = useFormat();
  const seen = useRef<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const code = stage ? `${stage.stage}|${stage.refund}` : null;
  useEffect(() => {
    if (!stage || !code) return;
    const first = seen.current === null;
    const changed = seen.current !== code;
    seen.current = code;
    if (first || !changed) return;
    const refund = refundSentence(stage, t, fmt);
    const text = refund ? `${stageSentence(stage, store, t)} ${refund}` : stageSentence(stage, store, t);
    setMessage(text);
    AccessibilityInfo.announceForAccessibility(text);
    const timer = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  return message;
}

export function StageToast({ message, top }: { message: string | null; top: number }) {
  if (!message) return null;
  return (
    <View testID="order-stage-toast" pointerEvents="none" style={[styles.toast, { top }]}>
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardCancelled: { borderColor: colors.error },
  text: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  textCancelled: { color: colors.error },
  sub: { color: colors.muted, fontSize: 13, marginTop: 4 },
  toast: { position: 'absolute', left: spacing.lg, right: spacing.lg, backgroundColor: colors.forest, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: spacing.md, zIndex: 20, elevation: 6 },
  toastText: { color: colors.onBrand, fontSize: 14, fontWeight: '600' },
});
