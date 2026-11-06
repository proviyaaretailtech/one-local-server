// Product page, as a sheet over the page it was opened from: it rises as a card with that page dimmed around it, grows
// to fill the screen as you scroll into it, and settles back into a card when you scroll back to the top. Under the card,
// the item and similar ones turn on a wheel of round photos; swipe or tap to show another in the card. Pulling the card down
// past the top, tapping outside it, its close button or back sends it away; links to other pages (store, brand,
// category, cart, compare) close it on the way. Inside: a swipeable gallery of the item's photos on a blurred,
// department-tinted backdrop; a white sheet with the item's details, store, compare and similar items (which open in
// this same sheet); the footer echoes the hero image; the price and "Add to cart" stay at the card's foot.
// Data: GET /api/products/:id/story.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppDimensions } from '@/src/layout';
import { NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import Reanimated, { Extrapolation, interpolate, scrollTo, type SharedValue, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import { setStatusBarStyle } from 'expo-status-bar';
import { type Href, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { colors, neu, radius, soft, spacing } from '@/src/theme';
import { logoSize, logoTile } from '@/src/logo-tile';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { apiGet, BACKEND, Catalog, Product, Store } from '@/src/api';
import { useCart } from '@/src/cart';
import { useCustomer } from '@/src/customer';
import { useCompare, COMPARE_LIMIT } from '@/src/compare';
import { unitPrice, unitPriceLabel } from '@/src/unit-price';
import { useFormat, useTranslation } from '@/src/i18n';
import { departmentName, paletteFor } from '@/src/departments';
import { useMotionAllowed } from '@/src/motion';
import { duration, reEasing, reSpring } from '@/src/motion-tokens';
import { haptic } from '@/src/haptics';
import { ProductRail } from '@/src/components/catalog-sections';
import { OpenProductContext } from '@/src/components/product-card';
import { RollingNumber } from '@/src/components/motion/rolling-number';
import { PageDot } from '@/src/ui/page-dot';
import { dockBottom } from '@/src/components/bottom-navigation';
import { useStoreEtas } from '@/src/use-store-etas';

type Story = {
  product: Product; gallery: string[];
  category: { id: string; name: string } | null;
  store: { id: string; name: string; logo: string; tagline: string; delivery_time: string; rating: number } | null;
  brand: { id: string; name: string; logo: string; tagline: string } | null;
  related: Product[];
};
const FAINT = 'rgba(0,0,0,0.2)'; // a gallery dot not showing
const SIDE = 12;          // the card's margin at its sides before it grows
const CONTROLS = 64;      // room at the top of the card for its close and share buttons
const PULL_TO_CLOSE = 90; // how far past the top a pull must go to send the sheet away
const WHEEL = 84;         // the band under the card where the similar items turn on their wheel
const DOT = 56;           // a similar item's round photo
const STEP = 64;          // the wheel's photos, centre to centre

// What the app already holds about an item (the catalogue and the shop list the list screens load), so its page slides in
// whole instead of as a skeleton; the story request then adds its other photos and similar items.
function heldStory(queryClient: QueryClient, id: string): Story | null {
  const catalog = queryClient.getQueryData<Catalog>(['catalog']); const product = catalog?.products.find(p => p.id === id);
  if (!catalog || !product) return null;
  const category = catalog.categories.find(c => c.id === product.category_id);
  return {
    product, gallery: [product.image], related: [],
    category: category ? { id: category.id, name: category.name } : null,
    store: queryClient.getQueryData<Store[]>(['stores'])?.find(s => s.id === product.store_id) ?? null,
    brand: catalog.brands.find(b => b.id === product.brand_id) ?? null,
  };
}

export default function ProductDetail() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets(); const router = useRouter(); const navigation = useNavigation(); const { width, height } = useAppDimensions();
  const { add, remove, qtyOf, totalItems, totalPrice } = useCart();
  const { saved, toggleSaved, error: savedError } = useCustomer();
  const compare = useCompare(); const motion = useMotionAllowed(); const { t } = useTranslation(); const fmt = useFormat();
  const queryClient = useQueryClient();
  const [story, setStory] = useState<Story | null>(() => id ? heldStory(queryClient, id) : null); const [failed, setFailed] = useState(false);
  // The slider's items: the first item whose similar items arrive, in the middle of them. Fixed while the sheet is open,
  // so moving through it never reshuffles it.
  const [slider, setSlider] = useState<Product[] | null>(null);
  const [slide, setSlide] = useState(0); const [notice, setNotice] = useState<'copied' | 'failed' | null>(null);
  const etas = useStoreEtas();
  const [compareFull, setCompareFull] = useState(false);

  // The sheet. `shown` brings it in (0 below the screen, 1 in place); `y` is how far it is scrolled; `dropped` is how far
  // a pull had taken it down when it was let go to close (-1 until then).
  const shown = useSharedValue(0); const y = useSharedValue(0); const dropped = useSharedValue(-1);
  // `fresh` fades the card's content when another item is picked; `ready` fades the slider in once it has its items;
  // `flash` fades the share notice; `pop` springs the stepper in.
  const fresh = useSharedValue(1); const ready = useSharedValue(0); const flash = useSharedValue(0); const pop = useSharedValue(1);
  const list = useAnimatedRef<Reanimated.ScrollView>(); const gone = useRef(false);
  // The card sits just under the status bar and above the slider; scrolling its first `top0` points grows it.
  // The wheel turns where the app's dock floats, just under the card.
  const wheelBottom = dockBottom(insets.bottom);
  const top0 = insets.top + 14; const bottom0 = wheelBottom + WHEEL + 4; const pageW = width - SIDE * 2;
  const heroH = Math.min(Math.round(height * 0.5), 440);

  useEffect(() => {
    if (!id) return; let live = true;
    setStory(s => s?.product.id === id ? s : heldStory(queryClient, id)); setFailed(false); setSlide(0);
    // A newer item may have been asked for since (from the slider or similar items); only the latest answer is shown.
    apiGet<Story>(`/products/${id}/story`).then(next => {
      if (!live) return;
      setStory(next); setSlider(s => s ?? [...next.related.slice(0, 3), next.product, ...next.related.slice(3, 8)]);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id, queryClient]);
  const shownId = story?.product.id;
  useEffect(() => { if (shownId) fresh.set(withTiming(1, { duration: duration.gentle })); }, [shownId, fresh]);
  useEffect(() => { if (slider) ready.set(withTiming(1, { duration: duration.gentle })); }, [slider, ready]);
  useEffect(() => {
    if (!notice) return;
    flash.set(withTiming(1, { duration: duration.quick }));
    const timer = setTimeout(() => { flash.set(withTiming(0, { duration: duration.quick }, done => { if (done) scheduleOnRN(setNotice, null); })); }, 2200);
    return () => clearTimeout(timer);
  }, [notice, flash]);

  // In and out. Every way of leaving (back, close, a link elsewhere) removes this screen; the sheet glides away first.
  useEffect(() => { shown.set(withTiming(1, { duration: duration.slow, easing: reEasing.enter })); }, [shown]);
  useEffect(() => navigation.addListener('beforeRemove', e => {
    if (gone.current) return;
    e.preventDefault();
    const leave = () => { gone.current = true; navigation.dispatch(e.data.action); };
    shown.set(withTiming(0, { duration: duration.gentle, easing: reEasing.exit }, finished => { if (finished) scheduleOnRN(leave); }));
  }), [navigation, shown]);
  const close = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }, [router]);
  const leaveTo = (href: Href) => router.replace(href);
  // Another item in this sheet: the one showing fades out, then the next is shown from the top of the card and fades in.
  const showHere = useCallback((next: string) => {
    if (next === id) return;
    const swap = () => { router.setParams({ id: next }); list.current?.scrollTo({ y: 0, animated: true }); };
    fresh.set(withTiming(0, { duration: duration.quick }, done => { if (done) scheduleOnRN(swap); }));
  }, [id, router, fresh, list]);
  const share = async (product: Product) => {
    const link = `${BACKEND}/product/${product.id}`;
    try {
      // Not every browser has a share sheet, so on the web the link is copied instead.
      if (Platform.OS === 'web') { await Clipboard.setStringAsync(link); setNotice('copied'); }
      else await Share.share({ title: product.name, message: t('product.shareMessage', { name: product.name, link }) });
    } catch { setNotice('failed'); }
  };

  // Light status bar over the dimmed page; dark once the card has grown under it.
  useFocusEffect(useCallback(() => { setStatusBarStyle('light'); return () => setStatusBarStyle('dark'); }, []));
  useAnimatedReaction(() => y.value > top0 / 2, (full, was) => { if (was !== null && full !== was) scheduleOnRN(setStatusBarStyle, full ? 'dark' : 'light'); }, [top0]);

  // How far the card has grown: 0 a card, 1 the whole screen.
  const grown = (v: number) => { 'worklet'; return Math.min(Math.max(v, 0), top0) / top0; };
  // Let go part-way through growing and the card eases on to whichever it is nearer, a card or the whole screen.
  const settle = (v: number) => { 'worklet'; if (v > 0 && v < top0) scrollTo(list, 0, v < top0 / 2 ? 0 : top0, true); };
  const onSheetScroll = useAnimatedScrollHandler({
    onScroll: e => { y.value = e.contentOffset.y; },
    onEndDrag: e => {
      if (e.contentOffset.y < -PULL_TO_CLOSE && dropped.value < 0) { dropped.value = -e.contentOffset.y; scheduleOnRN(close); return; }
      if (Math.abs(e.velocity?.y ?? 0) < 0.3) settle(e.contentOffset.y); // no fling, so no momentum end to settle it
    },
    onMomentumEnd: e => settle(e.contentOffset.y),
  });
  const dim = useAnimatedStyle(() => ({ opacity: shown.value * interpolate(dropped.value >= 0 ? dropped.value : -y.value, [0, 400], [1, 0.4], Extrapolation.CLAMP) }));
  const card = useAnimatedStyle(() => {
    const g = grown(y.value); const drop = dropped.value >= 0 ? dropped.value : Math.max(0, -y.value);
    return {
      top: top0 * (1 - g), left: SIDE * (1 - g), right: SIDE * (1 - g), bottom: bottom0 * (1 - g), borderRadius: radius.lg * (1 - g),
      opacity: motion ? 1 : shown.value,
      transform: [{ translateY: (motion ? (1 - shown.value) * height : 0) + drop }],
    };
  });
  // The slider rises with the card and fades as the card grows over it.
  const strip = useAnimatedStyle(() => ({ opacity: ready.value * shown.value * (1 - grown(y.value)), transform: [{ translateY: (1 - shown.value) * (WHEEL + wheelBottom) }] }));
  // The content rides along as the card grows, so it moves exactly with the finger; a pull past the top moves the card,
  // not the content inside it.
  const follow = useAnimatedStyle(() => ({ opacity: fresh.value, transform: [{ translateY: Math.min(y.value, top0) }] }));
  const noticeLook = useAnimatedStyle(() => ({ opacity: flash.value, transform: [{ translateY: (1 - flash.value) * -6 }] }));
  const popLook = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const controls = useAnimatedStyle(() => ({ transform: [{ translateY: insets.top * grown(y.value) }] }));
  const header = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [heroH - 150, heroH - 90], [0, 1], Extrapolation.CLAMP) }));
  const footer = useAnimatedStyle(() => ({ paddingBottom: 12 + insets.bottom * grown(y.value) }));

  const sheet = (body: ReactNode) => <View testID="product-detail" style={s.screen} accessibilityViewIsModal>
    {/* The page behind goes soft and dim, so the card and the slider stand clear of it. */}
    <Reanimated.View style={[StyleSheet.absoluteFill, dim]}><BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} /><View style={[StyleSheet.absoluteFill, s.dim]} /><Pressable testID="pd-backdrop" accessibilityLabel={t('common.close')} onPress={close} style={StyleSheet.absoluteFill} /></Reanimated.View>
    {!!slider && <Reanimated.View style={[s.wheel, { bottom: wheelBottom }, strip]}><Slider items={slider} current={id} onPick={showHere} /></Reanimated.View>}
    <Reanimated.View style={[s.card, card]}>{body}</Reanimated.View>
  </View>;
  if (failed) return sheet(<View style={s.center}><Icon name="cloud-offline-outline" size={32} color={colors.muted} /><Text style={s.muted}>{t('product.loadFailed')}</Text><Pressable testID="pd-back-btn" onPress={close} style={s.retry}><Text style={s.retryText}>{t('common.goBack')}</Text></Pressable></View>);
  if (!story) return sheet(<View style={s.center}><View style={s.skeletonHero} /><View style={s.skeletonLine} /><View style={[s.skeletonLine, { width: '40%' }]} /></View>);

  const { product, gallery } = story;
  const eta = (product.store_id && etas[product.store_id]) || product.delivery_min; // the store's real time when known
  const palette = paletteFor(`/${product.department ?? 'grocery'}`);
  const qty = qtyOf(product.id); const savings = product.mrp - product.price;
  const unit = unitPrice(product.price, product.weight);
  const shotH = heroH - CONTROLS - 64; const shotW = Math.min(Math.round(pageW * 0.78), shotH);
  // What the content keeps below its last words: room for the cart bar (its padding, the key, the home indicator once the
  // card fills the screen, the cart line when there is one) and the `top0` the content rides down as the card grows.
  const below = 14 + 56 + 12 + insets.bottom + (totalItems > 0 ? 26 : 0) + top0;
  const isSaved = saved.includes(product.id); const inCompare = compare.has(product.id);
  const onGallery = (e: NativeSyntheticEvent<NativeScrollEvent>) => { const i = Math.round(e.nativeEvent.contentOffset.x / pageW); if (i !== slide && i >= 0 && i < gallery.length) setSlide(i); };
  const addOne = (e: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (!qty && motion) { pop.set(0.86); pop.set(withSpring(1, reSpring.snappy)); } // the stepper springs in where the key was
    haptic.add(); add(product, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
  };
  const toggleCompare = () => {
    const r = compare.toggle(product); void Haptics.selectionAsync().catch(() => {});
    setCompareFull(r === 'full');
  };

  return sheet(<>
    <Reanimated.ScrollView ref={list} onScroll={onSheetScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
      <Reanimated.View key={product.id} style={follow}>
        {/* Hero: the item's photos, one at a time. */}
        <View style={{ height: heroH, overflow: 'hidden' }}>
          <Image source={product.image} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={Platform.OS === 'web' ? 30 : 60} />
          <LinearGradient colors={[`${palette.top}E6`, `${palette.mid}B3`, colors.surface]} locations={[0, 0.62, 1]} style={StyleSheet.absoluteFill} />
          {/* As wide as the card before it grows, so a swipe always lands on a whole photo. */}
          <ScrollView testID="pd-gallery" horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onGallery} onScroll={Platform.OS === 'web' ? onGallery : undefined} scrollEventThrottle={64} style={[s.pager, { width: pageW }]}>
            {gallery.map((uri, i) => <View key={uri} style={{ width: pageW, height: shotH, alignItems: 'center', justifyContent: 'center' }}>
              <View style={[s.shot, { width: shotW, height: shotH }]}><Image testID={`pd-gallery-${i}`} source={uri} style={{ width: shotW, height: shotH }} contentFit="cover" /></View>
            </View>)}
          </ScrollView>
          {gallery.length > 1 && <View testID="pd-gallery-dots" style={s.dots}>{gallery.map((_, i) => <PageDot key={i} on={i === slide} size={6} wide={16} color={FAINT} onColor={colors.splashInk} />)}</View>}
        </View>

        {/* Sheet */}
        <View style={s.sheet}>
          {!!savedError && <Text testID="pd-save-error" style={{ color: colors.onError }}>{savedError}</Text>}
          <View style={s.chipsRow}>
            <View style={s.delivery}><Icon name="flash" size={12} color={colors.onSurface} /><Text style={s.deliveryText}>{fmt.eta(eta)}</Text></View>
            <View style={s.rating}><Icon name="star" size={11} color={colors.gold} /><Text style={s.ratingText}>{fmt.number(product.rating, { maxFractionDigits: 1, minFractionDigits: 1 })}</Text></View>
            {!!story.category && <Pressable testID="pd-category-link" onPress={() => leaveTo(`/category/${story.category!.id}`)} style={s.catLink}><Text style={s.catLinkText}>{t('product.moreInCategory', { name: story.category.name })}</Text><Icon name="chevron-forward" size={12} color={colors.forest} /></Pressable>}
          </View>
          <Text testID="pd-name" style={s.name}>{product.name}</Text>
          <Text style={s.weight}>{product.weight}</Text>
          {/* The price itself sits once, in the bar at the card's foot, beside "Add to cart". */}
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
          {compare.items.length > 0 && <Pressable testID="pd-open-compare" onPress={() => leaveTo('/compare')} style={s.compareBar}>
            <View style={s.compareThumbs}>{compare.items.map(p => <Image key={p.id} source={p.image} style={s.compareThumb} contentFit="cover" />)}</View>
            <Text style={s.compareBarText}>{compare.items.length === 1 ? t('product.compareAddOne') : t('product.compareItems', { n: fmt.number(compare.items.length) })}</Text>
            <Icon name="arrow-forward" size={16} color={colors.electricLime} />
          </Pressable>}

          {!!story.store && <Pressable testID="pd-store-card" onPress={() => leaveTo(`/store/${story.store!.id}`)} style={s.store}>
            <View style={s.storeLogo}>{!!story.store.logo && <Image source={story.store.logo} style={s.storeLogoImage} contentFit="contain" />}</View>
            <View style={{ flex: 1 }}><Text style={s.storeName} numberOfLines={1}>{story.store.name}</Text><Text style={s.storeMeta} numberOfLines={1}>{`${story.store.tagline || t('product.storeFallback')} · ${fmt.deliveryTime(story.store.delivery_time)}`}</Text></View>
            <Icon name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>}
          {!!story.brand && <Pressable testID="pd-brand-link" accessibilityRole="link" onPress={() => leaveTo(`/brand/${story.brand!.id}`)} style={s.brandLink}>
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

        {story.related.length > 0 && <View style={s.relatedWrap}><Text style={s.sectionTitle}>{t('product.moreLikeThis')}</Text><OpenProductContext.Provider value={showHere}><ProductRail products={story.related} scope="pd-related" /></OpenProductContext.Provider></View>}

        {/* Footer echoes the hero. It runs on down behind the cart bar (and the strip the growing card keeps out of
            view below that), so no white is left between the two. */}
        <View style={[s.footer, { height: 260 + below, paddingBottom: 30 + below }]}>
          <Image source={product.image} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={Platform.OS === 'web' ? 24 : 50} />
          {/* Deepest by the words, as it was before the footer ran on, then the same colour on down behind the bar. */}
          <LinearGradient colors={[colors.surface, `${palette.mid}CC`, `${palette.color}F2`, `${palette.color}F2`]} locations={[0, 91 / (260 + below), 260 / (260 + below), 1]} style={StyleSheet.absoluteFill} />
          <Image source={product.image} style={s.footerShot} contentFit="contain" />
          <Text style={s.footerTitle}>{story.brand?.tagline || t('product.footerTagline')}</Text>
          <Text style={s.footerSub}>{t('product.footerSub', { name: story.brand?.name ?? story.store?.name ?? 'OneLocal' })}</Text>
        </View>
      </Reanimated.View>
    </Reanimated.ScrollView>

    {/* Once the photo has scrolled away, a white bar with the item's name settles in behind the buttons. */}
    <Reanimated.View pointerEvents="none" style={[s.header, { height: insets.top + CONTROLS }, header]}><Text numberOfLines={1} style={[s.headerTitle, { marginTop: insets.top + 12 }]}>{product.name}</Text></Reanimated.View>
    {/* The buttons stay where they are on screen while the card grows past the status bar around them. */}
    <Reanimated.View style={[s.topBar, controls]} pointerEvents="box-none">
      <Pressable testID="pd-back-btn" accessibilityLabel={t('common.close')} onPress={close} style={s.round}><Icon name="chevron-down" size={22} color={colors.onSurface} /></Pressable>
      <Pressable testID="pd-share" accessibilityLabel={t('product.share')} onPress={() => void share(product)} style={s.round}><Icon name="share-outline" size={20} color={colors.onSurface} /></Pressable>
      {!!notice && <Reanimated.View pointerEvents="none" style={[s.noticeWrap, noticeLook]}><View style={s.notice}><Text testID="pd-share-notice" style={s.noticeText}>{notice === 'copied' ? t('product.linkCopied') : t('product.shareFailed')}</Text></View></Reanimated.View>}
    </Reanimated.View>

    {/* At the card's foot, on a soft grey: the price, and "Add to cart" as a lime neumorphic key raised off that grey,
        soft-edged and lit from the top left (it sinks in while pressed), which becomes the quantity stepper once the item
        is in the cart. Once the card fills the screen the bar also clears the home indicator. */}
    <Reanimated.View style={[s.bottomBar, footer]}>
      {totalItems > 0 && <View style={s.cartRow}><Text numberOfLines={1} style={s.cartMeta}>{t('product.bagSummary', { n: fmt.number(totalItems), price: fmt.money(totalPrice) })}</Text><Pressable onPress={() => leaveTo('/cart')} testID="pd-view-cart" hitSlop={10}><Text style={s.cartLink}>{t('product.viewBag')}</Text></Pressable></View>}
      <View style={s.buy}>
        <View style={s.buyPrice}>
          <View style={s.buyRow}><Text testID="pd-price" style={s.buyNow}>{fmt.money(product.price)}</Text>{product.mrp > product.price && <Text style={s.buyMrp}>{fmt.money(product.mrp)}</Text>}</View>
          {product.mrp > product.price && <Text style={s.buyOff}>{t('product.off', { pct: fmt.percent(Math.round(savings / product.mrp * 100)) })}</Text>}
        </View>
        {qty === 0
          ? <Pressable testID="pd-add-btn" accessibilityRole="button" accessibilityLabel={t('product.addItem', { name: product.name })} onPress={addOne} style={({ pressed }) => [s.key, s.addKey, pressed && s.keyPressed]}>
              <Icon name="add" size={20} color={colors.forestDeep} /><Text numberOfLines={1} style={s.addKeyText}>{t('product.addToBag')}</Text>
            </Pressable>
          : <Reanimated.View style={[s.key, s.stepKey, popLook]}>
              <Pressable testID="pd-dec" accessibilityLabel={t('product.removeOne')} onPress={() => { haptic.remove(); remove(product.id); }} hitSlop={6} style={s.stepBtn}><Icon name={qty === 1 ? 'trash-outline' : 'remove'} size={19} color={colors.forestDeep} /></Pressable>
              <View style={s.stepMid}><RollingNumber testID="pd-qty" value={qty} text={fmt.number(qty)} lineHeight={20} style={s.stepQty} /><Text style={s.stepLabel}>{t('product.inCart')}</Text></View>
              <Pressable testID="pd-inc" accessibilityLabel={t('product.addOneMore')} onPress={addOne} hitSlop={6} style={s.stepBtn}><Icon name="add" size={20} color={colors.forestDeep} /></Pressable>
            </Reanimated.View>}
      </View>
    </Reanimated.View>
  </>);
}

// Under the card, the similar items turn on a wheel: round photos riding a gentle arc, the one in the card at the top and
// largest, the rest dipping, shrinking and fading as they go round. Swipe it round, or tap one, to show that item in the
// card.
function Slider({ items, current, onPick }: { items: Product[]; current: string; onPick: (id: string) => void }) {
  const { t } = useTranslation(); const { width } = useAppDimensions();
  // An item picked from "More like this" in the card may not be here; the wheel then stays where it is.
  const found = items.findIndex(p => p.id === current); const at = Math.max(found, 0);
  const list = useRef<Reanimated.ScrollView>(null); const x = useSharedValue(at * STEP);
  // Only a swipe picks an item: the wheel turning itself (on opening, or following the card) must not.
  const swiped = useRef(false);
  useEffect(() => { if (found >= 0) list.current?.scrollTo({ x: found * STEP, animated: true }); }, [found]);
  const onScroll = useAnimatedScrollHandler(e => { x.value = e.contentOffset.x; });
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!swiped.current) return; swiped.current = false;
    const next = items[Math.round(e.nativeEvent.contentOffset.x / STEP)]; if (next && next.id !== current) onPick(next.id);
  };
  return <Reanimated.ScrollView ref={list} testID="pd-slider" accessibilityLabel={t('product.moreLikeThis')} horizontal showsHorizontalScrollIndicator={false} snapToInterval={STEP} decelerationRate="fast"
      contentOffset={{ x: at * STEP, y: 0 }} onLayout={() => list.current?.scrollTo({ x: at * STEP, animated: false })} contentContainerStyle={{ paddingHorizontal: (width - STEP) / 2 }}
      onScroll={onScroll} scrollEventThrottle={16} onScrollBeginDrag={() => { swiped.current = true; }} onMomentumScrollEnd={settle}>
      {items.map((p, i) => <WheelPhoto key={p.id} product={p} index={i} x={x} selected={p.id === current} onPress={() => onPick(p.id)} />)}
    </Reanimated.ScrollView>;
}

