// "Payment options" for Cashfree (spec: specs/cashfree-checkout/spec.md "UI standard"). The method list comes from
// GET /payments/methods; the method used last time is on top. The selected row opens with its choices, one Pay button at
// the bottom shows the exact amount. Card numbers, UPI PINs and bank logins are typed on Cashfree's own page, never here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { METHOD_LOGOS, PayLogoStrip, PayTile } from './pay-logo';
import { useFormat, useTranslation } from '@/src/i18n';
import {
  defaultRow, defaultUpi, normalizePhone, orderMethods, payEnabled, upiOptions, validVpa,
  type LastUsed, type MethodId, type MethodsResponse, type PayPick, type UpiAppId, type UpiMode,
} from '../payments/logic';

// i18n-ignore: UPI app names are brand names
export const UPI_APP_NAMES: Record<UpiAppId, { name: string }> = {
  google_pay: { name: 'Google Pay' }, phonepe: { name: 'PhonePe' },
  paytm: { name: 'Paytm' }, bhim: { name: 'BHIM' },
};
const ICONS: Record<MethodId, string> = { upi: 'phone-portrait-outline', card: 'card-outline', netbanking: 'business-outline', cod: 'cash-outline' };

type Props = {
  methods: MethodsResponse | undefined; loading: boolean; failed: boolean; onReload: () => void;
  last: LastUsed | null; total: number; itemCount: number; savings: number; busy: boolean;
  profilePhone: string; onPay: (pick: PayPick) => void; onClose: () => void;
};

// The label of the method used last, for the cart's "PAY USING" line.
export function useMethodLabel() {
  const { t } = useTranslation();
  return (id: MethodId, app?: UpiAppId) =>
    id === 'upi' ? (app ? t('payment.upiWithApp', { app: UPI_APP_NAMES[app].name }) : t('payui.upi.title'))
      : id === 'card' ? t('payui.card.title') : id === 'netbanking' ? t('payui.net.title') : t('payui.cod.title');
}

