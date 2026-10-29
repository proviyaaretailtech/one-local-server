// "Coming soon" pop-up (format 'coming_soon', migration 0333): each upcoming store is a printed receipt that feeds out of a
// small printer, white paper and black type, a torn zigzag edge, the store's logo at its own proportions and neon-green
// corners (founder's sketch, 10 Oct 2026). Swipe sideways for the next store; the dots show where you are.
// The receipt-printer idea comes from lab.xevrion.dev (a web component); this is a React Native build of it on the UI
// thread with Reanimated. Reduce Motion shows the receipt already printed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/src/ui/text';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Svg, { Polygon, Polyline, Rect } from 'react-native-svg';
import { X } from 'lucide-react-native';
import { useTranslation } from '../i18n';
import { Tap } from '../components/tap';
import { imageUrl } from './api';
import type { ComingSoonItem } from './types';

const NEON = '#9DFF00';
const INK = '#141414';
const PAPER = '#FFFFFF';
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' });
const TOOTH = 8; const DEPTH = 5;

// Zigzag along a width: teeth DEPTH deep every TOOTH px, as a torn thermal receipt.
function teeth(width: number, flip = false) {
  const pts: string[] = [];
  for (let x = 0; x <= width; x += TOOTH / 2) pts.push(`${x},${(x / (TOOTH / 2)) % 2 ? (flip ? 0 : DEPTH) : (flip ? DEPTH : 0)}`);
  return pts;
}
function Edge({ width, bottom = false }: { width: number; bottom?: boolean }) {
  const line = teeth(width, bottom);
  const fill = bottom ? [...line, `${width},0`, '0,0'] : [...line, `${width},${DEPTH}`, `0,${DEPTH}`];
  return <Svg width={width} height={DEPTH} style={bottom ? s.edgeBottom : s.edgeTop}><Polygon points={fill.join(' ')} fill={PAPER} /></Svg>;
}
function Tear({ width }: { width: number }) {
  return <Svg width={width} height={DEPTH + 2} style={s.tear}><Polyline points={teeth(width).join(' ')} fill="none" stroke={INK} strokeWidth={1.2} /></Svg>;
}
// Bars drawn from the name, so a store always gets the same barcode.
function Barcode({ seed, width }: { seed: string; width: number }) {
  const bars = useMemo(() => {
    let h = 2166136261; const out: { x: number; w: number }[] = []; let x = 0;
    for (let i = 0; x < width; i++) { h = Math.imul(h ^ seed.charCodeAt(i % Math.max(1, seed.length)), 16777619) >>> 0; const w = 1 + (h % 3); if (i % 2 === 0) out.push({ x, w }); x += w + 1; }
    return out;
  }, [seed, width]);
  return <Svg width={width} height={34}>{bars.map((b, i) => <Rect key={i} x={b.x} y={0} width={b.w} height={34} fill={INK} />)}</Svg>;
}
function Corners() {
  return <>{(['tl', 'tr', 'bl', 'br'] as const).map(c => <View key={c} pointerEvents="none" style={[s.corner, s[c]]} />)}</>;
}
function Row({ left, right }: { left: string; right: string }) {
  return <View style={s.row}><Text style={s.rowText}>{left}</Text><Text numberOfLines={1} style={s.dots}>{'.'.repeat(40)}</Text><Text style={[s.rowText, s.bold]}>{right}</Text></View>;
}

