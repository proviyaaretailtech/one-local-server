// Privacy & your data (DPDP Act; docs/DPDP.md). One place to: switch optional consents on and off
// (each change recorded with the time and notice version), download your data, correct it, delete
// your account, nominate someone, raise a grievance, and read the notice. Guests see what is kept
// on this phone and can clear it; the account-level rights need sign-in, so we know it is you.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { AccountLayout, ActionButton, Message, accountStyles as s } from '@/src/components/account-layout';
import { colors } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { useCustomer } from '@/src/customer';
import { useCart } from '@/src/cart';
import { apiPost } from '@/src/api';
import { localeMeta, useFormat, useTranslation } from '@/src/i18n';
import {
  buildDownload, clearPhone, deliverDownload, keptByLawText, noticeDateText, PhoneEntry, phoneSummary, Problem, problemText, pullConsents, purposeText, usePrivacyChoices,
} from '@/src/privacy';
import { isPlaceholder, OPTIONAL_PURPOSES, PRIVACY } from '@/constants/privacy';

type Panel = '' | 'grievance' | 'correction' | 'nominee';
type Receipt = { reference: string; due_at: string | null; respond_within_days: number };
// What the screen tells the person after an action. Kept as facts, not as a sentence, so it is written in the
// language they have chosen when it is shown.
type Note = { kind: 'ready'; name: string; reference: string } | { kind: 'readyPhone'; name: string } | { kind: 'cleared' };
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`); // i18n-ignore: file-size units
const tap = () => void Haptics.selectionAsync().catch(() => {});

const DELETED_NOW = ['privacy.deleteSheet.nowAddresses', 'privacy.deleteSheet.nowRequests', 'privacy.deleteSheet.nowPhone', 'privacy.deleteSheet.nowConsents', 'privacy.deleteSheet.nowLogin'] as const;

// A small heading above a card. Devanagari reads badly with letter-spacing, so it is dropped for Hindi.
function Group({ children }: { children: string }) {
  const { i18n } = useTranslation();
  const deva = localeMeta(i18n.resolvedLanguage ?? 'en').script === 'devanagari';
  return <Text style={[st.group, deva && st.groupDeva]}>{children}</Text>;
}

export default function PrivacyScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const fmt = useFormat();
  const { open } = useLocalSearchParams<{ open?: string }>();
  const auth = useAuth(); const user = auth.session?.user;
  const customer = useCustomer(); const cart = useCart();
  const choices = usePrivacyChoices();
  const who = user?.email || (user?.phone ? `+${user.phone.replace(/^\+/, '')}` : '');

  const [panel, setPanel] = useState<Panel>(open === 'grievance' || open === 'nominee' || open === 'correction' ? open : '');
  const [phone, setPhone] = useState<PhoneEntry[] | null>(null);
  const [busy, setBusy] = useState<'' | 'download' | 'clear' | 'delete'>('');
  const [note, setNote] = useState<Note | null>(null); const [error, setError] = useState<Problem | null>(null);
  const [confirm, setConfirm] = useState<'' | 'clear' | 'delete'>('');
  const [erased, setErased] = useState<{ reference: string; message: string; login?: string } | null>(null);

  const refreshPhone = () => { void phoneSummary().then(setPhone).catch(() => setPhone([])); };
  // Again whenever a choice is saved (it is stored on the phone too).
  useEffect(refreshPhone, [choices.history.length]);
  useEffect(() => { if (user?.id) void pullConsents(); }, [user?.id]);
  const signIn = () => router.push('/sign-in?next=/privacy' as never);

  const toggle = (purpose: (typeof OPTIONAL_PURPOSES)[number], value: boolean) => {
    tap(); void choices.set(purpose, value);
    // "Offers near me" on the You tab is a marketing message too: withdrawing here switches it off.
    if (purpose === 'marketing' && !value && customer.profile.notifications.offers) {
      void customer.update({ profile: { ...customer.profile, notifications: { ...customer.profile.notifications, offers: false } } }).catch(() => {});
    }
  };
  const lastChange = (purpose: string) => [...choices.history].reverse().find(c => c.purpose === purpose);

  const download = async () => {
    setError(null); setNote(null); setBusy('download');
    try {
      const { file, reference } = await buildDownload(!!user);
      const name = await deliverDownload(file);
      setNote(reference ? { kind: 'ready', name, reference } : { kind: 'readyPhone', name });
    } catch (e) { setError({ key: 'privacy.err.prepare', cause: e }); }
    finally { setBusy(''); refreshPhone(); }
  };

  const clearThisPhone = async () => {
    setBusy('clear'); setError(null);
    try {
      await clearPhone(); await customer.reset(); cart.clear();
      setConfirm(''); setNote({ kind: 'cleared' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch { setError({ key: 'privacy.err.clear' }); }
    // The emptied cart saves itself a moment later (an empty cart, nothing personal); list after that.
    finally { setBusy(''); setTimeout(refreshPhone, 600); }
  };

  const deleteAccount = async () => {
    setBusy('delete'); setError(null);
    try {
      const result = await apiPost<{ reference: string; message: string; login?: string }>('/privacy/erasure', { confirm: 'DELETE' });
      await auth.signOut(false).catch(() => {});
      await clearPhone().catch(() => {}); await customer.reset().catch(() => {}); cart.clear();
      setConfirm(''); setErased(result); setPanel('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) { setError({ key: 'privacy.err.delete', cause: e }); }
    finally { setBusy(''); refreshPhone(); }
  };

  const noteText = !note ? '' : note.kind === 'ready' ? t('privacy.note.ready', { name: note.name, reference: note.reference })
    : note.kind === 'readyPhone' ? t('privacy.note.readyPhone', { name: note.name }) : t('privacy.note.cleared');
  const errorText = error ? problemText(error) : '';
  // The server says which way the erasure ended; the sentence is written here, in the person's language.
  const erasedText = !erased ? '' : erased.login === undefined ? erased.message
    : erased.login === 'deleted' ? t('privacy.erased.deleted') : t('privacy.erased.loginKept', { days: PRIVACY.responseDays, reference: erased.reference });
  const kept = keptByLawText();
  const board = t('privacyNotice.boardName');

  return <AccountLayout id="privacy" title={t('privacy.title')} subtitle={t('privacy.subtitle')}>
    {erased && <View testID="privacy-erased" style={[s.card, st.done]}>
      <Icon name="checkmark-circle" size={28} color={colors.forest} />
      <Text style={s.title}>{t('privacy.erased.title')}</Text>
      <Text selectable style={s.hint}>{erasedText}</Text>
      <Text selectable testID="privacy-erased-reference" style={st.reference}>{t('privacy.reference', { reference: erased.reference })}</Text>
    </View>}

    <View testID="privacy-who" style={[s.card, st.whoCard]}>
      <View style={s.row}>
        <View style={st.icon}><Icon name={user ? 'person-outline' : 'phone-portrait-outline'} size={18} color={colors.forest} /></View>
        <View style={s.flex}>
          <Text style={st.itemTitle}>{user ? t('privacy.who.signedIn') : t('privacy.who.guest')}</Text>
          {user
            ? <Text style={s.hint}>{t('privacy.who.signedInNote', { who })}</Text>
            : <Text style={s.hint}>{t('privacy.who.guestNote')}</Text>}
        </View>
      </View>
      {!user && <Pressable testID="privacy-sign-in" accessibilityRole="button" onPress={signIn} style={st.secondary}><Text style={st.secondaryText}>{t('privacy.who.signInButton')}</Text></Pressable>}
    </View>

    <Group>{t('privacy.group.choices')}</Group>
    <View testID="privacy-choices" style={s.card}>
      {OPTIONAL_PURPOSES.map((p, i) => {
        const last = lastChange(p);
        const text = purposeText(p);
        return <View key={p} style={[st.toggleRow, i > 0 && st.divided]}>
          <View style={s.flex}>
            <Text style={st.itemTitle}>{text.title}</Text>
            <Text style={s.hint}>{text.body}</Text>
            {last && <Text testID={`consent-${p}-changed`} style={st.meta}>{t(last.granted ? 'privacy.choiceOn' : 'privacy.choiceOff', { when: fmt.dateTime(last.at), version: last.notice_version })}</Text>}
          </View>
          <Switch testID={`consent-${p}`} accessibilityLabel={text.title} disabled={!choices.ready} value={choices.current[p]} onValueChange={v => toggle(p, v)}
            trackColor={{ true: colors.forest, false: colors.borderStrong }} thumbColor={colors.surface} />
        </View>;
      })}
      <Text testID="privacy-choices-note" style={st.meta}>
        {user ? (choices.unsent ? t('privacy.choicesNote.unsent', { count: choices.unsent }) : t('privacy.choicesNote.synced')) : t('privacy.choicesNote.phoneOnly')}
        {' '}{t('privacy.choicesNote.needed')}
      </Text>
    </View>

    <Group>{t('privacy.group.data')}</Group>
    <View testID="privacy-actions" style={[s.card, st.rows]}>
      <Row id="privacy-download" icon="download-outline" title={t('privacy.rows.downloadTitle')} sub={user ? t('privacy.rows.downloadSubUser') : t('privacy.rows.downloadSubGuest')} busy={busy === 'download'} onPress={download} />
      <Row id="privacy-correct" icon="create-outline" title={t('privacy.rows.correctTitle')} sub={t('privacy.rows.correctSub')} onPress={() => router.push('/profile-edit')} />
      <Row id="privacy-correct-ask" icon="construct-outline" title={t('privacy.rows.correctAskTitle')} sub={t('privacy.rows.correctAskSub')} locked={!user} onPress={() => (user ? setPanel(panel === 'correction' ? '' : 'correction') : signIn())} />
      <Row id="privacy-nominee" icon="people-outline" title={t('privacy.rows.nomineeTitle')} sub={t('privacy.rows.nomineeSub')} locked={!user} onPress={() => (user ? setPanel(panel === 'nominee' ? '' : 'nominee') : signIn())} />
      <Row id="privacy-grievance" icon="chatbubble-ellipses-outline" title={t('privacy.rows.grievanceTitle')} sub={t('privacy.rows.grievanceSub', { days: PRIVACY.responseDays })} locked={!user} onPress={() => (user ? setPanel(panel === 'grievance' ? '' : 'grievance') : signIn())} />
      <Row id="privacy-notice-link" icon="document-text-outline" title={t('privacy.rows.noticeTitle')} sub={t('privacy.rows.noticeSub', { version: PRIVACY.noticeVersion, date: noticeDateText(fmt) })} last onPress={() => router.push('/privacy-notice' as never)} />
    </View>
    <Message id="privacy-note" text={noteText} />
    <Message id="privacy-error" text={errorText} error />

    {user && panel === 'grievance' && <RequestForm key="grievance" kind="grievance" onClose={() => setPanel('')} />}
    {user && panel === 'correction' && <RequestForm key="correction" kind="correction" onClose={() => setPanel('')} />}
    {user && panel === 'nominee' && <NomineeForm onClose={() => setPanel('')} />}

    <Group>{t('privacy.group.phone')}</Group>
    <View testID="privacy-phone" style={s.card}>
      {phone === null ? <ActivityIndicator color={colors.forest} /> : phone.length === 0
        ? <Text testID="privacy-phone-empty" style={s.hint}>{t('privacy.phone.empty')}</Text>
        : phone.map(e => <View key={e.id} style={st.phoneRow}>
            <Icon name={e.secret ? 'key-outline' : 'document-outline'} size={16} color={colors.muted} />
            <Text style={[s.hint, s.flex]}>{t(`privacy.phoneItem.${e.id}`)}</Text>
            <Text style={st.meta}>{e.secret ? t('privacy.phone.private') : size(e.bytes)}</Text>
          </View>)}
      {!user && !!phone?.length && <Pressable testID="privacy-clear-phone" accessibilityRole="button" onPress={() => { setError(null); setConfirm('clear'); }} style={st.outlineDanger}>
        <Icon name="trash-outline" size={17} color={colors.onError} /><Text style={st.outlineDangerText}>{t('privacy.phone.clear')}</Text>
      </Pressable>}
      {!!user && <Text style={st.meta}>{t('privacy.phone.signedInNote')}</Text>}
    </View>

    {!!user && <>
      <Group>{t('privacy.deleteAccount')}</Group>
      <View testID="privacy-delete-card" style={s.card}>
        <Text style={s.hint}>{t('privacy.deleteCard.body')}</Text>
        <Pressable testID="privacy-delete" accessibilityRole="button" onPress={() => { setError(null); setConfirm('delete'); }} style={st.outlineDanger}>
          <Icon name="person-remove-outline" size={17} color={colors.onError} /><Text style={st.outlineDangerText}>{t('privacy.deleteAccount')}</Text>
        </Pressable>
      </View>
    </>}

    <View testID="privacy-contact" style={[s.card, st.contact]}>
      <Text style={st.itemTitle}>{t('privacy.contact.title')}</Text>
      <Text style={s.hint}>{t('privacy.contact.officer')} <Text style={isPlaceholder(PRIVACY.grievanceOfficer.name) ? st.todo : st.strong}>{PRIVACY.grievanceOfficer.name}</Text></Text>
      <Text style={s.hint}>{t('privacy.contact.email')} <Text style={isPlaceholder(PRIVACY.grievanceOfficer.email) ? st.todo : st.strong}>{PRIVACY.grievanceOfficer.email}</Text></Text>
      <Text style={s.hint}>{t('privacy.contact.phone')} <Text style={isPlaceholder(PRIVACY.grievanceOfficer.phone) ? st.todo : st.strong}>{PRIVACY.grievanceOfficer.phone}</Text> · {t('privacy.officerHours')}</Text>
      <Text style={s.hint}>{t('privacy.contact.board', { board })}</Text>
    </View>

    <Modal transparent visible={confirm === 'delete'} animationType="fade" onRequestClose={() => !busy && setConfirm('')}>
      <Pressable style={st.overlay} onPress={() => !busy && setConfirm('')}>
        <Pressable testID="privacy-delete-sheet" style={st.sheet} onPress={() => {}}><ScrollView contentContainerStyle={st.sheetScroll}>
          <Text style={st.sheetTitle}>{t('privacy.deleteSheet.title')}</Text>
          <Text style={st.sheetBody}>{t('privacy.deleteSheet.undone')}{who ? ` ${t('privacy.deleteSheet.signedInAs', { who })}` : ''}</Text>
          <Text style={st.sheetHead}>{t('privacy.deleteSheet.nowHead')}</Text>
          {DELETED_NOW.map(line =>
            <Text key={line} style={st.sheetLine}>•  {t(line)}</Text>)}
          <Text style={st.sheetHead}>{t('privacy.deleteSheet.keptHead')}</Text>
          {kept.map(line => <Text key={line.id} style={st.sheetLine}>•  {line.text}</Text>)}
          {!!errorText && <Text testID="privacy-delete-error" style={st.sheetError}>{errorText}</Text>}
          <Pressable testID="privacy-delete-confirm" disabled={!!busy} onPress={deleteAccount} style={st.sheetDanger}>
            {busy === 'delete' ? <ActivityIndicator color="#fff" /> : <Text style={st.sheetDangerText}>{t('privacy.deleteAccount')}</Text>}
          </Pressable>
          <Pressable testID="privacy-delete-cancel" disabled={!!busy} onPress={() => setConfirm('')} style={st.sheetCancel}><Text style={st.sheetCancelText}>{t('privacy.deleteSheet.keep')}</Text></Pressable>
        </ScrollView></Pressable>
      </Pressable>
    </Modal>

    <Modal transparent visible={confirm === 'clear'} animationType="fade" onRequestClose={() => !busy && setConfirm('')}>
      <Pressable style={st.overlay} onPress={() => !busy && setConfirm('')}>
        <Pressable testID="privacy-clear-sheet" style={st.sheet} onPress={() => {}}>
          <Text style={st.sheetTitle}>{t('privacy.clearSheet.title')}</Text>
          <Text style={st.sheetBody}>{t('privacy.clearSheet.body')}</Text>
          {!!errorText && <Text style={st.sheetError}>{errorText}</Text>}
          <Pressable testID="privacy-clear-confirm" disabled={!!busy} onPress={clearThisPhone} style={st.sheetDanger}>
            {busy === 'clear' ? <ActivityIndicator color="#fff" /> : <Text style={st.sheetDangerText}>{t('privacy.clearSheet.confirm')}</Text>}
          </Pressable>
          <Pressable testID="privacy-clear-cancel" disabled={!!busy} onPress={() => setConfirm('')} style={st.sheetCancel}><Text style={st.sheetCancelText}>{t('common.cancel')}</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  </AccountLayout>;
}

function Row({ id, icon, title, sub, onPress, busy, locked, last }: { id: string; icon: string; title: string; sub: string; onPress: () => void; busy?: boolean; locked?: boolean; last?: boolean }) {
  const { t } = useTranslation();
  return <Pressable testID={id} accessibilityRole="button" accessibilityHint={locked ? t('privacy.rows.lockHint') : undefined} disabled={busy} onPress={onPress}
    style={({ pressed }) => [st.row, !last && st.divided, pressed && { opacity: 0.6 }]}>
    <View style={st.icon}><Icon name={icon as never} size={18} color={colors.forest} /></View>
    <View style={s.flex}><Text style={st.itemTitle}>{title}</Text><Text style={s.hint}>{sub}</Text></View>
    {busy ? <ActivityIndicator color={colors.forest} /> : locked ? <View style={st.lock}><Icon name="lock-closed" size={11} color={colors.muted} /><Text style={st.lockText}>{t('privacy.rows.lockBadge')}</Text></View> : <Icon name="chevron-forward" size={18} color={colors.muted} />}
  </Pressable>;
}

// A grievance, or a request to correct something the person cannot edit in the app themselves.
const ABOUT_IDS = ['consent', 'marketing', 'access', 'erasure', 'security', 'other'] as const;
function RequestForm({ kind, onClose }: { kind: 'grievance' | 'correction'; onClose: () => void }) {
  const { t } = useTranslation();
  const [about, setAbout] = useState<string>(kind === 'correction' ? 'correction' : 'consent');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<Problem | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const send = async () => {
    setError(null);
    if (message.trim().length < 10) return setError({ key: 'privacy.err.describe' });
    setBusy(true);
    try { setReceipt(await apiPost<Receipt>('/privacy/grievances', { kind, about, message: message.trim() })); setMessage(''); }
    catch (e) { setError({ key: 'privacy.err.send', cause: e }); }
    finally { setBusy(false); }
  };
  return <View testID={`privacy-${kind}-form`} style={s.card}>
    <View style={s.row}><Text style={[s.title, s.flex]}>{kind === 'correction' ? t('privacy.form.correctionTitle') : t('privacy.rows.grievanceTitle')}</Text><Pressable testID={`privacy-${kind}-close`} accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={8} style={st.close}><Icon name="close" size={20} color={colors.muted} /></Pressable></View>
    {receipt ? <Receipted receipt={receipt} what={kind === 'correction' ? 'correction' : 'grievance'} /> : <>
      {kind === 'grievance' && <View style={st.chips}>{ABOUT_IDS.map(id => <Pressable key={id} testID={`privacy-about-${id}`} accessibilityRole="radio" accessibilityState={{ selected: about === id }} onPress={() => setAbout(id)} style={[st.chip, about === id && st.chipOn]}><Text style={[st.chipText, about === id && st.chipTextOn]}>{t(`privacy.about.${id}`)}</Text></Pressable>)}</View>}
      <TextInput testID={`privacy-${kind}-message`} accessibilityLabel={t('privacy.form.describeLabel')} placeholder={kind === 'correction' ? t('privacy.form.correctionPlaceholder') : t('privacy.form.grievancePlaceholder')} value={message} onChangeText={setMessage}
        maxLength={2000} multiline textAlignVertical="top" style={[s.input, st.message]} placeholderTextColor={colors.muted} />
      <Text style={st.meta}>{t('privacy.form.noCardDetails')}</Text>
      <Message id={`privacy-${kind}-error`} text={error ? problemText(error) : ''} error />
      <ActionButton id={`privacy-${kind}-submit`} title={kind === 'correction' ? t('privacy.form.sendCorrection') : t('privacy.form.sendGrievance')} onPress={send} busy={busy} />
    </>}
  </View>;
}

const RELATIONSHIPS = ['spouse', 'parent', 'child', 'sibling', 'relative', 'friend', 'other'] as const;
function NomineeForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(''); const [relationship, setRelationship] = useState<string>('');
  const [phone, setPhone] = useState(''); const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<Problem | null>(null); const [receipt, setReceipt] = useState<Receipt | null>(null);
  const send = async () => {
    setError(null);
    if (name.trim().length < 2) return setError({ key: 'privacy.err.nomineeName' });
    if (!relationship) return setError({ key: 'privacy.err.nomineeRelation' });
    if (!phone.trim() && !email.trim()) return setError({ key: 'privacy.err.nomineeContact' });
    setBusy(true);
    try { setReceipt(await apiPost<Receipt>('/privacy/nominee', { name: name.trim(), relationship, phone: phone.trim(), email: email.trim() })); }
    catch (e) { setError({ key: 'privacy.err.nominee', cause: e }); }
    finally { setBusy(false); }
  };
  return <View testID="privacy-nominee-form" style={s.card}>
    <View style={s.row}><Text style={[s.title, s.flex]}>{t('privacy.rows.nomineeTitle')}</Text><Pressable testID="privacy-nominee-close" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={8} style={st.close}><Icon name="close" size={20} color={colors.muted} /></Pressable></View>
    {receipt ? <Receipted receipt={receipt} what="nomination" /> : <>
      <Text style={s.hint}>{t('privacy.nominee.intro')}</Text>
      <TextInput testID="privacy-nominee-name" accessibilityLabel={t('privacy.nominee.name')} placeholder={t('privacy.nominee.name')} value={name} onChangeText={setName} maxLength={80} autoCapitalize="words" style={s.input} placeholderTextColor={colors.muted} />
      <View style={st.chips}>{RELATIONSHIPS.map(id => <Pressable key={id} testID={`privacy-nominee-${id}`} accessibilityRole="radio" accessibilityState={{ selected: relationship === id }} onPress={() => setRelationship(id)} style={[st.chip, relationship === id && st.chipOn]}><Text style={[st.chipText, relationship === id && st.chipTextOn]}>{t(`privacy.relation.${id}`)}</Text></Pressable>)}</View>
      <TextInput testID="privacy-nominee-phone" accessibilityLabel={t('privacy.nominee.phoneLabel')} placeholder={t('privacy.nominee.phonePlaceholder')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={16} style={s.input} placeholderTextColor={colors.muted} />
      <TextInput testID="privacy-nominee-email" accessibilityLabel={t('privacy.nominee.emailLabel')} placeholder={t('privacy.nominee.emailPlaceholder')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={120} style={s.input} placeholderTextColor={colors.muted} />
      <Message id="privacy-nominee-error" text={error ? problemText(error) : ''} error />
      <ActionButton id="privacy-nominee-submit" title={t('privacy.nominee.save')} onPress={send} busy={busy} />
    </>}
  </View>;
}

function Receipted({ receipt, what }: { receipt: Receipt; what: 'grievance' | 'correction' | 'nomination' }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const answer = receipt.due_at
    ? t('privacy.receipt.answerBy', { date: fmt.date(receipt.due_at, 'long'), days: receipt.respond_within_days })
    : t('privacy.receipt.answerNoDate', { days: receipt.respond_within_days });
  return <View testID="privacy-receipt" style={st.receipt}>
    <Icon name="checkmark-circle" size={24} color={colors.forest} />
    <Text selectable testID="privacy-receipt-reference" style={st.reference}>{t('privacy.reference', { reference: receipt.reference })}</Text>
    <Text selectable style={s.hint}>{t(`privacy.receipt.${what}`)} {answer} {t('privacy.receipt.quote')}</Text>
  </View>;
}

const st = StyleSheet.create({
  group: { fontSize: 12, lineHeight: 17, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 8, marginBottom: 8, marginLeft: 6 },
  groupDeva: { letterSpacing: 0 },
  whoCard: { gap: 12 },
  done: { alignItems: 'flex-start', backgroundColor: colors.limeSoft },
  reference: { color: colors.forest, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.limeSoft, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  meta: { color: colors.onSurfaceTertiary, fontSize: 11, lineHeight: 16, marginTop: 2 },
  strong: { color: colors.onSurface, fontWeight: '700' },
  todo: { color: colors.onWarning, backgroundColor: colors.warning, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 14 },
  rows: { gap: 0, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10 },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceSecondary, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  lockText: { fontSize: 10, lineHeight: 14, fontWeight: '800', color: colors.muted },
  secondary: { minHeight: 48, borderRadius: 16, backgroundColor: colors.electricLime, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  secondaryText: { color: '#050605', fontSize: 13, lineHeight: 19, fontWeight: '800', textAlign: 'center' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  outlineDanger: { minHeight: 50, borderRadius: 16, borderWidth: 1.5, borderColor: colors.onError, backgroundColor: colors.error, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, paddingHorizontal: 14, paddingVertical: 8 },
  outlineDangerText: { flexShrink: 1, textAlign: 'center', color: colors.onError, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  contact: { backgroundColor: colors.surfaceSecondary, gap: 6 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.surface },
  chipOn: { backgroundColor: '#050605', borderColor: '#050605' },
  chipText: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.onSurface },
  chipTextOn: { color: colors.electricLime },
  message: { minHeight: 120 },
  receipt: { backgroundColor: colors.limeSoft, padding: 16, borderRadius: 16, gap: 8 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 34, gap: 8, maxHeight: '92%' },
  sheetScroll: { gap: 8 },
  sheetTitle: { fontSize: 20, lineHeight: 28, fontWeight: '800', color: colors.onSurface },
  sheetBody: { fontSize: 14, lineHeight: 20, color: colors.muted },
  sheetHead: { fontSize: 13, lineHeight: 19, fontWeight: '800', color: colors.onSurface, marginTop: 8 },
  sheetLine: { fontSize: 12, lineHeight: 18, color: colors.muted },
  sheetError: { color: colors.onError, fontSize: 13, lineHeight: 18 },
  sheetDanger: { minHeight: 52, borderRadius: 16, backgroundColor: colors.onError, alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingHorizontal: 16, paddingVertical: 8 },
  sheetDangerText: { color: '#fff', fontSize: 15, lineHeight: 21, fontWeight: '800', textAlign: 'center' },
  sheetCancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  sheetCancelText: { color: colors.onSurface, fontSize: 14, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
});
