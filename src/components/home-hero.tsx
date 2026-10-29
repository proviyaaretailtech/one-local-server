// Home's first screen: a full-bleed photo "landing page" with the brand, address, headline and search
// drawn on the photo, then department tiles, two offer tiles and the daily-essentials rail.
// The shell's own header is hidden on home; its compact search bar slides in once the hero has
// scrolled away (HOME_COMPACT_AT, read by app-shell).
// The hero's picture and words are one campaign object so Home Studio can replace them later
// without an app update (specs/home-cms).
import { Tap } from './tap';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { setStatusBarStyle } from 'expo-status-bar';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, ChevronDown, MapPin, Mic, ScanLine, Search, ShoppingBag, User, Wallet, Zap } from 'lucide-react-native';
import { colors } from '../theme';
import { BrandLogo } from './brand-logo';
import { mediaUrl } from '../api';
import type { Catalog } from '../api';
import { useCart } from '../cart';
import { departments, departmentName } from '../departments';
import { useDeliveryLocation } from '../delivery-location';
import { useCityScroll } from '../motion';
import { useFormat, useTranslation } from '../i18n';
import { useIsDesktop } from '../layout';
import { useFeatures } from '../features';
import { SoonBadge } from './soon-badge';

export const HOME_HERO_HEIGHT = 348;
/** Scroll offset (past the hero's search bar) where the compact header appears. */
export const HOME_COMPACT_AT = 244;

const INK = '#0B1F16';
const DEEP = '#0F3D2E';
const campaign = { eyebrow: 'home.hero.eyebrow', title: 'home.hero.title', alt: 'home.hero.photoLabel' } as const;
// Hero backdrop photos, shown one after another (cross-fading) every few seconds.
const campaignImages = ['vegetables', 'fruit', 'milk'] as const;
const CAMPAIGN_INTERVAL_MS = 5000;
// Daily essentials: grocery categories, in this order, when the catalogue has them.
const ESSENTIALS = ['c1', 'c2', 'c3', 'c5', 'c24'];

function HeroIcon({ testID, label, onPress, children, badge, soon }: { testID: string; label: string; onPress: () => void; children: React.ReactNode; badge?: string; soon?: boolean }) {
  return <Tap testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} style={[s.glass]}>
    {children}{!!badge && <View style={s.badge}><Text testID="header-cart-count" style={s.badgeText}>{badge}</Text></View>}{soon && <SoonBadge testID={`${testID}-soon`} />}
  </Tap>;
}

