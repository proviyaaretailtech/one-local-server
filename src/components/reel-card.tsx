// One reel or photo ad, full screen and running on under the dock: its picture (and its video, while it is the one showing)
// edge to edge, shaded at the top and foot so the white on it reads. Dark frosted buttons like the dock on this page: back
// and the bag at the top; at the foot, who made it and the caption beside like, share and sound, then the product on a
// white card. A tap anywhere else pauses the video (a photo ad has none to pause).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Pressable, StyleSheet, AppState, Share, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { colors, radius, spacing } from '../theme';
import { BACKEND, Reel } from '../api';
import { useCart } from '../cart';
import { useFormat, useTranslation } from '../i18n';
import { logoSize, logoTile } from '../logo-tile';
import { Button } from '../ui/button';
import { Sheet } from '../ui/sheet';
import { dockSpace } from './bottom-navigation';

// The page's own insets carry no bottom (its frame leaves the dock's room for most pages), so this page, which runs on
// under the dock, leaves that room itself from the phone's, and clears the Discover button standing ~30pt above the dock.
const FOOT = dockSpace(initialWindowMetrics?.insets.bottom ?? 0) + spacing['2xl'] + spacing.xs;

function ReelVideo({ source, muted, paused, id }: { source: string; muted: boolean; paused: boolean; id: string }) {
  const [failed, setFailed] = useState(false); const { t } = useTranslation();
  const view = useRef<VideoView>(null);
  const player = useVideoPlayer(source, p => { p.loop = true; p.muted = true; });
  const play = useCallback(() => {
    if (Platform.OS !== 'web') { player.play(); return; }
    // Expo's web play() discards HTMLMediaElement's promise. Use the view's
    // exposed nativeRef to handle expected cancellation when navigating away.
    const element = (view.current as unknown as { nativeRef?: { current?: HTMLVideoElement } })?.nativeRef?.current;
    void element?.play().catch((error: Error) => { if (error.name !== 'AbortError') setFailed(true); });
  }, [player]);
  useEffect(() => { player.muted = muted; }, [player, muted]);
  useEffect(() => { if (paused) player.pause(); else play(); return () => { try { player.pause(); } catch { /* already released (Android, on unmount) */ } }; }, [player, paused, play]);
  useEffect(() => {
    const listener = player.addListener('statusChange', e => setFailed(e.status === 'error'));
    const app = AppState.addEventListener('change', state => { if (state !== 'active' || paused) player.pause(); else play(); });
    return () => { listener.remove(); app.remove(); };
  }, [player, paused, play]);
  // A video that will not play gives way to the photo under it (iOS would draw its own crossed-out play mark over it).
  return failed
    ? <Glass style={s.videoError}><Icon name="videocam-off-outline" size={16} color={colors.surface} /><Text testID={`reel-video-error-${id}`} numberOfLines={2} style={s.videoErrorText}>{t('reel.videoUnavailable')}</Text></Glass>
    : <View testID={`reel-video-${id}`} style={s.video}><VideoView ref={view} player={player} nativeControls={false} contentFit="cover" style={s.video} /></View>;
}

