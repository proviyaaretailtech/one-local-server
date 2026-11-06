// Privacy & your data (DPDP Act; docs/DPDP.md). One place to: switch optional consents on and off
// (each change recorded with the time and notice version), download your data, correct it, delete
// your account, nominate someone, raise a grievance, and read the notice. Guests see what is kept
// on this phone and can clear it; the account-level rights need sign-in, so we know it is you.
import { Fragment, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { AccountLayout, Group, Message, accountStyles as s } from '@/src/components/account-layout';
import { ChipRow } from '@/src/components/chip-row';
import { Button } from '@/src/ui/button';
import { ListGroup, ListRow } from '@/src/ui/list-row';
import { Sheet } from '@/src/ui/sheet';
import { Toggle } from '@/src/ui/toggle';
import { colors, radius } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { useCustomer } from '@/src/customer';
import { useCart } from '@/src/cart';
import { apiPost } from '@/src/api';
import { useFormat, useTranslation } from '@/src/i18n';
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

const DELETED_NOW = ['privacy.deleteSheet.nowAddresses', 'privacy.deleteSheet.nowRequests', 'privacy.deleteSheet.nowPhone', 'privacy.deleteSheet.nowConsents', 'privacy.deleteSheet.nowLogin'] as const;

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
  // Account → "Delete account" lands here with open=delete and goes straight to the confirm step (signed-in only).
  const [confirm, setConfirm] = useState<'' | 'clear' | 'delete'>(() => (open === 'delete' && user ? 'delete' : ''));
  const [erased, setErased] = useState<{ reference: string; message: string; login?: string } | null>(null);

  const refreshPhone = () => { void phoneSummary().then(setPhone).catch(() => setPhone([])); };
  // Again whenever a choice is saved (it is stored on the phone too).
  useEffect(refreshPhone, [choices.history.length]);
  useEffect(() => { if (user?.id) void pullConsents(); }, [user?.id]);
  const signIn = () => router.push('/sign-in?next=/privacy');

  const toggle = (purpose: (typeof OPTIONAL_PURPOSES)[number], value: boolean) => {
    void choices.set(purpose, value);
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
  // A right that needs the account: open its form when signed in, else sign in first.
  const ask = (which: Exclude<Panel, ''>) => (user ? setPanel(panel === which ? '' : which) : signIn());
  const lock = !user && <View style={st.lock}><Icon name="lock-closed" size={11} color={colors.muted} /><Text style={st.lockText}>{t('privacy.rows.lockBadge')}</Text></View>;
  const lockHint = user ? undefined : t('privacy.rows.lockHint');

  return <AccountLayout id="privacy" title={t('privacy.title')} subtitle={t('privacy.subtitle')}>
    {erased && <View testID="privacy-erased" style={[s.card, st.done]}>
      <Icon name="checkmark-circle" size={28} color={colors.forest} />
      <Text style={s.title}>{t('privacy.erased.title')}</Text>
      <Text selectable style={s.hint}>{erasedText}</Text>
      <Text selectable testID="privacy-erased-reference" style={st.reference}>{t('privacy.reference', { reference: erased.reference })}</Text>
    </View>}

    <View testID="privacy-who" style={s.card}>
      <View style={s.row}>
        <View style={s.tile}><Icon name={user ? 'person-outline' : 'phone-portrait-outline'} size={20} color={colors.forest} /></View>
        <View style={s.flex}>
          <Text style={st.itemTitle}>{user ? t('privacy.who.signedIn') : t('privacy.who.guest')}</Text>
          <Text style={s.hint}>{user ? t('privacy.who.signedInNote', { who }) : t('privacy.who.guestNote')}</Text>
        </View>
      </View>
      {!user && <Button testID="privacy-sign-in" title={t('privacy.who.signInButton')} onPress={signIn} />}
    </View>

    <Group>{t('privacy.group.choices')}</Group>
    <View testID="privacy-choices" style={s.card}>
      {OPTIONAL_PURPOSES.map((p, i) => {
        const last = lastChange(p);
        const text = purposeText(p);
        return <Fragment key={p}>
          {i > 0 && <View style={st.line} />}
          <View style={s.row}>
            <View style={s.flex}>
              <Text style={st.itemTitle}>{text.title}</Text>
              <Text style={s.hint}>{text.body}</Text>
              {last && <Text testID={`consent-${p}-changed`} style={st.meta}>{t(last.granted ? 'privacy.choiceOn' : 'privacy.choiceOff', { when: fmt.dateTime(last.at), version: last.notice_version })}</Text>}
            </View>
            <Toggle testID={`consent-${p}`} tone="light" tint={colors.forest} accessibilityLabel={text.title} disabled={!choices.ready} value={choices.current[p]} onValueChange={v => toggle(p, v)} />
          </View>
        </Fragment>;
      })}
      <Text testID="privacy-choices-note" style={st.meta}>
        {user ? (choices.unsent ? t('privacy.choicesNote.unsent', { count: choices.unsent }) : t('privacy.choicesNote.synced')) : t('privacy.choicesNote.phoneOnly')}
        {' '}{t('privacy.choicesNote.needed')}
      </Text>
    </View>

    <Group>{t('privacy.group.data')}</Group>
    <ListGroup testID="privacy-actions">
      <ListRow testID="privacy-download" icon="download-outline" title={t('privacy.rows.downloadTitle')} subtitle={user ? t('privacy.rows.downloadSubUser') : t('privacy.rows.downloadSubGuest')} disabled={busy === 'download'} onPress={download} trailing={busy === 'download' ? <ActivityIndicator color={colors.forest} /> : undefined} />
      <ListRow testID="privacy-correct" icon="create-outline" title={t('privacy.rows.correctTitle')} subtitle={t('privacy.rows.correctSub')} onPress={() => router.push('/profile-edit')} />
      <ListRow testID="privacy-correct-ask" icon="construct-outline" title={t('privacy.rows.correctAskTitle')} subtitle={t('privacy.rows.correctAskSub')} accessibilityHint={lockHint} trailing={lock || undefined} onPress={() => ask('correction')} />
      <ListRow testID="privacy-nominee" icon="people-outline" title={t('privacy.rows.nomineeTitle')} subtitle={t('privacy.rows.nomineeSub')} accessibilityHint={lockHint} trailing={lock || undefined} onPress={() => ask('nominee')} />
      <ListRow testID="privacy-grievance" icon="chatbubble-ellipses-outline" title={t('privacy.rows.grievanceTitle')} subtitle={t('privacy.rows.grievanceSub', { days: PRIVACY.responseDays })} accessibilityHint={lockHint} trailing={lock || undefined} onPress={() => ask('grievance')} />
      <ListRow testID="privacy-notice-link" icon="document-text-outline" title={t('privacy.rows.noticeTitle')} subtitle={t('privacy.rows.noticeSub', { version: PRIVACY.noticeVersion, date: noticeDateText(fmt) })} onPress={() => router.push('/privacy-notice')} />
    </ListGroup>
    <Message id="privacy-note" text={noteText} />
    <Message id="privacy-error" text={errorText} error />

    {user && panel === 'grievance' && <RequestForm key="grievance" kind="grievance" onClose={() => setPanel('')} />}
    {user && panel === 'correction' && <RequestForm key="correction" kind="correction" onClose={() => setPanel('')} />}
    {user && panel === 'nominee' && <NomineeForm onClose={() => setPanel('')} />}

    <Group>{t('privacy.group.phone')}</Group>
    <View testID="privacy-phone" style={s.card}>
      {phone === null ? <ActivityIndicator color={colors.forest} /> : phone.length === 0
        ? <Text testID="privacy-phone-empty" style={s.hint}>{t('privacy.phone.empty')}</Text>
        : <View style={st.phoneList}>{phone.map(e => <View key={e.id} style={st.phoneRow}>
            <Icon name={e.secret ? 'key-outline' : 'document-outline'} size={16} color={colors.forest} />
            <Text style={[s.hint, s.flex]}>{t(`privacy.phoneItem.${e.id}`)}</Text>
            <Text style={st.meta}>{e.secret ? t('privacy.phone.private') : size(e.bytes)}</Text>
          </View>)}</View>}
      {!user && !!phone?.length && <Button testID="privacy-clear-phone" variant="quiet" tone="danger" icon="trash-outline" title={t('privacy.phone.clear')} onPress={() => { setError(null); setConfirm('clear'); }} />}
      {!!user && <Text style={st.meta}>{t('privacy.phone.signedInNote')}</Text>}
    </View>

    {!!user && <>
      <Group>{t('privacy.deleteAccount')}</Group>
      <View testID="privacy-delete-card" style={s.card}>
        <Text style={s.hint}>{t('privacy.deleteCard.body')}</Text>
        <Button testID="privacy-delete" variant="quiet" tone="danger" icon="person-remove-outline" title={t('privacy.deleteAccount')} onPress={() => { setError(null); setConfirm('delete'); }} />
      </View>
    </>}

    <View testID="privacy-contact" style={[s.card, st.contact]}>
      <Text style={st.itemTitle}>{t('privacy.contact.title')}</Text>
      <Text style={s.hint}>{t('privacy.contact.officer')} <Text style={isPlaceholder(PRIVACY.grievanceOfficer.name) ? st.todo : st.strong}>{PRIVACY.grievanceOfficer.name}</Text></Text>
      <Text style={s.hint}>{t('privacy.contact.email')} <Text style={isPlaceholder(PRIVACY.grievanceOfficer.email) ? st.todo : st.strong}>{PRIVACY.grievanceOfficer.email}</Text></Text>
      <Text style={s.hint}>{t('privacy.contact.phone')} <Text style={isPlaceholder(PRIVACY.grievanceOfficer.phone) ? st.todo : st.strong}>{PRIVACY.grievanceOfficer.phone}</Text> · {t('privacy.officerHours')}</Text>
      <Text style={s.hint}>{t('privacy.contact.board', { board })}</Text>
    </View>

    <Sheet testID="privacy-delete-sheet" visible={confirm === 'delete'} onClose={() => !busy && setConfirm('')} title={t('privacy.deleteSheet.title')} body={`${t('privacy.deleteSheet.undone')}${who ? ` ${t('privacy.deleteSheet.signedInAs', { who })}` : ''}`}>
      <ScrollView style={st.sheetScroll} contentContainerStyle={st.sheetList}>
        <Text style={st.sheetHead}>{t('privacy.deleteSheet.nowHead')}</Text>
        {DELETED_NOW.map(line => <Text key={line} style={st.sheetLine}>•  {t(line)}</Text>)}
        <Text style={st.sheetHead}>{t('privacy.deleteSheet.keptHead')}</Text>
        {kept.map(line => <Text key={line.id} style={st.sheetLine}>•  {line.text}</Text>)}
      </ScrollView>
      <Message id="privacy-delete-error" text={errorText} error />
      <Button testID="privacy-delete-confirm" tone="danger" title={t('privacy.deleteAccount')} busy={busy === 'delete'} disabled={!!busy} onPress={deleteAccount} />
      <Button testID="privacy-delete-cancel" variant="quiet" title={t('privacy.deleteSheet.keep')} disabled={!!busy} onPress={() => setConfirm('')} />
    </Sheet>

    <Sheet testID="privacy-clear-sheet" visible={confirm === 'clear'} onClose={() => !busy && setConfirm('')} title={t('privacy.clearSheet.title')} body={t('privacy.clearSheet.body')}>
      <Message id="privacy-clear-error" text={errorText} error />
      <Button testID="privacy-clear-confirm" tone="danger" title={t('privacy.clearSheet.confirm')} busy={busy === 'clear'} disabled={!!busy} onPress={clearThisPhone} />
      <Button testID="privacy-clear-cancel" variant="quiet" title={t('common.cancel')} disabled={!!busy} onPress={() => setConfirm('')} />
    </Sheet>
  </AccountLayout>;
}

// A form's title with a round close button beside it.
function FormHead({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const { t } = useTranslation();
  return <View style={s.row}><Text style={[s.title, s.flex]}>{title}</Text><Pressable testID={`${id}-close`} accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={4} style={st.close}><Icon name="close" size={20} color={colors.onSurface} /></Pressable></View>;
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
    <FormHead id={`privacy-${kind}`} title={kind === 'correction' ? t('privacy.form.correctionTitle') : t('privacy.rows.grievanceTitle')} onClose={onClose} />
    {receipt ? <Receipted receipt={receipt} what={kind === 'correction' ? 'correction' : 'grievance'} /> : <>
      {kind === 'grievance' && <ChipRow style={s.chips} contentContainerStyle={s.chipContent} selected={about} onSelect={setAbout} chips={ABOUT_IDS.map(id => ({ id, testID: `privacy-about-${id}`, label: t(`privacy.about.${id}`) }))} />}
      <TextInput testID={`privacy-${kind}-message`} accessibilityLabel={t('privacy.form.describeLabel')} placeholder={kind === 'correction' ? t('privacy.form.correctionPlaceholder') : t('privacy.form.grievancePlaceholder')} value={message} onChangeText={setMessage}
        maxLength={2000} multiline textAlignVertical="top" style={[s.input, st.message]} placeholderTextColor={colors.muted} />
      <Text style={st.meta}>{t('privacy.form.noCardDetails')}</Text>
      <Message id={`privacy-${kind}-error`} text={error ? problemText(error) : ''} error />
      <Button testID={`privacy-${kind}-submit`} title={kind === 'correction' ? t('privacy.form.sendCorrection') : t('privacy.form.sendGrievance')} onPress={send} busy={busy} />
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
    <FormHead id="privacy-nominee" title={t('privacy.rows.nomineeTitle')} onClose={onClose} />
    {receipt ? <Receipted receipt={receipt} what="nomination" /> : <>
      <Text style={s.hint}>{t('privacy.nominee.intro')}</Text>
      <TextInput testID="privacy-nominee-name" accessibilityLabel={t('privacy.nominee.name')} placeholder={t('privacy.nominee.name')} value={name} onChangeText={setName} maxLength={80} autoCapitalize="words" style={s.input} placeholderTextColor={colors.muted} />
      <ChipRow style={s.chips} contentContainerStyle={s.chipContent} selected={relationship} onSelect={setRelationship} chips={RELATIONSHIPS.map(id => ({ id, testID: `privacy-nominee-${id}`, label: t(`privacy.relation.${id}`) }))} />
      <TextInput testID="privacy-nominee-phone" accessibilityLabel={t('privacy.nominee.phoneLabel')} placeholder={t('privacy.nominee.phonePlaceholder')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={16} style={s.input} placeholderTextColor={colors.muted} />
      <TextInput testID="privacy-nominee-email" accessibilityLabel={t('privacy.nominee.emailLabel')} placeholder={t('privacy.nominee.emailPlaceholder')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={120} style={s.input} placeholderTextColor={colors.muted} />
      <Message id="privacy-nominee-error" text={error ? problemText(error) : ''} error />
      <Button testID="privacy-nominee-submit" title={t('privacy.nominee.save')} onPress={send} busy={busy} />
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
  done: { alignItems: 'flex-start', backgroundColor: colors.limeSoft },
  reference: { color: colors.forest, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  itemTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  meta: { color: colors.onSurfaceTertiary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  strong: { color: colors.onSurface, fontWeight: '700' },
  todo: { color: colors.onWarning, backgroundColor: colors.warning, fontWeight: '700' },
  line: { height: 1, backgroundColor: colors.border },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  lockText: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: colors.muted },
  phoneList: { gap: 4 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30 },
  contact: { gap: 6 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary },
  message: { minHeight: 120 },
  receipt: { backgroundColor: colors.limeSoft, padding: 16, borderRadius: 16, gap: 8 },
  sheetScroll: { flexGrow: 0 },
  sheetList: { gap: 6, paddingBottom: 6 },
  sheetHead: { fontSize: 14, lineHeight: 20, fontWeight: '800', color: colors.onSurface, marginTop: 6 },
  sheetLine: { fontSize: 13, lineHeight: 19, color: colors.muted },
});
