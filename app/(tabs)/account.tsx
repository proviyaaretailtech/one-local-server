// "You" tab: who you are on the green card, quick counts, OneLocal Coins (coming soon), preferences that save as you tap,
// and everything account-related in short lists that can be scanned in one glance.
import { type ComponentProps, Fragment, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Text } from '@/src/ui/text';
import { useRouter, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { colors, glassPane, popBase, radius, soft } from '@/src/theme';
import { Diet, useCustomer } from '@/src/customer';
import { useAuth } from '@/src/auth';
import { apiGet, Order } from '@/src/api';
import { OneGlyph } from '@/src/components/one-button';
import { Tap } from '@/src/components/tap';
import { ChipRow } from '@/src/components/chip-row';
import { SoonBadge } from '@/src/components/soon-badge';
import { Group, Message, Wash, accountStyles as a } from '@/src/components/account-layout';
import { Button } from '@/src/ui/button';
import { ListGroup, ListRow } from '@/src/ui/list-row';
import { Sheet } from '@/src/ui/sheet';
import { Toggle } from '@/src/ui/toggle';
import { safeLineHeight, Trans, useFormat, useLanguage, useTranslation } from '@/src/i18n';

// Ids, icons and routes only: the words live in the catalogue (account.group.*, account.rowLabel.*, account.rowSub.*, account.diet.*).
type RowId = 'orders' | 'notifications' | 'bookings' | 'wishlist' | 'profile' | 'addresses' | 'payments' | 'privacy' | 'refer' | 'wallet' | 'help' | 'about';
type Row = { icon: ComponentProps<typeof Icon>['name']; id: RowId; route: Href; soon?: boolean };
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
const DIETS: { id: Diet; dot?: string }[] = [{ id: '' }, { id: 'veg', dot: colors.veg }, { id: 'egg', dot: colors.egg }, { id: 'nonveg', dot: colors.nonVeg }];
const NOTIFY = ['orders', 'offers', 'bookings'] as const;
// Sample earning rule for the teaser only — the real rule is decided with the Coins design (docs/ONELOCAL_COINS_PLAN.md).
const COINS_PER_RUPEE = 1 / 10;

export default function AccountScreen() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { profile, saved, addresses, ready, error, update } = useCustomer();
  const { t } = useTranslation(); const fmt = useFormat(); const { active } = useLanguage();
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
  const save = (patch: Partial<typeof profile>) => { void update({ profile: { ...profile, ...patch } }).catch(() => {}); };
  const signIn = () => router.push('/sign-in?next=/account');

  return <View style={s.screen}>
    <Wash />
    <ScrollView testID="account-screen" contentContainerStyle={[s.content, { paddingTop: insets.top + 14 }]}>
      <Text accessibilityRole="header" style={s.pageTitle}>{t('account.title')}<Text style={s.dot}>.</Text></Text>

      {/* Who you are */}
      <View testID="account-auth-card" style={s.identity}>
        <View pointerEvents="none" style={s.light}><View style={[s.disc, s.discOuter]} /><View style={[s.disc, s.discInner]} /></View>
        <View style={a.row}>
          <Pressable testID="account-avatar" accessibilityLabel={t('account.avatarChange')} onPress={() => router.push('/profile-edit')} style={s.avatar}>
            {profile.photo ? <Image source={profile.photo} style={s.photo} contentFit="cover" /> : initials ? <Text style={s.initials}>{initials}</Text> : <Icon name={`${profile.avatar}-outline` as never} size={30} color={colors.forestDeep} />}
            <View style={s.cam}><Icon name="camera" size={11} color={colors.forest} /></View>
          </Pressable>
          <View style={a.flex}>
            <Text testID="account-name" style={s.name} numberOfLines={1}>{profile.name || t('account.guestName')}</Text>
            <Text testID="account-email" style={s.email} numberOfLines={who || profile.email ? 1 : 2}>{who || profile.email || t('account.guestSub')}</Text>
          </View>
          <Pressable testID="edit-profile-btn" accessibilityLabel={t('account.rowLabel.profile')} onPress={() => router.push('/profile-edit')} style={s.editBtn}><Icon name="create-outline" size={18} color={colors.surface} /></Pressable>
        </View>
        {user ? <View style={s.pill}><View style={s.onlineDot} /><Text testID="account-auth-email" style={s.pillText}>{t('account.signedInPill')}</Text></View>
          : <Pressable testID="account-sign-in-btn" accessibilityRole="button" onPress={signIn} style={({ pressed }) => [s.signIn, pressed && s.signInDown]}>
            <Text style={s.signInText}>{t('account.signInOrCreate')}</Text><Icon name="arrow-forward" size={16} color={colors.forestDeep} />
          </Pressable>}
      </View>

      <View style={s.stats}>
        <Stat id="account-orders-summary" value={orders ? fmt.number(orders.length) : '–'} label={t('account.stat.orders')} onPress={() => router.push('/orders')} />
        <Stat id="account-wishlist-summary" countId="account-wishlist-count" value={fmt.number(saved.length)} label={t('account.stat.saved')} onPress={() => router.push('/wishlist')} />
        <Stat id="account-address-summary" countId="account-address-count" value={fmt.number(addresses.length)} label={t('account.stat.addresses')} onPress={() => router.push('/addresses')} />
      </View>

      {/* OneLocal Coins — coming soon */}
      <View testID="account-coins-card" style={a.card}>
        <View style={a.row}>
          <View style={s.coinBadge}><OneGlyph size={22} /></View>
          <View style={a.flex}><Text style={s.coinTitle}>{t('account.coinsTitle')}</Text><Text style={s.sub}>{t('account.coinsSub')}</Text></View>
          <SoonBadge corner={false} />
        </View>
        {wouldEarn > 0 && <Text testID="account-coins-teaser" style={s.coinTeaser}><Trans i18nKey="account.coinsTeaser" count={delivered.length} values={{ coins: fmt.number(wouldEarn) }} components={{ bold: <Text style={s.coinStrong} /> }} /></Text>}
      </View>

      {/* Preferences — save on tap */}
      <Group>{t('account.preferences')}</Group>
      <View style={a.card}>
        <View style={s.block}>
          <Text style={s.prefLabel}>{t('account.foodPreference')}</Text>
          <ChipRow style={a.chips} contentContainerStyle={a.chipContent} selected={profile.diet || 'any'} onSelect={id => save({ diet: DIETS.find(d => (d.id || 'any') === id)?.id ?? '' })}
            chips={DIETS.map(d => ({ id: d.id || 'any', testID: `pref-diet-${d.id || 'any'}`, label: t(`account.diet.${d.id || 'any'}`), lead: d.dot ? () => <View style={[s.vegMark, { borderColor: d.dot }]}><View style={[s.vegDot, { backgroundColor: d.dot }]} /></View> : undefined }))} />
        </View>
        <View style={s.hr} />
        <Pressable testID="pref-language" accessibilityRole="button" accessibilityLabel={t('account.languageRow', { language: active.nativeName })} onPress={() => router.push('/language')} style={a.row}>
          <Text style={[s.prefLabel, a.flex]}>{t('account.language')}</Text>
          <Text style={s.langName}>{active.nativeName}</Text>
          <Icon name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
        <View style={s.hr} />
        <View style={s.block}>
          <Text style={s.prefLabel}>{t('account.notifyAbout')}</Text>
          {NOTIFY.map(key => <View key={key} style={s.toggleRow}>
            <View style={a.flex}><Text style={s.toggleLabel}>{t(`account.notifyLabel.${key}`)}</Text><Text style={s.sub}>{t(`account.notifySub.${key}`)}</Text></View>
            <Toggle testID={`pref-notify-${key}`} tone="light" tint={colors.forest} accessibilityLabel={t(`account.notifyLabel.${key}`)} value={profile.notifications[key]} onValueChange={v => save({ notifications: { ...profile.notifications, [key]: v } })} />
          </View>)}
        </View>
      </View>

      {!ready && <ActivityIndicator testID="account-loading" color={colors.forest} />}
      <Message id="account-storage-error" text={error} error />

      {GROUPS.map(g => <Fragment key={g.id}>
        <Group>{t(`account.group.${g.id}`)}</Group>
        <ListGroup>{g.rows.map(r => <ListRow key={r.id} testID={`acc-${r.id}`} icon={r.icon} title={t(`account.rowLabel.${r.id}`)} subtitle={t(`account.rowSub.${r.id}`)} onPress={() => router.push(r.route)} trailing={r.soon ? <SoonBadge corner={false} /> : undefined} />)}</ListGroup>
      </Fragment>)}

      {/* Account: who you are, and a clear way out */}
      <Group>{user ? t('account.signedInTitle') : t('account.yourAccount')}</Group>
      {user ? <View testID="account-session-card" style={a.card}>
        <View style={a.row}>
          <View style={a.tile}><Icon name="person-outline" size={20} color={colors.forest} /></View>
          <View style={a.flex}><Text style={s.toggleLabel}>{profile.name || t('account.yourAccount')}</Text><Text testID="account-session-who" style={s.sub} numberOfLines={1}>{who}</Text></View>
        </View>
        <Button testID="sign-out-btn" variant="quiet" tone="danger" icon="log-out-outline" title={t('account.signOut')} onPress={() => { setSignOutError(''); setConfirm(true); }} />
      </View> : <View testID="account-guest-card" style={a.card}>
        <Message id="signed-out-notice" text={signedOut ? t('account.signedOutNotice') : ''} />
        <Text style={a.hint}>{t('account.guestPitch')}</Text>
        <Button testID="account-sign-in-bottom" title={t('account.signInOrCreate')} onPress={signIn} />
      </View>}

      <Sheet testID="sign-out-sheet" visible={confirm} onClose={() => !leaving && setConfirm(false)} title={t('account.signOutTitle')} body={who ? t('account.signOutBodyWho', { who }) : t('account.signOutBody')}>
        <Message id="sign-out-error" text={signOutError} error />
        <Button testID="sign-out-confirm" tone="danger" title={t('account.signOut')} busy={leaving === 'here'} disabled={!!leaving} onPress={() => leave(false)} />
        <Button testID="sign-out-everywhere" variant="quiet" tone="danger" title={t('account.signOutEverywhere')} busy={leaving === 'everywhere'} disabled={!!leaving} onPress={() => leave(true)} />
        <Button testID="sign-out-cancel" variant="quiet" title={t('common.cancel')} disabled={!!leaving} onPress={() => setConfirm(false)} />
      </Sheet>
      <Text testID="account-device-notice" style={s.notice}>{user ? t('account.deviceNoticeUser') : t('account.deviceNoticeGuest')}</Text>
      <Text style={s.tag}>{t('about.madeIn')}</Text>
    </ScrollView>
    {/* The wash's green behind the status bar, so the page scrolls away under it rather than under the clock. */}
    <LinearGradient pointerEvents="none" colors={[colors.cityMid, `${colors.cityMid}00`]} locations={[0.55, 1]} style={[s.statusFade, { height: insets.top + 18 }]} />
  </View>;
}

