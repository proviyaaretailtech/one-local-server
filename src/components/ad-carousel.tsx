// Tall ad slides for featured shops (their banner photo, best offer on a lime sticker, name, line and an "Order now"
// button) that move on by themselves every few seconds, always forwards: after the last comes the first again. Swipes move
// one slide at a time, a dot takes you to its slide, and a finger on the slides, Reduce Motion or leaving the screen
// stops the movement.
import { View, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { Text } from '../ui/text';
import { PageDot } from '../ui/page-dot';
import { Tap } from './tap';
import { colors, popBase, radius } from '../theme';
import { useAppDimensions } from '../layout';
import { useAutoPager } from '../use-auto-pager';
import { useFormat, useTranslation } from '../i18n';
import { storeBanner, type Store } from '../api';

const SIDE = 16;
const GAP = 12;
const HEIGHT = 236;
const EVERY = 4500;

/** `offer` is the shop's best discount (%), 0 for none; `accent` colours the current dot. */
export function AdCarousel({ slides, accent }: { slides: { store: Store; offer: number }[]; accent: string }) {
  const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat();
  const { width } = useAppDimensions(); const card = width - SIDE * 2; const step = card + GAP;
  const count = slides.length;
  const { list, index, loops, go, onScroll, touch } = useAutoPager(count, step, () => EVERY);
  const shown = loops ? [...slides, slides[0]] : slides;
  return <View testID="ad-carousel">
    <ScrollView ref={list} horizontal showsHorizontalScrollIndicator={false} snapToInterval={step} decelerationRate="fast" disableIntervalMomentum contentContainerStyle={s.track}
      scrollEventThrottle={16} onScroll={e => onScroll(e.nativeEvent.contentOffset.x)} {...touch}>
      {shown.map(({ store, offer }, n) => <Tap key={n < count ? store.id : `${store.id}-again`} testID={n < count ? `ad-${store.id}` : undefined} accessibilityRole="button" accessibilityLabel={t('home.shopStore', { name: store.name })}
        // A short wait before the press shows, so a swipe across the slides doesn't sink the one under the finger.
        unstable_pressDelay={120}
        onPress={() => router.push(`/store/${store.id}`)} style={[s.slide, { width: card }]}>
        <Image source={storeBanner(store)} style={StyleSheet.absoluteFill} contentFit="cover" />
        {/* Darkens the lower half, so the white words read on any photo. */}
        <LinearGradient pointerEvents="none" colors={['transparent', colors.overlay, colors.overlay]} locations={[0.3, 0.75, 1]} style={StyleSheet.absoluteFill} />
        <View style={s.tag}><Text style={s.tagText}>{t('foodPage.featured')}</Text></View>
        <View style={s.copy}>
          {offer > 0 && <View style={s.offer}><Icon name="pricetag" size={11} color={colors.forestDeep} /><Text style={s.offerText}>{t('foodPage.offer', { pct: fmt.percent(offer) })}</Text></View>}
          <Text numberOfLines={1} style={s.title}>{store.name}</Text>
          {!!store.tagline && <Text numberOfLines={1} style={s.line}>{store.tagline}</Text>}
          <View style={s.cta}><Text style={s.ctaText}>{t('foodPage.orderNow')}</Text><Icon name="arrow-forward" size={14} color={colors.forestDeep} /></View>
        </View>
      </Tap>)}
    </ScrollView>
    {count > 1 && <View style={s.dots}>{slides.map((slide, n) => <Tap key={slide.store.id} testID={`ad-dot-${n}`} accessibilityRole="button" accessibilityLabel={slide.store.name} accessibilityState={{ selected: n === index }} haptic={false} hitSlop={8} onPress={() => go(n)} style={s.dotHit}>
      <PageDot on={n === index} size={7} wide={20} color={colors.border} onColor={accent} />
    </Tap>)}</View>}
  </View>;
}

const s = StyleSheet.create({
  track: { paddingHorizontal: SIDE, gap: GAP },
  slide: { height: HEIGHT, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceTertiary },
  tag: { position: 'absolute', top: 14, left: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.overlay },
  tagText: { fontSize: 11, fontWeight: '700', color: colors.surface },
  copy: { position: 'absolute', left: 16, right: 16, bottom: 16, gap: 4, alignItems: 'flex-start' },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.electricLime, boxShadow: popBase(2) },
  offerText: { fontSize: 12, fontWeight: '800', color: colors.forestDeep },
  title: { fontSize: 24, lineHeight: 29, fontWeight: '800', letterSpacing: -0.4, color: colors.surface },
  line: { fontSize: 13, fontWeight: '500', color: colors.surface, opacity: 0.9 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 14, minHeight: 34, borderRadius: radius.pill, backgroundColor: colors.surface },
  ctaText: { fontSize: 13, fontWeight: '800', color: colors.forestDeep },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  // Each dot sits in a comfortable tap area of its own.
  dotHit: { paddingHorizontal: 4, paddingVertical: 8 },
});