export function PaymentMethodsSheet({ methods, loading, failed, onReload, last, total, itemCount, savings, busy, profilePhone, onPay, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const fmt = useFormat();
  const platform = Platform.OS === 'web' ? 'web' : 'native';
  const rows = useMemo(() => orderMethods(methods, last), [methods, last]);
  const [picked, setPicked] = useState<MethodId | null>(null);
  const sel = picked && rows.some(r => r.id === picked && r.available) ? picked : defaultRow(rows);
  const [upiPick, setUpiPick] = useState<{ mode: UpiMode; app?: UpiAppId } | null>(null);
  const upi = upiPick ?? (methods ? defaultUpi(methods, platform, last) : { mode: 'hosted' as UpiMode });
  const [vpa, setVpa] = useState('');
  const [vpaTouched, setVpaTouched] = useState(false);
  const [phone, setPhone] = useState(normalizePhone(profilePhone));
  const [phoneTouched, setPhoneTouched] = useState(false);
  const phoneOk = !!normalizePhone(phone);
  const lock = useRef(false);
  useEffect(() => { if (!busy) lock.current = false; }, [busy]);

  const row = rows.find(r => r.id === sel);
  const pick: PayPick | null = row ? { method: row.id, ...(row.id === 'upi' ? { mode: upi.mode, app: upi.app, vpa: upi.mode === 'collect' ? vpa.trim() : undefined } : {}), phone: normalizePhone(phone) } : null;
  const enabled = payEnabled({ row, busy, mode: upi.mode, app: upi.app, vpa, phone, phoneOk });
  const submit = () => {
    if (!pick || !enabled || lock.current) return;
    lock.current = true; // a second tap before the screen shows "busy" is ignored
    setTimeout(() => { lock.current = false; }, 1500);
    onPay(pick);
  };

  const cod = methods?.cod;
  const copyFor = (id: MethodId): { title: string; sub: string } => ({
    upi: { title: t('payui.upi.title'), sub: t('payui.upi.sub') },
    card: { title: t('payui.card.title'), sub: t('payui.card.sub') },
    netbanking: { title: t('payui.net.title'), sub: t('payui.net.sub') },
    cod: { title: t('payui.cod.title'), sub: t('payui.cod.sub') },
  }[id]);
  const reasonText = (r: typeof rows[number]) => r.reason === 'over_limit' ? t('payui.cod.over', { max: fmt.money(cod?.max_total ?? 0) }) : t('payui.cod.off');

  const options = methods ? upiOptions(methods, platform) : null;
  const tile = (key: string, selected: boolean, onPress: () => void, label: string, a11y: string, glyph: { icon?: string; app?: UpiAppId }) => (
    <Pressable key={key} testID={`pay-upi-${key}`} accessibilityRole="radio" accessibilityLabel={a11y} accessibilityState={{ checked: selected }}
      onPress={() => { setUpiPick(key === 'qr' ? { mode: 'qr' } : key === 'hosted' ? { mode: 'hosted' } : { mode: 'intent', app: key as UpiAppId }); }}
      style={[s.tile, selected && s.tileOn]}>
      {glyph.app ? <PayTile brand={glyph.app} width={58} height={36} /> : <View style={s.glyph}><Icon name={glyph.icon as never} size={18} color={colors.forest} /></View>}
      <Text numberOfLines={2} style={s.tileText}>{label}</Text>
    </Pressable>
  );

  const body = (id: MethodId) => {
    if (id === 'upi' && options && methods) {
      const useId = upi.mode === 'collect';
      return <View style={s.body}>
        <Text style={s.hint}>{t('payui.upi.pickApp')}</Text>
        <View style={s.tiles}>
          {options.apps.map(a => tile(a, !useId && upi.mode === 'intent' && upi.app === a, () => undefined, UPI_APP_NAMES[a].name, t('payui.upi.appA11y', { app: UPI_APP_NAMES[a].name }), { app: a }))}
          {options.qr && tile('qr', !useId && upi.mode === 'qr', () => undefined, t('payui.upi.qr'), t('payui.upi.qr'), { icon: 'qr-code-outline' })}
          {options.hosted && tile('hosted', !useId && upi.mode === 'hosted', () => undefined, options.apps.length ? t('payui.upi.other') : t('payui.upi.more'), options.apps.length ? t('payui.upi.other') : t('payui.upi.more'), { icon: 'apps-outline' })}
        </View>
        {options.qr && !useId && upi.mode === 'qr' && <Text style={s.hint}>{t('payui.upi.qrSub')}</Text>}
        {options.collect && <Pressable testID="pay-upi-id-link" accessibilityRole="button" onPress={() => setUpiPick(useId ? null : { mode: 'collect' })} style={s.link}>
          <Text style={s.linkText}>{t('payui.upi.useId')}</Text>
        </Pressable>}
        {useId && <View>
          <TextInput testID="pay-upi-id-input" accessibilityLabel={t('payui.upi.idLabel')} value={vpa} onChangeText={setVpa} onBlur={() => setVpaTouched(true)}
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder={t('payui.upi.idPlaceholder')} placeholderTextColor={colors.muted} style={s.input} />
          {vpaTouched && !validVpa(vpa) ? <Text testID="pay-upi-id-error" style={s.error}>{t('payui.upi.idInvalid')}</Text> : <Text style={s.hint}>{t('payui.upi.idNote')}</Text>}
        </View>}
      </View>;
    }
    return null;
  };

  const needsPhone = !!row && row.id !== 'cod' && !phoneOk;

  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <View testID="pay-methods-screen" style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable testID="pay-methods-back" accessibilityRole="button" accessibilityLabel={t('payment.sheet.backA11y')} onPress={onClose} style={s.back}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <View style={s.flex}>
          <Text accessibilityRole="header" style={s.title}>{t('payment.sheet.title')}</Text>
          <Text testID="pay-methods-summary" style={s.subline}>{t('payment.sheet.summary', { count: itemCount, total: fmt.money(total) })}{savings > 0 ? <Text style={s.save}> {t('payment.sheet.savings', { amount: fmt.money(savings) })}</Text> : null}</Text>
        </View>
      </View>
      {methods?.environment === 'sandbox' && <View testID="pay-test-ribbon" style={s.ribbon}><Icon name="flask-outline" size={14} color={colors.onWarning} /><Text style={s.ribbonText}>{t('payui.test')}</Text></View>}

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {loading && !methods && <View testID="pay-methods-loading" style={s.center}><ActivityIndicator color={colors.forest} /><Text style={s.hint}>{t('payui.loading')}</Text></View>}
        {failed && !methods && <View testID="pay-methods-error" style={s.center}>
          <Text style={s.error}>{t('payui.loadError')}</Text>
          <Pressable testID="pay-methods-reload" accessibilityRole="button" onPress={onReload} style={s.ghost}><Text style={s.ghostText}>{t('common.retry')}</Text></Pressable>
        </View>}
        {rows.map(r => {
          const on = sel === r.id, c = copyFor(r.id), dead = !r.available;
          return <View key={r.id} testID={`pay-method-${r.id}`} style={[s.row, on && s.rowOn, dead && s.rowDead]}>
            <Pressable testID={`pay-method-${r.id}-select`} accessibilityRole="radio" accessibilityLabel={c.title} accessibilityHint={dead ? reasonText(r) : undefined}
              accessibilityState={{ checked: on, disabled: dead }} disabled={dead} onPress={() => setPicked(r.id)} style={s.rowHead}>
              {r.id === 'upi' ? <PayTile brand="upi" width={44} height={40} /> : <View style={s.badge}><Icon name={ICONS[r.id] as never} size={20} color={colors.forest} /></View>}
              <View style={s.flex}>
                <View style={s.titleLine}>
                  <Text style={s.rowTitle}>{c.title}</Text>
                  {r.lastUsed && !dead && <View style={s.chip}><Text style={s.chipText}>{t('payui.lastUsed')}</Text></View>}
                </View>
                <Text testID={dead ? 'pay-cod-reason' : undefined} style={dead ? s.reason : s.rowSub}>{dead ? reasonText(r) : c.sub}</Text>
                {!dead && METHOD_LOGOS[r.id] && <PayLogoStrip brands={METHOD_LOGOS[r.id]!} />}
              </View>
              {!dead && <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.forest} />}
            </Pressable>
            {on && body(r.id)}
          </View>;
        })}
        {needsPhone && <View style={s.phone}>
          <Text style={s.hint}>{t('payui.phone.label')}</Text>
          <TextInput testID="pay-phone-input" accessibilityLabel={t('payui.phone.label')} value={phone} onChangeText={setPhone} onBlur={() => setPhoneTouched(true)}
            keyboardType="phone-pad" maxLength={13} placeholder={t('payui.phone.placeholder')} placeholderTextColor={colors.muted} style={s.input} />
          {phoneTouched && !phoneOk && <Text testID="pay-phone-error" style={s.error}>{t('payui.phone.invalid')}</Text>}
        </View>}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable testID="pay-methods-pay" accessibilityRole="button" accessibilityState={{ disabled: !enabled, busy }}
          accessibilityLabel={sel === 'cod' ? t('checkout.placeOrder', { amount: fmt.money(total) }) : t('checkout.pay', { amount: fmt.money(total) })}
          disabled={!enabled} onPress={submit} style={({ pressed }) => [s.payBtn, (!enabled || pressed) && s.payOff]}>
          {busy ? <ActivityIndicator color={colors.onBrandSecondary} /> : <Text style={s.payText}>{sel === 'cod' ? t('checkout.placeOrder', { amount: fmt.money(total) }) : t('checkout.pay', { amount: fmt.money(total) })}</Text>}
        </Pressable>
        <Text style={s.note}><Icon name={sel === 'cod' ? 'cash-outline' : 'lock-closed'} size={11} color={colors.muted} /> {sel === 'cod' ? t('payui.cashNote') : t('payui.online')}</Text>
      </View>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingBottom: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: colors.onSurface },
  subline: { fontSize: 12, color: colors.muted, marginTop: 2 }, save: { color: colors.onSuccess, fontWeight: '700' },
  ribbon: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.warning, paddingHorizontal: 16, minHeight: 32 },
  ribbonText: { color: colors.onWarning, fontSize: 12, fontWeight: '700' },
  scroll: { padding: 16, gap: 12, paddingBottom: 24 },
  center: { alignItems: 'center', gap: 10, padding: 24, minHeight: 120 },
  row: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  rowOn: { borderColor: colors.forest }, rowDead: { opacity: 0.7 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 64 },
  badge: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.limeSoft, alignItems: 'center', justifyContent: 'center' },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  rowSub: { fontSize: 12, color: colors.muted, marginTop: 3, lineHeight: 17 },
  reason: { fontSize: 12, color: colors.onError, marginTop: 3, lineHeight: 17 },
  chip: { backgroundColor: colors.success, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  chipText: { fontSize: 10, fontWeight: '800', color: colors.onSuccess },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface },
  tileOn: { borderColor: colors.forest, backgroundColor: colors.limeSoft },
  glyph: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.limeSoft, alignItems: 'center', justifyContent: 'center' },
  tileText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.onSurface },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: 12, color: colors.onSurfaceTertiary, textDecorationLine: 'underline' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, color: colors.onSurface, backgroundColor: colors.surface },
  error: { fontSize: 12, color: colors.onError, marginTop: 6, lineHeight: 17 },
  phone: { gap: 6 },
  ghost: { minHeight: 44, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: colors.forest, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: colors.forest, fontWeight: '700' },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  payBtn: { backgroundColor: colors.brandSecondary, borderRadius: 999, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  payOff: { opacity: 0.55 },
  payText: { color: colors.onBrandSecondary, fontSize: 16, fontWeight: '800' },
  note: { fontSize: 11, color: colors.muted, lineHeight: 16, textAlign: 'center' },
});
