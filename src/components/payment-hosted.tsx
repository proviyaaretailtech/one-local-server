// Phone app: Cashfree's hosted payment page (cards, netbanking, wallets, UPI apps and QR) in a WebView on a page our own API
// serves (checkout_url). react-native-webview is already in the build. The page tells us when it is finished, but that is
// only a cue: the progress screen then asks the server (payment-progress.tsx). Card numbers and PINs never reach our server.
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { WebView } from 'react-native-webview';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { useTranslation } from '@/src/i18n';
import { parsePaymentResultLink } from '../payments/logic';

export type HostedProps = {
  url: string; checkoutId: string;
  onCue: (data: unknown) => void;      // the page said something (done / failed / dismiss)
  onResultLink: (hint?: string) => void; // onecity://payment-result was followed
  onClose: () => void;                  // the customer closed the page by hand
  onBroken: () => void;                 // the page could not be opened
};

export function HostedPage({ url, onCue, onResultLink, onClose, onBroken }: HostedProps) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  return <View testID="pay-hosted" style={s.flex}>
    <View style={s.bar}>
      <Pressable testID="pay-hosted-close" accessibilityRole="button" accessibilityLabel={t('payment.cancelA11y')} onPress={onClose} style={s.close}><Icon name="close" size={22} color={colors.onSurface} /></Pressable>
      <Icon name="lock-closed" size={14} color={colors.onSuccess} /><Text style={s.title}>{t('payui.secure')}</Text>
    </View>
    <WebView
      source={{ uri: url }}
      onMessage={e => onCue(e.nativeEvent.data)}
      onLoadEnd={() => setLoaded(true)}
      // UPI apps and bank pages that leave the browser (upi://, tez://, intent://…) open outside it; our own result link stays in the app.
      onShouldStartLoadWithRequest={req => {
        const link = parsePaymentResultLink(req.url);
        if (link) { onResultLink(link.status); return false; }
        if (/^https?:/i.test(req.url) || req.url === 'about:blank') return true;
        Linking.openURL(req.url).catch(() => {});
        return false;
      }}
      onError={onBroken}
      onHttpError={e => { if (e.nativeEvent.statusCode >= 400 && e.nativeEvent.url === url) onBroken(); }}
      javascriptEnabled domStorageEnabled setSupportMultipleWindows={false} originWhitelist={['*']}
      style={s.flex}
    />
    {!loaded && <ActivityIndicator style={s.loading} color={colors.forest} />}
  </View>;
}
const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingBottom: 6 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13, fontWeight: '700', color: colors.onSurface },
  loading: { position: 'absolute', top: 120, alignSelf: 'center' },
});