// Dark frosted glass, the dock's look on this page: the picture shows through, softened, with no halo round it.
function Glass({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View style={[s.glass, style]}>
    <BlurView pointerEvents="none" intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
    {children}
  </View>;
}

// A glass button, with a word under it when it has one (like, share and sound).
function GlassButton({ testID, label, onPress, word, wordTestID, selected, disabled, children }: { testID: string; label: string; onPress: () => void; word?: string; wordTestID?: string; selected?: boolean; disabled?: boolean; children: ReactNode }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={selected === undefined ? undefined : { selected }} disabled={disabled} onPress={onPress} hitSlop={6} style={s.button}>
    <Glass style={s.round}>{children}</Glass>
    {!!word && <Text testID={wordTestID} numberOfLines={1} style={s.word}>{word}</Text>}
  </Pressable>;
}

export function ReelCard({ reel: r, height, active }: { reel: Reel; height: number; active: boolean }) {
  const { add, qtyOf, totalItems } = useCart();
  const { t } = useTranslation(); const fmt = useFormat();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [liked, setLiked] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<'' | 'likeFailed' | 'copyFailed'>(''); // a code, so it re-translates if the language changes
  // A reel can be about a brand only (no product): it then links to the brand and shows no product strip.
  const product = r.product;
  const brandPath = `/brand/${r.brand?.id || product?.brand_id || product?.store_id}`;
  const name = product?.name || r.brand?.name || r.creator;
  const link = product ? `${BACKEND}/product/${product.id}` : `${BACKEND}${brandPath}`;
  const inBag = product ? qtyOf(product.id) : 0;
  useEffect(() => { AsyncStorage.getItem(`reel-like-${r.id}`).then(value => { setLiked(value === 'yes'); setHydrated(true); }).catch(() => setHydrated(true)); }, [r.id]);
  const like = async () => { const previous = liked; setLiked(!previous); try { await AsyncStorage.setItem(`reel-like-${r.id}`, !previous ? 'yes' : 'no'); } catch { setLiked(previous); setMessage('likeFailed'); /* i18n-ignore: message code */ } };
  const share = async () => { if (Platform.OS === 'web') { setCopied(false); setShareOpen(true); return; } try { await Share.share({ title: name, message: t('reel.shareMessage', { name, link }) }); } catch { setShareOpen(true); } };
  const copy = async () => { try { await Clipboard.setStringAsync(link); setCopied(true); } catch { setMessage('copyFailed' /* i18n-ignore: message code */); } };
  return <View testID={`reel-card-${r.id}`} style={[s.card, { height }]}>
    <Image source={r.poster || product?.image || r.brand?.image} contentFit="cover" style={StyleSheet.absoluteFill} />
    {active && !!r.video && <ReelVideo source={Platform.OS === 'web' ? r.video_web : r.video} muted={muted} paused={paused || shareOpen} id={r.id} />}
    <LinearGradient pointerEvents="none" colors={[colors.overlay, colors.transparent, colors.transparent, colors.overlayDeep]} locations={[0, 0.2, 0.42, 1]} style={StyleSheet.absoluteFill} />
    <Pressable testID={`reel-play-${r.id}`} accessibilityLabel={paused ? t('reel.play') : t('reel.pause')} disabled={!r.video} onPress={() => setPaused(!paused)} style={s.playArea}>
      {paused && <Glass style={s.paused}><Icon name="play" size={30} color={colors.surface} /></Glass>}
    </Pressable>

    <View pointerEvents="box-none" style={[s.top, { paddingTop: insets.top + spacing.sm }]}>
      <GlassButton testID={`reel-back-discover-${r.id}`} label={t('reel.backToDiscover')} onPress={() => router.navigate('/discover')}><Icon name="chevron-back" size={22} color={colors.surface} /></GlassButton>
      <Text numberOfLines={1} style={s.title}>{t('reel.title')}</Text>
      <GlassButton testID={`reel-cart-${r.id}`} label={t('reel.viewCart')} onPress={() => router.navigate('/cart')}><Icon name="bag-handle-outline" size={20} color={colors.surface} /></GlassButton>
      {totalItems > 0 && <View pointerEvents="none" style={[s.count, { top: insets.top + spacing.xs }]}><Text testID={`reel-cart-count-${r.id}`} style={s.countText}>{fmt.number(totalItems)}</Text></View>}
    </View>

    {/* Only its own buttons take taps: a tap on the picture between them reaches the pause area. */}
    <View pointerEvents="box-none" style={[s.foot, { bottom: FOOT }]}>
      <View pointerEvents="box-none" style={s.story}>
        <View pointerEvents="box-none" style={s.words}>
          <Pressable testID={`reel-brand-${r.id}`} accessibilityRole="button" accessibilityLabel={t('reel.exploreCreator', { creator: r.creator })} onPress={() => router.push(brandPath as never)} style={s.creator}>
            <View style={s.logo}>{r.brand?.logo ? <Image testID={`reel-brand-logo-${r.id}`} source={r.brand.logo} style={s.logoImage} contentFit="contain" /> : <Text style={s.initial}>{r.creator.slice(0, 1)}</Text>}</View>
            <View style={s.creatorCopy}>
              <View style={s.creatorTop}><Text numberOfLines={1} style={s.creatorName}>{r.creator}</Text><Icon name="chevron-forward" size={14} color={colors.electricLime} /></View>
              <Text numberOfLines={1} style={s.creatorLine}>{t('reel.sampleAd')}</Text>
            </View>
          </Pressable>
          <Text testID={`reel-caption-${r.id}`} numberOfLines={2} style={s.caption}>{r.caption}</Text>
        </View>
        <View style={s.rail}>
          <GlassButton testID={`reel-like-${r.id}`} label={liked ? t('reel.unlike') : t('reel.like')} selected={liked} disabled={!hydrated} onPress={like} word={fmt.number(r.likes + (liked ? 1 : 0))} wordTestID={`reel-likes-${r.id}`}><Icon name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? colors.electricLime : colors.surface} /></GlassButton>
          <GlassButton testID={`reel-share-${r.id}`} label={t('reel.shareProduct')} onPress={share} word={t('reel.share')}><Icon name="paper-plane-outline" size={20} color={colors.surface} /></GlassButton>
          <GlassButton testID={`reel-mute-${r.id}`} label={muted ? t('reel.unmute') : t('reel.mute')} onPress={() => setMuted(!muted)} word={muted ? t('reel.soundOff') : t('reel.soundOn')}><Icon name={muted ? 'volume-mute-outline' : 'volume-high-outline'} size={20} color={colors.surface} /></GlassButton>
        </View>
      </View>
      {product && <View style={s.product}>
        <Pressable testID={`reel-product-${r.id}`} accessibilityRole="button" accessibilityLabel={product.name} onPress={() => router.push(`/product/${product.id}`)} style={s.productInfo}>
          <Image source={product.image} style={s.productImage} contentFit="cover" />
          <View style={s.productCopy}>
            <Text numberOfLines={2} style={s.productName}>{product.name}</Text>
            <Text testID={`reel-price-${r.id}`} numberOfLines={1} style={s.price}>{fmt.money(product.price)}{product.mrp > product.price && <Text style={s.mrp}>{`  ${fmt.money(product.mrp)}`}</Text>}</Text>
          </View>
        </Pressable>
        <Pressable testID={`reel-add-${r.id}`} accessibilityRole="button" accessibilityLabel={t('reel.addToCartA11y', { name: product.name })} onPress={() => add(product)} hitSlop={4} style={s.add}>
          <Icon name={inBag > 0 ? 'checkmark' : 'add'} size={16} color={colors.forestDeep} />
          <Text testID={`reel-added-${r.id}`} numberOfLines={1} style={s.addText}>{inBag > 0 ? t('reel.added', { n: fmt.number(inBag) }) : t('reel.addToCart')}</Text>
        </Pressable>
      </View>}
      {!!message && <Text testID={`reel-feedback-${r.id}`} style={s.feedback}>{message === 'likeFailed' ? t('reel.likeFailed') : t('reel.copyFailed')}</Text>}
    </View>

    <Sheet testID={`reel-share-sheet-${r.id}`} visible={shareOpen} onClose={() => setShareOpen(false)} title={t('reel.shareTitle')} body={name}>
      <Text selectable testID={`reel-share-link-${r.id}`} style={s.link}>{link}</Text>
      <Button testID={`reel-copy-link-${r.id}`} title={copied ? t('reel.linkCopied') : t('reel.copyLink')} icon={copied ? 'checkmark' : 'copy-outline'} onPress={() => void copy()} />
      <Button testID={`reel-share-close-${r.id}`} variant="quiet" title={t('common.close')} onPress={() => setShareOpen(false)} />
    </Sheet>
  </View>;
}