export function Receipt({ item, width, city }: { item: ComingSoonItem; width: number; city: string }) {
  const { t } = useTranslation();
  const logo = imageUrl(item.logo);
  return <View testID="coming-soon-receipt" style={[s.paper, { width }]}>
    <Edge width={width} />
    <Corners />
    <Text style={s.stamp}>{t('popups.comingSoon.stamp')}</Text>
    <Tear width={width - 36} />
    <View style={s.logoBox}>{logo && <Image source={{ uri: logo }} accessibilityLabel={item.name} style={StyleSheet.absoluteFill} contentFit="contain" transition={120} />}</View>
    <Text numberOfLines={2} style={s.name}>{item.name.toUpperCase()}</Text>
    <View style={s.rule} />
    {!!item.line && <Row left={t('popups.comingSoon.kind')} right={item.line.toUpperCase()} />}
    <Row left={t('popups.comingSoon.city')} right={city.toUpperCase()} />
    <Row left={t('popups.comingSoon.status')} right={t('popups.comingSoon.opening')} />
    <View style={s.rule} />
    <View style={s.barcode}><Barcode seed={item.name} width={width - 96} /></View>
    <Text style={s.thanks}>{t('popups.comingSoon.thanks')}</Text>
    <Edge width={width} bottom />
  </View>;
}