function WheelPhoto({ product, index, x, selected, onPress }: { product: Product; index: number; x: SharedValue<number>; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const ride = useAnimatedStyle(() => {
    const away = Math.abs(x.value - index * STEP) / STEP;
    return {
      opacity: interpolate(away, [0, 1, 2, 3], [1, 0.9, 0.55, 0], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(away, [0, 1, 2, 3], [0, 7, 19, 34], Extrapolation.CLAMP) }, { scale: interpolate(away, [0, 1, 2], [1, 0.8, 0.66], Extrapolation.CLAMP) }],
    };
  });
  return <Pressable testID={`pd-slider-${product.id}`} accessibilityRole="button" accessibilityLabel={t('product.viewItem', { name: product.name })} accessibilityState={{ selected }} onPress={onPress} style={s.slot}>
    <Reanimated.View style={[s.wheelDot, ride]}><View style={s.wheelPhoto}><Image source={product.image} style={StyleSheet.absoluteFill} contentFit="cover" /></View></Reanimated.View>
  </Pressable>;
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  dim: { backgroundColor: colors.overlay },
  card: { position: 'absolute', overflow: 'hidden', backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  muted: { color: colors.muted }, retry: { minHeight: 44, paddingHorizontal: 18, borderRadius: 16, backgroundColor: colors.limeSoft, justifyContent: 'center' }, retryText: { color: colors.forest, fontWeight: '700' },
  skeletonHero: { width: '100%', height: 320, borderRadius: 28, backgroundColor: colors.surfaceSecondary },
  skeletonLine: { width: '70%', height: 18, borderRadius: 9, backgroundColor: colors.surfaceSecondary },
  pager: { alignSelf: 'center', marginTop: CONTROLS },
  shot: { borderRadius: 30, overflow: 'hidden', backgroundColor: colors.glassBright, boxShadow: [{ offsetX: 0, offsetY: 18, blurRadius: 40, color: 'rgba(0,0,0,0.18)' }] },
  dots: { position: 'absolute', left: 0, right: 0, bottom: 44, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  sheet: { marginTop: -26, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.surface, padding: spacing.lg, paddingTop: 22 },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  delivery: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.pastelYellow, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  deliveryText: { fontSize: 11, fontWeight: '800', color: colors.onSurface, textTransform: 'uppercase' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill },
  ratingText: { fontSize: 11, fontWeight: '800', color: colors.onSurface },
  catLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, marginLeft: 'auto' }, brandLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, marginTop: 6, alignSelf: 'flex-start' }, catLinkText: { fontSize: 11, fontWeight: '700', color: colors.forest, flexShrink: 1 },
  name: { fontSize: 24, fontWeight: '800', color: colors.onSurface, letterSpacing: -0.5 },
  weight: { fontSize: 14, color: colors.muted, marginTop: 4 },
  unit: { fontSize: 12, color: colors.muted, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  action: { flex: 1, minHeight: 46, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  actionOn: { backgroundColor: colors.splashInk, borderColor: colors.splashInk },
  actionText: { fontSize: 13, fontWeight: '700', color: colors.onSurface, flexShrink: 1, textAlign: 'center' }, actionTextOn: { color: colors.electricLime },
  note: { fontSize: 12, color: colors.onError, marginTop: 8 },
  compareBar: { marginTop: 12, minHeight: 52, borderRadius: 18, backgroundColor: colors.splashInk, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  compareThumbs: { flexDirection: 'row' }, compareThumb: { width: 30, height: 30, borderRadius: 10, marginRight: -8, borderWidth: 2, borderColor: colors.splashInk, backgroundColor: colors.surface },
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
  footer: { marginTop: 28, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  footerShot: { width: 110, height: 110, marginBottom: 16, opacity: 0.95 },
  footerTitle: { color: colors.surface, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center', paddingHorizontal: 24 },
  footerSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 6, letterSpacing: 0.5 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingHorizontal: 68 },
  headerTitle: { height: 44, lineHeight: 44, textAlign: 'center', fontSize: 15, fontWeight: '800', color: colors.onSurface },
  topBar: { position: 'absolute', top: 12, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 10 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.glassBright, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.glassLine },
  noticeWrap: { position: 'absolute', top: 54, left: 0, right: 0, alignItems: 'center' },
  notice: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.forestDeep },
  noticeText: { fontSize: 12, fontWeight: '700', color: colors.surface },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.lg, paddingTop: 14 },
  cartRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cartMeta: { fontSize: 12, color: colors.muted, fontWeight: '600', flexShrink: 1 }, cartLink: { fontSize: 13, fontWeight: '800', color: colors.forest },
  buy: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  buyPrice: { flex: 1 },
  buyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  buyNow: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: colors.onSurface },
  buyMrp: { fontSize: 13, color: colors.muted, textDecorationLine: 'line-through' },
  buyOff: { fontSize: 12, fontWeight: '800', color: colors.onSuccess, marginTop: 1 },
  key: { height: 56, borderRadius: radius.pill, backgroundColor: colors.electricLime, boxShadow: [...neu(5), ...soft.raised.slice(1)] },
  keyPressed: { boxShadow: soft.sunken },
  addKey: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 26 },
  addKeyText: { fontSize: 16, fontWeight: '800', color: colors.forestDeep, flexShrink: 1 },
  stepKey: { minWidth: 168, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepMid: { alignItems: 'center' },
  stepQty: { fontSize: 17, fontWeight: '800', color: colors.forestDeep, textAlign: 'center' },
  stepLabel: { fontSize: 10, fontWeight: '700', color: colors.forestDeep, opacity: 0.7 },
  wheel: { position: 'absolute', left: 0, right: 0, height: WHEEL },
  slot: { width: STEP, height: WHEEL, alignItems: 'center', paddingTop: 6 },
  wheelDot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, borderColor: colors.surface, backgroundColor: colors.surface, boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 14, color: colors.overlay }] },
  wheelPhoto: { flex: 1, borderRadius: DOT / 2, overflow: 'hidden' },
});
