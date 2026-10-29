// The privacy notice (DPDP Act s.5, Rule 3): itemised, in plain language, standing on its own. Every
// fact comes from constants/privacy.ts, so the company, the grievance officer and the Board's link
// are filled in once. Placeholders still to be filled show highlighted, with a "draft" banner.
// The wording is in the catalogue (privacyNotice.*, English + Hindi): one key per paragraph.
import { Fragment, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { AccountLayout, accountStyles as s } from '@/src/components/account-layout';
import { colors } from '@/src/theme';
import { useFormat, useTranslation } from '@/src/i18n';
import { keptByLawText, noticeDateText, noticeItemsText, purposeText, sharedWithText } from '@/src/privacy';
import { isPlaceholder, OPTIONAL_PURPOSES, PRIVACY, SHARED_WITH } from '@/constants/privacy';

const g = PRIVACY.grievanceOfficer;
const FACTS = [PRIVACY.legalEntity, PRIVACY.registeredAddress, g.name, g.email, g.phone, ...(PRIVACY.board.complaintLink ? [PRIVACY.board.complaintLink] : []), ...SHARED_WITH.map(x => x.where)];
const draft = FACTS.some(isPlaceholder);

// A fact that is still a placeholder is shown highlighted, so it cannot be missed before launch.
function Fact({ value, id }: { value: string; id?: string }) {
  return <Text testID={id} style={isPlaceholder(value) ? st.todo : st.fact}>{value}</Text>;
}

// A sentence that holds styled pieces (a highlighted placeholder). Translate it with each piece passed as
// piece('name'), then swap the real elements back in here, so Hindi can put them wherever its grammar wants.
const piece = (name: string) => `⟦${name}⟧`;
function Rich({ text, parts }: { text: string; parts: Record<string, ReactNode> }) {
  return <>{text.split(/(⟦\w+⟧)/).filter(Boolean).map((chunk, i) => {
    const name = /^⟦(\w+)⟧$/.exec(chunk)?.[1];
    return name && name in parts ? <Fragment key={i}>{parts[name]}</Fragment> : chunk;
  })}</>;
}

const RIGHTS = ['see', 'correct', 'delete', 'nominate', 'complain'] as const;

function Section({ title, icon, children, id }: { title: string; icon: string; children: React.ReactNode; id: string }) {
  return <View testID={`notice-${id}`} style={s.card}>
    <View style={s.row}><View style={st.icon}><Icon name={icon as never} size={18} color={colors.forest} /></View><Text style={[s.title, s.flex]}>{title}</Text></View>
    {children}
  </View>;
}

export default function PrivacyNotice() {
  const router = useRouter();
  const { t } = useTranslation();
  const fmt = useFormat();
  const board = t('privacyNotice.boardName');
  const screen = t('privacy.title');
  const bullet = (title: string, body: string, key: string) => <Text key={key} style={st.bullet}>•  <Text style={st.strong}>{t('privacyNotice.bulletTitle', { title })}</Text> {body}</Text>;
  return <AccountLayout id="privacy-notice" title={t('privacyNotice.title')} subtitle={t('privacyNotice.subtitle', { brand: PRIVACY.brand })}>
    <View style={st.version}><Icon name="document-text-outline" size={16} color={colors.forest} /><Text testID="privacy-notice-version" style={st.versionText}>{t('privacyNotice.version', { version: PRIVACY.noticeVersion, date: noticeDateText(fmt) })}</Text></View>
    {draft && <View testID="privacy-notice-draft" style={st.draft}><Icon name="construct-outline" size={16} color={colors.onWarning} /><Text style={st.draftText}>{t('privacyNotice.draft')}</Text></View>}

    <Section id="who" title={t('privacyNotice.s1.title')} icon="business-outline">
      <Text style={s.hint}><Rich text={t('privacyNotice.s1.p1', { brand: PRIVACY.brand, entity: piece('entity'), address: piece('address') })}
        parts={{ entity: <Fact id="privacy-notice-entity" value={PRIVACY.legalEntity} />, address: <Fact value={PRIVACY.registeredAddress} /> }} /></Text>
    </Section>

    <Section id="collect" title={t('privacyNotice.s2.title')} icon="list-outline">
      {noticeItemsText().map((item, i) => <View key={item.id} testID={`notice-item-${i}`} style={st.item}>
        <View style={st.itemTop}><Text style={[st.itemTitle, s.flex]}>{item.data}</Text><Text style={item.basis === 'needed' ? st.needed : st.optional}>{item.basis === 'needed' ? t('privacyNotice.s2.needed') : t('common.optional')}</Text></View>
        <Text style={s.hint}>{item.why}</Text>
        <Text style={st.kept}>{t('privacyNotice.s2.kept', { value: item.kept })}</Text>
      </View>)}
      <Text style={s.hint}>{t('privacyNotice.s2.p1')}</Text>
    </Section>

    <Section id="share" title={t('privacyNotice.s3.title')} icon="people-outline">
      {sharedWithText().map(x => <View key={x.id} style={st.item}>
        <Text style={st.itemTitle}>{x.who}</Text><Text style={s.hint}>{x.what}</Text><Text style={st.kept}>{t('privacyNotice.s3.where')} <Fact value={x.where} /></Text>
      </View>)}
      <Text style={s.hint}>{t('privacyNotice.s3.p1')}</Text>
    </Section>

    <Section id="consent" title={t('privacyNotice.s4.title')} icon="toggle-outline">
      <Text style={s.hint}>{t('privacyNotice.s4.p1')}</Text>
      {OPTIONAL_PURPOSES.map(p => bullet(purposeText(p).title, purposeText(p).body, p))}
      <Text style={s.hint}>{t('privacyNotice.s4.p2', { screen })}</Text>
      <Link id="privacy-notice-open-choices" label={t('privacyNotice.s4.open', { screen })} onPress={() => router.push('/privacy' as never)} />
    </Section>

    <Section id="rights" title={t('privacyNotice.s5.title')} icon="shield-checkmark-outline">
      {RIGHTS.map(id => bullet(t(`privacyNotice.s5.${id}Title`), t(`privacyNotice.s5.${id}Body`, { days: PRIVACY.responseDays }), id))}
      <Text style={s.hint}>{t('privacyNotice.s5.p1', { screen })}</Text>
    </Section>

    <Section id="kept" title={t('privacyNotice.s6.title')} icon="archive-outline">
      {keptByLawText().map(line => <Text key={line.id} style={st.bullet}>•  {line.text}</Text>)}
      <Text style={s.hint}>{t('privacyNotice.s6.p1')}</Text>
    </Section>

    <Section id="children" title={t('privacyNotice.s7.title')} icon="happy-outline">
      <Text style={s.hint}>{t('privacyNotice.s7.p1', { age: PRIVACY.minimumAge })}</Text>
    </Section>

    <Section id="security" title={t('privacyNotice.s8.title')} icon="lock-closed-outline">
      <Text style={s.hint}>{t('privacyNotice.s8.p1', { hosting: t('privacyNotice.hosting'), board })}</Text>
    </Section>

    <Section id="complain" title={t('privacyNotice.s9.title')} icon="chatbubbles-outline">
      <Text style={s.hint}>{t('privacyNotice.s9.p1')}</Text>
      <View style={st.contact}>
        <Fact id="privacy-notice-officer" value={g.name} />
        <Fact id="privacy-notice-email" value={g.email} />
        <Fact value={g.phone} />
        <Text style={s.hint}>{t('privacy.officerHours')}</Text>
      </View>
      {PRIVACY.board.complaintLink
        ? <Text style={s.hint}><Rich text={t('privacyNotice.s9.p2', { days: PRIVACY.responseDays, board, link: piece('link') })}
            parts={{ link: <Fact id="privacy-notice-board" value={PRIVACY.board.complaintLink} /> }} /></Text>
        : <Text testID="privacy-notice-board" style={s.hint}>{t('privacyNotice.s9.p2NoLink', { days: PRIVACY.responseDays, board })}</Text>}
      <Link id="privacy-notice-raise" label={t('privacy.rows.grievanceTitle')} onPress={() => router.push('/privacy?open=grievance' as never)} />
      {!isPlaceholder(g.email) && <Link id="privacy-notice-mail" label={t('privacyNotice.s9.email', { email: g.email })} onPress={() => void Linking.openURL(`mailto:${g.email}`)} />}
    </Section>

    <Section id="changes" title={t('privacyNotice.s10.title')} icon="language-outline">
      <Text style={s.hint}>{t('privacyNotice.s10.p1')}</Text>
    </Section>
  </AccountLayout>;
}

function Link({ id, label, onPress }: { id: string; label: string; onPress: () => void }) {
  return <Pressable testID={id} accessibilityRole="link" onPress={onPress} style={st.link}><Text style={st.linkText}>{label}</Text><Icon name="chevron-forward" size={16} color={colors.forest} /></Pressable>;
}

const st = StyleSheet.create({
  version: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.limeSoft, marginBottom: 12 },
  versionText: { flexShrink: 1, color: colors.forest, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  draft: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.warning, marginBottom: 16 },
  draftText: { flex: 1, color: colors.onWarning, fontSize: 12, fontWeight: '600', lineHeight: 18 },
  icon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.limeSoft, alignItems: 'center', justifyContent: 'center' },
  item: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.divider },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  itemTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  needed: { fontSize: 10, lineHeight: 14, fontWeight: '800', color: colors.forest, backgroundColor: colors.limeSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  optional: { fontSize: 10, lineHeight: 14, fontWeight: '800', color: colors.book, backgroundColor: colors.bookSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  kept: { color: colors.onSurfaceTertiary, fontSize: 11, lineHeight: 17 },
  bullet: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  strong: { color: colors.onSurface, fontWeight: '700' },
  fact: { color: colors.onSurface, fontWeight: '700' },
  todo: { color: colors.onWarning, backgroundColor: colors.warning, fontWeight: '700' },
  contact: { gap: 4, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceSecondary },
  link: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 4 },
  linkText: { flexShrink: 1, color: colors.forest, fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
