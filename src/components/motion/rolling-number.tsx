// Odometer-style number: when the value changes, only the characters that changed roll — up when the
// number grows, down when it shrinks — so a quantity going 9 → 10 reads as counting, not a redraw.
// Works on any formatted string (Devanagari digits included), because it animates characters, not
// digit columns. Reduce Motion swaps instantly. After the roll, only the new text is in the tree, so
// tests and screen readers always read one clean value.
import { useEffect, useRef, useState } from 'react';
import { StyleProp, StyleSheet, TextStyle, View } from 'react-native';
import { Text } from '@/src/ui/text';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotionAllowed } from '../../motion';
import { duration, reEasing } from '../../motion-tokens';

type Props = { value: number; text: string; style?: StyleProp<TextStyle>; lineHeight: number; testID?: string };

export function RollingNumber({ value, text, style, lineHeight, testID }: Props) {
  // Which way to roll is derived from the previous value (React's "adjust state on prop change").
  const [last, setLast] = useState(value); const [dir, setDir] = useState(1);
  if (value !== last) { setLast(value); setDir(value > last ? 1 : -1); }
  // Keyed from the right, so units stay units when the length changes (9 → 10 rolls the last slot).
  const chars = text.split('');
  // Box rules (minWidth, flexShrink) belong to the whole number, not to each character.
  const { minWidth, flexShrink, textAlign, ...glyph } = StyleSheet.flatten(style) ?? {};
  const justifyContent = textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start';
  return <View testID={testID} accessible accessibilityLabel={text} style={[s.row, { height: lineHeight, minWidth, flexShrink, justifyContent }]}>
    {chars.map((c, i) => <Slot key={chars.length - i} ch={c} dir={dir} style={glyph} h={lineHeight} />)}
  </View>;
}

function Slot({ ch, dir, style, h }: { ch: string; dir: number; style?: StyleProp<TextStyle>; h: number }) {
  const motion = useMotionAllowed();
  const [prev, setPrev] = useState<string | null>(null);
  const shown = useRef(ch);
  const p = useSharedValue(1);
  const d = useSharedValue(dir);
  useEffect(() => {
    if (ch === shown.current) return;
    const old = shown.current; shown.current = ch;
    if (!motion) return;
    setPrev(old); d.value = dir; p.value = 0;
    p.value = withTiming(1, { duration: duration.quick + 60, easing: reEasing.standard });
    const t = setTimeout(() => setPrev(null), duration.quick + 80);
    return () => clearTimeout(t);
  }, [ch, dir, motion, p, d]);
  const inStyle = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: d.value * h * 0.8 * (1 - p.value) }] }));
  const outStyle = useAnimatedStyle(() => ({ opacity: 1 - p.value, transform: [{ translateY: -d.value * h * 0.8 * p.value }] }));
  return <View style={{ height: h, justifyContent: 'center' }}>
    <Animated.View style={inStyle}><Text style={[style, { lineHeight: h }]}>{ch}</Text></Animated.View>
    {prev !== null && <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, s.center, outStyle]}><Text style={[style, { lineHeight: h }]}>{prev}</Text></Animated.View>}
  </View>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
