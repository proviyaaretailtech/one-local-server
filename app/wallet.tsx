import { Fragment, useEffect, useState } from 'react';
import { useFeatures } from '@/src/features';
import { ComingSoon } from '@/src/components/coming-soon';
import { View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '@/src/ui/text';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from '@react-native-vector-icons/ionicons';
import { colors, popBase, radius, soft } from '@/src/theme';
import { useFormat, useLanguage, useTranslation } from '@/src/i18n';
import { AccountLayout, Group, accountStyles as s } from '@/src/components/account-layout';
type Entry = { id: string; amount: number; label: string; date: string };
// Entries are saved on the phone with these English labels (the stored shape is unchanged); the screen shows them in the app language.
const WELCOME_LABEL = 'Sample welcome credit'; // i18n-ignore: stored code, shown as wallet.welcomeCredit
const TOPUP_LABEL = 'Sample top-up'; // i18n-ignore: stored code, shown as wallet.sampleTopUp
function WalletScreen() {
  const { t } = useTranslation(); const fmt = useFormat(); const deva = useLanguage().active.script === 'devanagari';
  const entryLabel = (label: string) => label === WELCOME_LABEL ? t('wallet.welcomeCredit') : label === TOPUP_LABEL ? t('wallet.sampleTopUp') : label;
  const router = useRouter(); const [items, setItems] = useState<Entry[]>([]); const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { AsyncStorage.getItem('onecity-demo-wallet').then(raw => { setItems(raw ? JSON.parse(raw) : [{ id: 'welcome', amount: 250, label: WELCOME_LABEL, date: new Date().toISOString() }]); }).catch(() => setMessage(t('wallet.loadFailed'))).finally(() => setReady(true)); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- runs once; the failure text is read in the language of that moment
  const addDemo = async () => { if (busy || !ready) return; setBusy(true); const next = [{ id: Date.now().toString(), amount: 100, label: TOPUP_LABEL, date: new Date().toISOString() }, ...items]; try { await AsyncStorage.setItem('onecity-demo-wallet', JSON.stringify(next)); setItems(next); setMessage(t('wallet.added', { amount: fmt.money(100) })); } catch { setMessage(t('wallet.saveFailed')); } finally { setBusy(false); } };
  const balance = items.reduce((sum, entry) => sum + entry.amount, 0);
  return <AccountLayout id="wallet" title={t('wallet.title')} fallback="/(tabs)">
    <LinearGradient colors={[colors.forest, colors.walletInk]} style={styles.balanceCard}>
      <View style={styles.circle} />
      <View style={styles.balanceTop}><Icon name="wallet-outline" size={22} color={colors.lime} /><Text testID="wallet-demo-badge" style={[styles.demoBadge, deva && styles.devaBadge]}>{t('wallet.demoBadge')}</Text></View>
      <Text style={styles.balanceLabel}>{t('wallet.balanceLabel')}</Text>
      {ready ? <Text testID="wallet-balance" style={styles.balance}>{fmt.money(balance, { decimals: 0 })}<Text style={styles.decimals}>.00</Text></Text> : <ActivityIndicator color={colors.lime} />}
      <Text style={styles.balanceFoot}>{t('wallet.balanceFoot')}</Text>
    </LinearGradient>
    <View style={styles.actions}>
      <Pressable testID="wallet-add-demo" disabled={!ready || busy} onPress={addDemo} style={styles.action}><View style={s.tile}><Icon name="add-circle-outline" size={22} color={colors.forest} /></View><Text style={styles.actionText}>{busy ? t('wallet.adding') : t('wallet.addDemo', { amount: fmt.money(100) })}</Text></Pressable>
      <Pressable testID="wallet-explore" onPress={() => router.navigate('/categories')} style={styles.action}><View style={s.tile}><Icon name="basket-outline" size={22} color={colors.forest} /></View><Text style={styles.actionText}>{t('wallet.explore')}</Text></Pressable>
    </View>
    {!!message && <Text testID="wallet-feedback" style={styles.message}>{message}</Text>}
    <Text testID="wallet-disclaimer" style={s.hint}>{t('wallet.disclaimer')}</Text>
    <Group>{t('wallet.activity')}</Group>
    <View style={[s.card, styles.entries]}>{items.map((item, i) => <Fragment key={item.id}>
      {i > 0 && <View style={styles.line} />}
      <View testID={`wallet-entry-${item.id}`} style={styles.entry}>
        <View style={s.tile}><Icon name="arrow-down-outline" size={18} color={colors.forest} /></View>
        <View style={s.flex}><Text style={styles.entryTitle}>{entryLabel(item.label)}</Text><Text style={styles.entryDate}>{t('wallet.entryMeta', { date: fmt.date(item.date, 'short') })}</Text></View>
        <Text style={styles.amount}>+{fmt.money(item.amount)}</Text>
      </View>
    </Fragment>)}</View>
  </AccountLayout>;
}
const styles = StyleSheet.create({
  balanceCard: { padding: 24, borderRadius: radius.lg, minHeight: 210, overflow: 'hidden', boxShadow: popBase(5, colors.forestDeep) },
  balanceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  demoBadge: { color: colors.limeSoft, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, backgroundColor: colors.whiteGlass, borderRadius: radius.pill, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6 },
  devaBadge: { fontSize: 11, letterSpacing: 0 },
  balanceLabel: { color: colors.glass, fontSize: 12, marginTop: 24 },
  balance: { color: colors.surface, fontSize: 40, fontWeight: '800', marginTop: 6, letterSpacing: -1 },
  decimals: { fontSize: 22, color: colors.cityMid },
  balanceFoot: { color: colors.cityMid, fontSize: 10, marginTop: 20 },
  circle: { position: 'absolute', width: 190, height: 190, borderRadius: 95, borderWidth: 25, borderColor: colors.whiteGlass, right: -90, bottom: -80 },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1, minHeight: 104, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12, backgroundColor: colors.surface, boxShadow: soft.lifted },
  actionText: { color: colors.forest, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  message: { fontSize: 12, color: colors.forest, lineHeight: 18 },
  entries: { gap: 0, paddingVertical: 6 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  line: { height: 1, backgroundColor: colors.border },
  entryTitle: { fontSize: 14, fontWeight: '700', color: colors.onSurface },
  entryDate: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '800', color: colors.forest },
});
// Live only once its feature is switched on (src/features.ts); otherwise a 'coming soon' screen.
export default function Wallet() { return useFeatures().wallet ? <WalletScreen /> : <ComingSoon feature="wallet" />; }
