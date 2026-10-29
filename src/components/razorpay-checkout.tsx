// Phone app: Razorpay Checkout inside a WebView, on a page our own API serves
// (/api/payments/checkout-page, server/payments.ts). react-native-webview is already in the iOS build;
// Razorpay's native SDK (react-native-razorpay) would need a new build, so it waits (docs/PAYMENTS.md).
// Card numbers, UPI PINs and bank logins are typed into Razorpay's page, never into One Local.
import { useEffect, useRef, useState } from 'react';
import { Modal, View, Pressable, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { Text } from '@/src/ui/text';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { API, identity, PaymentResult, PaymentStart } from '../api';
import { colors } from '../theme';
import { useTranslation } from '@/src/i18n';

export function RazorpayCheckout({ session, method, app, onResult }: { session: PaymentStart; method: string; app?: string; onResult: (r: PaymentResult) => void }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const done = useRef(false);
  // The `reason` texts below travel in the result for developers; the cart never shows them, so they stay English.
  const finish = (r: PaymentResult) => { if (!done.current) { done.current = true; onResult(r); } };
  useEffect(() => { identity().then(setHeaders).catch(() => finish({ type: 'failed', reason: 'Could not open the payment page' })); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only the order id and the method shortcut go in the address; name, phone and email are handed
  // to the page after it loads, so they never sit in a URL or a server log.
  const uri = `${API}/payments/checkout-page?order=${encodeURIComponent(session.order_id)}&method=${encodeURIComponent(method)}&app=${encodeURIComponent(app ?? '')}`;
  const prefill = `window.__OL_PREFILL = ${JSON.stringify(session.prefill).replace(/</g, '\\u003c')}; true;`;

  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => finish({ type: 'dismiss' })}>
    <View testID="razorpay-webview" style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.bar}>
        <Pressable testID="razorpay-close" accessibilityLabel={t('payment.cancelA11y')} onPress={() => finish({ type: 'dismiss' })} style={s.close}><Icon name="close" size={22} color={colors.onSurface} /></Pressable>
        <Icon name="lock-closed" size={14} color={colors.onSuccess} /><Text style={s.title}>{t('payment.secure')}</Text>
      </View>
      {headers ? <WebView
        source={{ uri, headers }}
        injectedJavaScriptBeforeContentLoaded={prefill}
        onMessage={e => { try { finish(JSON.parse(e.nativeEvent.data)); } catch {} }}
        // UPI apps and bank pages that leave the browser (upi://, intent://, tez://…) open outside it.
        onShouldStartLoadWithRequest={req => { if (/^https?:/i.test(req.url) || req.url === 'about:blank') return true; Linking.openURL(req.url).catch(() => {}); return false; }}
        onError={() => finish({ type: 'failed', reason: 'Could not open the payment page' })}
        onHttpError={e => { if (e.nativeEvent.url.includes('/api/payments/checkout-page')) finish({ type: 'failed', reason: 'Could not open the payment page' }); }}
        startInLoadingState renderLoading={() => <ActivityIndicator style={s.loading} color={colors.forest} />}
        javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false} originWhitelist={['*']}
        style={s.web}
      /> : <ActivityIndicator style={s.loading} color={colors.forest} />}
    </View>
  </Modal>;
}
const s = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.cream }, bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingBottom: 6 }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 13, fontWeight: '700', color: colors.onSurface }, web: { flex: 1, backgroundColor: colors.cream }, loading: { flex: 1 } });
