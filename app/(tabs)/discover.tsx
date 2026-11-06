import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppDimensions } from '@/src/layout';
import { View, StyleSheet, FlatList, Platform, ViewToken } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Reel } from '@/src/api';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { colors, lightPane, popBase, radius } from '@/src/theme';
import { useDiscovery } from '@/src/use-discovery';
import { LoadState } from '@/src/components/catalog-sections';
import { OneGlyph } from '@/src/components/one-button';
import { Tap } from '@/src/components/tap';
import { ChipRow } from '@/src/components/chip-row';
import { MutedVideo } from '@/src/components/muted-video';
import { FeaturedReelsIntro } from '@/src/components/featured-reels-intro';
import { useFormat, useTranslation } from '@/src/i18n';
import { departmentArt, departmentName } from '@/src/departments';
import { useFeatures } from '@/src/features';
import { useAuth } from '@/src/auth';
import { SoonBadge } from '@/src/components/soon-badge';
import { useMotionAllowed } from '@/src/motion';

// Instagram-Explore style: reel tiles on screen play muted on a loop; at most MAX_PLAYING at once so
// a long grid never decodes a dozen videos. Leaving the tab pauses them.
const MAX_PLAYING = 4;
const SIDE = 10; const GAP = 6;
// The day the featured reels intro last played for an account (`<key>:<account id>`, signed-out guests share 'guest'):
// it plays the first time each account opens Discover each day.
const INTRO_KEY = 'onelocal.discover.featured-intro.v1';
// Each filter's picture from Home's services ('Reels' gets a play icon instead, 'All' none).
const FILTER_ICONS: Record<string, number> = { Food: departmentArt.food, Fresh: departmentArt.grocery, Care: departmentArt.care };

