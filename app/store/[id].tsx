// A shop's page, in pop-art and the shop's own colour (the one its card wears in shop lists): the shop's sign and its
// category tiles on a block of that colour, then a white sheet with its items in a grid (a tile narrows it), then its photos.
// A restaurant (a food store) gets its menu page instead (src/components/restaurant-view.tsx).
import { useEffect, useMemo, useState } from "react";
import { ComingSoonBrand, useComingSoon } from '@/src/components/coming-soon-brand';
import { Animated, View, StyleSheet, ScrollView, TouchableOpacity, Platform, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Text } from "@/src/ui/text";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { colors, nameTints, nameTintIndex, popBase, radius, spacing } from "@/src/theme";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, Catalog, Category, Product, Store, StoreMedia } from "@/src/api";
import { Tap } from "@/src/components/tap";
import { ShopHero } from "@/src/components/shop-hero";
import { RestaurantView } from "@/src/components/restaurant-view";
import { useFollowedStores } from "@/src/followed";
import { nativeDriver } from "@/src/motion";
import { useTranslation } from "@/src/i18n";
import { LoadState, ProductGrid } from "@/src/components/catalog-sections";
import { useRevealed } from "@/src/use-revealed";

const SIDE = 16;
const MEDIA = 168;
const FIRST_ITEMS = 6; // drawn with the page; the rest once it has slid in
// The back button's row; the hero starts below it.
const TOP_BAR = 56;
// How far the white sheet rises over the coloured block.
const OVERLAP = 28;

