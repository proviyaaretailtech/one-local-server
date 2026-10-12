// A brand or store that is on OneLocal but has no menu yet (founder, 10 Oct 2026: "the menu doesn't exist yet, it should be
// masked with coming soon"). Its page shows the coming-soon receipt instead of an empty list, and rails mark it "Soon".
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useCatalog } from '../use-catalog';
import { useDeliveryLocation } from '../delivery-location';
import { useMotionAllowed } from '../motion';
import { useTranslation } from '../i18n';
import { Receipt } from '../popups/coming-soon-receipt';
import { Tap } from './tap';

// true = nothing to order yet, false = has items, undefined = still loading (show nothing special).
export function useComingSoon(id: string | undefined): boolean | undefined {
  const { data } = useCatalog();
  if (!data || !id) return undefined;
  return !data.products.some(p => p.brand_id === id || p.store_id === id);
}

// '/api/media/brand-x' or an absolute address -> what the receipt's image helper expects.
const logoKey = (logo: string) => logo.split('/api/media/')[1] ?? logo;

export function ComingSoonBrand({ name, logo, line }: { name: string; logo: string; line?: string }) {
  const city = useDeliveryLocation().location.split(',')[0];
  const router = useRouter(); const insets = useSafeAreaInsets(); const { t } = useTranslation(); const motion = useMotionAllowed();
  const feed = useSharedValue(motion ? 0 : 1);
  useEffect(() => { if (motion) feed.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }); }, [motion, feed]);
  const paper = useAnimatedStyle(() => ({ opacity: Math.min(1, feed.value * 2), transform: [{ perspective: 900 }, { translateY: (feed.value - 1) * 60 }, { rotateX: `${(1 - feed.value) * 9}deg` }] }));
  return <ScrollView testID="brand-coming-soon" style={s.screen} contentContainerStyle={[s.content, { paddingTop: insets.top + 12 }]}>
    <Tap testID="brand-coming-soon-back" accessibilityRole="button" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} radius={22} style={s.back}>
      <ArrowLeft size={20} color="#FFFFFF" strokeWidth={2.2} />
    </Tap>
    <View style={s.printer}><View style={s.slot}><View style={s.lip} /></View></View>
    <View style={s.clip}><Animated.View style={paper}><Receipt item={{ name, logo: logoKey(logo), line }} width={276} city={city} /></Animated.View></View>
    <Text style={s.note}>{t('popups.comingSoon.menuSoon', { name })}</Text>
    <Tap testID="brand-coming-soon-explore" accessibilityRole="button" onPress={() => router.navigate('/food' as never)} radius={24} style={s.cta}>
      <Text style={s.ctaText}>{t('popups.comingSoon.explore')}</Text>
    </Tap>
  </ScrollView>;
}

const NEON = '#9DFF00';
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0F0C' },
  content: { alignItems: 'center', paddingBottom: 140, paddingHorizontal: 20 },
  back: { alignSelf: 'flex-start', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', marginBottom: 18 },
  printer: { width: 330, height: 36, borderRadius: 18, backgroundColor: '#1C1F1C', borderWidth: 1, borderColor: '#2D322D', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 9, zIndex: 2 },
  slot: { width: '86%', height: 7, borderRadius: 4, backgroundColor: '#050605', overflow: 'hidden' },
  lip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: NEON },
  clip: { overflow: 'hidden', marginTop: -6, paddingBottom: 30, paddingHorizontal: 20 },
  note: { color: 'rgba(255,255,255,0.78)', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 4, maxWidth: 300 },
  cta: { marginTop: 18, minHeight: 48, paddingHorizontal: 24, borderRadius: 24, backgroundColor: NEON, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#0B1F16', fontSize: 15, fontWeight: '800' },
});
