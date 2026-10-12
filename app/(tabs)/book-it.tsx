import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CityScroll } from '@/src/motion';
import { BrandSpotlight } from '@/src/components/brand-spotlight';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '@/src/theme';
import { useCatalog } from '@/src/use-catalog';
import { EventRail, LoadState, SectionTitle } from '@/src/components/catalog-sections';
import { useTranslation } from '@/src/i18n';
export default function BookIt() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const [filter, setFilter] = useState(kind || 'all');
  useEffect(() => { if (kind) setFilter(kind); }, [kind]);
  const { data, isError, refetch } = useCatalog();
  const router = useRouter(); const { t } = useTranslation();
  if (!data) return <LoadState error={isError} retry={refetch} />;
  return <CityScroll testID="department-screen-book-it" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
    <BrandSpotlight variant="book-it" />
    <View style={styles.sheet}>
    <View style={styles.filters}>{[{ id: 'all', name: t('departments.filters.explore'), icon: 'compass-outline' }, { id: 'movies', name: t('departments.filters.movies'), icon: 'film-outline' }, { id: 'events', name: t('departments.filters.events'), icon: 'musical-notes-outline' }, { id: 'activities', name: t('departments.filters.activities'), icon: 'bicycle-outline' }].map(f => <Pressable testID={`book-filter-${f.id}`} key={f.id} onPress={() => setFilter(f.id)} style={[styles.filter, filter === f.id && styles.selected]}><Icon name={f.icon as any} size={23} color={filter === f.id ? colors.surface : colors.book} /><Text style={[styles.filterText, filter === f.id && styles.white]}>{f.name}</Text></Pressable>)}</View>
    {(filter === 'all' || filter === 'movies') && <><SectionTitle id="book-movies" title={t('departments.bookIt.moviesTitle')} subtitle={t('departments.bookIt.moviesSubtitle')} /><EventRail events={data.events.filter(e => e.kind === 'movies')} scope="book-movies" /></>}
    {(filter === 'all' || filter === 'events') && <><SectionTitle id="book-events" title={t('departments.bookIt.eventsTitle')} subtitle={t('departments.bookIt.eventsSubtitle')} /><EventRail events={data.events.filter(e => e.kind === 'events')} scope="book-events" /></>}
    {(filter === 'all' || filter === 'activities') && <><SectionTitle id="book-activities" title={t('departments.bookIt.activitiesTitle')} subtitle={t('departments.bookIt.activitiesSubtitle')} /><EventRail events={data.events.filter(e => e.kind === 'activities')} scope="book-activities" /></>}
    <Pressable testID="book-view-enquiries" onPress={() => router.push('/enquiries' as any)} style={styles.enquiries}><Icon name="ticket-outline" size={22} color={colors.book} /><View style={styles.flex}><Text style={styles.enquiryTitle}>{t('departments.bookIt.enquiriesTitle')}</Text><Text style={styles.enquirySub}>{t('departments.bookIt.enquiriesSub')}</Text></View><Icon name="arrow-forward" size={20} color={colors.book} /></Pressable>
    <Text testID="booking-demo-notice" style={styles.notice}>{t('departments.bookIt.demoNotice')}</Text>
    </View>
  </CityScroll>;
}
const styles = StyleSheet.create({ content: { paddingBottom: 24 }, sheet: { backgroundColor: colors.glassBright, borderTopLeftRadius: 34, borderTopRightRadius: 34, paddingBottom: 20 }, filters: { flexDirection: 'row', gap: 10, padding: 20, paddingBottom: 0 }, filter: { flex: 1, minHeight: 68, paddingVertical: 8, paddingHorizontal: 2, borderRadius: 24, alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.bookSoft }, selected: { backgroundColor: colors.book }, filterText: { color: colors.book, fontSize: 9, fontWeight: '500', textAlign: 'center' }, white: { color: colors.surface }, enquiries: { margin: 20, marginTop: 30, padding: 17, borderRadius: 25, backgroundColor: colors.bookSoft, flexDirection: 'row', alignItems: 'center', gap: 12 }, flex: { flex: 1 }, enquiryTitle: { fontSize: 13, fontWeight: '600', color: colors.book }, enquirySub: { color: colors.muted, fontSize: 10, marginTop: 4 }, notice: { marginHorizontal: 24, fontSize: 10, lineHeight: 16, color: colors.muted } });