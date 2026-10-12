import { useEffect, useState } from "react";
import { ComingSoonBrand, useComingSoon } from '@/src/components/coming-soon-brand';
import { MAX_APP_WIDTH } from '@/src/layout';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, Platform } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { colors, radius, spacing } from "@/src/theme";
import { api, ApiError, Category, Product, Store, StoreMedia } from "@/src/api";
import { ProductCard } from "@/src/components/product-card";
import { useFollowedStores } from "@/src/followed";
import { useFormat, useTranslation } from "@/src/i18n";
import { LoadState } from "@/src/components/catalog-sections";

// Capped to the app column so the layout holds on tablets and desktop (src/layout.tsx).
const SCREEN_W = Math.min(Dimensions.get("window").width, MAX_APP_WIDTH);

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
        <VideoView style={mediaStyles.img} player={player} contentFit="cover" nativeControls={false} />
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
  videoBadge: { position: "absolute", top: 8, left: 8, backgroundColor: colors.brandPrimary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  videoBadgeText: { color: colors.onBrandPrimary, fontSize: 9, fontWeight: "800" },
});

export default function StoreProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const fmt = useFormat();
  const { isFollowing, toggle } = useFollowedStores();
  // Each answer is tagged with the load it belongs to (store id + retry count), so a retry or another store shows the loader
  // until its own answer arrives, without clearing state inside the effect.
  const [loaded, setLoaded] = useState<{ key: string; store: Store } | null>(null);
  const [slide, setSlide] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<string>("all");
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
    api<Category[]>("/categories").then(c => { if (live) setCategories(c); }).catch(() => {}); // chip labels only; without them a chip shows its id
    return () => { live = false; };
  }, [id, loadKey]);
  const failure = failed?.key === loadKey ? failed.kind : null;
  // No menu yet anywhere in the catalogue: show the coming-soon receipt, not an empty store.
  const comingSoon = useComingSoon(id);
  const store = loaded?.key === loadKey ? loaded.store : null;

  const back = (
    <TouchableOpacity
      style={[styles.backBtn, { top: insets.top + 8 }]}
      onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}
      testID="back-btn"
    >
      <Icon name="chevron-back" size={22} color={colors.onSurface} />
    </TouchableOpacity>
  );

  if (failure === 'missing') {
    return (
      <View style={styles.loader} testID="store-not-found">
        {back}
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
        {back}
        <LoadState error={failure === 'error'} retry={() => setAttempt(n => n + 1)} />
      </View>
    );
  }

  const slideW = Math.min(SCREEN_W * 0.72, 340);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  if (comingSoon) return <ComingSoonBrand name={store.name} logo={store.logo} line={store.tagline} />;
  const cats = ["all", ...Array.from(new Set(products.map((p) => p.category_id)))];

  const shown = activeCat === "all" ? products : products.filter((p) => p.category_id === activeCat);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }} testID="store-screen">
      {/* Back button - floating */}
      {back}

      <ScrollView contentContainerStyle={{ paddingBottom: spacing["3xl"] }} showsVerticalScrollIndicator={false}>
        {/* Top: swipeable carousel of the store's photos and videos */}
        <View style={[styles.mediaSection, { paddingHorizontal: 0, paddingTop: insets.top + 56 }]}>
          <ScrollView testID="store-media-carousel" horizontal pagingEnabled={false} snapToInterval={slideW + spacing.md} decelerationRate="fast" showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
            onScroll={e => setSlide(Math.round(e.nativeEvent.contentOffset.x / (slideW + spacing.md)))} scrollEventThrottle={64}>
            {store.media.map((m, i) => <MediaTile key={i} media={m} size={slideW} />)}
          </ScrollView>
          {store.media.length > 1 && <View style={styles.carouselDots}>{store.media.map((_, i) => <View key={i} style={[styles.carouselDot, i === slide && styles.carouselDotOn]} />)}</View>}
        </View>

        {/* Overlapping centered logo + store info */}
        <View style={styles.logoWrap}>
          <View style={styles.logoRing}>
            <Image source={store.logo} style={styles.logo} contentFit="cover" />
          </View>
          <Text style={styles.storeName}>{store.name}</Text>
          <Text style={styles.tagline}>{store.tagline}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Icon name="flash" size={12} color={colors.onSurface} />
              <Text style={styles.metaChipText}>{fmt.deliveryTime(store.delivery_time)}</Text>
            </View>
            <View style={styles.metaChip}>
              <Icon name="star" size={12} color={colors.onSurface} />
              <Text style={styles.metaChipText}>{fmt.number(store.rating, { maxFractionDigits: 1 })}</Text>
            </View>
            <View style={styles.metaChip}>
              <Icon name="storefront-outline" size={12} color={colors.onSurface} />
              <Text style={styles.metaChipText}>{t('store.sampleBadge')}</Text>
            </View>
          </View>
          <View style={styles.tagsRow}>
            {store.tags.map((tag) => (
              <View key={tag} style={styles.tagPill}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.followBtn, isFollowing(store.id) && styles.followBtnActive]}
            onPress={() => toggle(store.id)}
            testID="follow-btn"
          >
            <Icon
              name={isFollowing(store.id) ? "heart" : "heart-outline"}
              size={18}
              color={isFollowing(store.id) ? colors.onError : colors.onBrandPrimary}
            />
            <Text style={[styles.followText, isFollowing(store.id) && { color: colors.onSurface }]}>
              {isFollowing(store.id) ? t('store.following') : t('store.follow')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Category chip filter (sticky-styled row) */}
        <View style={styles.chipHeader}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {cats.map((c) => {
              const active = activeCat === c;
              const label = c === "all" ? t('store.allItems') : (catMap[c]?.name ?? c);
              const emoji = c === "all" ? "🛒" : (catMap[c]?.emoji ?? "");
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setActiveCat(c)}
                  style={[styles.chip, active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}
                  testID={`store-chip-${c}`}
                >
                  <Text style={[styles.chipText, active && { color: colors.onBrandPrimary }]}>
                    {emoji ? `${emoji}  ` : ""}{label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Products */}
        <View style={styles.productSection}>
          <Text style={styles.sectionTitle}>{t('store.allProducts')}</Text>
          <View style={styles.grid}>
            {shown.map((p) => (
              <View key={p.id} style={styles.gridItem}>
                <ProductCard product={p} width={undefined as any} />
              </View>
            ))}
            {shown.length === 0 && (
              <View style={styles.empty}>
                <Text style={{ color: colors.muted }}>{t('store.emptyCategory')}</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  carouselDots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.md },
  carouselDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  carouselDotOn: { width: 18, backgroundColor: colors.onSurface },
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
    elevation: 4,
  },
  mediaSection: { paddingHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary, paddingBottom: 60 },
  mediaRow: { flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  logoWrap: {
    marginTop: -50,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  logoRing: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: colors.surface,
    padding: 4,
    boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 12, color: colors.border }],
    elevation: 6,
  },
  logo: { width: "100%", height: "100%", borderRadius: 46 },
  storeName: { fontSize: 22, fontWeight: "800", color: colors.onSurface, marginTop: spacing.md, textAlign: "center" },
  tagline: { fontSize: 13, color: colors.muted, marginTop: 4, textAlign: "center" },
  metaRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap", justifyContent: "center" },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.pastelYellow, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  metaChipText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md, justifyContent: "center" },
  tagPill: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  tagText: { fontSize: 11, color: colors.onSurfaceSecondary, fontWeight: "600" },
  followBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 6,
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  followBtnActive: { backgroundColor: colors.pastelPink },
  followText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 13, flexShrink: 1 },
  chipHeader: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, minHeight: 56, justifyContent: "center" },
  chipRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, flexDirection: "row", alignItems: "center" },
  chip: { minHeight: 36, paddingVertical: 5, flexShrink: 0, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: "center" },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  productSection: { paddingTop: spacing.lg },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.onSurface, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.lg, gap: spacing.md },
  gridItem: { width: "47.5%" },
  empty: { padding: spacing.xl, width: "100%", alignItems: "center" },
});
