// "Share receipt" on an order: the plain-text receipt (src/receipt.ts) goes to the phone's share sheet, or onto the clipboard on the web.
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Icon from '@react-native-vector-icons/ionicons';
import type { Order } from '../api';
import { colors } from '../theme';
import { Text } from '../ui/text';
import { paymentMethodKey, useFormat, useTranslation } from '../i18n';
import { buildReceipt } from '../receipt';

export function ReceiptShare({ order }: { order: Order }) {
  const { t } = useTranslation(); const fmt = useFormat();
  const [copied, setCopied] = useState(false); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (order.status === 'cancelled') return null;
  const share = async () => {
    const text = buildReceipt(order, {
      title: t('orderReceipt.title'), order: t('orderReceipt.order'), date: t('orderReceipt.date'), store: t('orderReceipt.store'), deliverTo: t('orderReceipt.deliverTo'),
      items: t('orderReceipt.items'), subtotal: t('orderReceipt.subtotal'), discount: t('orderReceipt.discount'), delivery: t('orderReceipt.delivery'),
      tax: t('orderReceipt.tax'), total: t('orderReceipt.total'), payment: t('orderReceipt.payment'), footer: t('orderReceipt.footer'),
    }, { money: fmt.money, date: fmt.dateTime }, order.payment_method ? t(paymentMethodKey(order.payment_method)) : undefined);
    try {
      if (Platform.OS === 'web') { await Clipboard.setStringAsync(text); setCopied(true); timer.current = setTimeout(() => setCopied(false), 2500); }
      else await Share.share({ message: text });
    } catch { /* the customer closed the share sheet */ }
  };
  return <Pressable testID="order-share-receipt" accessibilityRole="button" onPress={() => void share()} style={({ pressed }) => [s.button, pressed && { opacity: 0.7 }]}>
    <Icon name={copied ? 'checkmark' : 'share-outline'} size={18} color={colors.forest} /><Text style={s.text}>{copied ? t('orderReceipt.copied') : t('orderReceipt.share')}</Text>
  </Pressable>;
}

const s = StyleSheet.create({
  button: { minHeight: 48, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  text: { fontSize: 14, fontWeight: '700', color: colors.forest },
});
