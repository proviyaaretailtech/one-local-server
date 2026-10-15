// The full "Payment Options" screen shown when online payments are live (features.online_payments).
// Laid out the way Indian shoppers already know from delivery apps: preferred method first, then
// UPI apps, cards, and more options. Tapping a row only selects it; the selected row opens with its
// own Pay button, so the last-used method is one tap. Card numbers, UPI ids and bank logins are all
// entered on Razorpay's page afterwards (razorpay-checkout.tsx) — this screen never asks for them.
import { useState } from 'react';
import type { ParseKeys } from 'i18next';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { PaymentMethod, UpiApp } from '../customer';
import { colors } from '../theme';
import { useFeatures } from '../features';
import { useDeliveryLocation } from '../delivery-location';
import { paymentLabel, UPI_APPS } from './payment-options';
import { isPayBrand, METHOD_LOGOS, PayLogoStrip, PayTile, type PayBrand } from './pay-logo';
import { useFormat, useTranslation } from '@/src/i18n';

export type PaymentChoice = { method: PaymentMethod; app?: UpiApp };
const same = (a: PaymentChoice, b: PaymentChoice) => a.method === b.method && (a.method !== 'upi' || (a.app ?? '') === (b.app ?? ''));

type Props = {
  onClose: () => void; choice: PaymentChoice; onPay: (choice: PaymentChoice) => void; paying: boolean;
  itemCount: number; total: number; savings: number;
};

// Catalogue keys, looked up while rendering so the rows follow the language.
const MORE: { method: PaymentMethod; title: ParseKeys; sub: ParseKeys; icon: string }[] = [
  { method: 'paylater', title: 'payment.sheet.laterTitle', sub: 'payment.sheet.laterSub', icon: 'calendar-outline' },
  { method: 'wallet', title: 'payment.wallet.title', sub: 'payment.wallet.sub', icon: 'wallet-outline' },
  { method: 'netbanking', title: 'payment.sheet.netbankingTitle', sub: 'payment.sheet.netbankingSub', icon: 'business-outline' },
  { method: 'cod', title: 'payment.sheet.codTitle', sub: 'payment.sheet.codSub', icon: 'cash-outline' },
];

