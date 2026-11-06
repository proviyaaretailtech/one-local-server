// The carousel campaign card (format 'carousel', specs/e2e-local-mvp/CAROUSEL-CONTRACT.md): a centered rounded card with an
// optional title, a horizontally paged (swipeable) gallery of image slides, page dots, the current slide's caption and a
// call-to-action that routes to the current slide (falling back to the first). A modal, never a strip.
//  - The card is screen width minus a margin (at most 360 pt); each slide fills it at contentFit:"cover", like a letter's photo.
//  - One fade / slide entrance on the UI thread; with Reduce Motion it simply appears (matches letter-popup / PopupHost).
//  - Close is always visible; tapping outside and the back button close it too.
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Icon from '@react-native-vector-icons/ionicons';
import { useTranslation } from '@/src/i18n';
import { colors, radius, spacing } from '../theme';
import { contentFor, imageUrl } from './api';
import type { Popup } from './types';

type Props = { popup: Popup; lang: string; motion: boolean; onClose: () => void; onOpen: (route?: string) => void };

export function CarouselPopup({ popup, lang, motion, onClose, onOpen }: Props) {
  const { t } = useTranslation();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const c = contentFor(popup, lang);
  const slides = c.slides ?? [];
  const [index, setIndex] = useState(0);

  // The card is edge-to-edge for the gallery; the picture keeps a 4:5 shape, capped so the card still fits small phones.
  const cardW = Math.min(screenW - 2 * spacing.lg, 360);
  const galleryH = Math.min(Math.round(cardW * 5 / 4), Math.round(screenH * 0.5));

  const progress = useSharedValue(motion ? 0 : 1);
  useEffect(() => { if (motion) progress.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }); }, [motion, progress]);
  const entrance = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: (1 - progress.value) * 24 }] }));

  if (!slides.length) return null;
  const cur = slides[Math.min(index, slides.length - 1)] ?? slides[0];
  const ctaRoute = cur.cta_route ?? slides[0]?.cta_route;             // fall back to the first slide's destination
  const hasCta = !!(cur.cta_label || ctaRoute);
  // Keep the paged index in step with the scroll on both native (momentum) and web (continuous scroll).
  const onScroll = (e: { nativeEvent: { contentOffset: { x: number } } }) => {
    const i = Math.max(0, Math.min(slides.length - 1, Math.round(e.nativeEvent.contentOffset.x / cardW)));
    if (i !== index) setIndex(i);
  };

  return <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
    <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t('popups.closeA11y')} />
    <View pointerEvents="box-none" style={s.center}>
      <Animated.View testID="popup-carousel" accessibilityViewIsModal accessibilityLabel={c.title || t('popups.dialogA11y')}
        style={[s.card, { width: cardW }, entrance]}>
        {!!c.title && <View style={s.header}><Text testID="popup-carousel-title" style={s.title} numberOfLines={2}>{c.title}</Text></View>}

        <View style={{ width: cardW, height: galleryH }}>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onScroll={onScroll} onMomentumScrollEnd={onScroll} scrollEventThrottle={16}>
            {slides.map((slide, i) => (
              <Image key={i} testID={`popup-carousel-slide-${i}`} source={{ uri: imageUrl(slide.image) ?? undefined }}
                style={{ width: cardW, height: galleryH, backgroundColor: colors.surfaceSecondary }} contentFit="cover" transition={150} />
            ))}
          </ScrollView>
          {/* The current slide's caption sits over the picture on a dark fade so it stays readable on any image. */}
          {!!cur.caption && <>
            <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)']} style={s.captionFade} />
            <Text style={s.caption} numberOfLines={2}>{cur.caption}</Text>
          </>}
        </View>

        <View style={s.footer}>
          {slides.length > 1 && <View style={s.dots}>
            {slides.map((_, i) => <View key={i} style={[s.dot, i === index && s.dotOn]} />)}
          </View>}
          {hasCta && <Pressable testID="popup-cta" accessibilityRole="button" onPress={() => onOpen(ctaRoute)}
            style={({ pressed }) => [s.cta, pressed && s.pressed]}>
            <Text style={s.ctaText}>{cur.cta_label || t('popups.open')}</Text>
          </Pressable>}
        </View>

        <Pressable testID="popup-close" accessibilityRole="button" accessibilityLabel={t('popups.closeA11y')} hitSlop={12} onPress={onClose}
          style={({ pressed }) => [s.close, pressed && s.pressed]}>
          <Icon name="close" size={20} color={colors.onSurface} />
        </Pressable>
      </Animated.View>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlayDeep },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', maxWidth: 360,
    boxShadow: [{ offsetX: 0, offsetY: 24, blurRadius: 48, color: 'rgba(5,20,10,0.35)' }] },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, paddingRight: 44 },
  title: { fontSize: 18, fontWeight: '700', color: colors.onSurface },
  captionFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  caption: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.md, color: '#FFFFFF', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  footer: { padding: spacing.lg, gap: spacing.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.borderStrong },
  dotOn: { backgroundColor: colors.brand, width: 18 },
  cta: { minHeight: 52, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: colors.onBrand, fontSize: 15, fontWeight: '700' },
  close: { position: 'absolute', right: spacing.sm, width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, opacity: 0.95,
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.2)' }] },
  pressed: { opacity: 0.7 },
});
