import { useCallback, useEffect, useMemo, useState } from 'react';
import { Tap } from './tap';
import { View, StyleSheet, Animated } from 'react-native';
import { Text } from '@/src/ui/text';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { CityMotionProvider, useCityScroll } from '../motion';
import { FloatingCart } from './floating-cart';
import { BottomNavigation, dockSpace } from './bottom-navigation';
import { CartCelebration } from './cart-celebration';
import { DeliveryLocationContext, Point } from '../delivery-location';
import { useQuery } from '@tanstack/react-query';
import { CITY_CENTER, coverageAt } from '../places';
import { OneGlyph } from './one-button';
import { useShowFirstRun, useTranslation } from '../i18n';
import { HEADER_COMPACT_AT } from './brand-header';
import { DesktopNav } from './desktop-nav';
import { useIsDesktop } from '../layout';
import { ScreenPathProvider, useRoutePath } from '../use-screen-path';

const BARE = ['/sign-in', '/welcome'];
const FULL_SCREEN = ['/location', '/address-map', '/address-form'];
const IMMERSIVE = ['/brand/', '/store/', '/category/', '/search', '/discover', '/reels'];
// The tabs: pages that scroll under their own brand header (src/components/brand-header.tsx).
const SCROLLING = ['/', '/food', '/book-it', '/categories'];
// The profile and its pages, and the location picker: their soft wash runs up under the status bar, and they draw their
// own header below it.
const WASHED = ['/account', '/orders', '/enquiries', '/wishlist', '/profile-edit', '/addresses', '/payments', '/privacy', '/privacy-notice', '/refer', '/wallet', '/help', '/about', '/language', '/location', '/india'];
const LOCATION_ASKED_KEY = 'onecity.location-asked.v1';

// First launch only: after the intro, ask where the customer is (any place in India), because
// what One Local offers depends on the town. Sign-in waits until they pay; browsing never needs it.
// It also waits while the first-launch "Choose your language" screen is up, so the two questions never stack.
function useLocationFirst(hasSavedLocation: boolean | null, waitForLanguage: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (hasSavedLocation !== false || waitForLanguage) return;
    AsyncStorage.getItem(LOCATION_ASKED_KEY).then(asked => {
      if (asked) return;
      void AsyncStorage.setItem(LOCATION_ASKED_KEY, '1');
      router.push('/location?first=1');
    }).catch(() => {});
  }, [hasSavedLocation, waitForLanguage, router]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname(); const desktop = useIsDesktop(); const router = useRouter(); const insets = useSafeAreaInsets(); const waitForLanguage = useShowFirstRun();
  const scrolling = SCROLLING.includes(path); const bare = BARE.includes(path);
  // i18n-ignore: the default place name is data, not UI copy
  const [location, setLocationText] = useState('Latur, Maharashtra'); const [point, setPoint] = useState<Point | null>(null);
  const [hasSaved, setHasSaved] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.multiGet(['one-latur-location', 'one-latur-location-point']).then(([[, text], [, saved]]) => {
      if (text) setLocationText(text);
      try { if (saved) setPoint(JSON.parse(saved)); } catch {}
      setHasSaved(!!text);
    }).catch(() => setHasSaved(true));
  }, []);
  // What One Local offers where the customer is. No position yet means the Latur default.
  const at = point ?? CITY_CENTER;
  const { data: coverage = null } = useQuery({ queryKey: ['coverage', at.lat, at.lng], queryFn: () => coverageAt(at), staleTime: 10 * 60_000 });
  const setLocation = useCallback((value: string, next: Point | null = null) => {
    setLocationText(value); setPoint(next);
    AsyncStorage.multiSet([['one-latur-location', value], ['one-latur-location-point', next ? JSON.stringify(next) : '']]).catch(() => {});
  }, []);
  const openLocation = useCallback(() => router.push('/location'), [router]);
  // This shell re-renders on every navigation (it follows the path). Its context values change only when what they hold
  // does: every product card reads both, and a fresh object each time re-rendered every card on every screen switch.
  const deliveryLocation = useMemo(() => ({ location, point, coverage, setLocation, edit: openLocation }), [location, point, coverage, setLocation, openLocation]);
  useLocationFirst(hasSaved, waitForLanguage);
  // Full-screen takeovers (sign-in) get no tab bar or floating cart. The screens stay where they are in the tree on every
  // path: moving them for these pages rebuilt every open screen. Each screen draws its own top (ScreenFrame below).
  return <DeliveryLocationContext.Provider value={deliveryLocation}><View style={styles.container}>
    {desktop && !bare && !FULL_SCREEN.some(p => path.startsWith(p)) && <DesktopNav />}
    <View style={styles.page}>
    {children}
    {(scrolling || path === '/discover' || path.startsWith('/category/') || path.startsWith('/collection/') || path.startsWith('/brand/') || path === '/search') && <FloatingCart compact={path.startsWith('/category/')} bottom={Math.max(insets.bottom, 9) + 84} />}
    <BottomNavigation />
    {!bare && <CartCelebration top={insets.top + 8} />}
    </View>
  </View></DeliveryLocationContext.Provider>;
}

