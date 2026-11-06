// The campaign card (format 'letter', specs/marketing-popups/plan.md §3), founder-picked "Calm Utility" look (2026-10-29): the
// photo or video IS the card, rising from the bottom like a sheet but never full screen; the words sit on it over a dark fade,
// with a small label top left, a round close top right and one full-width lime button.
// Master Admin's "frame" sets the label (Classic/Festive show the label text, Plain shows none).
//  - Screen width minus 24 pt (at most 420), the creative's own shape, at most 64% of the screen tall.
//  - Video plays muted on a loop with a sound button; with Reduce Motion it does not play (poster shown).
//  - Close is always visible; tapping outside and the back button close it too.
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Icon from '@react-native-vector-icons/ionicons';
import { useTranslation } from '@/src/i18n';
import { colors } from '../theme';
import { contentFor, imageUrl } from './api';
import type { Popup } from './types';

const INK = '#0B1F16';
const RADIUS = 28;

type Props = { popup: Popup; lang: string; motion: boolean; onClose: () => void; onOpen: () => void };

export function LetterPopup({ popup, lang, motion, onClose, onOpen }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const c = contentFor(popup, lang);
  const media = popup.media;
  const style = popup.frame?.style ?? 'royal_gold';
  const tag = style === 'plain' ? null : (popup.is_sponsored ? t('popups.ad') : c.greeting?.replace(/[,，]\s*$/, '') || null);

  // The picture is the card: full width (minus a 12 pt margin), its own shape, never taller than 64% of the screen.
  const cardW = Math.min(screenW - 24, 420);
  const ratio = media ? media.width / media.height : 4 / 5;
  const cardH = Math.min(cardW / ratio, screenH * 0.64);

  const progress = useSharedValue(motion ? 0 : 1);
  useEffect(() => { if (motion) progress.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }); }, [motion, progress]);
  const entrance = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: (1 - progress.value) * 40 }] }));

  return <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
    <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t('popups.closeA11y')} />
    <View pointerEvents="box-none" style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
      <Animated.View testID="popup-letter" accessibilityViewIsModal accessibilityLabel={c.title || t('popups.dialogA11y')} style={[s.card, { width: cardW, height: cardH }, entrance]}>
        {media && (media.type === 'video'
          ? <CampaignVideo source={imageUrl(media.web_key ?? media.key)!} poster={imageUrl(media.poster_key)} play={motion} />
          : <Image testID="popup-letter-photo" source={{ uri: imageUrl(media.key)! }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />)}
        {/* the words sit on the picture: a dark fade from the bottom keeps them readable on any photo */}
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.82)']} locations={[0.3, 0.55, 1]} style={StyleSheet.absoluteFill} />

        {!!tag && <View style={s.tag}><Text style={s.tagText} numberOfLines={1}>{tag}</Text></View>}
        <Pressable testID="popup-close" accessibilityRole="button" accessibilityLabel={t('popups.closeA11y')} hitSlop={12} onPress={onClose}
          style={({ pressed }) => [s.close, pressed && s.pressed]}>
          <Icon name="close" size={18} color={INK} />
        </Pressable>

        <View style={s.words}>
          {!!c.title && <Text testID="popup-letter-title" style={s.title} numberOfLines={3}>{c.title}</Text>}
          {!!c.body && <Text style={s.text} numberOfLines={3}>{c.body}</Text>}
          {/* A button shows when it has words or a destination; with no destination it just closes the card (e.g. "Coming soon"). */}
          {!!(c.cta_label || c.cta_route) && <Pressable testID="popup-cta" accessibilityRole="button" onPress={onOpen} style={({ pressed }) => [s.cta, pressed && s.pressed]}>
            <Text style={s.ctaText}>{c.cta_label || t('popups.open')}</Text>
          </Pressable>}
        </View>
      </Animated.View>
    </View>
  </Modal>;
}

// Muted loop with a sound button; with Reduce Motion (play=false) only the poster (or the first frame) is shown.
function CampaignVideo({ source, poster, play }: { source: string; poster: string | null; play: boolean }) {
  const { t } = useTranslation();
  const view = useRef<VideoView>(null);
  const [muted, setMuted] = useState(true); const [started, setStarted] = useState(false);
  const player = useVideoPlayer(source, p => { p.loop = true; p.muted = true; });
  useEffect(() => { player.muted = muted; }, [player, muted]);
  useEffect(() => {
    if (!play) return;
    const start = () => {
      const el = Platform.OS === 'web' ? (view.current as unknown as { nativeRef?: { current?: HTMLVideoElement } })?.nativeRef?.current : undefined;
      if (el) void el.play().catch(() => {}); else player.play();
    };
    start();
    const ready = player.addListener('statusChange', e => { if (e.status === 'readyToPlay') start(); });
    const tick = player.addListener('playingChange', e => { if (e.isPlaying) setStarted(true); });
    return () => { ready.remove(); tick.remove(); try { player.pause(); } catch { /* already released (Android, on close) */ } };
  }, [player, play]);
  return <>
    {/* a <video> on the web keeps its own size unless stretched (see Discover tiles) */}
    <VideoView ref={view} testID="popup-letter-video" player={player} nativeControls={false} contentFit="cover" style={[StyleSheet.absoluteFill, s.fill]} />
    {!!poster && !started && <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" />}
    {play && <Pressable testID="popup-letter-sound" accessibilityRole="button" accessibilityLabel={muted ? t('popups.soundOn') : t('popups.soundOff')}
      hitSlop={10} onPress={() => setMuted(m => !m)} style={({ pressed }) => [s.sound, pressed && s.pressed]}>
      <Icon name={muted ? 'volume-mute' : 'volume-high'} size={16} color="#FFFFFF" />
    </Pressable>}
  </>;
}

const s = StyleSheet.create({
  // Dark enough (and blurred on the web) that bright things behind the card, like the lime SOON pills, fall away.
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,16,11,0.74)',
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' } as object) : {}) },
  bottom: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'flex-end' },
  card: { borderRadius: RADIUS, overflow: 'hidden', backgroundColor: '#1C241F',
    boxShadow: [{ offsetX: 0, offsetY: 24, blurRadius: 48, color: 'rgba(5,20,10,0.35)' }] },
  fill: { width: '100%', height: '100%' },
  tag: { position: 'absolute', top: 16, left: 16, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)' },
  tagText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  close: { position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.92)' },
  words: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingBottom: 18, gap: 6 },
  title: { color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.8 },
  text: { color: 'rgba(255,255,255,0.88)', fontSize: 15, lineHeight: 21 },
  cta: { marginTop: 10, minHeight: 54, borderRadius: 27, backgroundColor: colors.electricLime, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: INK, fontSize: 16, fontWeight: '800' },
  sound: { position: 'absolute', right: 60, top: 14, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  pressed: { opacity: 0.8 },
});
