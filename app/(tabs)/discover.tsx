import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDimensions } from '@/src/layout';
import { View, Pressable, StyleSheet, FlatList, ScrollView, Platform, ViewToken } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { Reel } from '@/src/api';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '@/src/theme';
import { useDiscovery } from '@/src/use-discovery';
import { LoadState } from '@/src/components/catalog-sections';
import { OneGlyph } from '@/src/components/one-button';
import { useFormat, useTranslation } from '@/src/i18n';
import { departmentName } from '@/src/departments';
import { useFeatures } from '@/src/features';
import { SoonBadge } from '@/src/components/soon-badge';
import { useMotionAllowed } from '@/src/motion';

// Instagram-Explore style: reel tiles on screen play muted on a loop; at most MAX_PLAYING at once so
// a long grid never decodes a dozen videos. Leaving the tab pauses them.
const MAX_PLAYING = 4;

// The tile keeps its product photo until the video is actually playing, so loading never shows a blank box.
// On the web a <video> ignores inset alone and keeps its own size (300x150, then the clip's size), so it is stretched explicitly (tileVideo).

function TileVideo({ source }: { source: string }) {
  const view = useRef<VideoView>(null); const [shown, setShown] = useState(false);
  const player = useVideoPlayer(source, p => { p.loop = true; p.muted = true; p.timeUpdateEventInterval = 0.5; });
  useEffect(() => {
    const tick = player.addListener('timeUpdate', e => { if (e.currentTime > 0.2) setShown(true); });
    return () => tick.remove();
  }, [player]);
  useEffect(() => {
    // Web: play() through the element so a cancelled play (scrolling past) is not reported as an error.
    // The element is not attached on the first pass, so try again once the video is ready to play.
    const start = () => {
      const element = Platform.OS === 'web' ? (view.current as unknown as { nativeRef?: { current?: HTMLVideoElement } })?.nativeRef?.current : undefined;
      if (element) void element.play().catch(() => {}); else player.play();
    };
    start();
    const ready = player.addListener('statusChange', e => { if (e.status === 'readyToPlay') start(); });
    return () => { ready.remove(); player.pause(); };
  }, [player]);
  return <VideoView ref={view} player={player} nativeControls={false} contentFit="cover" style={[StyleSheet.absoluteFill, styles.tileVideo, { opacity: shown ? 1 : 0 }]} pointerEvents="none" />;
}