function Hero({ catalog }: { catalog: Catalog }) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { width } = useWindowDimensions();
  const { t } = useTranslation(); const fmt = useFormat(); const { totalItems } = useCart();
  const { location, edit } = useDeliveryLocation(); const features = useFeatures();
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSlide(i => (i + 1) % campaignImages.length), CAMPAIGN_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  const desktop = useIsDesktop();
  // The quickest delivery the catalogue promises today (real data, not a fixed claim); no chip when none is known.
  const fastest = useMemo(() => Math.min(...catalog.products.map(p => p.delivery_min).filter(m => m > 0)), [catalog]);
  const height = HOME_HERO_HEIGHT + insets.top;
  return <View testID="home-hero" style={[s.hero, { height }]}>
    <Image source={mediaUrl(campaignImages[slide])} accessibilityLabel={t(campaign.alt)} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={{ top: '28%', left: '60%' }} transition={900} cachePolicy="memory-disk" />
    {/* Legibility: a soft dark wash from the top-left, then the photo melts into the page. */}
    <LinearGradient pointerEvents="none" colors={['rgba(6,18,11,0.74)', 'rgba(6,18,11,0.42)', 'rgba(6,18,11,0.06)']} locations={[0, 0.5, 0.9]} start={{ x: 0, y: 0.1 }} end={{ x: 1, y: 0.75 }} style={StyleSheet.absoluteFill} />
    <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.75)', colors.surface]} locations={[0, 0.6, 1]} style={[s.fade, { top: height - 150 }]} />
    <View style={[s.heroInner, { paddingTop: insets.top + 6 }]}>
      {!desktop && <View style={s.topRow}>
        <Tap testID="header-brand-home" accessibilityRole="button" accessibilityLabel={t('shell.home')} style={s.brand}>
          <BrandLogo testID="company-logo" tone="dark" height={28} />
        </Tap>
        <View style={s.actions}>
          <HeroIcon testID="header-wallet-button" label={t('shell.wallet')} onPress={() => router.navigate('/wallet' as never)} soon={!features.wallet}><Wallet size={19} color="#FFFFFF" strokeWidth={1.8} /></HeroIcon>
          <HeroIcon testID="header-cart-button" label={t('shell.cart')} onPress={() => router.navigate('/cart' as never)} badge={totalItems > 0 ? fmt.number(totalItems) : undefined}><ShoppingBag size={19} color="#FFFFFF" strokeWidth={1.8} /></HeroIcon>
          <HeroIcon testID="header-profile-btn" label={t('shell.profile')} onPress={() => router.navigate('/account' as never)}><User size={19} color="#FFFFFF" strokeWidth={1.8} /></HeroIcon>
        </View>
      </View>}
      <View style={s.locationRow}>
        <Tap testID="location-button" accessibilityRole="button" accessibilityLabel={t('shell.changeLocation')} onPress={edit} style={s.location}>
          <MapPin size={15} color="#FFFFFF" fill="rgba(255,255,255,0.18)" strokeWidth={2} />
          <Text testID="selected-location" numberOfLines={1} style={s.address}>{location}</Text>
          <ChevronDown size={14} color="#FFFFFF" strokeWidth={2.2} />
        </Tap>
        {Number.isFinite(fastest) && <View testID="home-hero-eta" style={s.etaChip}><Zap size={13} color="#0B1F16" fill="#0B1F16" strokeWidth={2} /><Text style={s.etaText}>{t('home.hero.fastDelivery', { time: fmt.eta(fastest) })}</Text></View>}
      </View>
      <Text testID="home-hero-eyebrow" style={s.eyebrow}>{t(campaign.eyebrow)}</Text>
      <Text testID="home-hero-title" accessibilityRole="header" style={[s.title, { maxWidth: Math.min(300, width * 0.78) }]}>{t(campaign.title)}</Text>
      <View style={s.search}>
        <Tap testID="header-search-button" accessibilityRole="search" accessibilityLabel={t('shell.searchProducts')} onPress={() => router.navigate('/search' as never)} style={s.searchText}>
          <Search size={20} color={INK} strokeWidth={2} /><Text numberOfLines={1} style={s.placeholder}>{t('home.hero.searchPlaceholder')}</Text>
        </Tap>
        <Tap testID="header-voice-search" accessibilityLabel={t('shell.searchVoice')} onPress={() => router.push('/smart-search?mode=voice' as never)} style={s.searchIcon}><Mic size={19} color={INK} strokeWidth={1.9} />{!features.ai_search && <SoonBadge testID="header-voice-search-soon" />}</Tap>
        <View style={s.divider} />
        <Tap testID="header-camera-search" accessibilityLabel={t('shell.searchPhoto')} onPress={() => router.push('/smart-search?mode=image' as never)} style={s.searchIcon}><ScanLine size={19} color={INK} strokeWidth={1.9} />{!features.ai_search && <SoonBadge testID="header-camera-search-soon" />}</Tap>
      </View>
    </View>
  </View>;
}

function DepartmentTiles() {
  const router = useRouter(); const { t } = useTranslation();
  return <View testID="department-strip" style={s.tiles}>{departments.map(d => {
    const name = departmentName(t, d.id);
    // Each tile wears its department's own gradient; the cut-out icon sits straight on it.
    return <Tap key={d.id} testID={`department-${d.id}`} accessibilityRole="button" accessibilityLabel={name.replace('\n', ' ')} onPress={() => router.navigate(d.route as never)} style={[s.tile]}>
      <LinearGradient colors={[d.top, d.fade]} locations={[0, 0.85]} style={StyleSheet.absoluteFill} />
      <Image testID={`department-icon-${d.id}`} source={mediaUrl(`icon-${d.id}-v4`)} style={s.tileIcon} contentFit="contain" cachePolicy="memory-disk" />
      <Text testID={`department-label-${d.id}`} numberOfLines={2} style={s.tileLabel}>{name}</Text>
    </Tap>;
  })}</View>;
}

