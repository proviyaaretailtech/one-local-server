import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, AppState, Share, Modal, Platform } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { colors } from '../theme';
import { BACKEND, Reel } from '../api';
import { useCart } from '../cart';
import { useFormat, useTranslation } from '../i18n';
import { logoSize, logoTile } from '../logo-tile';

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
  useEffect(() => { if (paused) player.pause(); else play(); return () => { player.pause(); }; }, [player, paused, play]);
  useEffect(() => {
    const listener = player.addListener('statusChange', e => setFailed(e.status === 'error'));
    const app = AppState.addEventListener('change', state => { if (state !== 'active' || paused) player.pause(); else play(); });
    return () => { listener.remove(); app.remove(); };
  }, [player, paused, play]);
  return <><View testID={`reel-video-${id}`} style={styles.video}><VideoView ref={view} player={player} nativeControls={false} contentFit="cover" style={styles.video} /></View>{failed && <View style={styles.videoError}><Text testID={`reel-video-error-${id}`} style={styles.errorText}>{t('reel.videoUnavailable')}</Text></View>}</>;
}

export function ReelCard({ reel: r, height, active, next }: { reel: Reel; height: number; active: boolean; next: () => void }) {
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
  const link = `${BACKEND}/product/${r.product.id}`;
  useEffect(() => { AsyncStorage.getItem(`reel-like-${r.id}`).then(value => { setLiked(value === 'yes'); setHydrated(true); }).catch(() => setHydrated(true)); }, [r.id]);
  const like = async () => { const previous = liked; setLiked(!previous); try { await AsyncStorage.setItem(`reel-like-${r.id}`, !previous ? 'yes' : 'no'); } catch { setLiked(previous); setMessage('likeFailed'); /* i18n-ignore: message code */ } };
  const share = async () => { if (Platform.OS === 'web') { setCopied(false); setShareOpen(true); return; } try { await Share.share({ title: r.product.name, message: t('reel.shareMessage', { name: r.product.name, link }) }); } catch { setShareOpen(true); } };
  return <View testID={`reel-card-${r.id}`} style={[styles.card, { height }]}>
    <Image source={r.product.image} contentFit="cover" style={StyleSheet.absoluteFill} />
    {active && !!r.video && <ReelVideo source={Platform.OS === 'web' ? r.video_web : r.video} muted={muted} paused={paused || shareOpen} id={r.id} />}
    <LinearGradient colors={[colors.overlay, colors.transparent, colors.transparent, colors.overlayDeep]} locations={[0, 0.25, 0.5, 1]} style={StyleSheet.absoluteFill} />
    <View style={[styles.top, { paddingTop: insets.top + 16 }]}><Pressable testID={`reel-back-discover-${r.id}`} accessibilityLabel={t('reel.backToDiscover')} onPress={() => router.navigate('/discover' as any)}><Text style={styles.title}>{t('reel.title')}</Text><Text style={styles.topSub}>{t('reel.tagline')}</Text></Pressable><Pressable testID={`reel-cart-${r.id}`} accessibilityLabel={t('reel.viewCart')} onPress={() => router.navigate('/cart' as any)} style={styles.round}><Icon name="bag-handle-outline" size={20} color={colors.surface} />{totalItems > 0 && <Text testID={`reel-cart-count-${r.id}`} style={styles.cartCount}>{fmt.number(totalItems)}</Text>}</Pressable></View>
    <Pressable testID={`reel-play-${r.id}`} accessibilityLabel={paused ? t('reel.play') : t('reel.pause')} onPress={() => setPaused(!paused)} style={styles.playArea}>{paused && <View style={styles.pauseIcon}><Icon name="play" size={34} color={colors.surface} /></View>}</Pressable>
    <View style={styles.actions}>
      <Pressable testID={`reel-like-${r.id}`} accessibilityLabel={liked ? t('reel.unlike') : t('reel.like')} accessibilityState={{ selected: liked }} disabled={!hydrated} onPress={like} style={[styles.action, styles.actionGlass]}><Icon name={liked ? 'heart' : 'heart-outline'} size={23} color={liked ? colors.lime : colors.surface} /><Text testID={`reel-likes-${r.id}`} style={styles.actionLabel}>{fmt.number(r.likes + (liked ? 1 : 0))}</Text></Pressable>
      <Pressable testID={`reel-share-${r.id}`} accessibilityLabel={t('reel.shareProduct')} onPress={share} style={[styles.action, styles.actionGlass]}><Icon name="paper-plane-outline" size={22} color={colors.surface} /><Text style={styles.actionLabel}>{t('reel.share')}</Text></Pressable>
      <Pressable testID={`reel-mute-${r.id}`} accessibilityLabel={muted ? t('reel.unmute') : t('reel.mute')} onPress={() => setMuted(!muted)} style={[styles.action, styles.actionGlass]}><Icon name={muted ? 'volume-mute-outline' : 'volume-high-outline'} size={22} color={colors.surface} /><Text style={styles.actionLabel}>{muted ? t('reel.soundOff') : t('reel.soundOn')}</Text></Pressable>
    </View>
    <View style={styles.bottom}>
      <Pressable testID={`reel-brand-${r.id}`} accessibilityLabel={t('reel.exploreCreator', { creator: r.creator })} onPress={() => router.push(`/brand/${r.brand?.id || r.product.brand_id || r.product.store_id}` as any)} style={styles.creator}><View style={styles.brandLogoWrap}>{r.brand?.logo ? <Image testID={`reel-brand-logo-${r.id}`} source={r.brand.logo} style={styles.brandLogo} contentFit="contain" /> : <Text style={styles.brandInitial}>{r.creator.slice(0, 1)}</Text>}</View><View style={styles.creatorCopy}><Text style={styles.creatorName}>{r.creator}</Text><Text style={styles.sample}>{t('reel.sampleAd')}</Text></View><Icon name="chevron-forward" size={15} color={colors.lime} /></Pressable>
      <Text testID={`reel-caption-${r.id}`} style={styles.caption}>{r.caption}</Text>
      <View style={styles.product}><Pressable testID={`reel-product-${r.id}`} onPress={() => router.push(`/product/${r.product.id}` as any)} style={styles.productInfo}><Image source={r.product.image} style={styles.productImage} /><View style={styles.flex}><Text style={styles.productName} numberOfLines={1}>{r.product.name}</Text><Text testID={`reel-price-${r.id}`} style={styles.price}>{fmt.money(r.product.price)} <Text style={styles.mrp}>{fmt.money(r.product.mrp)}</Text></Text></View></Pressable><Pressable testID={`reel-add-${r.id}`} accessibilityLabel={t('reel.addToCartA11y', { name: r.product.name })} onPress={() => add(r.product)} style={styles.add}><Icon name={qtyOf(r.product.id) > 0 ? 'checkmark' : 'add'} size={17} color={colors.onSurface} /><Text testID={`reel-added-${r.id}`} style={styles.addText}>{qtyOf(r.product.id) > 0 ? t('reel.added', { n: fmt.number(qtyOf(r.product.id)) }) : t('reel.addToCart')}</Text></Pressable></View>
      <Pressable testID={`reel-shop-now-${r.id}`} onPress={() => router.push(`/product/${r.product.id}` as any)} style={styles.shopNow}><Text style={styles.shopNowText}>{t('reel.shopNow')}</Text><Icon name="arrow-forward" size={17} color={colors.onSurface} /></Pressable>
      {!!message && <Text testID={`reel-feedback-${r.id}`} style={styles.errorText}>{message === 'likeFailed' ? t('reel.likeFailed') : t('reel.copyFailed')}</Text>}
      <Pressable testID={`reel-next-${r.id}`} onPress={next} style={styles.next}><Icon name="chevron-up" size={13} color={colors.surface} /><Text style={styles.nextText}>{t('reel.swipeNext')}</Text></Pressable>
    </View>
    <Modal visible={shareOpen} transparent animationType="slide" onRequestClose={() => setShareOpen(false)}><View style={styles.modal}><View testID={`reel-share-sheet-${r.id}`} style={styles.sheet}><View style={styles.sheetTop}><Text style={styles.sheetTitle}>{t('reel.shareTitle')}</Text><Pressable testID={`reel-share-close-${r.id}`} style={styles.round} onPress={() => setShareOpen(false)}><Icon name="close" size={23} color={colors.onSurface} /></Pressable></View><Text style={styles.shareName}>{r.product.name}</Text><Text selectable testID={`reel-share-link-${r.id}`} style={styles.link}>{link}</Text><Pressable testID={`reel-copy-link-${r.id}`} style={styles.copy} onPress={async () => { try { await Clipboard.setStringAsync(link); setCopied(true); } catch { setMessage('copyFailed' /* i18n-ignore: message code */); } }}><Icon name={copied ? 'checkmark' : 'copy-outline'} size={18} color={colors.onSurface} /><Text testID={`reel-copy-status-${r.id}`} style={styles.addText}>{copied ? t('reel.linkCopied') : t('reel.copyLink')}</Text></Pressable></View></View></Modal>
  </View>;
}
const styles = StyleSheet.create({
  actionGlass: { backgroundColor: colors.overlay, borderRadius: 25, paddingVertical: 9 },
  shopNow: { minHeight: 46, backgroundColor: colors.lime, marginTop: 9, borderRadius: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 }, shopNowText: { fontSize: 12, fontWeight: '600', color: colors.onSurface }, brandLogoWrap: logoTile(48), brandLogo: { width: logoSize(48), height: logoSize(48) }, brandInitial: { color: colors.onSurface, fontSize: 21, fontWeight: '700' },
  video: { ...StyleSheet.absoluteFill, width: '100%', height: '100%', pointerEvents: 'none' },
  card: { backgroundColor: colors.brandPrimary, width: '100%', overflow: 'hidden' }, top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { color: colors.surface, fontSize: 29, fontWeight: '800', letterSpacing: -1 }, topSub: { fontSize: 7, letterSpacing: 1.7, color: colors.surface, marginTop: 5 }, round: { width: 44, height: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.whiteGlass }, cartCount: { position: 'absolute', right: -2, top: -2, paddingHorizontal: 5, borderRadius: 8, backgroundColor: colors.lime, color: colors.onSurface, fontSize: 10, fontWeight: '800' }, playArea: { position: 'absolute', top: '18%', bottom: '40%', left: 0, right: 70, alignItems: 'center', justifyContent: 'center' }, pauseIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' }, actions: { position: 'absolute', right: 14, bottom: 240, gap: 23 }, action: { minWidth: 50, maxWidth: 76, minHeight: 50, alignItems: 'center', gap: 5 }, actionLabel: { color: colors.surface, fontSize: 10, fontWeight: '600', textAlign: 'center' }, bottom: { position: 'absolute', bottom: 10, left: 18, right: 18 }, creator: { flexDirection: 'row', alignItems: 'center', gap: 8 }, creatorCopy: { flexShrink: 1 }, avatar: { backgroundColor: colors.lime, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, creatorName: { color: colors.surface, fontSize: 13, fontWeight: '700' }, sample: { fontSize: 8, color: colors.surface, marginTop: 3 }, caption: { color: colors.surface, fontSize: 12, lineHeight: 18, marginTop: 13, marginBottom: 16, maxWidth: 290 }, product: { backgroundColor: colors.surface, padding: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }, productInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }, productImage: { width: 43, height: 48, borderRadius: 9 }, flex: { flex: 1 }, productName: { color: colors.onSurface, fontSize: 11, fontWeight: '700' }, price: { color: colors.forest, fontSize: 14, fontWeight: '800', marginTop: 7 }, mrp: { fontWeight: '400', fontSize: 10, color: colors.muted, textDecorationLine: 'line-through' }, add: { backgroundColor: colors.lime, minHeight: 44, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '46%' }, addText: { color: colors.onSurface, fontSize: 10, fontWeight: '800', flexShrink: 1 }, next: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }, nextText: { color: colors.surface, fontSize: 8, letterSpacing: 0.6 }, videoError: { position: 'absolute', top: '40%', alignSelf: 'center', padding: 12, backgroundColor: colors.overlay }, errorText: { color: colors.surface, fontSize: 12 }, modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 38 }, sheetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sheetTitle: { fontSize: 23, fontWeight: '700', color: colors.onSurface }, shareName: { fontSize: 14, color: colors.onSurface, marginTop: 12 }, link: { color: colors.muted, backgroundColor: colors.cream, padding: 14, borderRadius: 10, marginVertical: 14, fontSize: 11 }, copy: { minHeight: 48, backgroundColor: colors.lime, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
});