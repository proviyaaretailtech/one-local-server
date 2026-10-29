// Coming-soon gate for the whole app. Any route outside OPEN_SEGMENTS (a store, brand, product, checkout…) is
// covered by a frosted-glass "we're getting ready" card over the screen behind it, and a blocked write (see
// apiPost) shows a short, friendly toast. Copy is English only for this launch build (i18n-ignore below).
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { useTranslation } from '../i18n';
import { nativeDriver, useMotionAllowed } from '../motion';
import { COMING_SOON_ALL, isComingSoonRoute, onComingSoon } from '../coming-soon-mode';
import { BrandLogo } from './brand-logo';

const INK = '#0B1F16';
const MUTED = '#4B5B53';

// Three dots that breathe one after another: "we're working on it", without a spinner's urgency.
function WorkingDots() {
  const motion = useMotionAllowed();
  const [dots] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.35)));
  useEffect(() => {
    if (!motion) { dots.forEach(d => d.setValue(1)); return; }
    const loop = Animated.loop(Animated.stagger(180, dots.map(d => Animated.sequence([
      Animated.timing(d, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver }),
      Animated.timing(d, { toValue: 0.35, duration: 420, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver }),
    ]))));
    loop.start();
    return () => loop.stop();
  }, [motion, dots]);
  return <View style={s.dots}>{dots.map((d, i) => <Animated.View key={i} style={[s.dot, { opacity: d, transform: [{ scale: d }] }]} />)}</View>;
}

function ComingSoonCard({ onBack }: { onBack: () => void }) {
  const motion = useMotionAllowed();
  const [enter] = useState(() => new Animated.Value(motion ? 0 : 1));
  useEffect(() => {
    if (!motion) return;
    Animated.timing(enter, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }).start();
  }, [motion, enter]);
  return <Animated.View testID="coming-soon-card" style={[s.card, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] }]}>
    <BrandLogo tone="light" height={24} />
    <View style={s.pill}><Icon name="sparkles" size={12} color={colors.forest} /><Text style={s.pillText}>ALMOST THERE</Text></View>
    <Text style={s.title}>Something wonderful is on its way</Text>
    <Text style={s.body}>{"We're working tirelessly to give you a wonderful experience. We'll be ready very soon."}</Text>
    <View style={s.working}><WorkingDots /><Text style={s.workingText}>Getting things ready for you</Text></View>
    <View style={s.notify}>
      <View style={s.notifyIcon}><Icon name="notifications-outline" size={16} color={INK} /></View>
      <Text style={s.notifyText}>{"We'll notify you the moment everything is up and running. Stay tuned!"}</Text>
    </View>
    <Pressable testID="coming-soon-home" accessibilityRole="button" onPress={onBack} style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}>
      <Text style={s.ctaText}>Keep exploring</Text>
      <Icon name="arrow-forward" size={16} color={INK} />
    </Pressable>
  </Animated.View>;
}

export function ComingSoonGate() {
  const segments = useSegments(); const router = useRouter(); const insets = useSafeAreaInsets(); const { t } = useTranslation();
  const [toast, setToast] = useState(false);

  useEffect(() => onComingSoon(() => setToast(true)), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(false), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  if (!COMING_SOON_ALL) return null;
  const blocked = isComingSoonRoute(segments);
  const back = () => router.canGoBack() ? router.back() : router.replace('/(tabs)');

  // i18n-ignore: launch-build copy, English only
  return <>
    {blocked && <View testID="coming-soon-page" style={s.page}>
      <BlurView intensity={45} tint="light" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, s.wash]} />
      <Pressable testID="coming-soon-back" accessibilityLabel={t('common.goBack')} onPress={back} style={[s.back, { top: insets.top + 12 }]}>
        <Icon name="chevron-back" size={22} color={INK} />
      </Pressable>
      <View style={[s.center, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 24 }]}>
        <ComingSoonCard onBack={back} />
      </View>
    </View>}
    {toast && <View testID="coming-soon-banner" accessibilityLiveRegion="polite" style={[s.toast, { top: insets.top + 10 }]}>
      <BlurView intensity={40} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
      <Icon name="sparkles" size={15} color={colors.electricLime} />
      <Text style={s.toastText}>{"Coming soon! We'll let you know when it's live."}</Text>
    </View>}
  </>;
}

const shadow = { shadowColor: '#0B1F16', shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 10 };

const s = StyleSheet.create({
  page: { ...StyleSheet.absoluteFill, zIndex: 50 },
  wash: { backgroundColor: 'rgba(244,248,245,0.86)' },
  back: { position: 'absolute', left: 18, zIndex: 2, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center', ...shadow, shadowOpacity: 0.08 },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  card: { alignSelf: 'center', width: '100%', maxWidth: 420, alignItems: 'center', paddingHorizontal: 24, paddingTop: 28, paddingBottom: 22, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.97)', borderWidth: 1, borderColor: '#FFFFFF', ...shadow },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(179,244,0,0.22)' },
  pillText: { color: colors.forest, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: INK, fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center', marginTop: 14 },
  body: { color: MUTED, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.forest },
  workingText: { color: MUTED, fontSize: 13, fontWeight: '600' },
  notify: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', marginTop: 20, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 1, borderColor: '#E6EEE9' },
  notifyIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(179,244,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  notifyText: { flex: 1, color: INK, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  cta: { alignSelf: 'stretch', flexDirection: 'row', gap: 8, marginTop: 18, minHeight: 52, borderRadius: 18, backgroundColor: colors.electricLime, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: INK, fontSize: 15, fontWeight: '800' },
  toast: { position: 'absolute', alignSelf: 'center', zIndex: 60, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 18, paddingVertical: 11, paddingHorizontal: 16, backgroundColor: 'rgba(11,31,22,0.72)', ...shadow },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
