import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import Icon from '@react-native-vector-icons/ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Address, useCustomer } from '@/src/customer';
import { useDeliveryLocation } from '@/src/delivery-location';
import { useTranslation } from '@/src/i18n';
import { AccountLayout, Message, accountStyles as s } from '@/src/components/account-layout';
import { ChipRow } from '@/src/components/chip-row';
import { Button } from '@/src/ui/button';
import { EmptyState } from '@/src/ui/states';
import { colors, radius } from '@/src/theme';
const empty: Address = { id: '', label: 'Home', name: '', phone: '', line: '', area: '', pin: '' }; // i18n-ignore: 'Home' is the stored label code
// The label codes people can pick here (stored as written; the chip words come from the catalogue).
const LABELS = [{ code: 'Home', key: 'address.kind.home' }, { code: 'Work', key: 'address.kind.work' }, { code: 'Other', key: 'address.kind.other' }] as const; // i18n-ignore: stored label codes
// The text fields of the form: the Address property each one edits and the catalogue key of its label.
const FIELDS = [{ key: 'name', label: 'address.list.receiverName' }, { key: 'phone', label: 'address.list.mobile' }, { key: 'line', label: 'address.list.flat' }, { key: 'area', label: 'address.list.areaCity' }, { key: 'pin', label: 'address.list.pin' }] as const;
export default function Addresses() {
  const { addresses, update, profile, ready } = useCustomer(); const delivery = useDeliveryLocation(); const { t } = useTranslation();
  const [draft, setDraft] = useState<Address | null>(null); const [removing, setRemoving] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!draft) return; setError(''); setMessage('');
    if (draft.name.trim().length < 2 || draft.line.trim().length < 5 || draft.area.trim().length < 2) return setError(t('address.list.errRequired'));
    if (!/^[6-9]\d{9}$/.test(draft.phone)) return setError(t('address.list.errPhone'));
    if (!/^[1-9]\d{5}$/.test(draft.pin)) return setError(t('address.list.errPin'));
    const next = { ...draft, id: draft.id || `address-${Date.now()}`, name: draft.name.trim(), line: draft.line.trim(), area: draft.area.trim() };
    setBusy(true); try { await update({ addresses: addresses.some(a => a.id === next.id) ? addresses.map(a => a.id === next.id ? next : a) : [...addresses, next] }); setDraft(null); setMessage(t('address.list.saved')); } catch { setError(t('address.list.saveFailed')); } finally { setBusy(false); }
  };
  const remove = async (id: string) => { setBusy(true); try { await update({ addresses: addresses.filter(a => a.id !== id) }); setRemoving(''); setMessage(t('address.list.removed')); } catch { setError(t('address.list.removeFailed')); } finally { setBusy(false); } };
  const choose = async (a: Address) => { setBusy(true); try { const text = `${a.label}: ${a.line}, ${a.area}, ${a.pin}`; await AsyncStorage.setItem('one-latur-location', text); delivery.setLocation(text); setMessage(t('address.list.deliveringTo', { label: a.label })); } catch { setError(t('address.list.selectFailed')); } finally { setBusy(false); } };
  return <AccountLayout id="addresses" title={t('address.list.title')} subtitle={t('address.list.subtitle')}>
    <Message id="address-error" text={error} error /><Message id="address-success" text={message} />
    {!addresses.length && !draft && <EmptyState testID="addresses-empty" icon="location-outline" title={t('address.list.emptyTitle')} body={t('address.list.emptyHint')} />}
    {addresses.map(a => { const here = delivery.location.includes(a.line);
      return <View testID={`address-card-${a.id}`} key={a.id} style={[s.card, here && st.here]}>
        <View style={s.row}>
          <View style={s.tile}><Icon name={a.label === 'Work' ? 'briefcase-outline' : 'home-outline'} size={22} color={colors.forest} /></View>
          <Text testID={`address-label-${a.id}`} style={[s.title, s.flex]}>{a.label}</Text>
          <Pressable testID={`address-edit-${a.id}`} hitSlop={4} style={st.link} onPress={() => { setDraft(a); setError(''); setMessage(''); }}><Text style={st.linkText}>{t('common.edit')}</Text></Pressable>
          <Pressable testID={`address-delete-${a.id}`} hitSlop={4} style={st.link} onPress={() => setRemoving(a.id)}><Text style={[st.linkText, st.danger]}>{t('address.list.remove')}</Text></Pressable>
        </View>
        <Text testID={`address-details-${a.id}`} style={s.hint}>{a.name} · {a.phone}{'\n'}{a.line}, {a.area} · {a.pin}</Text>
        {removing === a.id ? <View style={st.confirm}>
          <Text testID="address-delete-confirmation" style={s.hint}>{t('address.list.confirmRemove')}</Text>
          <Button testID="address-confirm-delete" tone="danger" title={t('address.list.yesRemove')} onPress={() => remove(a.id)} busy={busy} />
          <Button testID="address-cancel-delete" variant="quiet" title={t('address.list.keep')} onPress={() => setRemoving('')} />
        </View> : <Button testID={`address-use-${a.id}`} variant={here ? 'quiet' : 'primary'} icon={here ? 'checkmark-circle' : undefined} title={here ? t('address.list.selected') : t('address.list.deliverHere')} onPress={() => choose(a)} busy={busy} />}
      </View>; })}
    {draft ? <View testID="address-form" style={s.card}>
      <Text style={s.title}>{draft.id ? t('address.editTitle') : t('address.list.addTitle')}</Text>
      <ChipRow style={s.chips} contentContainerStyle={s.chipContent} selected={draft.label} onSelect={code => setDraft({ ...draft, label: code })} chips={LABELS.map(({ code, key }) => ({ id: code, testID: `address-type-${code.toLowerCase()}`, label: t(key) }))} />
      {FIELDS.map(f => <View key={f.key}><Text style={s.label}>{t(f.label)}</Text><TextInput testID={`address-${f.key}-input`} accessibilityLabel={t(f.label)} style={s.input} value={String(draft[f.key as keyof Address] ?? '')} editable={!busy} onChangeText={text => setDraft({ ...draft, [f.key]: text })} maxLength={f.key === 'phone' ? 10 : f.key === 'pin' ? 6 : 120} keyboardType={['phone', 'pin'].includes(f.key) ? 'number-pad' : 'default'} /></View>)}
      <Button testID="address-save" title={t('address.save')} onPress={save} busy={busy} />
      <Button testID="address-cancel" variant="quiet" title={t('common.cancel')} onPress={() => setDraft(null)} />
    </View> : <Button testID="address-add" icon="add" title={t('address.list.add')} disabled={!ready} onPress={() => { setDraft({ ...empty, name: profile.name, phone: profile.phone }); setError(''); setMessage(''); }} />}
  </AccountLayout>;
}
const st = StyleSheet.create({
  // The address deliveries go to now is ringed in the brand green.
  here: { borderWidth: 1.5, borderColor: colors.forest },
  link: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  linkText: { color: colors.forest, fontWeight: '700', fontSize: 13 },
  danger: { color: colors.onError },
  confirm: { gap: 10 },
});
