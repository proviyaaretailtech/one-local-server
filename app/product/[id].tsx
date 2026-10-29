// Immersive product page: a blurred, department-tinted backdrop behind a swipeable gallery; "Play
// images" runs a slow cinematic zoom through the photos; "Watch" plays the product's reel (or its
// store's film); a white sheet carries price, unit price, store, compare and similar items; the
// footer echoes the hero image. Data: GET /api/products/:id/story.
import { useEffect, useRef, useState } from 'react';
import { useAppDimensions } from '@/src/layout';
import { Animated, Easing, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import Icon from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { colors, radius, spacing } from '@/src/theme';
import { logoSize, logoTile } from '@/src/logo-tile';
import { apiGet, Product } from '@/src/api';
import { useCart } from '@/src/cart';
import { useCustomer } from '@/src/customer';
import { useCompare, COMPARE_LIMIT } from '@/src/compare';
import { unitPrice, unitPriceLabel } from '@/src/unit-price';
import { useFormat, useTranslation } from '@/src/i18n';
import { paletteFor } from '@/src/departments';
import { nativeDriver, useMotionAllowed } from '@/src/motion';
import { ProductRail } from '@/src/components/catalog-sections';
import { useStoreEtas } from '@/src/use-store-etas';
import { departmentName } from '@/src/departments';

type Story = {
  product: Product; gallery: string[];
  video: { url: string; web: string; poster: string; label: string } | null;
  category: { id: string; name: string } | null;
  store: { id: string; name: string; logo: string; tagline: string; delivery_time: string; rating: number } | null;
  brand: { id: string; name: string; logo: string; tagline: string } | null;
  related: Product[];
};
const SLIDE_MS = 2600;
const INK = '#050605';

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets(); const router = useRouter(); const { width, height } = useAppDimensions();
  const { add, remove, qtyOf, totalItems, totalPrice } = useCart();
  const { saved, toggleSaved, error: savedError } = useCustomer();
  const compare = useCompare(); const motion = useMotionAllowed(); const { t } = useTranslation(); const fmt = useFormat();
  const [story, setStory] = useState<Story | null>(null); const [failed, setFailed] = useState(false);
  const [slide, setSlide] = useState(0); const [playing, setPlaying] = useState(false); const [watching, setWatching] = useState(false);
  const etas = useStoreEtas();
  const [compareFull, setCompareFull] = useState(false); const [tick, setTick] = useState(0);
  const pager = useRef<ScrollView>(null); const zoom = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!id) return; setStory(null); setFailed(false); setSlide(0); setPlaying(false); setWatching(false);
    apiGet<Story>(`/products/${id}/story`).then(setStory).catch(() => setFailed(true));
  }, [id]);

  // Slideshow: each slide slowly zooms and pans; after SLIDE_MS it moves on (a single photo replays its zoom).
  useEffect(() => {
    if (!playing || !story) return;
    zoom.setValue(0);
    const anim = Animated.timing(zoom, { toValue: 1, duration: SLIDE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver });
    if (motion) anim.start();
    const timer = setTimeout(() => {
      const next = (slide + 1) % story.gallery.length;
      if (next !== slide) { setSlide(next); pager.current?.scrollTo({ x: next * width, animated: true }); } else setTick(n => n + 1);
    }, SLIDE_MS);
    return () => { clearTimeout(timer); anim.stop(); };
  }, [playing, slide, tick, story, width, zoom, motion]);

  if (failed) return <View testID="product-detail" style={[s.center, { paddingTop: insets.top }]}><Icon name="cloud-offline-outline" size={32} color={colors.muted} /><Text style={s.muted}>{t('product.loadFailed')}</Text><Pressable testID="pd-back-btn" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={s.retry}><Text style={s.retryText}>{t('common.goBack')}</Text></Pressable></View>;
  if (!story) return <View testID="product-detail" style={s.center}><View style={s.skeletonHero} /><View style={s.skeletonLine} /><View style={[s.skeletonLine, { width: '40%' }]} /></View>;

  const { product, gallery, video } = story;
  const eta = (product.store_id && etas[product.store_id]) || product.delivery_min; // the store's real time when known
  const palette = paletteFor(`/${product.department ?? 'grocery'}`);
  const qty = qtyOf(product.id); const savings = product.mrp - product.price;
  const unit = unitPrice(product.price, product.weight);
  const heroH = Math.min(Math.round(height * 0.56), 500);
  const shotH = heroH - insets.top - 110; const shotW = Math.min(Math.round(width * 0.78), shotH);
  const isSaved = saved.includes(product.id); const inCompare = compare.has(product.id);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => { const i = Math.round(e.nativeEvent.contentOffset.x / width); if (i !== slide && i >= 0 && i < gallery.length) setSlide(i); };
  const toggleCompare = () => {
    const r = compare.toggle(product); void Haptics.selectionAsync().catch(() => {});
    setCompareFull(r === 'full');
  };
  const kenBurns = (i: number) => i === slide && playing ? [
    { scale: zoom.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
    { translateX: zoom.interpolate({ inputRange: [0, 1], outputRange: [0, i % 2 ? -14 : 14] }) },
  ] : [];

  return <View style={s.screen} testID="product-detail">
    <ScrollView contentContainerStyle={{ paddingBottom: 170 }} showsVerticalScrollIndicator={false}>
      {/* Hero */}
      <View style={{ height: heroH, overflow: 'hidden' }}>
        <Image source={product.image} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={Platform.OS === 'web' ? 30 : 60} />
        <LinearGradient colors={[`${palette.top}E6`, `${palette.mid}B3`, colors.surface]} locations={[0, 0.62, 1]} style={StyleSheet.absoluteFill} />
        <ScrollView ref={pager} testID="pd-gallery" horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} onScroll={Platform.OS === 'web' ? onScroll : undefined} scrollEventThrottle={64} style={{ marginTop: insets.top + 56 }}>
          {gallery.map((uri, i) => <View key={uri} style={{ width, height: shotH, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={[s.shot, { width: shotW, height: shotH, transform: kenBurns(i) }]}><Image testID={`pd-gallery-${i}`} source={uri} style={{ width: shotW, height: shotH }} contentFit="cover" /></Animated.View>
          </View>)}
        </ScrollView>
        {watching && video && <VideoPreview source={Platform.OS === 'web' ? video.web : video.url} label={video.label} onClose={() => setWatching(false)} top={insets.top} width={width} height={heroH} />}
        {!watching && <View style={s.heroControls}>
          <Pressable testID="pd-play-images" accessibilityRole="button" accessibilityLabel={playing ? t('product.pauseImages') : t('product.playImages')} onPress={() => setPlaying(p => !p)} style={s.glassPill}>
            <Icon name={playing ? 'pause' : 'play'} size={14} color={colors.onSurface} /><Text style={s.glassText}>{playing ? t('product.pause') : t('product.playImages')}</Text>
          </Pressable>
          {gallery.length > 1 && <View style={s.dots}>{gallery.map((_, i) => <View key={i} style={[s.dot, i === slide && s.dotOn]} />)}</View>}
          {video ? <Pressable testID="pd-watch-video" accessibilityRole="button" accessibilityLabel={video.label} onPress={() => { setPlaying(false); setWatching(true); }} style={[s.glassPill, s.watch]}>
            <Icon name="videocam" size={14} color={colors.surface} /><Text style={[s.glassText, { color: colors.surface }]}>{t('product.watch')}</Text>
          </Pressable> : <View style={{ width: 80 }} />}
        </View>}
      </View>

      {/* Sheet */}
      <View style={s.sheet}>
        {!!savedError && <Text testID="pd-save-error" style={{ color: colors.onError }}>{savedError}</Text>}
        <View style={s.chipsRow}>
          <View style={s.delivery}><Icon name="flash" size={12} color={colors.onSurface} /><Text style={s.deliveryText}>{fmt.eta(eta)}</Text></View>
          <View style={s.rating}><Icon name="star" size={11} color={colors.gold} /><Text style={s.ratingText}>{fmt.number(product.rating, { maxFractionDigits: 1, minFractionDigits: 1 })}</Text></View>
          {!!story.category && <Pressable testID="pd-category-link" onPress={() => router.push(`/category/${story.category!.id}` as any)} style={s.catLink}><Text style={s.catLinkText}>{t('product.moreInCategory', { name: story.category.name })}</Text><Icon name="chevron-forward" size={12} color={colors.forest} /></Pressable>}
        </View>
        <Text testID="pd-name" style={s.name}>{product.name}</Text>
        <Text style={s.weight}>{product.weight}</Text>
        <View style={s.priceRow}>
          <Text testID="pd-price" style={s.price}>{fmt.money(product.price)}</Text>
          {product.mrp > product.price && <><Text style={s.mrp}>{fmt.money(product.mrp)}</Text><View style={s.off}><Text style={s.offText}>{t('product.off', { pct: fmt.percent(Math.round(savings / product.mrp * 100)) })}</Text></View></>}
        </View>
        <Text testID="pd-unit-price" style={s.unit}>{unit ? `${unitPriceLabel(unit, t, fmt)} · ` : ''}{product.department === 'food' ? t('product.gstAdded') : t('product.taxIncluded')}</Text>

        <View style={s.actions}>
          <Pressable testID="pd-compare-toggle" accessibilityRole="button" accessibilityState={{ selected: inCompare }} onPress={toggleCompare} style={[s.action, inCompare && s.actionOn]}>
            <Icon name={inCompare ? 'checkmark-circle' : 'git-compare-outline'} size={17} color={inCompare ? colors.electricLime : colors.onSurface} /><Text style={[s.actionText, inCompare && s.actionTextOn]}>{inCompare ? t('product.inCompare') : t('product.addToCompare')}</Text>
          </Pressable>
          <Pressable testID="pd-save-product" accessibilityLabel={isSaved ? t('product.removeFromWishlist') : t('product.saveToWishlist')} accessibilityState={{ selected: isSaved }} onPress={() => { void toggleSaved(product.id).catch(() => {}); void Haptics.selectionAsync().catch(() => {}); }} style={s.action}>
            <Icon name={isSaved ? 'heart' : 'heart-outline'} size={17} color={isSaved ? colors.onError : colors.onSurface} /><Text style={s.actionText}>{isSaved ? t('product.saved') : t('common.save')}</Text>
          </Pressable>
        </View>
        {compareFull && <Text testID="pd-compare-note" style={s.note}>{t('product.compareFull', { limit: fmt.number(COMPARE_LIMIT) })}</Text>}
        {compare.items.length > 0 && <Pressable testID="pd-open-compare" onPress={() => router.push('/compare' as any)} style={s.compareBar}>
          <View style={s.compareThumbs}>{compare.items.map(p => <Image key={p.id} source={p.image} style={s.compareThumb} contentFit="cover" />)}</View>
          <Text style={s.compareBarText}>{compare.items.length === 1 ? t('product.compareAddOne') : t('product.compareItems', { n: fmt.number(compare.items.length) })}</Text>
          <Icon name="arrow-forward" size={16} color={colors.electricLime} />
        </Pressable>}

        {!!story.store && <Pressable testID="pd-store-card" onPress={() => router.push(`/store/${story.store!.id}` as any)} style={s.store}>
          <View style={s.storeLogo}>{!!story.store.logo && <Image source={story.store.logo} style={s.storeLogoImage} contentFit="contain" />}</View>
          <View style={{ flex: 1 }}><Text style={s.storeName} numberOfLines={1}>{story.store.name}</Text><Text style={s.storeMeta} numberOfLines={1}>{`${story.store.tagline || t('product.storeFallback')} · ${fmt.deliveryTime(story.store.delivery_time)}`}</Text></View>
          <Icon name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>}
        {!!story.brand && <Pressable testID="pd-brand-link" accessibilityRole="link" onPress={() => router.push(`/brand/${story.brand!.id}` as any)} style={s.brandLink}>
          <Text style={s.catLinkText}>{t('product.moreFromBrand', { name: story.brand.name })}</Text><Icon name="chevron-forward" size={12} color={colors.forest} />
        </Pressable>}
      </View>

      {/* Everything the catalogue knows about the item, nothing more. */}
      <View testID="pd-details" style={s.details}>
        <Text style={[s.sectionTitle, { marginHorizontal: 0 }]}>{t('product.details.title')}</Text>
        {([
          ['brand', t('product.details.brand'), story.brand?.name],
          ['pack', t('product.details.packSize'), product.weight],
          ['category', t('product.details.category'), story.category?.name],
          ['store', t('product.details.soldBy'), story.store?.name],
          ['type', t('product.details.type'), product.department ? departmentName(t, product.department) : ''],
          ['delivery', t('product.details.delivery'), fmt.eta(eta)],
          ['rating', t('product.details.rating'), fmt.number(product.rating, { maxFractionDigits: 1, minFractionDigits: 1 }) + ' / 5'],
          ['mrp', t('product.details.mrp'), product.mrp > product.price ? fmt.money(product.mrp) : ''],
          ['save', t('product.details.youSave'), savings > 0 ? `${fmt.money(savings)} (${fmt.percent(Math.round(savings / product.mrp * 100))})` : ''],
          ['tax', t('product.details.taxes'), product.department === 'food' ? t('product.gstAdded') : t('product.taxIncluded')],
        ] as const).filter(([, , value]) => !!value).map(([key, label, value]) => <View key={key} style={s.detailRow}><Text style={s.detailLabel}>{label}</Text><Text testID={`pd-detail-${key}`} style={s.detailValue}>{value}</Text></View>)}
      </View>

      {story.related.length > 0 && <View style={s.relatedWrap}><Text style={s.sectionTitle}>{t('product.moreLikeThis')}</Text><ProductRail products={story.related} scope="pd-related" /></View>}

      {/* Footer echoes the hero */}
      <View style={s.footer}>
        <Image source={product.image} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={Platform.OS === 'web' ? 24 : 50} />
        <LinearGradient colors={[colors.surface, `${palette.mid}CC`, `${palette.color}F2`]} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />
        <Image source={product.image} style={s.footerShot} contentFit="contain" />
        <Text style={s.footerTitle}>{story.brand?.tagline || t('product.footerTagline')}</Text>
        <Text style={s.footerSub}>{t('product.footerSub', { name: story.brand?.name ?? story.store?.name ?? 'OneLocal' })}</Text>
      </View>
    </ScrollView>

    {/* Top bar */}
    <View style={[s.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
      <Pressable testID="pd-back-btn" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={s.round}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
      <Pressable testID="pd-open-cart" accessibilityLabel={t('product.openCart')} onPress={() => router.push('/cart' as any)} style={s.round}><Icon name="bag-handle-outline" size={20} color={colors.onSurface} />{totalItems > 0 && <View style={s.badge}><Text style={s.badgeText}>{fmt.number(totalItems)}</Text></View>}</Pressable>
    </View>

    {/* Sticky add bar */}
    <View style={[s.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
      {totalItems > 0 && <View style={s.cartPreview}><Text style={s.cartMeta}>{t('product.bagSummary', { n: fmt.number(totalItems), price: fmt.money(totalPrice) })}</Text><Pressable onPress={() => router.push('/cart' as any)} testID="pd-view-cart" hitSlop={10}><Text style={s.cartLink}>{t('product.viewBag')}</Text></Pressable></View>}
      {qty === 0 ? <Pressable style={s.addCta} onPress={() => { void Haptics.selectionAsync().catch(() => {}); add(product); }} testID="pd-add-btn">
        <View style={{ flex: 1 }}><Text style={s.addPrice}>{fmt.money(product.price)}</Text>{product.mrp > product.price && <Text style={s.addMrp}>{t('product.mrpPrice', { price: fmt.money(product.mrp) })}</Text>}</View>
        <View style={s.addPill}><Text style={s.addCtaText}>{t('product.addToBag')}</Text><Icon name="add" size={18} color={INK} /></View>
      </Pressable> : <View style={s.stepperLarge}>
        <Pressable onPress={() => remove(product.id)} style={s.stepBtnLg} testID="pd-dec" accessibilityLabel={t('product.removeOne')}><Text style={s.stepBtnLgText}>−</Text></Pressable>
        <View style={s.stepQtyWrap}><Text style={s.stepQtyLg}>{t('product.bagSummary', { n: fmt.number(qty), price: fmt.money(qty * product.price) })}</Text></View>
        <Pressable onPress={() => add(product)} style={s.stepBtnLg} testID="pd-inc" accessibilityLabel={t('product.addOneMore')}><Text style={s.stepBtnLgText}>+</Text></Pressable>
      </View>}
    </View>
  </View>;
}

function VideoPreview({ source, label, onClose, top, width, height }: { source: string; label: string; onClose: () => void; top: number; width: number; height: number }) {
  const { t } = useTranslation();
  const player = useVideoPlayer(source, p => { p.loop = true; p.muted = true; p.play(); });
  return <View testID="pd-video" style={[StyleSheet.absoluteFill, s.videoWrap]}>
    <VideoView player={player} nativeControls={false} contentFit="cover" style={{ position: 'absolute', top: 0, left: 0, width, height }} />
    <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent', 'rgba(0,0,0,0.5)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
    <View style={[s.videoTop, { top: top + 64 }]}><View style={s.videoLabel}><Icon name="videocam" size={12} color={colors.electricLime} /><Text style={s.videoLabelText}>{label}</Text></View>
      <Pressable testID="pd-video-close" accessibilityLabel={t('product.closeVideo')} onPress={onClose} style={s.videoClose}><Icon name="close" size={20} color={colors.surface} /></Pressable></View>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.surface, padding: 24 },
  muted: { color: colors.muted }, retry: { minHeight: 44, paddingHorizontal: 18, borderRadius: 16, backgroundColor: colors.limeSoft, justifyContent: 'center' }, retryText: { color: colors.forest, fontWeight: '700' },
  skeletonHero: { width: '100%', height: 320, borderRadius: 28, backgroundColor: colors.surfaceSecondary },
  skeletonLine: { width: '70%', height: 18, borderRadius: 9, backgroundColor: colors.surfaceSecondary },
  shot: { borderRadius: 30, overflow: 'hidden', backgroundColor: colors.glassBright, boxShadow: [{ offsetX: 0, offsetY: 18, blurRadius: 40, color: 'rgba(0,0,0,0.18)' }] },
  heroControls: { position: 'absolute', left: 20, right: 20, bottom: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  glassPill: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: colors.glassBright, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.glassLine },
  glassText: { fontSize: 12, fontWeight: '700', color: colors.onSurface, flexShrink: 1 },
  watch: { backgroundColor: INK, borderColor: INK },
  dots: { flexDirection: 'row', gap: 5 }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.2)' }, dotOn: { width: 16, backgroundColor: INK },
  videoWrap: { backgroundColor: INK, overflow: 'hidden' },
  videoTop: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  videoLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)' },
  videoLabelText: { color: colors.surface, fontSize: 11, fontWeight: '700' },
  videoClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  sheet: { marginTop: -26, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.surface, padding: spacing.lg, paddingTop: 22 },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  delivery: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.pastelYellow, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  deliveryText: { fontSize: 11, fontWeight: '800', color: colors.onSurface, textTransform: 'uppercase' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill },
  ratingText: { fontSize: 11, fontWeight: '800', color: colors.onSurface },
  catLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, marginLeft: 'auto' }, brandLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, marginTop: 6, alignSelf: 'flex-start' }, catLinkText: { fontSize: 11, fontWeight: '700', color: colors.forest, flexShrink: 1 },
  name: { fontSize: 24, fontWeight: '800', color: colors.onSurface, letterSpacing: -0.5 },
  weight: { fontSize: 14, color: colors.muted, marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 14 },
  price: { fontSize: 28, fontWeight: '800', color: colors.onSurface },
  mrp: { fontSize: 16, color: colors.muted, textDecorationLine: 'line-through' },
  off: { backgroundColor: colors.pastelGreen, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill }, offText: { color: colors.onSuccess, fontSize: 11, fontWeight: '800' },
  unit: { fontSize: 12, color: colors.muted, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  action: { flex: 1, minHeight: 46, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  actionOn: { backgroundColor: INK, borderColor: INK },
  actionText: { fontSize: 13, fontWeight: '700', color: colors.onSurface, flexShrink: 1, textAlign: 'center' }, actionTextOn: { color: colors.electricLime },
  note: { fontSize: 12, color: colors.onError, marginTop: 8 },
  compareBar: { marginTop: 12, minHeight: 52, borderRadius: 18, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  compareThumbs: { flexDirection: 'row' }, compareThumb: { width: 30, height: 30, borderRadius: 10, marginRight: -8, borderWidth: 2, borderColor: INK, backgroundColor: colors.surface },
  compareBarText: { flex: 1, color: colors.surface, fontSize: 13, fontWeight: '700', marginLeft: 8 },
  store: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20, backgroundColor: colors.surfaceSecondary },
  storeLogo: logoTile(48), storeLogoImage: { width: logoSize(48), height: logoSize(48) },
  storeName: { fontSize: 14, fontWeight: '800', color: colors.onSurface }, storeMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  relatedWrap: { marginTop: 8 },
  details: { marginTop: 8, marginHorizontal: spacing.lg, padding: spacing.lg, borderRadius: 20, backgroundColor: colors.surfaceSecondary },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  detailLabel: { fontSize: 13, color: colors.muted, flexShrink: 0 },
  detailValue: { flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '700', color: colors.onSurface },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface, marginHorizontal: 20, marginBottom: 12, letterSpacing: -0.3 },
  footer: { marginTop: 28, height: 260, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 30, overflow: 'hidden' },
  footerShot: { width: 110, height: 110, marginBottom: 16, opacity: 0.95 },
  footerTitle: { color: colors.surface, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center', paddingHorizontal: 24 },
  footerSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 6, letterSpacing: 0.5 },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 10 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.glassBright, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.glassLine },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: INK, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: colors.electricLime, fontSize: 9, fontWeight: '800' },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.glassBright, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  cartPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cartMeta: { fontSize: 12, color: colors.muted, fontWeight: '600', flexShrink: 1 }, cartLink: { fontSize: 13, fontWeight: '800', color: colors.forest },
  addCta: { minHeight: 58, borderRadius: 20, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 6 },
  addPrice: { color: colors.surface, fontSize: 18, fontWeight: '800' }, addMrp: { color: 'rgba(255,255,255,0.55)', fontSize: 10, textDecorationLine: 'line-through', marginTop: 1 },
  addPill: { minHeight: 46, maxWidth: '65%', paddingHorizontal: 18, paddingVertical: 4, borderRadius: 16, backgroundColor: colors.electricLime, flexDirection: 'row', alignItems: 'center', gap: 6 },
  addCtaText: { color: INK, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  stepperLarge: { minHeight: 58, borderRadius: 20, backgroundColor: INK, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  stepBtnLg: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' }, stepBtnLgText: { color: colors.electricLime, fontSize: 24, fontWeight: '800' },
  stepQtyWrap: { flex: 1, alignItems: 'center' }, stepQtyLg: { color: colors.surface, fontSize: 15, fontWeight: '800', textAlign: 'center' },
});
