// Home's first screen, over a still festive backdrop: the brand header (src/components/brand-header.tsx), then a row of tall
// cards that moves on by itself (src/use-auto-pager.ts), the card that is up in the middle and its neighbours peeking in
// either side. The first card holds the five services; the banners follow. Bars below show which card is up and fill while
// it waits; a bar takes you to its card. The services card waits longest. The page's white sheet, with rounded top
// corners, begins below.
import { Tap } from './tap';
import { memo, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Animated, Easing, ScrollView, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { setStatusBarStyle } from 'expo-status-bar';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { colors, glassPane, radius } from '../theme';
import { IconTile } from '../ui/icon-tile';
import { PageDot } from '../ui/page-dot';
import { BrandHeader, HEADER_COMPACT_AT } from './brand-header';
import { departmentArt, departments, departmentName, type DepartmentId } from '../departments';
import { nativeDriver, useCityScroll } from '../motion';
import { useAutoPager } from '../use-auto-pager';
import { useTranslation } from '../i18n';
import { useAppDimensions } from '../layout';

const CARD_SHARE = 0.68; // of the screen's width; the neighbours show in what is left
const CARD_RATIO = 1.5; // height to width; shorter than the 9:16 posters, which lose a little at top and bottom
const CARD_GAP = 12;
const PAD = 14;
const TILE_GAP = 10;
// Where each service opens: Groceries, Shops and Pharma & Beauty are all in the Categories tab.
const OPENS: Record<DepartmentId, Href> = { food: '/food', grocery: '/categories', shops: '/categories', care: '/categories', 'book-it': '/book-it' };
// Room left below the cards, for the bars; the page's white sheet covers the lower part of it (HOME_HERO_OVERLAP).
const TAIL = 56;
/** How far the white sheet after the hero rises over its bottom edge, its rounded top corners drawn on the backdrop. */
export const HOME_HERO_OVERLAP = 28;
const SERVICES_WAIT = 6000; // the services are how Home is used, so their card stays longest
const BANNER_WAIT = 4200;

// Bundled with the app, so it is there at once and offline. It is drawn from its top edge; what the hero is shorter than
// it is cut off at the bottom. s.hero is its own top colour, for the moment before it decodes.
const BACKDROP = require('../../assets/images/home/hero-backdrop.webp');
// The banners, bundled with the app too: posters that carry their own words, so nothing is drawn on them. `label` is what a
// screen reader says.
const BANNERS = [
  { id: 'purushottam', image: require('../../assets/images/home/banner-purushottam.jpg'), label: 'home.banners.purushottam' },
  { id: 'shree-shyam-bhoj', image: require('../../assets/images/home/banner-shree-shyam-bhoj.jpg'), label: 'home.banners.shreeShyamBhoj' },
  { id: 'rooftop', image: require('../../assets/images/home/banner-rooftop.jpg'), label: 'home.banners.rooftop' },
  { id: 'baskin-robbins', image: require('../../assets/images/home/banner-baskin-robbins.jpg'), label: 'home.banners.baskinRobbins' },
] as const;

// `copy` is one of the copies at the ends of the row: no test ids, and hidden from screen readers. `style` places it.
type CardProps = { width: number; copy: boolean; style?: StyleProp<ViewStyle> };
const hidden = (copy: boolean) => ({ accessibilityElementsHidden: copy, importantForAccessibility: copy ? 'no-hide-descendants' as const : 'auto' as const });

// The services card, white glass like the header's controls: its title over the five services, all one size, two centred
// on top and three below (departments lists them in that order), the rows spread down the card.
function ServicesCard({ width, copy, style }: CardProps) {
  const router = useRouter(); const { t } = useTranslation();
  const names: Partial<Record<DepartmentId, string>> = { care: t('home.services.care'), 'book-it': t('home.services.bookIt') };
  const tile = (width - PAD * 2 - TILE_GAP * 2) / 3;
  return <View testID={copy ? undefined : 'department-strip'} {...hidden(copy)} style={[s.card, glassPane, s.services, { width, height: Math.round(width * CARD_RATIO) }, style]}>
    <Text numberOfLines={1} style={s.servicesTitle}>{t('home.hero.services')}</Text>
    <View style={s.grid}>{[departments.slice(0, 2), departments.slice(2)].map((row, r) => <View key={r} style={s.serviceRow}>
      {row.map(d => {
        const name = names[d.id] ?? departmentName(t, d.id);
        // A short wait before the press shows, so a swipe across the cards doesn't sink the tile under the finger.
        return <Tap key={d.id} testID={copy ? undefined : `department-${d.id}`} accessibilityRole="button" accessibilityLabel={name} unstable_pressDelay={120} onPress={() => router.navigate(OPENS[d.id])} style={[s.service, { width: tile }]}>
          <IconTile testID={copy ? undefined : `department-icon-${d.id}`} source={departmentArt[d.id]} />
          <Text testID={copy ? undefined : `department-label-${d.id}`} numberOfLines={2} style={s.serviceName}>{name}</Text>
        </Tap>;
      })}
    </View>)}</View>
  </View>;
}

// A banner's card: the poster filling it, trimmed where its shape differs from the card's. Posters carry their logo near
// the top, so most of the trim comes off the bottom.
function BannerCard({ banner, width, copy, style }: CardProps & { banner: (typeof BANNERS)[number] }) {
  const { t } = useTranslation();
  return <View testID={copy ? undefined : `home-banner-${banner.id}`} accessible={!copy} accessibilityRole="image" accessibilityLabel={copy ? undefined : t(banner.label)} {...hidden(copy)}
    style={[s.card, s.banner, { width, height: Math.round(width * CARD_RATIO) }, style]}>
    <Image source={banner.image} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={{ top: '25%', left: '50%' }} />
  </View>;
}

// Which card is up: a dot for each, the current one stretched into a bar that fills while its card waits (and stays full
// while held).
function Steps({ labels, index, running, wait, go }: { labels: string[]; index: number; running: boolean; wait: number; go: (n: number) => void }) {
  const [fill] = useState(() => new Animated.Value(0));
  // Before the frame is drawn, so a card's bar never shows the last card's full fill for a moment.
  useLayoutEffect(() => {
    fill.setValue(running ? 0 : 1);
    if (!running) return;
    const run = Animated.timing(fill, { toValue: 1, duration: wait, easing: Easing.linear, useNativeDriver: nativeDriver });
    run.start(); return () => run.stop();
  }, [fill, index, running, wait]);
  return <View style={s.steps}>{labels.map((label, n) => <Tap key={n} testID={`home-hero-step-${n}`} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: n === index }} haptic={false} hitSlop={8} onPress={() => go(n)} style={s.stepHit}>
    <PageDot on={n === index} size={6} wide={22} color={colors.glass} onColor={colors.whiteGlassLine}>{n === index && <Animated.View style={[s.barFill, { transform: [{ scaleX: fill }] }]} />}</PageDot>
  </Tap>)}</View>;
}

