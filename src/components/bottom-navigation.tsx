// The floating dock (after lab.xevrion.dev/lab/dock, rebuilt for touch). A pill that hovers above the
// page — content scrolls underneath it — with:
//   - scrub to magnify: slide a finger along the dock and the icon under it swells while its
//     neighbours lean in, a detent tick plays as the finger crosses each icon, and letting go opens
//     the one under the finger (phones have no hover, so the finger is the cursor);
//   - a launch hop: the tab you land on jumps twice, squashing on each landing, and its dot lights
//     as it first touches down;
//   - plain taps still work exactly as before.
// Reduce Motion: no magnify or hop; scrub-to-open and the ticks remain.
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, type SharedValue, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { BlurView } from 'expo-blur';
import { House, LayoutGrid, Play, Ticket, UtensilsCrossed, type LucideIcon } from 'lucide-react-native';
import { Tap } from './tap';
import { colors } from '../theme';
import { OneButton } from './one-button';
import { usePageColors } from '../use-page-colors';
import { useTranslation } from '../i18n';
import { departmentName } from '../departments';
import { haptic } from '../haptics';
import { useMotionAllowed } from '../motion';

const tabs = [
  { id: 'home', path: '/', icon: House },
  { id: 'categories', path: '/categories', icon: LayoutGrid },
  { id: 'discover', path: '/discover', icon: Play },
  { id: 'food', path: '/food', icon: UtensilsCrossed },
  { id: 'book-it', path: '/book-it', icon: Ticket },
] satisfies { id: string; path: string; icon: LucideIcon }[];

const PEAK = 1.38;   // icon scale right under the finger
const REACH = 1.6;   // how many slots away an icon still feels the pull
// Light and slightly underdamped: keeps up with a fast finger and settles with a small wobble.
const SIZE_SPRING = { mass: 0.25, stiffness: 320, damping: 16 };
export const DOCK_HEIGHT = 66;
export const dockBottom = (insetBottom: number) => Math.max(insetBottom, 10) + 6;
/** Room a screen must leave at its bottom so nothing hides under the floating dock. */
export const dockSpace = (insetBottom: number) => dockBottom(insetBottom) + DOCK_HEIGHT + 8;

export function BottomNavigation() {
  const insets = useSafeAreaInsets(); const path = usePathname(); const router = useRouter(); const { t } = useTranslation();
  const motion = useMotionAllowed();
  const labels: Record<string, string> = { home: t('nav.home'), categories: t('nav.categories'), discover: t('nav.discover'), food: departmentName(t, 'food'), 'book-it': departmentName(t, 'book-it') };
  const palette = usePageColors();
  const dark = path === '/reels';
  const selected = (id: string, route: string) => path === route || (id === 'categories' && (path.startsWith('/collection/') || path.startsWith('/category/')));

  const finger = useSharedValue(-1);   // finger x inside the dock, -1 when not scrubbing
  const slot = useSharedValue(0);      // width of one slot
  const hovered = useSharedValue(-1);  // slot under the finger
  const scrubbed = useSharedValue(0);  // 1 once a scrub opened a tab, until the next touch: swallows the tap its release may also fire
  const open = (i: number) => {
    const tab = tabs[i]; if (!tab) return;
    if (tab.id === 'discover') router.navigate('/(tabs)/discover');
    else router.navigate((tab.id === 'home' ? '/(tabs)' : `/(tabs)/${tab.id}`) as never);
  };
  const scrubOpen = (i: number) => { haptic.select(); open(i); };
  const pan = Gesture.Pan().activeOffsetX([-8, 8]).failOffsetY([-14, 14])
    .onBegin(() => { scrubbed.value = 0; })
    .onStart(e => { finger.value = e.x; })
    .onUpdate(e => {
      finger.value = e.x;
      const i = slot.value > 0 ? Math.min(tabs.length - 1, Math.max(0, Math.floor(e.x / slot.value))) : -1;
      if (i !== hovered.value) { hovered.value = i; scheduleOnRN(haptic.tick); }
    })
    .onFinalize((_e, success) => {
      const i = hovered.value; hovered.value = -1; finger.value = -1;
      if (success && i >= 0) { scrubbed.value = 1; scheduleOnRN(scrubOpen, i); }
    });
  const onLayout = (e: LayoutChangeEvent) => { slot.value = e.nativeEvent.layout.width / tabs.length; };

  // Full-screen flows, and product pages (they carry their own sticky add-to-bag bar).
  if (['/location', '/address-map', '/address-form', '/sign-in'].includes(path) || path.startsWith('/product/')) return null;
  return <View pointerEvents="box-none" style={[styles.float, { bottom: dockBottom(insets.bottom) }]}>
    <GestureDetector gesture={pan}>
      <View testID="bottom-navigation" onLayout={onLayout} style={[styles.bar, dark && styles.dark]}>
        {/* Frosted glass: the page stays readable through the dock without competing with the icons. */}
        <BlurView pointerEvents="none" intensity={40} tint={dark ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, styles.glass]} />
        {tabs.map((tab, i) => tab.id === 'discover'
          ? <View key={tab.id} style={styles.item}><View style={[styles.center, dark && styles.darkCenter]}><OneButton selected={path === '/discover' || dark} onDiscover={() => router.navigate('/(tabs)/discover')} onAssistant={() => router.push('/assistant')} /></View><Text testID="discover-tab-label" style={[styles.label, dark && styles.light]}>{labels.discover}</Text></View>
          : <Tap key={tab.id} testID={`tab-${tab.id}`} accessibilityRole="tab" accessibilityLabel={labels[tab.id]} accessibilityState={{ selected: selected(tab.id, tab.path) }} glow={false}
              onPress={() => { if (!scrubbed.value) open(i); }} style={styles.item}>
              <DockIcon index={i} finger={finger} slot={slot} motion={motion} selected={selected(tab.id, tab.path)}>
                <tab.icon size={21} strokeWidth={selected(tab.id, tab.path) ? 2.2 : 1.7} color={selected(tab.id, tab.path) ? palette.forest : dark ? colors.surface : colors.muted} />
              </DockIcon>
              <Text testID={`tab-label-${tab.id}`} style={[styles.label, selected(tab.id, tab.path) && styles.active, selected(tab.id, tab.path) && { color: palette.forest }, dark && styles.light]}>{labels[tab.id]}</Text>
              <RunningLight on={selected(tab.id, tab.path)} color={palette.forest} motion={motion} />
            </Tap>)}
      </View>
    </GestureDetector>
  </View>;
}