function Stat({ id, countId, value, label, onPress }: { id: string; countId?: string; value: string; label: string; onPress: () => void }) {
  return <Tap testID={id} onPress={onPress} style={s.stat}><Text testID={countId} style={s.number}>{value}</Text><Text style={s.statLabel}>{label}</Text></Tap>;
}

const AVATAR = 64;
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  content: { gap: 14, paddingHorizontal: 16, paddingBottom: 120 },
  statusFade: { position: 'absolute', top: 0, left: 0, right: 0 },
  pageTitle: { color: colors.onSurface, fontSize: 30, lineHeight: safeLineHeight(30), fontWeight: '800', letterSpacing: -1, marginLeft: 2, marginBottom: 2 },
  dot: { color: colors.forest },
  // The green card, raised on a darker base, with two soft discs of light in its corner.
  identity: { gap: 16, padding: 18, borderRadius: radius.lg, backgroundColor: colors.forest, boxShadow: popBase(5, colors.forestDeep) },
  light: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', borderRadius: radius.lg },
  disc: { position: 'absolute', borderRadius: 999, backgroundColor: colors.surface },
  discOuter: { width: 220, height: 220, right: -80, top: -110, opacity: 0.06 },
  discInner: { width: 130, height: 130, right: -35, top: -65, opacity: 0.07 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.electricLime, boxShadow: popBase(3, colors.forestDeep) },
  photo: { width: AVATAR, height: AVATAR, borderRadius: 22 },
  initials: { color: colors.forestDeep, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  cam: { position: 'absolute', right: -4, bottom: -4, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.forest },
  name: { color: colors.surface, fontSize: 20, lineHeight: 27, fontWeight: '800', letterSpacing: -0.4 },
  email: { color: colors.glass, fontSize: 12, lineHeight: 17, marginTop: 2 },
  editBtn: { ...glassPane, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.whiteGlass },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.electricLime },
  pillText: { color: colors.surface, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  signIn: { minHeight: 50, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18, backgroundColor: colors.electricLime, boxShadow: popBase(4, colors.forestDeep) },
  signInDown: { boxShadow: popBase(1, colors.forestDeep) },
  signInText: { color: colors.forestDeep, fontSize: 15, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, minHeight: 78, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, boxShadow: soft.lifted },
  number: { fontSize: 24, lineHeight: 31, fontWeight: '800', letterSpacing: -0.5, color: colors.forest },
  statLabel: { fontSize: 12, fontWeight: '600', color: colors.muted },
  coinBadge: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forestDeep, boxShadow: popBase(3, colors.electricLime) },
  coinTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800', color: colors.onSurface },
  coinTeaser: { fontSize: 13, lineHeight: 20, color: colors.inkSoft },
  coinStrong: { fontWeight: '800', color: colors.forest },
  sub: { fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 2 },
  block: { gap: 12 },
  prefLabel: { fontSize: 14, lineHeight: 20, fontWeight: '800', color: colors.onSurface },
  // India's veg / egg / non-veg mark: a dot in a square outline, on white even on the picked chip's green.
  vegMark: { width: 14, height: 14, marginLeft: 6, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  vegDot: { width: 6, height: 6, borderRadius: 3 },
  hr: { height: 1, backgroundColor: colors.border },
  langName: { fontSize: 14, fontWeight: '600', color: colors.forest, flexShrink: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  toggleLabel: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: colors.onSurface },
  notice: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 4 },
  tag: { color: colors.forest, fontSize: 11, fontWeight: '600', textAlign: 'center' },
});