function OfferTiles({ catalog }: { catalog: Catalog }) {
  const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat();
  // Real numbers only: the best discount the catalogue has in that department today.
  const best = (deps: string[]) => Math.max(0, ...catalog.products.filter(p => deps.includes(p.department ?? '')).map(p => p.discount_pct ?? 0));
  const grocery = best(['grocery']); const care = best(['pharmacy', 'beauty']);
  return <View style={s.offers}>
    {grocery > 0 && <Tap testID="home-offer-grocery" accessibilityRole="button" onPress={() => router.navigate('/grocery' as never)} style={[s.offer, s.offerWide]}>
      <LinearGradient colors={['#FFF7E1', '#FCEBC4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={s.offerCopy}><Text style={s.offerTitle}>{t('home.offers.groceryTitle', { pct: fmt.percent(grocery) })}</Text><Text style={[s.offerSub, { color: '#9A6A00' }]}>{t('home.offers.grocerySub')}</Text></View>
      <Image source={mediaUrl('item-cereal')} style={s.offerImage} contentFit="cover" cachePolicy="memory-disk" /><View style={s.offerArrow}><ArrowRight size={13} color={INK} strokeWidth={2.2} /></View>
    </Tap>}
    {care > 0 && <Tap testID="home-offer-care" accessibilityRole="button" onPress={() => router.navigate('/care' as never)} style={[s.offer]}>
      <LinearGradient colors={['#ECF8F2', '#DCF1E7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={s.offerCopy}><Text style={s.offerTitle}>{t('home.offers.careTitle')}</Text><Text style={[s.offerSub, { color: '#1F7A55' }]}>{t('home.offers.careSub', { pct: fmt.percent(care) })}</Text></View>
      <Image source={mediaUrl('skincare')} style={[s.offerImage, s.offerImageSmall]} contentFit="cover" cachePolicy="memory-disk" /><View style={s.offerArrow}><ArrowRight size={13} color={INK} strokeWidth={2.2} /></View>
    </Tap>}
  </View>;
}

function Essentials({ catalog }: { catalog: Catalog }) {
  const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat();
  const items = useMemo(() => ESSENTIALS.flatMap(id => {
    const c = catalog.categories.find(x => x.id === id); if (!c) return [];
    const prices = catalog.products.filter(p => p.category_id === id).map(p => p.price);
    return prices.length ? [{ ...c, from: Math.min(...prices) }] : [];
  }), [catalog]);
  if (!items.length) return null;
  return <View style={s.essentials}>
    <View style={s.sectionHead}>
      <Text accessibilityRole="header" style={s.sectionTitle}>{t('home.essentialsTitle')}</Text>
      <Tap testID="home-essentials-see-all" accessibilityRole="button" accessibilityLabel={t('home.seeAllLabel', { title: t('home.essentialsTitle') })} onPress={() => router.navigate('/grocery' as never)} hitSlop={8} style={s.seeAll}><Text style={s.seeAllText}>{t('common.seeAll')}</Text><ArrowRight size={16} color={DEEP} strokeWidth={2.2} /></Tap>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
      {items.map(c => <Tap key={c.id} testID={`home-essential-${c.id}`} accessibilityRole="button" accessibilityLabel={c.name} onPress={() => router.push(`/category/${c.id}` as never)} style={[s.essential]}>
        <Image source={c.image} style={s.essentialImage} contentFit="cover" cachePolicy="memory-disk" transition={150} />
        <View style={s.essentialCopy}><Text numberOfLines={1} style={s.essentialName}>{c.name}</Text><Text style={s.essentialFrom}>{t('home.fromPrice', { price: fmt.money(c.from) })}</Text></View>
      </Tap>)}
    </ScrollView>
  </View>;
}

// Light status bar over the photo; dark once the white compact header has taken over.
function useHeroStatusBar() {
  const { y } = useCityScroll();
  useFocusEffect(useCallback(() => {
    let dark = false; setStatusBarStyle('light');
    const id = y.addListener(({ value }) => { const next = value > HOME_COMPACT_AT - 40; if (next !== dark) { dark = next; setStatusBarStyle(next ? 'dark' : 'light'); } });
    return () => { y.removeListener(id); setStatusBarStyle('dark'); };
  }, [y]));
  useEffect(() => () => setStatusBarStyle('dark'), []);
}

export const HomeHero = memo(function HomeHero({ catalog }: { catalog: Catalog }) {
  useHeroStatusBar();
  return <View style={s.wrap}>
    <Hero catalog={catalog} />
    <View style={s.below}>
      <DepartmentTiles />
      <OfferTiles catalog={catalog} />
      <Essentials catalog={catalog} />
    </View>
  </View>;
});

const shadow = [{ offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(11,31,22,0.08)' }, { offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(11,31,22,0.05)' }];
const s = StyleSheet.create({
  wrap: { backgroundColor: colors.surface },
  hero: { width: '100%', overflow: 'hidden', backgroundColor: colors.surface },
  fade: { position: 'absolute', left: 0, right: 0, bottom: -2 },
  heroInner: { flex: 1, paddingHorizontal: 18 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  brand: { minHeight: 44, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 8 },
  glass: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0397A', borderWidth: 1.5, borderColor: '#FFFFFF' },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  location: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%', flexShrink: 1, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  etaChip: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: colors.electricLime },
  etaText: { fontSize: 12.5, fontWeight: '800', color: '#0B1F16' },
  address: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  eyebrow: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700', letterSpacing: 2.2, marginTop: 16 },
  title: { color: '#FFFFFF', fontSize: 28, lineHeight: 38, fontWeight: '800', letterSpacing: -0.9, marginTop: 8, textShadowColor: 'rgba(0,0,0,0.18)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 12 },
  search: { position: 'absolute', left: 16, right: 16, bottom: 56, height: 54, borderRadius: 27, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 6, boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 28, color: 'rgba(6,18,11,0.22)' }] },
  searchText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  placeholder: { flex: 1, color: '#6B7A72', fontSize: 14, fontWeight: '500' },
  searchIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  divider: { width: 1, height: 20, backgroundColor: '#E3E8E5' },
  below: { marginTop: -44, paddingHorizontal: 16, gap: 18 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, minHeight: 92, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', paddingTop: 7, paddingHorizontal: 2, paddingBottom: 6, gap: 5, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', boxShadow: shadow },
  tileIcon: { width: 54, height: 54 },
  tileLabel: { color: INK, fontSize: 11, lineHeight: 13, minHeight: 26, fontWeight: '700', letterSpacing: -0.1, textAlign: 'center' },
  offers: { flexDirection: 'row', gap: 10 },
  offer: { flex: 1, height: 100, borderRadius: 18, overflow: 'hidden', flexDirection: 'row' },
  offerWide: { flex: 1.35 },
  offerCopy: { flex: 1, paddingLeft: 14, paddingTop: 13, paddingRight: 2, zIndex: 1 },
  offerTitle: { color: INK, fontSize: 13.5, lineHeight: 16, fontWeight: '800', letterSpacing: -0.2 },
  offerSub: { fontSize: 11, lineHeight: 13, fontWeight: '600', marginTop: 3 },
  offerArrow: { position: 'absolute', right: 8, bottom: 8, zIndex: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  offerImage: { width: 80, height: '100%', borderTopLeftRadius: 40, borderBottomLeftRadius: 40 },
  offerImageSmall: { width: 46, borderTopLeftRadius: 23, borderBottomLeftRadius: 23 },
  essentials: { marginTop: 4, marginHorizontal: -16 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { color: INK, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  seeAllText: { color: DEEP, fontSize: 14, fontWeight: '700' },
  rail: { paddingHorizontal: 16, gap: 10 },
  essential: { width: 128, borderRadius: 18, backgroundColor: '#F4F7F5', overflow: 'hidden' },
  essentialImage: { width: '100%', height: 92 },
  essentialCopy: { paddingHorizontal: 11, paddingTop: 9, paddingBottom: 11 },
  essentialName: { color: INK, fontSize: 12.5, fontWeight: '700' },
  essentialFrom: { color: '#6B7A72', fontSize: 11, fontWeight: '500', marginTop: 2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
});
