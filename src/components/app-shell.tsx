import { useEffect, useState } from 'react';
import { Tap } from './tap';
import { View, StyleSheet, Animated } from 'react-native';
import { Text } from '@/src/ui/text';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { paletteFor } from '../departments';
import { useCart } from '../cart';
import { DepartmentStrip } from './department-strip';
import { useCityScroll } from '../motion';
import { FloatingCart } from './floating-cart';
import { BottomNavigation, dockSpace } from './bottom-navigation';
import { CartCelebration } from './cart-celebration';
import { DeliveryLocationContext, Point } from '../delivery-location';
import { useQuery } from '@tanstack/react-query';
import { CITY_CENTER, coverageAt } from '../places';
import { OneGlyph } from './one-button';
import { BrandLogo } from './brand-logo';
import { SoonBadge } from './soon-badge';
import { useFeatures } from '../features';
import { useFormat, useShowFirstRun, useTranslation } from '../i18n';
import { HOME_COMPACT_AT } from './home-hero';
import { DesktopNav } from './desktop-nav';
import { useIsDesktop } from '../layout';
import { useFastestEta } from '../use-fastest-eta';

const BARE = ['/sign-in', '/welcome'];
const FULL_SCREEN = ['/location', '/address-map', '/address-form'];
const IMMERSIVE = ['/product/', '/brand/'];
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
      router.push('/location?first=1' as never);
    }).catch(() => {});
  }, [hasSavedLocation, waitForLanguage, router]);
}

