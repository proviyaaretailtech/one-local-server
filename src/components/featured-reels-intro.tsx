// The featured reels, played full screen over Discover the first time it opens each day (app/(tabs)/discover.tsx decides
// when): each runs for a few seconds, stories-style bars across the top showing how far along, then the intro fades away
// to the page. Skip ends it at once; "Watch the reel" opens the reel being shown. Reduce Motion shows each reel's photo.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { Text } from '../ui/text';
import { Tap } from './tap';
import { MutedVideo } from './muted-video';
import { colors, glassPane, popBase, radius } from '../theme';
import { nativeDriver, useMotionAllowed } from '../motion';
import { useFormat, useTranslation } from '../i18n';
import type { Reel } from '../api';

const EACH = 5000; // how long each reel shows
const FADE = 500;

export function FeaturedReelsIntro({ reels, onDone }: { reels: Reel[]; onDone: () => void }) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const motion = useMotionAllowed(); const { t } = useTranslation(); const fmt = useFormat();
  const [index, setIndex] = useState(0); const [shown] = useState(() => new Animated.Value(motion ? 0 : 1)); const [progress] = useState(() => new Animated.Value(0));
  const reel = reels[index];
  // The page re-renders while the intro plays; holding its latest onDone keeps `close` (and the bar timer) from restarting.
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  const close = useCallback((then?: () => void) => {
    progress.stopAnimation();
    const end = () => { done.current(); then?.(); };
    if (!motion) { end(); return; }
    Animated.timing(shown, { toValue: 0, duration: FADE, useNativeDriver: nativeDriver }).start(end);
  }, [motion, shown, progress]);
  // Pops up on opening.
  useEffect(() => { if (motion) Animated.timing(shown, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }).start(); }, [motion, shown]);
  // Fills this reel's bar, then moves on; after the last reel the intro fades out to the page.
  useEffect(() => {
    progress.setValue(0);
    const run = Animated.timing(progress, { toValue: 1, duration: EACH, easing: Easing.linear, useNativeDriver: nativeDriver });
    run.start(({ finished }) => { if (!finished) return; if (index < reels.length - 1) setIndex(index + 1); else close(); });
    return () => run.stop();
  }, [index, reels.length, progress, close]);
  if (!reel) return null;
  return <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={() => close()}>
    <Animated.View testID="featured-reels-intro" style={[StyleSheet.absoluteFill, s.screen, { opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] }) }] }]}>
      <Image source={reel.poster || reel.product?.image || reel.brand?.image} style={StyleSheet.absoluteFill} contentFit="cover" />
      {motion && <MutedVideo key={reel.id} source={Platform.OS === 'web' ? reel.video_web : reel.video} />}
      <LinearGradient pointerEvents="none" colors={[colors.overlayDeep, 'transparent']} style={[s.topShade, { height: insets.top + 140 }]} />
      <LinearGradient pointerEvents="none" colors={['transparent', colors.overlayDeep]} style={s.bottomShade} />
      <View style={[s.top, { paddingTop: insets.top + 10 }]}>
        <View style={s.bars}>{reels.map((r, n) => <View key={r.id} style={s.bar}>
          <Animated.View style={[s.barFill, { transform: [{ scaleX: n < index ? 1 : n > index ? 0 : progress }] }]} />
        </View>)}</View>
        <View style={s.head}>
          <View style={s.logo}>{!!reel.brand?.logo && <Image source={reel.brand.logo} style={s.logoImage} contentFit="contain" />}</View>
          <Text numberOfLines={1} style={s.brand}>{reel.creator}</Text>
          <View style={s.featured}><Icon name="star" size={10} color={colors.forestDeep} /><Text style={s.featuredText}>{t('discover.intro.featured')}</Text></View>
          <Tap testID="featured-intro-skip" accessibilityRole="button" accessibilityLabel={t('discover.intro.skip')} onPress={() => close()} style={s.skip}><Text style={s.skipText}>{t('discover.intro.skip')}</Text><Icon name="close" size={14} color={colors.surface} /></Tap>
        </View>
      </View>
      <View style={[s.bottom, { paddingBottom: insets.bottom + 28 }]}>
        {!!reel.tag && <Text style={s.tag}>{reel.tag}</Text>}
        <Text numberOfLines={3} style={s.caption}>{reel.caption}</Text>
        {reel.product && <Text numberOfLines={1} style={s.product}>{reel.product.name} · <Text style={s.price}>{fmt.money(reel.product.price)}</Text></Text>}
        <Tap testID="featured-intro-watch" accessibilityRole="button" onPress={() => close(() => router.push({ pathname: '/reels', params: { id: reel.id } } as never))} style={s.watch}>
          <Icon name="play" size={15} color={colors.forestDeep} /><Text style={s.watchText}>{t('discover.intro.watch')}</Text>
        </Tap>
      </View>
    </Animated.View>
  </Modal>;
}

const s = StyleSheet.create({
  screen: { backgroundColor: colors.brandPrimary },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  top: { paddingHorizontal: 14, gap: 12 },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.whiteGlassLine },
  barFill: { flex: 1, backgroundColor: colors.surface, transformOrigin: 'left' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  logoImage: { width: 30, height: 30 },
  brand: { flexShrink: 1, fontSize: 14, fontWeight: '800', color: colors.surface },
  featured: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.electricLime },
  featuredText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: colors.forestDeep, textTransform: 'uppercase' },
  skip: { ...glassPane, marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 12, borderRadius: radius.pill },
  skipText: { fontSize: 12, fontWeight: '800', color: colors.surface },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, gap: 8 },
  tag: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: colors.electricLime },
  caption: { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.4, color: colors.surface },
  product: { fontSize: 14, fontWeight: '600', color: colors.surface, opacity: 0.9 },
  price: { fontWeight: '800', color: colors.electricLime },
  watch: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, minHeight: 44, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.electricLime, boxShadow: popBase(3) },
  watchText: { fontSize: 14, fontWeight: '800', color: colors.forestDeep },
});
