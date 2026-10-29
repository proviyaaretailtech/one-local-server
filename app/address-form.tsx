// Address details after the pin: where exactly (building, street, area), who receives it, and how to reach the door.
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { randomId } from '@/src/api';
import { Address, useCustomer } from '@/src/customer';
import { useDeliveryLocation } from '@/src/delivery-location';
import { useTranslation } from '@/src/i18n';
import { addressText, isCoordinateText } from '@/src/places';
import { colors } from '@/src/theme';

type Kind = NonNullable<Address['kind']>;
// The kind is a code that is stored; the chip words come from the catalogue.
const KINDS = [
  { id: 'home', label: 'address.kind.home', icon: 'home-outline' }, { id: 'work', label: 'address.kind.work', icon: 'briefcase-outline' }, { id: 'other', label: 'address.kind.other', icon: 'navigate-outline' },
] as const satisfies readonly { id: Kind; label: string; icon: string }[];

const phoneOk = (v: string) => /^[6-9]\d{9}$/.test(v.replace(/\D/g, '').slice(-10));

export default function AddressForm() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const delivery = useDeliveryLocation(); const { t } = useTranslation();
  const { addresses, profile, update } = useCustomer();
  const p = useLocalSearchParams<{ lat?: string; lng?: string; locality?: string; formatted?: string; pincode?: string; id?: string; manual?: string }>();
  const existing = useMemo(() => addresses.find(a => a.id === p.id), [addresses, p.id]);
  const formatted = p.formatted && !isCoordinateText(p.formatted) ? p.formatted : '';
  const manual = p.manual === '1' || !formatted;
  const noStreet = manual && !!p.lat; // came from a pin, but no street address was found for it
  const initialKind: Kind = existing?.kind ?? (existing?.label === 'Work' ? 'work' : existing && existing.label !== 'Home' ? 'other' : 'home');

  const [name, setName] = useState(existing?.name || profile.name); const [phone, setPhone] = useState(existing?.phone || profile.phone);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [building, setBuilding] = useState(existing?.building ?? existing?.line ?? ''); const [street, setStreet] = useState(existing?.street ?? '');
  const [area, setArea] = useState(p.locality || existing?.locality || existing?.area || ''); const [pin, setPin] = useState(p.pincode || existing?.pin || '');
  const [saveAs, setSaveAs] = useState(initialKind === 'other' ? existing?.label ?? '' : ''); const [instructions, setInstructions] = useState(existing?.instructions ?? '');
  const [showInstructions, setShowInstructions] = useState(!!existing?.instructions);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  // The button wakes up once everything required is there (the checks in save() still explain any mistake).
  const ready = name.trim().length >= 2 && phoneOk(phone) && building.trim().length >= 2
    && (!manual || area.trim().length >= 2) && (kind !== 'other' || saveAs.trim().length >= 2);

  const save = async () => {
    setError('');
    if (name.trim().length < 2) return setError(t('address.form.errName'));
    if (!phoneOk(phone)) return setError(t('address.form.errPhone'));
    if (building.trim().length < 2) return setError(t('address.form.errBuilding'));
    if (manual && area.trim().length < 2) return setError(t('address.form.errArea'));
    if (pin && !/^\d{6}$/.test(pin.trim())) return setError(t('address.form.errPin'));
    if (kind === 'other' && saveAs.trim().length < 2) return setError(t('address.form.errSaveAs'));
    const lat = p.lat ? Number(p.lat) : existing?.lat; const lng = p.lng ? Number(p.lng) : existing?.lng;
    const address: Address = {
      id: existing?.id ?? `address-${randomId(6)}`,
      label: kind === 'other' ? saveAs.trim() : kind === 'work' ? 'Work' : 'Home', kind, // i18n-ignore: stored label for the Home/Work code (user data; shown as stored)
      name: name.trim(), phone: phone.replace(/\D/g, '').slice(-10),
      building: building.trim(), street: street.trim(), line: [building.trim(), street.trim()].filter(Boolean).join(', '),
      locality: area.trim(), area: area.trim(), formatted: formatted || existing?.formatted, pin: pin.trim(),
      instructions: instructions.trim() || undefined, lat, lng,
    };
    setBusy(true);
    try {
      await update({ addresses: existing ? addresses.map(a => (a.id === existing.id ? address : a)) : [...addresses, address] });
      delivery.setLocation(addressText(address), lat != null && lng != null ? { lat, lng } : null);
      // Back to where shopping was (home), closing the location, map and form screens.
      router.dismissTo('/(tabs)' as never);
    } catch { setError(t('address.form.saveFailed')); }
    finally { setBusy(false); }
  };

  const title = p.locality || (existing ? t('address.editTitle') : t('address.form.addTitle'));
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable testID="address-form-back" accessibilityLabel={t('common.goBack')} onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerLine} numberOfLines={1}>
          <Text style={styles.title}>{title}</Text>
          {!!formatted && <Text style={styles.subtitle}>{'  |  '}{formatted}</Text>}
        </Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>{t('address.form.locationDetails')}</Text>
        <View style={styles.card}>
          <View style={styles.kinds}>{KINDS.map(k => (
            <Pressable key={k.id} testID={`address-kind-${k.id}`} accessibilityRole="button" accessibilityState={{ selected: kind === k.id }} onPress={() => setKind(k.id)} style={[styles.kind, kind === k.id && styles.kindOn]}>
              <Icon name={k.icon as never} size={16} color={kind === k.id ? colors.surface : colors.onSurface} /><Text style={[styles.kindText, kind === k.id && styles.kindTextOn]}>{t(k.label)}</Text>
            </Pressable>
          ))}</View>
          <Field id="address-building" label={t('address.form.building')} value={building} onChange={setBuilding} />
          <Field id="address-street" label={t('address.form.street')} value={street} onChange={setStreet} />
          {manual ? (
            <>
              {noStreet && <Text testID="address-no-street" style={styles.help}>{t('address.form.noStreetFound')}</Text>}
              <View style={styles.areaRow}>
                <View style={styles.flex}><Field id="address-area" label={t('address.form.area')} value={area} onChange={setArea} /></View>
                {!!p.lat && <ChangeTile compact onPress={() => router.back()} label={t('address.form.change')} />}
              </View>
              <Field id="address-pin" label={t('address.form.pincode')} value={pin} onChange={setPin} keyboard="number-pad" />
            </>
          ) : (
            <View style={styles.areaRow}>
              <View style={[styles.flex, styles.areaBox]}>
                <Text style={styles.floatLabel}>{t('address.form.areaLabel')}</Text>
                <Text testID="address-area-pinned" style={styles.areaText} numberOfLines={3}>{formatted}</Text>
              </View>
              <ChangeTile onPress={() => router.back()} label={t('address.form.change')} />
            </View>
          )}
          {kind === 'other' && <Field id="address-save-as" label={t('address.form.saveAs')} value={saveAs} onChange={setSaveAs} />}
        </View>

        <Text style={styles.section}>{t('address.form.receiverDetails')}</Text>
        <View style={styles.card}>
          <Field id="receiver-name" label={t('address.form.name')} value={name} onChange={setName} />
          <Field id="receiver-phone" label={t('address.form.mobile')} value={phone} onChange={setPhone} keyboard="phone-pad" />
          <Text style={styles.help}>{t('address.form.mobileHelp')}</Text>
        </View>

        <Text style={styles.section}>{t('address.form.instructions')}</Text>
        <View style={styles.card}>
          {showInstructions ? (
            <TextInput testID="address-instructions" value={instructions} onChangeText={setInstructions} placeholder={t('address.form.directionsHint')} placeholderTextColor={colors.muted} multiline maxLength={200} autoFocus={!existing?.instructions} style={[styles.input, styles.multiline]} />
          ) : (
            <Pressable testID="address-instructions-add" accessibilityRole="button" onPress={() => setShowInstructions(true)} style={styles.rowAction}>
              <Text style={styles.rowActionText}>{t('address.form.instructionsRow')}</Text>
              <Text style={styles.rowActionCta}>{t('address.form.addAction')}</Text>
            </Pressable>
          )}
        </View>
        {!!error && <Text testID="address-form-error" style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable testID="save-address" accessibilityState={{ disabled: !ready || busy }} disabled={busy} onPress={save} style={[styles.cta, !ready && styles.ctaIdle, busy && { opacity: 0.6 }]}>
          <Text style={[styles.ctaText, !ready && styles.ctaTextIdle]}>{busy ? t('address.form.saving') : t('address.save')}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// The label sits inside the box like a placeholder, and moves to the top edge once there is text or focus.
function Field({ id, label, value, onChange, keyboard }: { id: string; label: string; value: string; onChange: (v: string) => void; keyboard?: 'phone-pad' | 'number-pad' }) {
  const [focused, setFocused] = useState(false);
  const raised = focused || value.length > 0;
  return (
    <View style={[styles.fieldBox, focused && styles.fieldBoxOn]}>
      {raised && <Text style={styles.floatLabel}>{label}</Text>}
      <TextInput
        testID={id} value={value} onChangeText={onChange} keyboardType={keyboard} accessibilityLabel={label}
        placeholder={raised ? undefined : label} placeholderTextColor={colors.muted}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={[styles.fieldInput, raised && styles.fieldInputRaised]}
      />
    </View>
  );
}

// A small map tile that goes back to the pin. Compact next to a one-line field, tall next to the pinned area.
function ChangeTile({ onPress, label, compact }: { onPress: () => void; label: string; compact?: boolean }) {
  return (
    <Pressable testID="change-pin" accessibilityRole="button" onPress={onPress} style={[styles.change, compact && styles.changeCompact]}>
      {!compact && <View style={styles.changeMap}><Icon name="map-outline" size={30} color={colors.borderStrong} /></View>}
      <Icon name="location" size={compact ? 18 : 22} color={colors.forest} />
      <Text style={styles.changeText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingBottom: 4, minHeight: 58, backgroundColor: colors.surface, boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: colors.shadow }], zIndex: 1 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerLine: { flex: 1, paddingRight: 8 },
  flex: { flex: 1 },
  title: { fontSize: 16, fontWeight: '800', color: colors.onSurface },
  subtitle: { fontSize: 14, fontWeight: '400', color: colors.muted },
  content: { padding: 16, gap: 10 },
  section: { marginTop: 12, fontSize: 17, fontWeight: '800', color: colors.onSurface },
  card: { borderRadius: 18, backgroundColor: colors.surface, padding: 16, gap: 14 },
  help: { fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: -4 },
  kinds: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 16, backgroundColor: colors.surfaceSecondary },
  kind: { flex: 1, minHeight: 44, paddingVertical: 6, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  kindOn: { backgroundColor: colors.forestDeep },
  kindText: { fontSize: 14, fontWeight: '600', color: colors.onSurface },
  kindTextOn: { color: colors.surface },
  fieldBox: { minHeight: 56, borderRadius: 14, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: colors.surface },
  fieldBoxOn: { borderColor: colors.forest },
  floatLabel: { fontSize: 11, color: colors.muted, fontWeight: '500' },
  fieldInput: { fontSize: 16, color: colors.onSurface, minHeight: 48, paddingVertical: 0 },
  fieldInputRaised: { minHeight: 26 },
  areaRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  areaBox: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 3, backgroundColor: colors.surfaceSecondary },
  areaText: { fontSize: 15, lineHeight: 21, color: colors.onSurfaceTertiary },
  change: { width: 84, minHeight: 84, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.surfaceSecondary },
  changeCompact: { width: 76, minHeight: 56 },
  changeMap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: 0.5 },
  changeText: { fontSize: 13, fontWeight: '700', color: colors.forest, marginTop: 2 },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 14, fontSize: 15, color: colors.onSurface, backgroundColor: colors.surface },
  multiline: { minHeight: 90, paddingTop: 12, textAlignVertical: 'top' },
  rowAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 32 },
  rowActionText: { flex: 1, fontSize: 15, color: colors.onSurfaceTertiary },
  rowActionCta: { fontSize: 14, fontWeight: '800', color: colors.forest, textTransform: 'uppercase' },
  error: { marginTop: 6, fontSize: 13, color: colors.onError },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.surfaceSecondary },
  cta: { minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest },
  ctaIdle: { backgroundColor: colors.surfaceTertiary },
  ctaText: { color: colors.surface, fontSize: 17, fontWeight: '700' },
  ctaTextIdle: { color: colors.muted },
});