// Light status bar over the backdrop; dark once the white compact header has taken over.
function useHeroStatusBar() {
  const { y } = useCityScroll();
  useFocusEffect(useCallback(() => {
    let dark = false; setStatusBarStyle('light');
    const id = y.addListener(({ value }) => { const next = value > HEADER_COMPACT_AT - 40; if (next !== dark) { dark = next; setStatusBarStyle(next ? 'dark' : 'light'); } });
    return () => { y.removeListener(id); setStatusBarStyle('dark'); };
  }, [y]));
  useEffect(() => () => setStatusBarStyle('dark'), []);
}

export const HomeHero = memo(function HomeHero() {
  useHeroStatusBar();
  const { t } = useTranslation(); const { width } = useAppDimensions();
  const card = Math.round(width * CARD_SHARE); const step = card + CARD_GAP; const count = BANNERS.length + 1;
  const { list, index, loops, running, wait, go, onScroll, touch } = useAutoPager(count, step, n => (n === 0 ? SERVICES_WAIT : BANNER_WAIT));
  // Card numbers, 0 the services. Copies at both ends, so a neighbour peeks in either side of every card and moving on from
  // the last slides into the first: the last card before the row, pulled left so only its edge shows, and the first two after.
  const row = loops ? [count - 1, ...Array.from({ length: count }, (_, n) => n), 0, 1] : [0];
  return <View testID="home-hero" style={s.hero}>
    <Image source={BACKDROP} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" />
    <BrandHeader tone="photo" />
    <ScrollView ref={list} horizontal showsHorizontalScrollIndicator={false} snapToInterval={step} decelerationRate="fast" disableIntervalMomentum scrollEnabled={loops}
      contentContainerStyle={[s.cards, { paddingHorizontal: (width - card) / 2 }]} scrollEventThrottle={16} onScroll={e => onScroll(e.nativeEvent.contentOffset.x)} {...touch}>
      {row.map((at, n) => {
        const copy = loops && (n === 0 || n > count); const style = loops && n === 0 ? { marginLeft: -step } : undefined;
        return at === 0 ? <ServicesCard key={n} width={card} copy={copy} style={style} /> : <BannerCard key={n} banner={BANNERS[at - 1]} width={card} copy={copy} style={style} />;
      })}
    </ScrollView>
    {loops && <Steps labels={[t('home.hero.services'), ...BANNERS.map(banner => t(banner.label))]} index={index} running={running} wait={wait} go={go} />}
  </View>;
});

const s = StyleSheet.create({
  hero: { width: '100%', overflow: 'hidden', backgroundColor: colors.festiveDeep, paddingBottom: TAIL },
  cards: { paddingTop: 18, paddingBottom: 6, gap: CARD_GAP },
  card: { borderRadius: radius.lg },
  services: { padding: PAD, gap: 10 },
  servicesTitle: { color: colors.surface, fontSize: 18, lineHeight: 26, fontWeight: '800' },
  grid: { flex: 1, justifyContent: 'space-evenly' },
  serviceRow: { flexDirection: 'row', justifyContent: 'center', gap: TILE_GAP },
  service: { alignItems: 'center', gap: 6 },
  serviceName: { color: colors.surface, fontSize: 12, lineHeight: 17, fontWeight: '700', textAlign: 'center', textShadowColor: colors.overlay, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  banner: { overflow: 'hidden', backgroundColor: colors.forestDeep },
  steps: { position: 'absolute', left: 0, right: 0, bottom: HOME_HERO_OVERLAP + 3, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  // Each step sits in a comfortable tap area of its own.
  stepHit: { paddingHorizontal: 3, paddingVertical: 8 },
  barFill: { flex: 1, backgroundColor: colors.surface, transformOrigin: 'left' },
});
