import { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '@/src/theme';
import { apiPost } from '@/src/api';
import { useCatalog } from '@/src/use-catalog';
import { LoadState } from '@/src/components/catalog-sections';
import { bookingDay, SavedEnquiry, saveEnquiry } from '@/src/bookings';
import { useFormat, useTranslation } from '@/src/i18n';

function dateString(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
const ERROR_TEXT = { slot: 'booking.errorSlot', name: 'booking.errorName', phone: 'booking.errorPhone', save: 'booking.errorSave' } as const;
export default function Booking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isError, refetch } = useCatalog();
  const event = data?.events.find(e => e.id === id);
  const router = useRouter();
  const { t } = useTranslation();
  const fmt = useFormat();
  const [date, setDate] = useState(dateString(new Date()));
  const [slot, setSlot] = useState('');
  const [guests, setGuests] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<'' | keyof typeof ERROR_TEXT>(''); // a code, so the message re-translates if the language changes
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  // The ISO value is what the API gets; only the label a person reads is localised.
  const dates = Array.from({ length: 7 }, (_, index) => { const d = new Date(); d.setDate(d.getDate() + index); const value = dateString(d); return { value, label: index === 0 ? t('format.today') : fmt.date(bookingDay(value) ?? d, 'weekdayShort'), day: d.getDate() }; });
  const guestsText = t('booking.guests', { count: guests, value: fmt.number(guests) });
  const pickedDay = bookingDay(date); const dateText = pickedDay ? fmt.date(pickedDay) : date;
  const submit = async () => {
    if (!event || busy) return;
    if (!slot) { setError('slot'); return; } // i18n-ignore: error code
    if (name.trim().length < 2) { setError('name'); return; } // i18n-ignore: error code
    if (!/^[6-9]\d{9}$/.test(phone)) { setError('phone'); return; } // i18n-ignore: error code
    setBusy(true); setError('');
    try {
      const result = await apiPost<SavedEnquiry>('/booking-enquiries', { event_id: id, date, slot, guests, name: name.trim(), phone });
      await saveEnquiry({ ...result, title: event.title }).catch(() => {});
      setSaved(result.id);
    } catch { setError('save'); /* i18n-ignore: error code */ } finally { setBusy(false); }
  };
  if (!data) return <LoadState error={isError} retry={refetch} />;
  if (!event) return <View style={styles.empty}><Text style={styles.title}>{t('booking.notFound')}</Text><Pressable testID="booking-not-found-back" onPress={() => router.replace('/book-it' as any)} style={styles.submit}><Text style={styles.submitText}>{t('booking.exploreBookIt')}</Text></Pressable></View>;
  if (saved) return <View testID="booking-confirmation" style={styles.empty}><View style={styles.successIcon}><Icon name="checkmark" size={35} color={colors.book} /></View><Text style={styles.title}>{t('booking.saved')}</Text><Text testID="booking-confirmation-detail" style={styles.confirmText}>{event.title}{'\n'}{dateText} · {slot} · {guestsText}</Text><Text testID="booking-reference" style={styles.reference}>{t('booking.reference', { ref: saved.slice(0, 8).toUpperCase() })}</Text><Text style={styles.notice}>{t('booking.demoNotice')}</Text><Pressable testID="booking-view-enquiries" style={styles.submit} onPress={() => router.replace('/enquiries' as any)}><Text style={styles.submitText}>{t('booking.viewEnquiries')}</Text></Pressable><Pressable testID="booking-back-explore" style={styles.backExplore} onPress={() => router.replace('/book-it' as any)}><Text style={styles.backText}>{t('booking.keepExploring')}</Text></Pressable></View>;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView testID="booking-screen" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <View style={styles.top}><Pressable testID="booking-back" style={styles.iconButton} onPress={() => router.canGoBack() ? router.back() : router.replace('/book-it' as any)}><Icon name="arrow-back" size={23} color={colors.onSurface} /></Pressable><Text style={styles.topTitle}>{t('booking.planTitle')}</Text><Text style={styles.demo}>{t('booking.demo')}</Text></View>
    <Image source={event.image} style={styles.image} contentFit="cover" /><Text testID="booking-event-title" style={styles.title}>{event.title}</Text><Text style={styles.sub}>{event.subtitle}</Text><View style={styles.venue}><Icon name="location-outline" size={15} color={colors.book} /><Text style={styles.sub}>{event.venue}</Text></View>
    <Text style={styles.label}>{t('booking.pickDay')}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>{dates.map(d => <Pressable testID={`booking-date-${d.value}`} key={d.value} style={[styles.day, date === d.value && styles.selected]} onPress={() => setDate(d.value)}><Text style={[styles.dayLabel, date === d.value && styles.white]}>{d.label}</Text><Text style={[styles.dayNumber, date === d.value && styles.white]}>{fmt.number(d.day)}</Text></Pressable>)}</ScrollView>
    <Text style={styles.label}>{t('booking.chooseTime')}</Text><View style={styles.times}>{event.slots.map((time, index) => <Pressable testID={`booking-time-${index}`} key={time} style={[styles.time, slot === time && styles.selected]} onPress={() => setSlot(time)}><Text style={[styles.timeText, slot === time && styles.white]}>{time}</Text></Pressable>)}</View>
    <View style={styles.guestRow}><Text style={styles.label}>{t('booking.howManyGuests')}</Text><View style={styles.stepper}><Pressable testID="booking-guests-decrease" disabled={guests <= 1} onPress={() => setGuests(guests - 1)} style={styles.iconButton}><Icon name="remove" size={21} color={guests <= 1 ? colors.muted : colors.book} /></Pressable><Text testID="booking-guests" style={styles.guestCount}>{fmt.number(guests)}</Text><Pressable testID="booking-guests-increase" disabled={guests >= 8} onPress={() => setGuests(guests + 1)} style={styles.iconButton}><Icon name="add" size={21} color={colors.book} /></Pressable></View></View>
    <Text style={styles.label}>{t('booking.yourDetails')}</Text><TextInput testID="booking-name" style={styles.input} value={name} onChangeText={setName} placeholder={t('booking.fullName')} placeholderTextColor={colors.muted} maxLength={80} autoComplete="name" /><TextInput testID="booking-phone" style={styles.input} value={phone} onChangeText={v => setPhone(v.replace(/\D/g, '').slice(0, 10))} placeholder={t('booking.phonePlaceholder')} placeholderTextColor={colors.muted} keyboardType="phone-pad" autoComplete="tel" maxLength={10} />
    <View style={styles.estimate}><Text style={styles.sub}>{t('booking.indicativeTotal', { guests: guestsText })}</Text><Text testID="booking-estimate" style={styles.estimatePrice}>{fmt.money(event.price * guests)}</Text></View><Text style={styles.notice}>{t('booking.sampleNotice')}</Text>
    {!!error && <Text testID="booking-error" style={styles.error}>{t(ERROR_TEXT[error])}</Text>}<Pressable testID="booking-submit" disabled={busy} onPress={submit} style={[styles.submit, busy && styles.disabled]}>{busy ? <ActivityIndicator color={colors.surface} /> : <><Text style={styles.submitText}>{t('booking.saveDemo')}</Text><Icon name="arrow-forward" size={19} color={colors.surface} /></>}</Pressable>
  </ScrollView></KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface }, content: { padding: 20, paddingBottom: 40 }, top: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  topTitle: { flex: 1, color: colors.onSurface, fontSize: 17, fontWeight: '700' }, demo: { color: colors.book, fontSize: 9, fontWeight: '800', backgroundColor: colors.bookSoft, padding: 7, borderRadius: 5 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, image: { width: '100%', height: 160, borderRadius: 20, marginBottom: 20 },
  title: { fontSize: 27, fontWeight: '700', color: colors.onSurface, letterSpacing: -0.8 }, sub: { fontSize: 12, color: colors.muted, marginTop: 5, flexShrink: 1 }, venue: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  label: { fontSize: 15, fontWeight: '700', color: colors.onSurface, marginTop: 26, marginBottom: 13, flexShrink: 1 }, choices: { gap: 8 }, day: { minWidth: 57, minHeight: 70, paddingHorizontal: 8, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.bookSoft, gap: 5 },
  dayLabel: { fontSize: 10, color: colors.book }, dayNumber: { fontSize: 21, fontWeight: '700', color: colors.book }, selected: { backgroundColor: colors.book }, white: { color: colors.surface },
  times: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, time: { minHeight: 44, paddingHorizontal: 15, borderRadius: 12, backgroundColor: colors.bookSoft, justifyContent: 'center' }, timeText: { color: colors.book, fontSize: 12, fontWeight: '600' },
  guestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }, stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bookSoft, borderRadius: 12, marginTop: 18 }, guestCount: { fontSize: 17, fontWeight: '700', color: colors.book },
  input: { minHeight: 50, paddingHorizontal: 15, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 12, marginBottom: 12, color: colors.onSurface, fontSize: 14 }, estimate: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingVertical: 16, borderTopWidth: 1, borderColor: colors.border }, estimatePrice: { color: colors.book, fontSize: 22, fontWeight: '700' },
  notice: { fontSize: 11, lineHeight: 18, color: colors.muted, marginVertical: 12 }, submit: { minHeight: 52, backgroundColor: colors.book, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15, marginTop: 12, width: '100%' }, submitText: { color: colors.surface, fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'center' }, error: { color: colors.onError, fontSize: 12, lineHeight: 20 }, disabled: { opacity: 0.6 },
  empty: { flex: 1, padding: 28, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.bookSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  confirmText: { fontSize: 14, lineHeight: 23, color: colors.onSurface, textAlign: 'center', marginTop: 16 }, reference: { fontSize: 11, color: colors.book, marginTop: 14 }, backExplore: { minHeight: 44, marginTop: 12, justifyContent: 'center' }, backText: { color: colors.book, fontWeight: '600' },
});