export function BrandMark({ large = false }: { large?: boolean }) { return <View style={[styles.mark, large && styles.largeMark]}><Text style={[styles.one, large && styles.largeOne]}>1</Text></View>; }
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname(); const desktop = useIsDesktop(); const router = useRouter(); const insets = useSafeAreaInsets(); const { totalItems } = useCart(); const features = useFeatures(); const fastest = useFastestEta();
  const { t } = useTranslation(); const fmt = useFormat(); const waitForLanguage = useShowFirstRun();
  const scrolling = ['/', '/food', '/grocery', '/shops', '/care', '/pharmacy', '/beauty', '/book-it', '/categories'].includes(path);
  const reels = !scrolling; const palette = paletteFor(path);
  const utility = ['/discover', '/reels', '/account', '/enquiries'].includes(path);
  const back = () => router.canGoBack() ? router.back() : router.replace('/(tabs)');
  const isHome = path === '/';
  // Photo-led pages draw edge to edge under the status bar and place their own buttons below it.
  const immersive = IMMERSIVE.some(p => path.startsWith(p));
  const { y, headerHeight, setHeaderHeight, scrollRef, scrollUnderDock } = useCityScroll();
  const [compact, setCompact] = useState(false);
  // Only once the real header is measured and its search bar has scrolled away; before layout the
  // height is 0, which used to show both search bars at the top of the page.
  // Home draws its own photo hero instead of this header; the compact bar arrives once the hero has gone.
  const compactFrom = isHome ? HOME_COMPACT_AT : headerHeight - 70;
  useEffect(() => { const id = y.addListener(({ value }) => setCompact((isHome || headerHeight > 0) && value > compactFrom)); return () => y.removeListener(id); }, [y, headerHeight, compactFrom, isHome]);
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
  const setLocation = (value: string, next: Point | null = null) => {
    setLocationText(value); setPoint(next);
    AsyncStorage.multiSet([['one-latur-location', value], ['one-latur-location-point', next ? JSON.stringify(next) : '']]).catch(() => {});
  };
  const openLocation = () => router.push('/location' as never);
  useLocationFirst(hasSaved, waitForLanguage);
  // Full-screen takeovers (sign-in) get no header, tab bar or floating cart, and handle their own insets.
  if (BARE.includes(path)) return <DeliveryLocationContext.Provider value={{ location, point, coverage, setLocation, edit: openLocation }}><View style={styles.container}>{children}</View></DeliveryLocationContext.Provider>;
  return <DeliveryLocationContext.Provider value={{ location, point, coverage, setLocation, edit: openLocation }}><View style={styles.container}>
    {desktop && !FULL_SCREEN.some(p => path.startsWith(p)) && <DesktopNav />}
    <View style={styles.page}>
    {!reels && !isHome && <Animated.View testID="city-header" onLayout={e => { if (scrolling) setHeaderHeight(e.nativeEvent.layout.height); }} style={scrolling ? [styles.scrollingHeader, { transform: [{ translateY: y.interpolate({ inputRange: [0, headerHeight], outputRange: [0, -headerHeight], extrapolate: 'clamp' }) }] }] : undefined}><View>{/* transparent: the page's own gradient (CityScroll) shows through */}
      <View style={{ paddingTop: insets.top }}><View style={styles.header}>
        <View style={styles.topRow}><View style={styles.topLead}>{!isHome && <Tap testID="global-back-button" accessibilityLabel={t('shell.goPrevious')} onPress={back} style={styles.backButton}><Icon name="arrow-back" size={20} color={colors.onSurface} /></Tap>}<Tap testID="header-brand-home" accessibilityLabel={t('shell.home')} onPress={() => router.navigate('/(tabs)' as any)} style={styles.brand}><BrandLogo testID="company-logo" tone="light" height={22} /></Tap></View>
          <View style={styles.topActions}>{[{ id: 'wallet', label: t('shell.wallet'), icon: 'wallet-outline', route: '/wallet' }, { id: 'cart', label: t('shell.cart'), icon: 'bag-handle-outline', route: '/cart' }, { id: 'profile', label: t('shell.profile'), icon: 'person-outline', route: '/account' }].map(b => <Tap testID={b.id === 'profile' ? 'header-profile-btn' : `header-${b.id}-button`} accessibilityLabel={b.label} key={b.id} onPress={() => router.navigate(b.route as any)} style={styles.iconButton}><Icon name={b.icon as any} size={18} color={colors.onSurface} />{b.id === 'wallet' && !features.wallet && <SoonBadge testID="header-wallet-button-soon" />}{b.id === 'cart' && totalItems > 0 && <View style={styles.badge}><Text testID="header-cart-count" style={styles.badgeText}>{fmt.number(totalItems)}</Text></View>}</Tap>)}</View>
        </View>
        <View style={styles.locationRow}><Tap testID="location-button" accessibilityRole="button" accessibilityLabel={t('shell.changeLocation')} onPress={openLocation} style={styles.location}><Icon name="location-outline" size={13} color={colors.onSurface} /><Text testID="selected-location" style={styles.address} numberOfLines={1}>{location}</Text><Icon name="chevron-down" size={10} color={colors.onSurface} /></Tap>{fastest !== null && <View testID="shell-eta" style={styles.etaChip}><Icon name="flash" size={12} color={colors.forestDeep} /><Text style={styles.etaChipText}>{t('home.hero.fastDelivery', { time: fmt.eta(fastest) })}</Text></View>}</View>
        <View style={styles.searchRow}><Tap testID="header-search-button" accessibilityLabel={t('shell.searchProducts')} onPress={() => router.navigate('/search' as any)} style={styles.searchText}><Icon name="search-outline" size={18} color={colors.onSurface} /><Text style={styles.placeholder}>{t('shell.searchPlaceholder')}</Text></Tap><Tap testID="header-voice-search" accessibilityLabel={t('shell.searchVoice')} onPress={() => router.push('/smart-search?mode=voice' as any)} style={styles.searchIcon}><Icon name="mic-outline" size={18} color={colors.onSurface} />{!features.ai_search && <SoonBadge testID="header-voice-search-soon" />}</Tap><View style={styles.searchDivider} /><Tap testID="header-camera-search" accessibilityLabel={t('shell.searchPhoto')} onPress={() => router.push('/smart-search?mode=image' as any)} style={styles.searchIcon}><Icon name="camera-outline" size={19} color={colors.onSurface} />{!features.ai_search && <SoonBadge testID="header-camera-search-soon" />}</Tap></View>
      </View><DepartmentStrip /></View>
    </View></Animated.View>}
    {scrolling && (isHome || headerHeight > 0) && <Animated.View pointerEvents="none" style={[styles.scrim, { height: insets.top + 40, opacity: y.interpolate({ inputRange: [compactFrom - 30, compactFrom + 10], outputRange: [0, 1], extrapolate: 'clamp' }) }]}><LinearGradient colors={[colors.surface, colors.surface, 'rgba(255,255,255,0)']} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} /></Animated.View>}
    {scrolling && (isHome || headerHeight > 0) && <Animated.View testID="compact-header" pointerEvents={compact ? 'auto' : 'none'} style={[styles.compact, { top: insets.top + 6,
      opacity: y.interpolate({ inputRange: [compactFrom - 30, compactFrom + 10], outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [{ translateY: y.interpolate({ inputRange: [compactFrom - 30, compactFrom + 10], outputRange: [-14, 0], extrapolate: 'clamp' }) }, { scale: y.interpolate({ inputRange: [compactFrom - 30, compactFrom + 10], outputRange: [0.96, 1], extrapolate: 'clamp' }) }] }]}>
      {isHome
        ? <Tap testID="compact-expand-header" accessibilityLabel={t('shell.backToTop')} hitSlop={6} style={styles.compactGlyph} onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}><OneGlyph size={22} /></Tap>
        : <Tap testID="compact-back" accessibilityLabel={t('common.goBack')} hitSlop={6} style={styles.compactGlyph} onPress={back}><Icon name="arrow-back" size={19} color="#FFFFFF" /></Tap>}
      <Tap testID="compact-search" accessibilityRole="search" accessibilityLabel={t('shell.searchProducts')} style={styles.compactSearch} onPress={() => router.push('/search' as any)}>
        <Icon name="search-outline" size={18} color={colors.forest} /><Text numberOfLines={1} style={styles.compactPlaceholder}>{t('shell.compactPlaceholder')}</Text>
      </Tap>
      <Tap testID="compact-voice" accessibilityLabel={t('shell.searchByVoice')} hitSlop={6} style={styles.compactIcon} onPress={() => router.push('/smart-search?mode=voice' as any)}><Icon name="mic-outline" size={19} color={colors.forest} /></Tap>
    </Animated.View>}
    <SafeAreaInsetsContext.Provider value={{ ...insets, top: immersive || isHome ? insets.top : 0, bottom: 0 }}><View style={[styles.body, reels && !immersive && { paddingTop: insets.top }, !scrollUnderDock && { paddingBottom: dockSpace(insets.bottom) }]}>{utility && <View style={styles.utility}><Tap testID="page-back-button" accessibilityLabel={t('common.goBack')} onPress={back} style={styles.iconButton}><Icon name="arrow-back" size={20} color={colors.forest} /></Tap><Text testID="page-navigation-label" style={styles.compactText}>OneLocal</Text><Tap testID="page-search-button" accessibilityLabel={t('common.search')} onPress={() => router.push('/search')} style={styles.iconButton}><Icon name="search-outline" size={20} color={colors.forest} /></Tap></View>}{children}</View></SafeAreaInsetsContext.Provider>
    {(scrolling || path === '/discover' || path.startsWith('/category/') || path.startsWith('/collection/') || path.startsWith('/brand/') || path === '/search') && <FloatingCart compact={path.startsWith('/category/')} bottom={Math.max(insets.bottom, 9) + 84} />}
    <BottomNavigation />
    <CartCelebration top={insets.top + 8} />
    </View>
  </View></DeliveryLocationContext.Provider>;
}
const styles = StyleSheet.create({
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  etaChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.electricLime },
  etaChipText: { fontSize: 11.5, fontWeight: '800', color: colors.forestDeep },
  utility: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, paddingHorizontal: 14, height: 44 },
  scrollingHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }, compact: { position: 'absolute', left: 16, right: 16, zIndex: 25, height: 52, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: 26, paddingLeft: 6, paddingRight: 6, boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 28, color: 'rgba(5,6,5,0.16)' }, { offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(5,6,5,0.08)' }] }, scrim: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 24 }, compactGlyph: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#050605', alignItems: 'center', justifyContent: 'center' }, compactSearch: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8 }, compactPlaceholder: { flex: 1, color: 'rgba(5,6,5,0.55)', fontSize: 15, fontWeight: '500' }, compactIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(179,244,0,0.28)', alignItems: 'center', justifyContent: 'center' }, compactButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }, compactText: { color: colors.forest, fontSize: 11, fontWeight: '600' },
  container: { flex: 1, backgroundColor: colors.surface }, page: { flex: 1 }, body: { flex: 1 }, background: { position: 'absolute', top: 0, left: 0, right: 0, height: 525 }, header: { paddingHorizontal: 20, paddingTop: 9 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, topLead: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -10 }, backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, topActions: { flexDirection: 'row', gap: 4 },
  brand: { minHeight: 44, justifyContent: 'center' }, logo: { width: 76, height: 22 }, location: { minHeight: 28, alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -5 }, address: { color: colors.onSurface, fontSize: 10, fontWeight: '500', flexShrink: 1 },
  iconButton: { width: 44, height: 44, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.whiteGlass },
  searchRow: { marginTop: 5, minHeight: 47, borderRadius: 25, paddingLeft: 15, paddingRight: 5, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.glassBright, borderWidth: 1, borderColor: colors.glassLine, boxShadow: [{ offsetX: 0, offsetY: 5, blurRadius: 15, color: colors.shadow }] }, searchText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }, placeholder: { color: colors.muted, fontSize: 10, flexShrink: 1 }, searchIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, searchDivider: { width: 1, height: 17, backgroundColor: colors.border },
  // i18n-ignore: the brand digit "1", not text
  badge: { position: 'absolute', right: 1, top: 0, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest, paddingHorizontal: 3 }, badgeText: { color: colors.surface, fontSize: 8, fontWeight: '700' }, mark: { width: 27, height: 27, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' }, one: { fontSize: 24, lineHeight: 28, fontWeight: '900', color: colors.lime }, largeMark: { width: 54, height: 54, borderRadius: 27 }, largeOne: { fontSize: 48, lineHeight: 54 },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }, sheet: { backgroundColor: colors.glassBright, padding: 24, paddingBottom: 40, borderTopLeftRadius: 35, borderTopRightRadius: 35 }, modalTitle: { fontSize: 18, fontWeight: '600', color: colors.onSurface, flex: 1 }, help: { fontSize: 12, color: colors.muted, marginVertical: 14, lineHeight: 19 }, input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 20, padding: 14, color: colors.onSurface }, save: { backgroundColor: colors.lime, minHeight: 48, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 16 }, saveText: { color: colors.onSurface, fontWeight: '600', fontSize: 12 }, disabled: { opacity: 0.4 },
});