export function ComingSoonReceipts({ title, items, city, motion, onClose }: { title?: string; items: ComingSoonItem[]; city: string; motion: boolean; onClose: () => void }) {
  const { t } = useTranslation(); const { width: screen } = useWindowDimensions();
  const width = Math.min(276, screen - 72); const slot = width + 36;
  const [page, setPage] = useState(0);
  const list = useRef<ScrollView>(null); const touched = useRef(false);
  const goTo = (p: number) => { list.current?.scrollTo({ x: p * slot, animated: true }); setPage(p); void Haptics.selectionAsync().catch(() => {}); };
  // Next store every 3.5 s until the customer swipes or taps a dot themselves.
  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => { if (!touched.current) setPage(p => { const n = (p + 1) % items.length; list.current?.scrollTo({ x: n * slot, animated: true }); return n; }); }, 3500);
    return () => clearInterval(id);
  }, [items.length, slot]);
  const feed = useSharedValue(motion ? 0 : 1);   // 0 = still inside the printer, 1 = fully printed
  const fade = useSharedValue(motion ? 0 : 1);
  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!motion) return;
    fade.value = withTiming(1, { duration: 220 });
    // Feed out with a few short "burn" pauses, like a thermal printer, then settle the lean.
    feed.value = withDelay(260, withSequence(
      withTiming(0.28, { duration: 300, easing: Easing.linear }), withTiming(0.3, { duration: 60 }),
      withTiming(0.62, { duration: 340, easing: Easing.linear }), withTiming(0.64, { duration: 60 }),
      withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) })));
  }, [motion, feed, fade]);
  const backdrop = useAnimatedStyle(() => ({ opacity: fade.value }));
  const paper = useAnimatedStyle(() => ({
    transform: [{ perspective: 900 }, { translateY: (feed.value - 1) * 520 }, { rotateX: `${(1 - feed.value) * 9}deg` }],
  }));
  const onScroll = (x: number) => { const p = Math.round(x / slot); if (p !== page && p >= 0 && p < items.length) { setPage(p); void Haptics.selectionAsync().catch(() => {}); } };

  return <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
    <Animated.View testID="popup-coming-soon" accessibilityViewIsModal accessibilityLabel={title || t('popups.comingSoon.stamp')} style={[s.backdrop, backdrop]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('popups.closeA11y')} />
      {!!title && <Text style={s.title}>{title}</Text>}
      <View style={[s.printer, { width: slot + 28 }]}>
        <View style={s.led} /><View style={s.slot}><View style={s.lip} /></View>
      </View>
      <View style={[s.clip, { width: slot + 28 }]}>
        <Animated.View style={paper}>
          <ScrollView ref={list} onScrollBeginDrag={() => { touched.current = true; }} horizontal pagingEnabled snapToInterval={slot} decelerationRate="fast" showsHorizontalScrollIndicator={false} style={{ width: slot }}
            onScroll={e => onScroll(e.nativeEvent.contentOffset.x)} scrollEventThrottle={32}>
            {items.map((item, i) => <View key={`${item.name}-${i}`} style={{ width: slot, alignItems: 'center', paddingTop: 2, paddingBottom: 28 }}><Receipt item={item} width={width} city={city} /></View>)}
          </ScrollView>
        </Animated.View>
      </View>
      {items.length > 1 && <View style={s.dotsRow} accessibilityLabel={t('popups.comingSoon.page', { n: page + 1, total: items.length })}>
        {items.map((_, i) => <Pressable key={i} testID={`coming-soon-dot-${i}`} accessibilityRole="button" accessibilityLabel={t('popups.comingSoon.page', { n: i + 1, total: items.length })} hitSlop={8} onPress={() => { touched.current = true; goTo(i); }}><View style={[s.dot, i === page && s.dotOn]} /></Pressable>)}
      </View>}
      <Tap testID="popup-close" accessibilityRole="button" accessibilityLabel={t('popups.closeA11y')} onPress={onClose} radius={22} style={s.close}><X size={20} color="#FFFFFF" strokeWidth={2.2} /></Tap>
    </Animated.View>
  </Modal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(4,8,5,0.82)', alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.4, marginBottom: 14 },
  printer: { height: 40, borderRadius: 18, backgroundColor: '#1C1F1C', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 9, zIndex: 2,
    borderWidth: 1, borderColor: '#2D322D', boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 24, color: 'rgba(0,0,0,0.55)' }] },
  led: { position: 'absolute', top: 9, right: 16, width: 7, height: 7, borderRadius: 4, backgroundColor: NEON, boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 8, color: NEON }] },
  slot: { width: '86%', height: 7, borderRadius: 4, backgroundColor: '#050605', overflow: 'hidden' },
  lip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: NEON, opacity: 0.85 },
  clip: { overflow: 'hidden', alignItems: 'center', marginTop: -6, maxHeight: 560 },
  paper: { userSelect: 'none', backgroundColor: PAPER, paddingHorizontal: 18, paddingTop: 22, paddingBottom: 22, alignItems: 'stretch',
    boxShadow: [{ offsetX: 0, offsetY: 26, blurRadius: 34, color: 'rgba(0,0,0,0.5)' }, { offsetX: 0, offsetY: 2, blurRadius: 4, color: 'rgba(0,0,0,0.25)' }] },
  edgeTop: { position: 'absolute', top: -DEPTH, left: 0 },
  edgeBottom: { position: 'absolute', bottom: -DEPTH, left: 0 },
  corner: { position: 'absolute', width: 18, height: 18, borderColor: NEON },
  tl: { top: 8, left: 8, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 4 },
  tr: { top: 8, right: 8, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 4 },
  bl: { bottom: 8, left: 8, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 4 },
  br: { bottom: 8, right: 8, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 4 },
  stamp: { fontFamily: MONO, color: INK, fontSize: 21, fontWeight: '800', letterSpacing: 3, textAlign: 'center', marginTop: 6 },
  tear: { alignSelf: 'center', marginTop: 10, marginBottom: 14 },
  logoBox: { height: 132, marginHorizontal: 8 },
  name: { fontFamily: MONO, color: INK, fontSize: 13, fontWeight: '800', letterSpacing: 1.2, textAlign: 'center', marginTop: 14 },
  rule: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#9A9A92', marginVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, marginVertical: 2 },
  rowText: { fontFamily: MONO, color: INK, fontSize: 11 },
  bold: { fontWeight: '800' },
  dots: { flex: 1, fontFamily: MONO, color: '#9A9A92', fontSize: 11, overflow: 'hidden' },
  barcode: { alignItems: 'center', marginTop: 4 },
  thanks: { fontFamily: MONO, color: INK, fontSize: 10, letterSpacing: 2, textAlign: 'center', marginTop: 8, marginBottom: 4 },
  dotsRow: { flexDirection: 'row', gap: 7, marginTop: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotOn: { width: 22, backgroundColor: NEON },
  close: { marginTop: 18, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
});
