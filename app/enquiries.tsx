import { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@/src/ui/text';
import { useFocusEffect, useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { bookingDay, getEnquiries, SavedEnquiry } from '@/src/bookings';
import { useFormat, useTranslation } from '@/src/i18n';
import { AccountLayout, accountStyles as s } from '@/src/components/account-layout';
import { Button } from '@/src/ui/button';
import { EmptyState } from '@/src/ui/states';
import { colors, radius } from '@/src/theme';
export default function Enquiries() {
  const [items, setItems] = useState<SavedEnquiry[]>([]);
  const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat();
  const dayText = (iso: string) => { const day = bookingDay(iso); return day ? fmt.date(day) : iso; };
  useFocusEffect(useCallback(() => { getEnquiries().then(setItems).catch(() => {}); }, []));
  return <AccountLayout id="enquiries" title={t('enquiries.title')} subtitle={t('enquiries.sub')} fallback="/book-it">
    {items.map(item => <View key={item.id} testID={`saved-enquiry-${item.id}`} style={[s.card, s.row, st.card]}>
      <View style={[s.tile, st.tile]}><Icon name="ticket-outline" size={22} color={colors.book} /></View>
      <View style={[s.flex, st.copy]}>
        <Text style={s.title}>{item.title}</Text>
        <Text style={s.hint}>{dayText(item.date)} · {item.slot}</Text>
        <Text style={s.hint}>{t('enquiries.guestsRef', { guests: t('booking.guests', { count: item.guests, value: fmt.number(item.guests) }), ref: item.id.slice(0, 8).toUpperCase() })}</Text>
        <Text style={st.badge}>{t('enquiries.badge')}</Text>
      </View>
    </View>)}
    {!items.length && <EmptyState testID="enquiries-empty" icon="ticket-outline" title={t('enquiries.emptyTitle')}><Button testID="enquiries-explore" title={t('booking.exploreBookIt')} onPress={() => router.replace('/book-it')} /></EmptyState>}
  </AccountLayout>;
}
const st = StyleSheet.create({
  card: { alignItems: 'flex-start' },
  // Book It's own sky blue, so a booking reads as one at a glance.
  tile: { backgroundColor: colors.bookTop },
  copy: { gap: 4 },
  badge: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, overflow: 'hidden', fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: colors.book, backgroundColor: colors.bookFade },
});
