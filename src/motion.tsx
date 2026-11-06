import { createContext, useContext, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform, ScrollView, ScrollViewProps, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useScreenPalette } from './use-screen-path';
import { colors } from './theme';

// Where a page that draws no header of its own (ExploreTown) starts: the room the shell's old header took.
const TOP_ROOM = 236;
// How far the page gradient reaches below that room, where it has faded to white.
const BACKDROP_BELOW_HEADER = 520;

export const nativeDriver = Platform.OS !== 'web';

// One shared "may we animate?" answer for the whole app. Every product card used to ask the OS and
// add its own two listeners; now one subscription feeds all of them.
let reduced = true; let active = AppState.currentState === 'active'; let watching = false;
const motionListeners = new Set<() => void>();
const emitMotion = () => motionListeners.forEach(l => l());
function watchMotion() {
  if (watching) return; watching = true;
  AccessibilityInfo.isReduceMotionEnabled().then(v => { reduced = v; emitMotion(); }).catch(() => {});
  AccessibilityInfo.addEventListener('reduceMotionChanged', v => { reduced = v; emitMotion(); });
  AppState.addEventListener('change', v => { active = v === 'active'; emitMotion(); });
}
const subscribeMotion = (l: () => void) => { watchMotion(); motionListeners.add(l); return () => { motionListeners.delete(l); }; };
const motionSnapshot = () => !reduced && active;
export function useMotionAllowed() {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, () => false);
}
/** The same answer, read at the moment it is needed (a press) without subscribing: every button on every kept tab
 *  subscribing made each trip to the background and back re-render all of them. */
export function motionAllowedNow() { watchMotion(); return motionSnapshot(); }
type ScrollContextValue = { y: Animated.Value; scrollRef: React.RefObject<ScrollView | null> };
const ScrollContext = createContext<ScrollContextValue | null>(null);
// One per screen (its frame in src/components/app-shell.tsx provides it): each page keeps its own scroll position, so its
// header and compact bar stay as they are while another page comes in over it or fades in beside it.
export function CityMotionProvider({ children }: { children: React.ReactNode }) {
  const [y] = useState(() => new Animated.Value(0));
  const scrollRef = useRef<ScrollView>(null);
  const value = useMemo(() => ({ y, scrollRef }), [y]);
  return <ScrollContext.Provider value={value}>{children}</ScrollContext.Provider>;
}
export const useCityScroll = () => useContext(ScrollContext)!;
// The scroll position drives the collapsing header on the native (UI) thread, so the header follows the
// finger without waiting for JavaScript.
// `bleed`: the screen draws its own header (home's photo hero), so content starts at the very top.
export function CityScroll({ contentContainerStyle, bleed = false, children, ...props }: ScrollViewProps & { bleed?: boolean }) {
  const palette = useScreenPalette();
  const { y, scrollRef } = useCityScroll();
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: nativeDriver }), [y]);
  // One gradient for the whole top of the page, from behind the (transparent) header down through the hero into white.
  // It lives in the scrolling content, so it moves with the page and the header and hero never paint separate bands.
  return <Animated.ScrollView {...props} ref={scrollRef} scrollEventThrottle={16} onScroll={onScroll} contentContainerStyle={[styles.content, contentContainerStyle, { paddingTop: bleed ? 0 : TOP_ROOM, paddingBottom: 125 }]}>
    {!bleed && <LinearGradient testID="page-gradient" pointerEvents="none" colors={[palette.top, palette.mid, palette.fade, colors.surface]} locations={[0, 0.32, 0.78, 1]} style={[styles.backdrop, { height: TOP_ROOM + BACKDROP_BELOW_HEADER }]} />}
    {children}
  </Animated.ScrollView>;
}
const styles = StyleSheet.create({ content: { flexGrow: 1 }, backdrop: { position: 'absolute', top: 0, left: 0, right: 0 } });