// Mounted only while open, so it always starts on the customer's last-used method.
export function PaymentSheet({ onClose, choice, onPay, paying, itemCount, total, savings }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const fmt = useFormat();
  const { wallet, coins } = useFeatures();
  const { location } = useDeliveryLocation();
  const [picked, setPicked] = useState<PaymentChoice>(choice);
  const [offers, setOffers] = useState(false);

  // One row; when it is the selected one it opens with its own Pay button. A plain render function
  // (not a component), so rows keep their identity between renders.
  const row = ({ c, title, sub, icon, brand, logos, testID }: { c: PaymentChoice; title: string; sub?: string; icon?: string; brand?: PayBrand; logos?: PayBrand[]; testID: string }) => {
    const on = same(picked, c);
    // The last-used method also appears in its own section; only the Preferred row opens there.
    const showPay = on && (testID === 'payment-preferred' || !same(c, choice));
    return <View key={testID} style={[s.row, on && s.rowOn]}>
      <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setPicked(c)} style={s.rowHead}>
        {brand ? <PayTile brand={brand} width={44} height={40} />
          : <View style={s.badge}><Icon name={(icon ?? 'card-outline') as any} size={20} color={colors.forest} /></View>}
        <View style={s.copy}><Text style={s.rowTitle}>{title}</Text>{!!sub && <Text style={s.rowSub}>{sub}</Text>}{!!logos && <PayLogoStrip brands={logos} />}</View>
        <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.forest} />
      </Pressable>
      {showPay && <View style={s.payWrap}>
        <Pressable testID="payment-sheet-pay" accessibilityRole="button" disabled={paying} onPress={() => onPay(picked)} style={({ pressed }) => [s.payBtn, (pressed || paying) && s.pressed]}>
          {paying ? <ActivityIndicator color={colors.onBrandSecondary} /> : <Text style={s.payText}>{c.method === 'cod' ? t('checkout.placeOrder', { amount: fmt.money(total) }) : t('checkout.pay', { amount: fmt.money(total) })}</Text>}
        </Pressable>
        <Text style={s.payNote}>{c.method === 'cod' ? t('payment.sheet.cashNote') : t('payment.sheet.onlineNote')}</Text>
      </View>}
    </View>;
  };


  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <View testID="payment-options-screen" style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable testID="payment-options-back" accessibilityLabel={t('payment.sheet.backA11y')} onPress={onClose} style={s.back}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <View style={s.copy}>
          <Text style={s.title}>{t('payment.sheet.title')}</Text>
          <Text testID="payment-options-summary" style={s.subline}>{t('payment.sheet.summary', { count: itemCount, total: fmt.money(total) })}{savings > 0 ? <Text style={s.save}> {t('payment.sheet.savings', { amount: fmt.money(savings) })}</Text> : null}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}>
        <View style={s.route}>
          <View style={s.routeDot}><Icon name="storefront" size={14} color={colors.surface} /></View>
          <View style={s.copy}><Text style={s.routeTitle}>One Local</Text><Text style={s.routeSub}>{t('payment.sheet.routeEta')}</Text></View>
          <Icon name="arrow-forward" size={16} color={colors.muted} />
          <View style={[s.copy, { alignItems: 'flex-end' }]}><Text style={s.routeTitle}>{t('payment.sheet.deliverTo')}</Text><Text numberOfLines={1} style={s.routeSub}>{location}</Text></View>
        </View>

        <Pressable testID="payment-offers" onPress={() => setOffers(v => !v)} style={s.offers}>
          <Icon name="pricetags" size={16} color={colors.onSuccess} /><Text style={s.offersText}>{t('payment.sheet.offers')}</Text><Icon name={offers ? 'chevron-up' : 'chevron-forward'} size={16} color={colors.onSuccess} />
        </Pressable>
        {offers && <Text testID="payment-offers-list" style={s.offersNote}>{t('payment.sheet.offersNone')}</Text>}

        {(wallet || coins) && <View style={[s.row, s.walletRow]}>
          <View style={s.badge}><Icon name="wallet" size={20} color={colors.forest} /></View>
          <View style={s.copy}><Text style={s.rowTitle}>{wallet ? 'OneLocal Wallet' : 'OneLocal Coins'}</Text><Text style={s.rowSub}>{t('payment.sheet.walletNote')}</Text></View>
          <Switch value={false} disabled accessibilityLabel={t('payment.sheet.walletA11y')} />
        </View>}

        <Text style={s.section}>{t('payment.sheet.sectionPreferred')}</Text>
        {row({ testID: "payment-preferred", c: choice, title: paymentLabel(choice.method, choice.method === 'upi' ? choice.app : undefined), sub: t('payment.sheet.lastUsed'), brand: choice.method === 'upi' && choice.app && isPayBrand(choice.app) ? choice.app : undefined, icon: MORE.find(m => m.method === choice.method)?.icon ?? (choice.method === 'card' ? 'card-outline' : 'phone-portrait-outline') })}

        <Text style={s.section}>{t('payment.sheet.sectionUpi')}</Text>
        {UPI_APPS.map(a => row({ testID: `payment-upi-${a.id}`, c: { method: 'upi', app: a.id }, title: a.title, brand: isPayBrand(a.id) ? a.id : undefined, icon: 'phone-portrait-outline' }))}
        {row({ testID: "payment-upi-id", c: { method: 'upi', app: 'id' }, title: t('payment.sheet.addUpiId'), sub: t('payment.sheet.upiIdNote'), icon: "add-circle-outline" })}

        <Text style={s.section}>{t('payment.sheet.sectionCards')}</Text>
        {row({ testID: "payment-card", c: { method: 'card' }, title: t('payment.sheet.addCard'), sub: t('payment.sheet.cardNote'), icon: "add-circle-outline", logos: METHOD_LOGOS.card })}

        <Text style={s.section}>{t('payment.sheet.sectionMore')}</Text>
        {MORE.map(m => row({ testID: `payment-more-${m.method}`, c: { method: m.method }, title: t(m.title), sub: t(m.sub), icon: m.icon }))}
      </ScrollView>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingBottom: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: colors.onSurface },
  subline: { fontSize: 12, color: colors.muted, marginTop: 2 }, save: { color: colors.onSuccess, fontWeight: '700' },
  scroll: { padding: 16, gap: 10 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 18, padding: 14 },
  routeDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center' },
  routeTitle: { fontSize: 13, fontWeight: '700', color: colors.onSurface }, routeSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  offers: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.pastelGreen, borderRadius: 14, paddingHorizontal: 14, minHeight: 44 },
  offersText: { flex: 1, color: colors.onSuccess, fontWeight: '700', fontSize: 13 },
  offersNote: { fontSize: 12, color: colors.onSurfaceTertiary, lineHeight: 18, paddingHorizontal: 4 },
  section: { fontSize: 12, fontWeight: '800', color: colors.onSurfaceTertiary, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 14, marginLeft: 4 },
  row: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  rowOn: { borderColor: colors.forest },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 56 },
  badge: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.limeSoft, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface }, rowSub: { fontSize: 11, color: colors.muted, marginTop: 3, lineHeight: 16 },
  payWrap: { paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  payBtn: { backgroundColor: colors.brandSecondary, borderRadius: 999, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  payText: { color: colors.onBrandSecondary, fontSize: 16, fontWeight: '800' },
  payNote: { fontSize: 11, color: colors.muted, lineHeight: 16, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
