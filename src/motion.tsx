import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { AccessibilityInfo, Animated, AppState, Platform, ScrollView, ScrollViewProps, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useScreenPalette } from './use-screen-path';
import { colors } from './theme';

// How far the page gradient reaches below the header: past the department hero, where it has faded to white.
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
type ScrollContextValue = { y: Animated.Value; headerHeight: number; setHeaderHeight: (v: number) => void; scrollRef: React.RefObject<ScrollView | null>;
  // True while a CityScroll screen is showing: it pads its own bottom, so content scrolls under the floating dock.
  // Counted, not a flag: when one tab focuses before the last one blurs, the order must not matter.
  scrollUnderDock: boolean; claimScrollUnderDock: () => () => void };
const ScrollContext = createContext<ScrollContextValue | null>(null);
export function CityMotionProvider({ children }: { children: React.ReactNode }) {
  const y = useRef(new Animated.Value(0)).current;
  const [headerHeight, setHeaderHeight] = useState(236);
  const scrollRef = useRef<ScrollView>(null);
  const [claims, setClaims] = useState(0);
  const claimScrollUnderDock = useCallback(() => { setClaims(n => n + 1); return () => setClaims(n => n - 1); }, []);
  return <ScrollContext.Provider value={{ y, headerHeight, setHeaderHeight, scrollRef, scrollUnderDock: claims > 0, claimScrollUnderDock }}>{children}</ScrollContext.Provider>;
}
export const useCityScroll = () => useContext(ScrollContext)!;
// The scroll position drives the collapsing header on the native (UI) thread, so the header follows the
// finger without waiting for JavaScript. The listener only remembers the offset for when the tab returns.
// `bleed`: the screen draws its own header (home's photo hero), so content starts at the very top.
export function CityScroll({ contentContainerStyle, bleed = false, children, ...props }: ScrollViewProps & { bleed?: boolean }) {
  const palette = useScreenPalette();
  const { y, headerHeight, scrollRef, claimScrollUnderDock } = useCityScroll();
  const ownRef = useRef<ScrollView>(null); const offset = useRef(0);
  useFocusEffect(useCallback(() => { scrollRef.current = ownRef.current; y.setValue(offset.current); return claimScrollUnderDock(); }, [scrollRef, y, claimScrollUnderDock]));
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y } } }], {
    useNativeDriver: nativeDriver,
    listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => { offset.current = Math.max(0, e.nativeEvent.contentOffset.y); },
  }), [y]);
  // One gradient for the whole top of the page, from behind the (transparent) header down through the hero into white.
  // It lives in the scrolling content, so it moves with the page and the header and hero never paint separate bands.
  return <Animated.ScrollView {...props} ref={ownRef} scrollEventThrottle={16} onScroll={onScroll} contentContainerStyle={[styles.content, contentContainerStyle, { paddingTop: bleed ? 0 : headerHeight, paddingBottom: 125 }]}>
    {!bleed && <LinearGradient testID="page-gradient" pointerEvents="none" colors={[palette.top, palette.mid, palette.fade, colors.surface]} locations={[0, 0.32, 0.78, 1]} style={[styles.backdrop, { height: headerHeight + BACKDROP_BELOW_HEADER }]} />}
    {children}
  </Animated.ScrollView>;
}
const styles = StyleSheet.create({ content: { flexGrow: 1 }, backdrop: { position: 'absolute', top: 0, left: 0, right: 0 } });