export default function Discover() {
  const focused = useIsFocused(); const features = useFeatures(); const motion = useMotionAllowed(); const [visible, setVisible] = useState<string[]>([]); // Reduce Motion: tiles stay still photos
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<Reel>[] }) => {
    setVisible(viewableItems.filter(v => v.isViewable && !!v.item?.video).map(v => v.item.id).slice(0, MAX_PLAYING));
  }).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const playing = useCallback((id: string) => motion && focused && visible.includes(id), [motion, focused, visible]);
  const { data, isError, refetch } = useDiscovery(); const [filter, setFilter] = useState('All');
  const insets = useSafeAreaInsets(); const { width } = useAppDimensions(); const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat();
  // The filter ids are codes (they drive the filtering and the test ids); only the shown words are translated.
  const filterLabel: Record<string, string> = { All: t('common.all'), Reels: t('discover.filter.reels'), Food: departmentName(t, 'food'), Fresh: t('discover.filter.fresh'), Care: t('discover.filter.care') };
  const columns = width > 600 ? 4 : 3; const tileWidth = (width - 8 - (columns - 1) * 3) / columns;
  const filtered = data?.filter(r => filter === 'All' || (filter === 'Reels' ? !!r.video : filter === 'Food' ? r.product.department === 'food' : filter === 'Fresh' ? r.product.department === 'grocery' : ['beauty', 'pharmacy'].includes(r.product.department || '')));
  // Start the top row playing straight away: on the web the list does not always report what is on
  // screen until the first scroll. Scrolling then hands playback to whatever is in view.
  const firstVideos = (filtered ?? []).slice(0, columns * 2).filter(r => !!r.video).slice(0, MAX_PLAYING).map(r => r.id).join(',');
  useEffect(() => { setVisible(firstVideos ? firstVideos.split(',') : []); }, [firstVideos]);
  return <View testID="discover-screen" style={[styles.screen, { paddingTop: insets.top }]}>
    <View style={styles.header}><View><Text testID="discover-title" style={styles.title}>{t('discover.title')}<Text style={styles.green}>.</Text></Text><Text testID="discover-subtitle" style={styles.subtitle}>{t('discover.subtitle')}</Text></View><Pressable testID="discover-ai-button" accessibilityLabel={t('discover.askLabel')} onPress={() => router.push('/assistant' as any)} style={styles.ai}><OneGlyph size={23} /><Text style={styles.aiLabel}>{t('discover.askAi')}</Text>{!features.assistant && <SoonBadge testID="discover-ai-soon" />}</Pressable></View>
    <ScrollView horizontal style={styles.filters} contentContainerStyle={styles.filterContent} showsHorizontalScrollIndicator={false}>{['All', 'Reels', 'Food', 'Fresh', 'Care'].map(f => <Pressable key={f} testID={`discover-filter-${f.toLowerCase()}`} accessibilityState={{ selected: filter === f }} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.selected]}><Text style={[styles.chipText, filter === f && styles.selectedText]}>{filterLabel[f]}</Text></Pressable>)}</ScrollView>
    {!data ? <LoadState error={isError} retry={refetch} /> : <FlatList testID="discover-grid" key={columns} numColumns={columns} data={filtered} keyExtractor={r => r.id} showsVerticalScrollIndicator={false} onViewableItemsChanged={onViewable} viewabilityConfig={viewability} contentContainerStyle={styles.grid} columnWrapperStyle={styles.gridRow} ListHeaderComponent={<Text testID="discover-content-notice" style={styles.notice}>{t('discover.notice')}</Text>} ListEmptyComponent={<Text testID="discover-empty" style={styles.empty}>{t('discover.empty')}</Text>} renderItem={({ item: r, index }) => <Pressable testID={`discover-tile-${r.id}`} accessibilityLabel={r.video ? t('discover.openReel', { name: r.product.name }) : t('discover.openPhotoAd', { name: r.product.name })} onPress={() => router.push({ pathname: '/reels', params: { id: r.id } } as any)} style={({ pressed }) => [styles.tile, { width: tileWidth, height: tileWidth * 1.6 }, pressed && styles.pressed]}><Image testID={`discover-image-${r.id}`} source={r.product.image} contentFit="cover" style={StyleSheet.absoluteFill} transition={180} />{!!r.video && playing(r.id) && <TileVideo source={Platform.OS === 'web' ? r.video_web : r.video} />}<LinearGradient colors={[colors.transparent, colors.overlayDeep]} style={styles.gradient} /><View style={styles.topIcon}><Icon name={r.video ? 'play' : 'images-outline'} size={15} color={colors.surface} /></View>{index === 0 && filter === 'All' && <View style={styles.trending}><Text style={styles.trendingText}>{t('discover.forYou')}</Text></View>}<View style={styles.caption}><Text testID={`discover-name-${r.id}`} style={styles.name} numberOfLines={2}>{r.product.name}</Text><Text testID={`discover-price-${r.id}`} style={styles.price}>{fmt.money(r.product.price)}<Text style={styles.shop}>{` · ${t('discover.shop')}`}</Text></Text></View></Pressable>} />}
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.surface }, header: { padding: 20, paddingTop: 18, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { color: colors.onSurface, fontSize: 29, fontWeight: '800', letterSpacing: -1 }, green: { color: colors.forest }, subtitle: { fontSize: 13, color: colors.muted, marginTop: 4 }, ai: { backgroundColor: colors.brandPrimary, borderRadius: 22, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14 }, aiLabel: { color: colors.surface, fontSize: 13, fontWeight: '700' }, filters: { flexGrow: 0, flexShrink: 0 }, filterContent: { paddingHorizontal: 20, gap: 8, paddingBottom: 10 }, chip: { minHeight: 40, borderRadius: 20, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }, selected: { backgroundColor: colors.brandPrimary }, chipText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: '600' }, selectedText: { color: colors.lime }, grid: { paddingHorizontal: 4, paddingBottom: 135 }, gridRow: { gap: 3, marginBottom: 3 }, tile: { backgroundColor: colors.cream, overflow: 'hidden', borderRadius: 12 }, tileVideo: { width: '100%', height: '100%' }, gradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' }, topIcon: { position: 'absolute', right: 7, top: 8, backgroundColor: colors.overlay, borderRadius: 10, padding: 4 }, caption: { position: 'absolute', left: 9, right: 6, bottom: 10 }, name: { color: colors.surface, fontWeight: '700', fontSize: 12, lineHeight: 15 }, price: { color: colors.lime, fontSize: 12, fontWeight: '800', marginTop: 4 }, shop: { color: colors.surface, fontSize: 10, fontWeight: '500' }, notice: { fontSize: 11, color: colors.muted, marginHorizontal: 12, marginTop: 3, marginBottom: 12 }, empty: { color: colors.muted, padding: 30, fontSize: 13 }, trending: { position: 'absolute', left: 6, top: 9, padding: 4, borderRadius: 6, backgroundColor: colors.lime }, trendingText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, color: colors.forestDeep }, pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] } });