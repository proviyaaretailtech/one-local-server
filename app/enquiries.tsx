import { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/src/ui/text';
import { useFocusEffect, useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { bookingDay, getEnquiries, SavedEnquiry } from '@/src/bookings';
import { useFormat, useTranslation } from '@/src/i18n';
import { colors } from '@/src/theme';
export default function Enquiries() {
  const [items, setItems] = useState<SavedEnquiry[]>([]);
  const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat();
  const dayText = (iso: string) => { const day = bookingDay(iso); return day ? fmt.date(day) : iso; };
  useFocusEffect(useCallback(() => { getEnquiries().then(setItems).catch(() => {}); }, []));
  return <ScrollView testID="enquiries-screen" contentContainerStyle={styles.content}><View style={styles.header}><Pressable testID="enquiries-back" onPress={() => router.replace('/book-it' as any)} style={styles.back}><Icon name="arrow-back" size={23} color={colors.onSurface} /></Pressable><Text style={styles.title}>{t('enquiries.title')}</Text></View><Text style={styles.sub}>{t('enquiries.sub')}</Text>{items.map(item => <View key={item.id} testID={`saved-enquiry-${item.id}`} style={styles.card}><Icon name="ticket-outline" size={24} color={colors.book} /><View style={styles.flex}><Text style={styles.name}>{item.title}</Text><Text style={styles.detail}>{dayText(item.date)} · {item.slot}</Text><Text style={styles.detail}>{t('enquiries.guestsRef', { guests: t('booking.guests', { count: item.guests, value: fmt.number(item.guests) }), ref: item.id.slice(0, 8).toUpperCase() })}</Text><Text style={styles.badge}>{t('enquiries.badge')}</Text></View></View>)}{!items.length && <View testID="enquiries-empty" style={styles.empty}><Icon name="ticket-outline" size={45} color={colors.book} /><Text style={styles.name}>{t('enquiries.emptyTitle')}</Text><Pressable testID="enquiries-explore" style={styles.explore} onPress={() => router.replace('/book-it' as any)}><Text style={styles.exploreText}>{t('booking.exploreBookIt')}</Text></Pressable></View>}</ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 }, header: { flexDirection: 'row', alignItems: 'center', gap: 8 }, back: { height: 44, width: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 22, color: colors.onSurface, fontWeight: '700', letterSpacing: -0.7 }, sub: { color: colors.muted, fontSize: 11, marginVertical: 18 },
  card: { padding: 18, borderRadius: 17, backgroundColor: colors.bookSoft, marginBottom: 12, flexDirection: 'row', gap: 14 }, flex: { flex: 1 }, name: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  detail: { color: colors.muted, fontSize: 11, marginTop: 7 }, badge: { fontSize: 8, letterSpacing: 1, color: colors.book, fontWeight: '700', marginTop: 14 }, empty: { alignItems: 'center', paddingTop: 50, gap: 24 },
  explore: { paddingHorizontal: 22, paddingVertical: 6, minHeight: 48, justifyContent: 'center', borderRadius: 13, backgroundColor: colors.book }, exploreText: { color: colors.surface, fontSize: 14, fontWeight: '700', textAlign: 'center' },
});