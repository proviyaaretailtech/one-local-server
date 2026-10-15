// "You" tab: identity, quick stats, OneLocal Coins (coming soon), preferences that save as you tap,
// and everything account-related grouped so it can be scanned in one glance.
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Switch, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import Icon from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { colors } from '@/src/theme';
import { Diet, useCustomer } from '@/src/customer';
import { useAuth } from '@/src/auth';
import { apiGet, Order } from '@/src/api';
import { OneGlyph } from '@/src/components/one-button';
import { CornerGlow } from '@/src/components/corner-glow';
import { Tap } from '@/src/components/tap';
import { Trans, useFormat, useLanguage, useTranslation } from '@/src/i18n';

const INK = '#050605';
// Ids, icons and routes only: the words live in the catalogue (account.group.*, account.rowLabel.*, account.rowSub.*, account.diet.*).
type RowId = 'orders' | 'notifications' | 'bookings' | 'wishlist' | 'profile' | 'addresses' | 'payments' | 'privacy' | 'refer' | 'wallet' | 'help' | 'about';
type Row = { icon: string; id: RowId; route: string; soon?: boolean };
const GROUPS: { id: 'orders' | 'account' | 'rewards' | 'help'; rows: Row[] }[] = [
  { id: 'orders', rows: [
    { icon: 'receipt-outline', id: 'orders', route: '/orders' },
    { icon: 'notifications-outline', id: 'notifications', route: '/notifications' },
    { icon: 'ticket-outline', id: 'bookings', route: '/enquiries' },
    { icon: 'heart-outline', id: 'wishlist', route: '/wishlist' },
  ] },
  { id: 'account', rows: [
    { icon: 'person-circle-outline', id: 'profile', route: '/profile-edit' },
    { icon: 'location-outline', id: 'addresses', route: '/addresses' },
    { icon: 'card-outline', id: 'payments', route: '/payments' },
    { icon: 'shield-checkmark-outline', id: 'privacy', route: '/privacy' },
  ] },
  { id: 'rewards', rows: [
    { icon: 'gift-outline', id: 'refer', route: '/refer' },
    { icon: 'wallet-outline', id: 'wallet', route: '/wallet', soon: true },
  ] },
  { id: 'help', rows: [
    { icon: 'help-circle-outline', id: 'help', route: '/help' },
    { icon: 'information-circle-outline', id: 'about', route: '/about' },
  ] },
];
const DIETS: { id: Diet; dot?: string }[] = [{ id: '' }, { id: 'veg', dot: '#1B8A3A' }, { id: 'egg', dot: '#D99A00' }, { id: 'nonveg', dot: '#B3261E' }];
const NOTIFY = ['orders', 'offers', 'bookings'] as const;
// Sample earning rule for the teaser only — the real rule is decided with the Coins design (docs/ONELOCAL_COINS_PLAN.md).
const COINS_PER_RUPEE = 1 / 10;