const BUTTON = 44;
// White words straight on the picture get a soft shadow, so they read on a bright frame too.
const onPicture = { textShadowColor: colors.overlay, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 };
const s = StyleSheet.create({
  card: { width: '100%', overflow: 'hidden', backgroundColor: colors.brandPrimary },
  video: { ...StyleSheet.absoluteFill, width: '100%', height: '100%', pointerEvents: 'none' },
  videoError: { position: 'absolute', top: '32%', alignSelf: 'center', maxWidth: '78%', flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md },
  videoErrorText: { flexShrink: 1, color: colors.surface, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  playArea: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  glass: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.whiteGlassLine },
  round: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2 },
  paused: { width: 72, height: 72, borderRadius: 36 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  title: { ...onPicture, flex: 1, color: colors.surface, fontSize: 17, lineHeight: 24, fontWeight: '800', textAlign: 'center' },
  count: { position: 'absolute', right: spacing.sm, minWidth: 20, height: 20, paddingHorizontal: spacing.xs, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.electricLime },
  countText: { color: colors.forestDeep, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  button: { alignItems: 'center', gap: spacing.xs },
  word: { ...onPicture, maxWidth: 64, color: colors.surface, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  foot: { position: 'absolute', left: spacing.lg, right: spacing.lg, gap: spacing.lg },
  story: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg },
  words: { flex: 1, gap: spacing.sm },
  creator: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.sm, maxWidth: '100%' },
  logo: logoTile(40),
  logoImage: { width: logoSize(40), height: logoSize(40) },
  initial: { color: colors.onSurface, fontSize: 17, fontWeight: '800' },
  creatorCopy: { flexShrink: 1 },
  creatorTop: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  creatorName: { ...onPicture, flexShrink: 1, color: colors.surface, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  creatorLine: { ...onPicture, color: colors.surface, fontSize: 11, lineHeight: 15, opacity: 0.8 },
  caption: { ...onPicture, color: colors.surface, fontSize: 14, lineHeight: 20 },
  rail: { gap: spacing.lg, alignItems: 'center' },
  product: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface },
  productInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  productImage: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  productCopy: { flex: 1, gap: 2 },
  productName: { color: colors.onSurface, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  price: { color: colors.forest, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  mrp: { color: colors.muted, fontSize: 12, fontWeight: '500', textDecorationLine: 'line-through' },
  add: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40, maxWidth: '44%', paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.electricLime },
  addText: { flexShrink: 1, color: colors.forestDeep, fontSize: 13, lineHeight: 17, fontWeight: '800' },
  feedback: { ...onPicture, color: colors.surface, fontSize: 12, lineHeight: 17 },
  link: { color: colors.muted, fontSize: 12, lineHeight: 18, padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
});