function MediaTile({ media, size }: { media: StoreMedia; size: number }) {
  const [playing, setPlaying] = useState(false);
  const player = useVideoPlayer(media.type === "video" ? (Platform.OS === 'web' ? media.video_web || media.url : media.url) : null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  if (media.type === "image") {
    return (
      <View style={[mediaStyles.tile, { width: size, height: size }]}>
        <Image source={media.url} style={mediaStyles.img} contentFit="cover" />
      </View>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={[mediaStyles.tile, { width: size, height: size }]}
      onPress={() => {
        if (playing) { player.pause(); setPlaying(false); }
        else { player.play(); setPlaying(true); }
      }}
      testID={`store-media-${media.url}`}
    >
      {playing ? (
        <VideoView style={mediaStyles.img} player={player} contentFit="cover" nativeControls={false} surfaceType="textureView" />
      ) : (
        <>
          <Image source={media.thumbnail ?? ""} style={mediaStyles.img} contentFit="cover" />
          <View style={mediaStyles.playOverlay}>
            <View style={mediaStyles.playBtn}>
              <Icon name="play" size={22} color={colors.onBrandPrimary} />
            </View>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}

const mediaStyles = StyleSheet.create({
  tile: { borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceSecondary, position: "relative" },
  img: { width: "100%", height: "100%" },
  playOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: colors.overlay },
  playBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
});

export default function StoreProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const focused = useIsFocused();
  const { t } = useTranslation();
  const { isFollowing, toggle } = useFollowedStores();
  const queryClient = useQueryClient(); const revealed = useRevealed();
  // Each answer is tagged with the load it belongs to (store id + retry count), so a retry or another store shows the loader
  // until its own answer arrives, without clearing state inside the effect.
  // It starts from what the app already holds (the shop list and the catalogue the list screens load), so the page slides in
  // whole instead of as a loader that pops in; the requests below then bring it up to date.
  const [loaded, setLoaded] = useState<{ key: string; store: Store } | null>(() => {
    const store = queryClient.getQueryData<Store[]>(['stores'])?.find(s => s.id === id);
    return store ? { key: `${id}:0`, store } : null;
  });
  const [products, setProducts] = useState<Product[]>(() => queryClient.getQueryData<Catalog>(['catalog'])?.products.filter(p => p.store_id === id) ?? []);
  const [categories, setCategories] = useState<Category[]>(() => queryClient.getQueryData<Catalog>(['catalog'])?.categories ?? []);
  // The category tile that narrows the grid, if any.
  const [picked, setPicked] = useState<string | null>(null);
  const [scrollY] = useState(() => new Animated.Value(0));
  // The hero's height tells when the white sheet (which starts at its foot) has reached the status bar.
  const [heroHeight, setHeroHeight] = useState(0); const [sheetOnTop, setSheetOnTop] = useState(false);
  // 'missing' = the server answered 404 (no such store in this city); 'error' = the store or its products could not be loaded.
  const [failed, setFailed] = useState<{ key: string; kind: 'missing' | 'error' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadKey = `${id}:${attempt}`;

  useEffect(() => {
    if (!id) return;
    let live = true;
    const fail = (e: unknown) => { if (live) setFailed(f => f?.key === loadKey && f.kind === 'missing' ? f : { key: loadKey, kind: e instanceof ApiError && e.status === 404 ? 'missing' : 'error' }); };
    api<Store>(`/stores/${id}`).then(s => { if (live) setLoaded({ key: loadKey, store: s }); }).catch(fail);
    api<Product[]>(`/stores/${id}/products`).then(p => { if (live) setProducts(p); }).catch(fail);
    api<Category[]>("/categories").then(c => { if (live) setCategories(c); }).catch(() => {}); // category names only; without them a category shows its id
    return () => { live = false; };
  }, [id, loadKey]);
  const failure = failed?.key === loadKey ? failed.kind : null;
  // No menu yet anywhere in the catalogue: show the coming-soon receipt, not an empty store.
  const comingSoon = useComingSoon(id);
  const store = loaded?.key === loadKey ? loaded.store : null;
  // The shop's categories (its tiles) in the order its items come, each with its items.
  const groups = useMemo(() => Array.from(new Set(products.map(p => p.category_id)), category => ({ category, items: products.filter(p => p.category_id === category) })), [products]);

  // On the shop's colour it is a filled sticker; on the plain loading and missing screens, a white button.
  const back = (ink?: string) => (
    <TouchableOpacity
      style={[styles.backBtn, { top: insets.top + 8 }, !!ink && [styles.backOnInk, { backgroundColor: ink }]]}
      onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}
      testID="back-btn"
    >
      <Icon name="chevron-back" size={22} color={ink ? colors.surface : colors.onSurface} />
    </TouchableOpacity>
  );

  if (failure === 'missing') {
    return (
      <View style={styles.loader} testID="store-not-found">
        {back()}
        <Icon name="storefront-outline" size={32} color={colors.muted} />
        <Text style={styles.missingTitle}>{t('store.notFound')}</Text>
        <TouchableOpacity testID="store-not-found-home" style={styles.missingLink} onPress={() => router.replace('/(tabs)' as any)}>
          <Text style={styles.missingLinkText}>{t('store.backHome')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (failure === 'error' || !store) {
    return (
      <View style={styles.loader}>
        {back()}
        <LoadState error={failure === 'error'} retry={() => setAttempt(n => n + 1)} />
      </View>
    );
  }

  if (comingSoon) return <ComingSoonBrand name={store.name} logo={store.logo} line={store.tagline} />;
  if (store.department === 'food') return <RestaurantView store={store} products={products} categories={categories} />;
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const tint = nameTints[nameTintIndex(store.id)]; const [wash, ink] = tint;
  const shown = groups.find(g => g.category === picked)?.items ?? products;
  // A section heading: the name in the shop's colour, then a dot and a bar in a light wash of it running off the edge.
  const heading = (title: string) => <View style={styles.head}>
    <Text numberOfLines={1} style={[styles.headTitle, { color: ink }]}>{title}</Text>
    <View style={styles.motif}><View style={[styles.motifDot, { backgroundColor: ink }]} /><View style={[styles.motifBar, { backgroundColor: ink }]} /></View>
  </View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="store-screen">
      {/* Light on the shop's colour; dark once the white sheet has slid up under the status bar. */}
      {focused && <StatusBar style={sheetOnTop ? "dark" : "light"} />}
      {/* Fades in white as the sheet's edge passes under the status bar, so the items then scroll beneath plain white. */}
      {heroHeight > 0 && <Animated.View pointerEvents="none" style={[styles.statusBand, { height: insets.top, opacity: scrollY.interpolate({ inputRange: [heroHeight - OVERLAP - insets.top, heroHeight - OVERLAP], outputRange: [0, 1], extrapolate: 'clamp' }) }]} />}
      {back(ink)}

      <Animated.ScrollView showsVerticalScrollIndicator={false} scrollEventThrottle={16} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: nativeDriver, listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => setSheetOnTop(e.nativeEvent.contentOffset.y > heroHeight - OVERLAP - insets.top / 2) })}>
        {/* Above the top edge, so pulling the page down (iOS bounce) shows the shop's colour, not white. */}
        <View style={[styles.pullFill, { backgroundColor: ink }]} />
        {/* Held in place as the page scrolls, so the white sheet slides up over it; pulling down past the top moves it
            with the page. It stays in the scroll content (not behind it) so its buttons and tiles keep taking taps. */}
        <Animated.View onLayout={e => setHeroHeight(e.nativeEvent.layout.height)} style={{ transform: [{ translateY: scrollY.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' }) }] }}>
        <ShopHero store={store} tint={tint} top={insets.top + TOP_BAR} following={isFollowing(store.id)} onFollow={() => toggle(store.id)}>
          {/* A shop with one kind of item needs no tiles to choose from. */}
          {groups.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tilesRow} contentContainerStyle={styles.tiles}>
            {groups.map(({ category, items }) => {
              const name = catMap[category]?.name ?? category; const on = category === picked;
              // Tapping the picked tile again shows everything.
              return <Tap key={category} testID={`store-chip-${category}`} accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected: on }} onPress={() => setPicked(on ? null : category)} style={[styles.tile, { backgroundColor: wash }, on && styles.tileOn]}>
                <Text numberOfLines={2} style={[styles.tileName, { color: ink }]}>{name}</Text>
                <View style={[styles.frame, { backgroundColor: ink }]}><Image source={items[0].image} style={styles.frameImage} contentFit="cover" /></View>
              </Tap>;
            })}
          </ScrollView>}
        </ShopHero>
        </Animated.View>

        <View style={styles.sheet}>
          {products.length > 0 && <View style={styles.section}>
            {heading(picked ? catMap[picked]?.name ?? picked : t('store.allItems'))}
            <ProductGrid products={revealed ? shown : shown.slice(0, FIRST_ITEMS)} scope="store" accent={ink} />
          </View>}
          {store.media.length > 0 && <View style={styles.section}>
            {heading(t('store.inside', { name: store.name }))}
            <ScrollView testID="store-media-carousel" horizontal snapToInterval={MEDIA + spacing.md} decelerationRate="fast" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.media}>
              {store.media.map((m, i) => <MediaTile key={i} media={m} size={MEDIA} />)}
            </ScrollView>
          </View>}
        </View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  missingTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface, marginTop: spacing.md, textAlign: "center", paddingHorizontal: spacing.lg },
  missingLink: { minHeight: 44, justifyContent: "center", marginTop: spacing.sm },
  missingLinkText: { color: colors.forest, fontSize: 13, fontWeight: "700" },
  backBtn: {
    position: "absolute",
    left: spacing.lg,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
    zIndex: 10,
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: colors.border }],
  },
  // A white ring keeps it visible on the shop's colour and on the white sheet alike.
  backOnInk: { borderWidth: 2, borderColor: colors.surface, boxShadow: popBase(3) },
  statusBand: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 9, backgroundColor: colors.surface },
  pullFill: { position: "absolute", top: -600, height: 600, left: 0, right: 0 },
  tilesRow: { alignSelf: "stretch", marginTop: 24 },
  tiles: { paddingHorizontal: SIDE, paddingBottom: 6, gap: 12 },
  // A pastel tile: its name on top, one of its items framed below, inset by the same margin on every side.
  tile: { width: 108, height: 148, borderRadius: radius.md, padding: 8, paddingTop: 12, alignItems: "center", justifyContent: "space-between", overflow: "hidden", boxShadow: popBase(5) },
  tileOn: { borderWidth: 3, borderColor: colors.surface },
  tileName: { fontSize: 13, lineHeight: 16, fontWeight: "800", textAlign: "center", paddingHorizontal: 8 },
  // Near square, so the mostly square product photos lose little to the crop.
  frame: { alignSelf: "stretch", height: 84, borderRadius: radius.sm, overflow: "hidden", borderWidth: 2, borderColor: colors.surface },
  frameImage: { width: "100%", height: "100%" },
  // Above the held-in-place hero, which it slides over.
  sheet: { zIndex: 1, marginTop: -OVERLAP, paddingTop: 4, paddingBottom: spacing["3xl"], backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: "hidden" },
  section: { marginTop: 24, gap: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 20 },
  headTitle: { flexShrink: 1, fontSize: 22, lineHeight: 28, fontWeight: "800", letterSpacing: -0.5 },
  motif: { flex: 1, minWidth: 48, flexDirection: "row", alignItems: "center", gap: 6, opacity: 0.16 },
  motifDot: { width: 18, height: 18, borderRadius: 9 },
  // Runs past the screen's right edge, where the sheet cuts it off.
  motifBar: { flex: 1, height: 18, borderRadius: 9, marginRight: -12 },
  media: { paddingHorizontal: 20, gap: spacing.md },
});
