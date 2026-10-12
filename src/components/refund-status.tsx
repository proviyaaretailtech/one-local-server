// The refund line on the order screen: "Refund of ₹X initiated · to your original payment method in 3-5 working days",
// then "completed" or, if the gateway refused, "delayed, our team is retrying" with a support link.
// Reads GET /payments/refund-status; shows nothing when the order has no refund. While a refund is "initiated" it asks
// again every 30 seconds (the server also learns from the gateway's webhook).
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { useFormat, useTranslation } from '@/src/i18n';
import { fetchRefunds } from '../payments/api';
import { refundKey, refundNeedsPolling, refundRows, type RefundRow } from '../payments/logic';

export function RefundStatus({ orderId, checkoutId }: { orderId?: string | null; checkoutId?: string | null }) {
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const router = useRouter();
  const english = (i18n.resolvedLanguage ?? i18n.language ?? 'en') === 'en';
  const [rows, setRows] = useState<RefundRow[]>([]);

  useEffect(() => {
    if (!orderId && !checkoutId) return;
    let dead = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      fetchRefunds({ orderId: orderId ?? undefined, checkoutId: orderId ? undefined : checkoutId ?? undefined })
        .then(r => {
          if (dead) return;
          const list = refundRows(r.refunds);
          setRows(list);
          if (refundNeedsPolling(list)) timer = setTimeout(load, 30_000);
        })
        .catch(() => { /* the line is an extra: a failed read shows nothing and the next visit tries again */ });
    };
    load();
    return () => { dead = true; if (timer) clearTimeout(timer); };
  }, [orderId, checkoutId]);

  if (!rows.length) return null;
  return <View testID="refund-status" style={s.wrap}>
    {rows.slice(0, 3).map(r => {
      const failed = r.state === 'failed', done = r.state === 'processed';
      const text = t(refundKey(r), { amount: fmt.money(r.amount), eta: english && r.eta_text ? r.eta_text : t('payui.refund.eta') });
      return <View key={r.id} testID={`refund-line-${r.state}`} accessibilityRole="text" accessibilityLabel={text} style={[s.line, failed ? s.lineFailed : done ? s.lineDone : s.lineInit]}>
        <Icon name={failed ? 'alert-circle' : done ? 'checkmark-circle' : 'time-outline'} size={20} color={failed ? colors.onError : done ? colors.onSuccess : colors.onWarning} />
        <View style={s.flex}>
          <Text style={s.text}>{text}</Text>
          {failed && <Pressable testID="refund-support" accessibilityRole="link" onPress={() => router.push('/help' as never)} style={s.link}><Text style={s.linkText}>{t('payui.refund.support')}</Text></Pressable>}
        </View>
      </View>;
    })}
  </View>;
}

const s = StyleSheet.create({
  wrap: { gap: 8, marginTop: 12 },
  flex: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, padding: 12 },
  lineInit: { backgroundColor: colors.warning }, lineDone: { backgroundColor: colors.success }, lineFailed: { backgroundColor: colors.error },
  text: { fontSize: 13, lineHeight: 19, color: colors.onSurface, fontWeight: '600' },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: 13, fontWeight: '800', color: colors.forest, textDecorationLine: 'underline' },
});