function DockIcon({ index, finger, slot, motion, selected, children }: { index: number; finger: SharedValue<number>; slot: SharedValue<number>; motion: boolean; selected: boolean; children: React.ReactNode }) {
  const hopY = useSharedValue(0); const squashX = useSharedValue(1); const squashY = useSharedValue(1);
  // Count arrivals (derived from the prop, React's "adjust state on prop change"); each one hops.
  const [prev, setPrev] = useState(selected); const [arrivals, setArrivals] = useState(0);
  if (selected !== prev) { setPrev(selected); if (selected) setArrivals(n => n + 1); }
  useEffect(() => {
    if (!arrivals || !motion) return;
    // Two hops, the second lower — thrown up and caught — squashing on each landing.
    const up = (ms: number) => ({ duration: ms, easing: Easing.out(Easing.quad) }); const down = (ms: number) => ({ duration: ms, easing: Easing.in(Easing.quad) });
    hopY.value = withSequence(withTiming(-14, up(150)), withTiming(0, down(120)), withTiming(-6, up(110)), withTiming(0, down(100)));
    squashY.value = withSequence(withTiming(1.04, up(150)), withTiming(0.88, down(120)), withTiming(1.02, up(110)), withTiming(0.95, down(100)), withSpring(1));
    squashX.value = withSequence(withTiming(0.97, up(150)), withTiming(1.1, down(120)), withTiming(0.99, up(110)), withTiming(1.04, down(100)), withSpring(1));
  }, [arrivals, motion, hopY, squashX, squashY]);
  const st = useAnimatedStyle(() => {
    let target = 1;
    if (motion && finger.value >= 0 && slot.value > 0) {
      const d = Math.abs(finger.value - (index + 0.5) * slot.value) / slot.value;
      target = interpolate(d, [0, REACH], [PEAK, 1], 'clamp');
    }
    // Grows up from the shelf (origin at the bottom), like the desktop dock, rather than from the middle.
    return { transformOrigin: 'center bottom', transform: [{ translateY: hopY.value }, { scale: withSpring(target, SIZE_SPRING) }, { scaleX: squashX.value }, { scaleY: squashY.value }] };
  });
  return <Animated.View style={st}>{children}</Animated.View>;
}

// The dot under the open tab comes on as the hop first lands, not on the tap.
function RunningLight({ on, color, motion }: { on: boolean; color: string; motion: boolean }) {
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => { v.value = on ? withDelay(motion ? 270 : 0, withTiming(1, { duration: 200 })) : withTiming(0, { duration: 150 }); }, [on, motion, v]);
  const st = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.5 + 0.5 * v.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.dot, { backgroundColor: color }, st]} />;
}

const styles = StyleSheet.create({
  float: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  bar: { width: '92%', maxWidth: 440, height: DOCK_HEIGHT, flexDirection: 'row', paddingTop: 11, backgroundColor: 'rgba(255,255,255,0.78)', borderWidth: 1, borderColor: colors.glassLine, borderRadius: 33,
    boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 28, color: 'rgba(16,59,43,0.18)' }, { offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(16,59,43,0.08)' }] },
  glass: { borderRadius: 33, overflow: 'hidden' },
  item: { flex: 1, minHeight: 45, alignItems: 'center', gap: 5 }, label: { fontSize: 9, fontWeight: '500', color: colors.muted }, active: { color: colors.forest, fontWeight: '700' },
  center: { marginTop: -30, marginBottom: -5, borderWidth: 6, borderColor: colors.surface, borderRadius: 40, backgroundColor: colors.surface }, dot: { position: 'absolute', bottom: -6, width: 4, height: 4, borderRadius: 2 },
  dark: { backgroundColor: 'rgba(26,26,26,0.92)', borderColor: 'rgba(255,255,255,0.08)' }, darkCenter: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary }, light: { color: colors.surface },
});