// A scrolling page's own top, which moves with the page, so leaving the page takes it along instead of snapping it away: the
// white scrim behind the status bar and the compact search bar, both arriving once the page's brand header
// (src/components/brand-header.tsx) has scrolled its search bar away.
function ScrollingChrome({ path, back }: { path: string; back: () => void }) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { t } = useTranslation();
  const isHome = path === '/';
  const { y, scrollRef } = useCityScroll();
  const [compact, setCompact] = useState(false);
  const scrimHeight = insets.top + 106;
  useEffect(() => { const id = y.addListener(({ value }) => setCompact(value > HEADER_COMPACT_AT)); return () => y.removeListener(id); }, [y]);
  // Built once, not on every render: each new node is attached to the native driver again.
  const scrolled = useMemo(() => {
    const near = { inputRange: [HEADER_COMPACT_AT - 30, HEADER_COMPACT_AT + 10], extrapolate: 'clamp' as const };
    return {
      show: y.interpolate({ ...near, outputRange: [0, 1] }),
      drop: y.interpolate({ ...near, outputRange: [-14, 0] }),
      grow: y.interpolate({ ...near, outputRange: [0.96, 1] }),
    };
  }, [y]);
  return <>
    {/* Solid behind the status bar, easing out under the compact bar (top + 6, 52 tall) and fading over 48pt below it. */}
    <Animated.View pointerEvents="none" style={[styles.scrim, { height: scrimHeight, opacity: scrolled.show }]}><LinearGradient colors={[colors.surface, colors.surface, 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0.15)', 'rgba(255,255,255,0)']} locations={[0, insets.top / scrimHeight, (insets.top + 58) / scrimHeight, (insets.top + 88) / scrimHeight, 1]} style={StyleSheet.absoluteFill} /></Animated.View>
    <Animated.View testID="compact-header" pointerEvents={compact ? 'auto' : 'none'} style={[styles.compact, { top: insets.top + 6,
      opacity: scrolled.show, transform: [{ translateY: scrolled.drop }, { scale: scrolled.grow }] }]}>
      {isHome
        ? <Tap testID="compact-expand-header" accessibilityLabel={t('shell.backToTop')} hitSlop={6} style={styles.compactGlyph} onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}><OneGlyph size={22} /></Tap>
        : <Tap testID="compact-back" accessibilityLabel={t('common.goBack')} hitSlop={6} style={styles.compactGlyph} onPress={back}><Icon name="arrow-back" size={19} color="#FFFFFF" /></Tap>}
      <Tap testID="compact-search" accessibilityRole="search" accessibilityLabel={t('shell.searchProducts')} style={styles.compactSearch} onPress={() => router.push('/search')}>
        <Icon name="search-outline" size={18} color={colors.forest} /><Text numberOfLines={1} style={styles.compactPlaceholder}>{t('shell.compactPlaceholder')}</Text>
      </Tap>
      <Tap testID="compact-voice" accessibilityLabel={t('shell.searchByVoice')} hitSlop={6} style={styles.compactIcon} onPress={() => router.push('/smart-search?mode=voice')}><Icon name="mic-outline" size={19} color={colors.forest} /></Tap>
    </Animated.View>
  </>;
}

// Each screen's own frame, set by its own route, never by the path the app is showing: the screen's path and scroll position
// for everything on it (useScreenPath, useCityScroll), the room it leaves under the status bar and above the dock, the insets
// its content sees, and its top (the utility pages' bar, a scrolling page's header). One frame around the whole stack changed
// with every navigation, so the page being left jumped, re-rendered and lost its top in the middle of the transition.
function ScreenFrame({ children }: { children: React.ReactNode }) {
  const path = useRoutePath(); const insets = useSafeAreaInsets(); const router = useRouter();
  const scrolling = SCROLLING.includes(path);
  // Photo-led pages draw edge to edge under the status bar and place their own buttons below it.
  const immersive = IMMERSIVE.some(p => path.startsWith(p)) || WASHED.includes(path);
  const top = immersive || scrolling ? insets.top : 0;
  const pageInsets = useMemo(() => ({ ...insets, top, bottom: 0 }), [insets, top]);
  // These pages leave room at their own ends, so they run on under the floating dock instead of stopping above it.
  const underDock = scrolling || path.startsWith('/category/') || path === '/reels';
  const back = () => router.canGoBack() ? router.back() : router.replace('/(tabs)');
  // Full-screen takeovers handle their own insets, and so does the product sheet, which floats over the page it came from.
  return <ScreenPathProvider value={path}><CityMotionProvider>{BARE.includes(path) || path.startsWith('/product/') ? children :<View style={[styles.body, !scrolling && !immersive && { paddingTop: insets.top }, !underDock && { paddingBottom: dockSpace(insets.bottom) }, WASHED.includes(path) && styles.grey]}><SafeAreaInsetsContext.Provider value={pageInsets}>{children}</SafeAreaInsetsContext.Provider>
    {scrolling && <ScrollingChrome path={path} back={back} />}
  </View>}</CityMotionProvider></ScreenPathProvider>;
}
// For a navigator's screenLayout. The tabs navigator frames its own screens.
export const screenFrame = ({ route, children }: { route: { name: string }; children: React.ReactElement }) => route.name === '(tabs)' ? children : <ScreenFrame>{children}</ScreenFrame>;
const styles = StyleSheet.create({
  compact: { position: 'absolute', left: 16, right: 16, zIndex: 25, height: 52, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: 26, paddingLeft: 6, paddingRight: 6, boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 28, color: 'rgba(5,6,5,0.16)' }, { offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(5,6,5,0.08)' }] }, scrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 24 }, compactGlyph: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#050605', alignItems: 'center', justifyContent: 'center' }, compactSearch: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8 }, compactPlaceholder: { flex: 1, color: 'rgba(5,6,5,0.55)', fontSize: 15, fontWeight: '500' }, compactIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(179,244,0,0.28)', alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, backgroundColor: colors.surface }, page: { flex: 1 }, body: { flex: 1 }, grey: { backgroundColor: colors.surfaceSecondary },
});
