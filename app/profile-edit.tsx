import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import Icon from '@react-native-vector-icons/ionicons';
import { Diet, useCustomer } from '@/src/customer';
import { colors, lightPane, popBase, radius, soft } from '@/src/theme';
import { useTranslation } from '@/src/i18n';
import { AccountLayout, Message, accountStyles as s } from '@/src/components/account-layout';
import { ChipRow } from '@/src/components/chip-row';
import { Button } from '@/src/ui/button';

const DIETS: Diet[] = ['', 'veg', 'egg', 'nonveg']; // words: account.diet.* in the catalogue
const AVATARS = ['person', 'happy', 'flower', 'rocket'] as const; // Ionicons names (technical), labelled via profile.avatarChoice.*

export default function ProfileEdit() {
  const { t } = useTranslation(); const { profile, update, ready } = useCustomer(); const [draft, setDraft] = useState(profile); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => { if (ready) setDraft(profile); }, [ready, profile]);

  // Photos are stored small (square, compressed, as a data URI) so they fit in on-device storage.
  const pickPhoto = async (camera: boolean) => {
    setError('');
    try {
      if (camera) { const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) return setError(t('profile.error.camera')); }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.35, base64: true };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, selectionLimit: 1 });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      const photo = asset.base64 ? `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}` : asset.uri;
      if (photo.length > 900_000) return setError(t('profile.error.photoTooLarge'));
      setDraft(d => ({ ...d, photo }));
    } catch { setError(t('profile.error.photoOpen')); }
  };

  const save = async () => {
    setMessage(''); setError('');
    if (draft.name.trim().length < 2) return setError(t('profile.error.name'));
    if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return setError(t('profile.error.email'));
    if (draft.phone && !/^[6-9]\d{9}$/.test(draft.phone.trim())) return setError(t('profile.error.phone'));
    if (draft.birthday && !/^(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])$/.test(draft.birthday.trim())) return setError(t('profile.error.birthday'));
    setBusy(true);
    try { await update({ profile: { ...draft, name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim(), birthday: draft.birthday.trim() } }); setMessage(t('profile.saved')); }
    catch { setError(t('profile.error.save')); }
    finally { setBusy(false); }
  };

  const initials = draft.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return <AccountLayout id="profile-edit" title={t('profile.title')} subtitle={t('profile.subtitle')}>
    <View style={styles.photoBlock}>
      <View style={styles.photoRing}>{draft.photo ? <Image testID="profile-photo" source={draft.photo} style={styles.photo} contentFit="cover" /> : <View style={styles.placeholder}>{initials ? <Text style={styles.initials}>{initials}</Text> : <Icon name={`${draft.avatar}-outline` as never} size={40} color={colors.forestDeep} />}</View>}</View>
      <View style={styles.photoActions}>
        <Pressable testID="profile-photo-library" onPress={() => void pickPhoto(false)} style={styles.photoBtn}><Icon name="images-outline" size={17} color={colors.forest} /><Text style={styles.photoBtnText}>{t('profile.choosePhoto')}</Text></Pressable>
        <Pressable testID="profile-photo-camera" onPress={() => void pickPhoto(true)} style={styles.photoBtn}><Icon name="camera-outline" size={17} color={colors.forest} /><Text style={styles.photoBtnText}>{t('profile.takePhoto')}</Text></Pressable>
        {!!draft.photo && <Pressable testID="profile-photo-remove" accessibilityLabel={t('profile.removePhoto')} onPress={() => setDraft(d => ({ ...d, photo: '' }))} style={styles.photoBtn}><Icon name="trash-outline" size={17} color={colors.onError} /></Pressable>}
      </View>
      {!draft.photo && <View style={styles.avatars}>{AVATARS.map(icon => { const on = draft.avatar === icon;
        return <Pressable key={icon} testID={`profile-avatar-${icon}`} accessibilityLabel={t(`profile.avatarChoice.${icon}`)} accessibilityState={{ selected: on }} style={[styles.avatar, on && styles.avatarOn]} onPress={() => setDraft({ ...draft, avatar: icon })}><Icon name={`${icon}-outline`} color={on ? colors.surface : colors.forest} size={22} /></Pressable>; })}</View>}
    </View>

    <View style={s.card}>{[
      { key: 'name', label: t('profile.label.name'), placeholder: t('profile.placeholder.name') },
      { key: 'email', label: t('profile.label.email'), placeholder: 'you@example.com' }, // i18n-ignore: example address
      { key: 'phone', label: t('profile.label.phone'), placeholder: t('auth.placeholder.mobile') },
      { key: 'birthday', label: t('profile.label.birthday'), placeholder: t('profile.placeholder.birthday') },
    ].map(f => <View key={f.key}><Text testID={`profile-${f.key}-label`} style={s.label}>{f.label}</Text><TextInput testID={`profile-${f.key}-input`} accessibilityLabel={f.label} value={draft[f.key as 'name' | 'email' | 'phone' | 'birthday']} onChangeText={value => setDraft({ ...draft, [f.key]: value })} editable={ready && !busy} autoCapitalize={f.key === 'name' ? 'words' : 'none'} keyboardType={f.key === 'email' ? 'email-address' : f.key === 'phone' ? 'phone-pad' : f.key === 'birthday' ? 'numbers-and-punctuation' : 'default'} maxLength={f.key === 'phone' ? 10 : f.key === 'birthday' ? 5 : 100} placeholder={f.placeholder} placeholderTextColor={colors.muted} style={s.input} /></View>)}
      <View><Text style={s.label}>{t('account.foodPreference')}</Text>
        <ChipRow style={s.chips} contentContainerStyle={s.chipContent} selected={draft.diet || 'any'} onSelect={id => setDraft({ ...draft, diet: DIETS.find(d => (d || 'any') === id) ?? '' })} chips={DIETS.map(d => ({ id: d || 'any', testID: `profile-diet-${d || 'any'}`, label: t(`account.diet.${d || 'any'}`) }))} />
      </View>
    </View>
    <Message id="profile-edit-error" text={error} error /><Message id="profile-edit-success" text={message} /><Button testID="profile-save" title={t('profile.saveChanges')} onPress={save} busy={busy} disabled={!ready} />
  </AccountLayout>;
}

const PHOTO = 104;
const styles = StyleSheet.create({
  photoBlock: { alignItems: 'center', gap: 16, paddingTop: 6, paddingBottom: 4 },
  // The photo on a lime mount, raised on a green base like the profile's avatar.
  photoRing: { padding: 4, borderRadius: 38, backgroundColor: colors.electricLime, boxShadow: popBase(4, colors.forest) },
  photo: { width: PHOTO, height: PHOTO, borderRadius: 34 },
  placeholder: { width: PHOTO, height: PHOTO, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.limeSoft },
  initials: { fontSize: 34, fontWeight: '800', color: colors.forestDeep },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  photoBtn: { ...lightPane, minHeight: 44, minWidth: 44, paddingHorizontal: 16, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoBtnText: { fontSize: 13, fontWeight: '700', color: colors.forest },
  avatars: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, boxShadow: soft.lifted },
  avatarOn: { backgroundColor: colors.forest, boxShadow: popBase(3, colors.forestDeep) },
});