export default function Discover() {
  const focused = useIsFocused(); const features = useFeatures(); const motion = useMotionAllowed(); const [visible, setVisible] = useState<string[]>([]); // Reduce Motion: tiles stay still photos
  const [intro, setIntro] = useState(false);
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ViewToken<Reel>[] }) => {
    const next = viewableItems.filter(v => v.isViewable && !!v.item?.video).map(v => v.item.id).slice(0, MAX_PLAYING);
    setVisible(prev => (prev.join() === next.join() ? prev : next));
  });
  // A tile has to stay in view a moment before its video starts, so a fast scroll does not spin players up and down.
  const [viewability] = useState(() => ({ itemVisiblePercentThreshold: 60, minimumViewTime: 250 }));
  // The tiles wait while the intro plays over them.
  const playing = useCallback((id: string) => motion && focused && !intro && visible.includes(id), [motion, focused, intro, visible]);
  const { data, isError, refetch } = useDiscovery(); const [filter, setFilter] = useState('All');
  const insets = useSafeAreaInsets(); const { width } = useAppDimensions(); const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat();
  // The featured reels are the catalogue's video reels (the photo ads have no video).
  const featured = useMemo(() => data?.filter(r => !!r.video) ?? [], [data]);
  // Decided once sign-in has loaded, so a signed-in customer is not counted as a guest for a moment.
  const { ready, session } = useAuth(); const account = session?.user.id ?? 'guest';
  useEffect(() => {
    if (!focused || !ready || !featured.length) return;
    let live = true; const today = new Date().toDateString(); const key = `${INTRO_KEY}:${account}`;
    AsyncStorage.getItem(key).then(day => { if (live && day !== today) { setIntro(true); void AsyncStorage.setItem(key, today).catch(() => {}); } }).catch(() => {});
    return () => { live = false; };
  }, [focused, ready, account, featured.length]);
  // The filter ids are codes (they drive the filtering and the test ids); only the shown words are translated.
  const filterLabel: Record<string, string> = { All: t('common.all'), Reels: t('discover.filter.reels'), Food: departmentName(t, 'food'), Fresh: t('discover.filter.fresh'), Care: t('discover.filter.care') };
  const columns = width > 600 ? 4 : 3; const tileWidth = (width - SIDE * 2 - (columns - 1) * GAP) / columns;
  const filtered = data?.filter(r => filter === 'All' || (filter === 'Reels' ? !!r.video : filter === 'Food' ? r.product?.department === 'food' : filter === 'Fresh' ? r.product?.department === 'grocery' : ['beauty', 'pharmacy'].includes(r.product?.department || '')));
  // Start the top row playing straight away: on the web the list does not always report what is on
  // screen until the first scroll. Scrolling then hands playback to whatever is in view.
  const firstVideos = (filtered ?? []).slice(0, columns * 2).filter(r => !!r.video).slice(0, MAX_PLAYING).map(r => r.id).join(',');
  useEffect(() => { setVisible(firstVideos ? firstVideos.split(',') : []); }, [firstVideos]);
  return <View testID="discover-screen" style={styles.screen}>
    {/* A light wash of the brand green, fading to white behind the grid. */}
    <LinearGradient pointerEvents="none" colors={[colors.cityMid, colors.cityFade, colors.surface]} locations={[0, 0.5, 1]} style={[styles.wash, { height: insets.top + 260 }]} />
    <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
      <View style={styles.headCopy}><Text testID="discover-title" style={styles.title}>{t('discover.title')}<Text style={styles.green}>.</Text></Text><Text testID="discover-subtitle" style={styles.subtitle}>{t('discover.subtitle')}</Text></View>
      <Tap testID="discover-search" accessibilityRole="button" accessibilityLabel={t('common.search')} onPress={() => router.push('/search')} style={styles.round}><Icon name="search-outline" size={19} color={colors.onSurface} /></Tap>
      <Tap testID="discover-ai-button" accessibilityRole="button" accessibilityLabel={t('discover.askLabel')} onPress={() => router.push('/assistant')} style={styles.ai}><OneGlyph size={20} /><Text style={styles.aiLabel}>{t('discover.askAi')}</Text>{!features.assistant && <SoonBadge testID="discover-ai-soon" />}</Tap>
    </View>
    <ChipRow selected={filter} onSelect={setFilter} style={styles.filters} contentContainerStyle={styles.filterContent} chips={['All', 'Reels', 'Food', 'Fresh', 'Care'].map(f => ({
      id: f, testID: `discover-filter-${f.toLowerCase()}`, label: filterLabel[f],
      lead: f === 'All' ? undefined : f === 'Reels' ? (on: boolean) => <View style={[styles.play, on && styles.playOn]}><Icon name="play" size={12} color={on ? colors.forest : colors.surface} /></View> : () => <Image source={FILTER_ICONS[f]} style={styles.chipIcon} contentFit="contain" cachePolicy="memory-disk" />,
    }))} />
    {!data ? <LoadState error={isError} retry={refetch} /> : <FlatList testID="discover-grid" key={columns} numColumns={columns} data={filtered} keyExtractor={r => r.id} showsVerticalScrollIndicator={false} onViewableItemsChanged={onViewable} viewabilityConfig={viewability} contentContainerStyle={styles.grid} columnWrapperStyle={styles.gridRow} ListHeaderComponent={<Text testID="discover-content-notice" style={styles.notice}>{t('discover.notice')}</Text>} ListEmptyComponent={<Text testID="discover-empty" style={styles.empty}>{t('discover.empty')}</Text>} renderItem={({ item: r, index }) => <Tap testID={`discover-tile-${r.id}`} accessibilityLabel={r.video ? t('discover.openReel', { name: r.product?.name || r.brand?.name || r.creator }) : t('discover.openPhotoAd', { name: r.product?.name || r.brand?.name || r.creator })} onPress={() => router.push({ pathname: '/reels', params: { id: r.id } } as never)} style={[styles.tile, { width: tileWidth, height: tileWidth * 1.6 }]}>
      <Image testID={`discover-image-${r.id}`} source={r.poster || r.product?.image || r.brand?.image} contentFit="cover" style={StyleSheet.absoluteFill} transition={180} />
      {!!r.video && playing(r.id) && <MutedVideo source={Platform.OS === 'web' ? r.video_web : r.video} />}
      <LinearGradient colors={[colors.transparent, colors.overlayDeep]} style={styles.gradient} />
      <View style={styles.topIcon}><Icon name={r.video ? 'play' : 'images-outline'} size={13} color={colors.surface} /></View>
      {index === 0 && filter === 'All' && <View style={styles.trending}><Text style={styles.trendingText}>{t('discover.forYou')}</Text></View>}
      <View style={styles.caption}><Text testID={`discover-name-${r.id}`} style={styles.name} numberOfLines={2}>{r.product?.name || r.brand?.name || r.creator}</Text>{r.product && <Text testID={`discover-price-${r.id}`} style={styles.price}>{fmt.money(r.product.price)}<Text style={styles.shop}>{` · ${t('discover.shop')}`}</Text></Text>}</View>
    </Tap>} />}
    {intro && <FeaturedReelsIntro reels={featured} onDone={() => setIntro(false)} />}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  wash: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 14 },
  headCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.onSurface, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -1 },
  green: { color: colors.forest },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  round: { ...lightPane, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  ai: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, boxShadow: popBase(3) },
  aiLabel: { color: colors.surface, fontSize: 13, fontWeight: '800' },
  filters: { flexGrow: 0, flexShrink: 0 },
  filterContent: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  chipIcon: { width: 30, height: 30 },
  play: { width: 26, height: 26, marginLeft: 2, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest },
  playOn: { backgroundColor: colors.electricLime },
  grid: { paddingHorizontal: SIDE, paddingBottom: 135 },
  gridRow: { gap: GAP, marginBottom: GAP },
  tile: { backgroundColor: colors.cream, overflow: 'hidden', borderRadius: radius.md },
  gradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' },
  topIcon: { position: 'absolute', right: 8, top: 8, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
  caption: { position: 'absolute', left: 10, right: 8, bottom: 10 },
  name: { color: colors.surface, fontWeight: '700', fontSize: 12, lineHeight: 15 },
  price: { color: colors.electricLime, fontSize: 12, fontWeight: '800', marginTop: 4 },
  shop: { color: colors.surface, fontSize: 10, fontWeight: '500' },
  notice: { fontSize: 11, color: colors.muted, marginHorizontal: 6, marginBottom: 10 },
  empty: { color: colors.muted, padding: 30, fontSize: 13 },
  trending: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 7, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.electricLime },
  trendingText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, color: colors.forestDeep },
});