export default function AccountScreen() {
  const router = useRouter(); const { profile, saved, addresses, ready, error, update } = useCustomer();
  const { t } = useTranslation(); const fmt = useFormat(); const { active } = useLanguage(); const deva = active.script === 'devanagari';
  const auth = useAuth(); const user = auth.session?.user;
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [confirm, setConfirm] = useState(false); const [leaving, setLeaving] = useState<'' | 'here' | 'everywhere'>(''); const [signOutError, setSignOutError] = useState(''); const [signedOut, setSignedOut] = useState(false);
  const who = user?.email || user?.phone && `+${user.phone.replace(/^\+/, '')}` || '';
  const leave = async (everywhere: boolean) => {
    setLeaving(everywhere ? 'everywhere' : 'here'); setSignOutError('');
    try { await auth.signOut(everywhere); setConfirm(false); setSignedOut(true); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
    catch (e) { setSignOutError((e as Error).message); }
    finally { setLeaving(''); }
  };
  useEffect(() => { apiGet<Order[]>('/orders').then(setOrders).catch(() => setOrders([])); }, [user?.id]);
  const delivered = (orders ?? []).filter(o => o.status !== 'cancelled');
  const wouldEarn = Math.floor(delivered.reduce((s, o) => s + o.total, 0) * COINS_PER_RUPEE);
  const initials = (profile.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const groupTitle = [s.groupTitle, deva && s.noTrack];
  const save = (patch: Partial<typeof profile>) => { void Haptics.selectionAsync().catch(() => {}); void update({ profile: { ...profile, ...patch } }).catch(() => {}); };

  return <ScrollView testID="account-screen" style={s.screen} contentContainerStyle={s.content}>
    {/* Identity */}
    <View testID="account-auth-card" style={s.identity}>
      <View style={s.glow} />
      <View style={s.identityTop}>
        <Pressable testID="account-avatar" accessibilityLabel={t('account.avatarChange')} onPress={() => router.push('/profile-edit')} style={s.avatar}>
          {profile.photo ? <Image source={profile.photo} style={s.photo} contentFit="cover" /> : initials ? <Text style={s.initials}>{initials}</Text> : <Icon name={`${profile.avatar}-outline` as any} size={30} color={INK} />}
          <View style={s.cam}><Icon name="camera" size={11} color={INK} /></View>
        </Pressable>
        <View style={s.flex}>
          <Text testID="account-name" style={s.name} numberOfLines={1}>{profile.name || t('account.guestName')}</Text>
          <Text testID="account-email" style={s.email} numberOfLines={who || profile.email ? 1 : 2}>{who || profile.email || t('account.guestSub')}</Text>
        </View>
        <Pressable testID="edit-profile-btn" accessibilityLabel={t('account.rowLabel.profile')} onPress={() => router.push('/profile-edit')} style={s.editBtn}><Icon name="create-outline" size={18} color={colors.electricLime} /></Pressable>
      </View>
      {user ? <View style={s.authRow}>
        <View style={s.pill}><View style={s.onlineDot} /><Text testID="account-auth-email" style={s.pillText}>{t('account.signedInPill')}</Text></View>
      </View> : <Pressable testID="account-sign-in-btn" accessibilityRole="button" onPress={() => router.push('/sign-in?next=/account' as never)} style={s.signIn}>
        <Text style={s.signInText}>{t('account.signInOrCreate')}</Text><Icon name="arrow-forward" size={16} color={INK} />
      </Pressable>}
    </View>

    {/* Stats */}
    <View style={s.stats}>
      <Stat id="account-orders-summary" value={orders ? String(orders.length) : '–'} label={t('account.stat.orders')} onPress={() => router.push('/orders')} />
      <Stat id="account-wishlist-summary" countId="account-wishlist-count" value={String(saved.length)} label={t('account.stat.saved')} onPress={() => router.push('/wishlist')} />
      <Stat id="account-address-summary" countId="account-address-count" value={String(addresses.length)} label={t('account.stat.addresses')} onPress={() => router.push('/addresses')} />
    </View>

    {/* OneLocal Coins — coming soon */}
    <View testID="account-coins-card" style={s.coins}>
      <View style={s.coinRow}>
        <View style={s.coinBadge}><OneGlyph size={22} /></View>
        <View style={s.flex}><Text style={s.coinTitle}>{t('account.coinsTitle')}</Text><Text style={s.coinSub}>{t('account.coinsSub')}</Text></View>
        <View style={s.soonDark}><Text style={[s.soonDarkText, deva && s.devaSoon]}>{t('common.soon').toUpperCase()}</Text></View>
      </View>
      {wouldEarn > 0 && <Text testID="account-coins-teaser" style={s.coinTeaser}><Trans i18nKey="account.coinsTeaser" count={delivered.length} values={{ coins: fmt.number(wouldEarn) }} components={{ bold: <Text style={s.coinStrong} /> }} /></Text>}
    </View>

    {/* Preferences — save on tap */}
    <Text style={groupTitle}>{t('account.preferences')}</Text>
    <View style={s.card}>
      <CornerGlow color={colors.lime} corner="top-right" size={220} strength={0.18} />
      <Text style={s.prefLabel}>{t('account.foodPreference')}</Text>
      <View style={s.chips}>{DIETS.map(d => <Pressable key={d.id || 'any'} testID={`pref-diet-${d.id || 'any'}`} accessibilityRole="radio" accessibilityState={{ selected: profile.diet === d.id }} onPress={() => save({ diet: d.id })} style={[s.chip, profile.diet === d.id && s.chipOn]}>
        {!!d.dot && <View style={[s.vegDot, { borderColor: d.dot }]}><View style={[s.vegInner, { backgroundColor: d.dot }]} /></View>}<Text style={[s.chipText, profile.diet === d.id && s.chipTextOn]}>{t(`account.diet.${d.id || 'any'}`)}</Text>
      </Pressable>)}</View>
      <View style={s.hr} />
      <Pressable testID="pref-language" accessibilityRole="button" accessibilityLabel={t('account.languageRow', { language: active.nativeName })} onPress={() => router.push('/language' as never)} style={({ pressed }) => [s.langRow, pressed && s.pressed]}>
        <Text style={[s.prefLabel, s.langLabel]}>{t('account.language')}</Text>
        <Text style={s.langName}>{active.nativeName}</Text>
        <Icon name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>
      <View style={s.hr} />
      <Text style={s.prefLabel}>{t('account.notifyAbout')}</Text>
      {NOTIFY.map(key => <View key={key} style={s.toggleRow}>
        <View style={s.flex}><Text style={s.toggleLabel}>{t(`account.notifyLabel.${key}`)}</Text><Text style={s.sub}>{t(`account.notifySub.${key}`)}</Text></View>
        <Switch testID={`pref-notify-${key}`} value={profile.notifications[key]} onValueChange={v => save({ notifications: { ...profile.notifications, [key]: v } })} trackColor={{ true: colors.forest, false: colors.borderStrong }} thumbColor={colors.surface} />
      </View>)}
    </View>

    {!ready && <ActivityIndicator testID="account-loading" color={colors.forest} />}{!!error && <Text testID="account-storage-error" style={s.error}>{error}</Text>}

    {GROUPS.map(g => <View key={g.id}>
      <Text style={groupTitle}>{t(`account.group.${g.id}`)}</Text>
      <View style={s.rows}><CornerGlow color={colors.lime} corner="bottom-left" size={200} strength={0.12} />{g.rows.map((r, i) => <Tap key={r.id} testID={`acc-${r.id}`} onPress={() => router.push(r.route as any)} glow={false} style={[s.row, i === g.rows.length - 1 && s.rowLast]}>
        <View style={s.icon}><Icon name={r.icon as any} size={20} color={colors.forest} /></View>
        <View style={s.flex}><Text testID={`acc-${r.id}-label`} style={s.label}>{t(`account.rowLabel.${r.id}`)}</Text><Text style={s.sub}>{t(`account.rowSub.${r.id}`)}</Text></View>
        {r.soon ? <View style={s.soon}><Text style={[s.soonText, deva && s.devaSoon]}>{t('common.soon').toUpperCase()}</Text></View> : <Icon name="chevron-forward" size={18} color={colors.muted} />}
      </Tap>)}</View>
    </View>)}

    {/* Account: who you are, and a clear way out */}
    <Text style={groupTitle}>{user ? t('account.signedInTitle') : t('account.yourAccount')}</Text>
    {user ? <View testID="account-session-card" style={s.session}>
      <View style={s.sessionRow}>
        <View style={s.sessionIcon}><Icon name="person-outline" size={20} color={colors.forest} /></View>
        <View style={s.flex}><Text style={s.label}>{profile.name || t('account.yourAccount')}</Text><Text testID="account-session-who" style={s.sub} numberOfLines={1}>{who}</Text></View>
      </View>
      <Pressable testID="sign-out-btn" accessibilityRole="button" accessibilityLabel={t('account.signOut')} onPress={() => { setSignOutError(''); setConfirm(true); }} style={s.signOut}>
        <Icon name="log-out-outline" size={19} color={colors.onError} /><Text style={s.signOutText}>{t('account.signOut')}</Text>
      </Pressable>
    </View> : <View testID="account-guest-card" style={s.session}>
      {signedOut && <View testID="signed-out-notice" style={s.signedOut}><Icon name="checkmark-circle" size={18} color={colors.forest} /><Text style={s.signedOutText}>{t('account.signedOutNotice')}</Text></View>}
      <Text style={s.sub}>{t('account.guestPitch')}</Text>
      <Pressable testID="account-sign-in-bottom" accessibilityRole="button" onPress={() => router.push('/sign-in?next=/account' as never)} style={s.signInBottom}><Text style={s.signInText}>{t('account.signInOrCreate')}</Text><Icon name="arrow-forward" size={16} color={INK} /></Pressable>
    </View>}

    <Modal transparent visible={confirm} animationType="fade" onRequestClose={() => setConfirm(false)}>
      <Pressable style={s.overlay} onPress={() => !leaving && setConfirm(false)}>
        <Pressable testID="sign-out-sheet" style={s.sheet} onPress={() => {}}>
          <Text style={s.sheetTitle}>{t('account.signOutTitle')}</Text>
          <Text style={s.sheetBody}>{who ? t('account.signOutBodyWho', { who }) : t('account.signOutBody')}</Text>
          {!!signOutError && <Text testID="sign-out-error" style={s.error}>{signOutError}</Text>}
          <Pressable testID="sign-out-confirm" disabled={!!leaving} onPress={() => leave(false)} style={s.sheetDanger}>
            {leaving === 'here' ? <ActivityIndicator color="#fff" /> : <Text style={s.sheetDangerText}>{t('account.signOut')}</Text>}
          </Pressable>
          <Pressable testID="sign-out-everywhere" disabled={!!leaving} onPress={() => leave(true)} style={s.sheetSecondary}>
            {leaving === 'everywhere' ? <ActivityIndicator color={colors.onError} /> : <Text style={s.sheetSecondaryText}>{t('account.signOutEverywhere')}</Text>}
          </Pressable>
          <Pressable testID="sign-out-cancel" disabled={!!leaving} onPress={() => setConfirm(false)} style={s.sheetCancel}><Text style={s.sheetCancelText}>{t('common.cancel')}</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
    <Text testID="account-device-notice" style={s.notice}>{user ? t('account.deviceNoticeUser') : t('account.deviceNoticeGuest')}</Text>
    <Text style={s.tag}>{t('about.madeIn')}</Text>
  </ScrollView>;
}

function Stat({ id, countId, value, label, onPress }: { id: string; countId?: string; value: string; label: string; onPress: () => void }) {
  return <Tap testID={id} onPress={onPress} radius={20} style={s.stat}><Text testID={countId} style={s.number}>{value}</Text><Text style={s.statLabel}>{label}</Text></Tap>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary }, content: { padding: 16, paddingBottom: 120 }, flex: { flex: 1 },
  identity: { backgroundColor: INK, borderRadius: 28, padding: 18, overflow: 'hidden' },
  glow: { position: 'absolute', right: -50, top: -70, width: 180, height: 180, borderRadius: 90, backgroundColor: colors.lime, opacity: 0.14 },
  identityTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 64, height: 64, borderRadius: 24, backgroundColor: colors.electricLime, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 64, height: 64, borderRadius: 24 },
  initials: { color: INK, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  cam: { position: 'absolute', right: -3, bottom: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: INK },
  name: { color: '#fff', fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  email: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 3 },
  editBtn: { width: 44, height: 44, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  authRow: { marginTop: 16 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)' },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.electricLime },
  pillText: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600', flexShrink: 1 },
  signIn: { marginTop: 16, minHeight: 48, borderRadius: 16, backgroundColor: colors.electricLime, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  signInText: { color: INK, fontSize: 14, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: 10, marginTop: 12 },
  stat: { flex: 1, minHeight: 72, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  number: { fontSize: 22, fontWeight: '800', color: colors.onSurface },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2, fontWeight: '600' },
  coins: { marginTop: 12, borderRadius: 22, padding: 16, backgroundColor: colors.limeSoft, borderWidth: 1, borderColor: colors.cityMid },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coinBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  coinTitle: { fontSize: 15, fontWeight: '800', color: colors.onSurface },
  coinSub: { fontSize: 11, color: colors.inkSoft, marginTop: 2, lineHeight: 16 },
  coinTeaser: { fontSize: 12, color: colors.inkSoft, marginTop: 12, lineHeight: 18 },
  coinStrong: { fontWeight: '800', color: colors.forest },
  soonDark: { backgroundColor: INK, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  soonDarkText: { color: colors.electricLime, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  devaSoon: { fontSize: 11, letterSpacing: 0 }, // 9 px Devanagari is unreadable; no tracking
  noTrack: { letterSpacing: 0 }, // Devanagari: letter-spacing pulls conjuncts and matras apart
  groupTitle: { fontSize: 12, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 22, marginBottom: 8, marginLeft: 6 },
  card: { backgroundColor: colors.surface, borderRadius: 22, padding: 16, overflow: 'hidden' },
  prefLabel: { fontSize: 13, fontWeight: '700', color: colors.onSurface, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface },
  chipOn: { backgroundColor: INK, borderColor: INK },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.onSurface },
  chipTextOn: { color: colors.electricLime },
  langRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  langLabel: { flex: 1, marginBottom: 0 },
  langName: { fontSize: 14, fontWeight: '600', color: colors.onSurface, flexShrink: 1 },
  vegDot: { width: 12, height: 12, borderWidth: 1.5, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  vegInner: { width: 5, height: 5, borderRadius: 3 },
  hr: { height: 1, backgroundColor: colors.divider, marginVertical: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  rows: { backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLast: { borderBottomWidth: 0 },
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.limeSoft, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  sub: { fontSize: 11, color: colors.muted, lineHeight: 16, marginTop: 2 },
  soon: { backgroundColor: colors.surfaceSecondary, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  soonText: { fontSize: 9, fontWeight: '800', color: colors.muted, letterSpacing: 1 },
  session: { backgroundColor: colors.surface, borderRadius: 22, padding: 16, gap: 14 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sessionIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.limeSoft, alignItems: 'center', justifyContent: 'center' },
  signOut: { minHeight: 52, borderRadius: 16, borderWidth: 1.5, borderColor: colors.onError, backgroundColor: colors.error, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  signOutText: { color: colors.onError, fontSize: 15, fontWeight: '800' },
  signInBottom: { minHeight: 52, borderRadius: 16, backgroundColor: colors.electricLime, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  signedOut: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.limeSoft },
  signedOutText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.forest, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 34, gap: 10 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.onSurface },
  sheetBody: { fontSize: 14, lineHeight: 20, color: colors.muted, marginBottom: 6 },
  sheetDanger: { minHeight: 52, borderRadius: 16, backgroundColor: colors.onError, alignItems: 'center', justifyContent: 'center' },
  sheetDangerText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  sheetSecondary: { minHeight: 48, borderRadius: 16, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  sheetSecondaryText: { color: colors.onError, fontSize: 14, fontWeight: '700' },
  sheetCancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  sheetCancelText: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  notice: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 18, lineHeight: 16 },
  tag: { color: colors.forest, fontSize: 11, textAlign: 'center', marginTop: 8, fontWeight: '600' },
  error: { color: colors.onError, margin: 16 }, pressed: { opacity: 0.6 },
});
