// A row of choice chips, one picked (Search's departments, Discover's filters). The picked one is a green pill that glides
// to the chip you tap, over the chips' white plates, and each chip's words turn white as the pill comes under them. Each
// chip may have a picture before its words (`lead`, told whether the chip is picked).
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, type SharedValue, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Text } from '../ui/text';
import { Tap } from './tap';
import { colors, popBase, radius } from '../theme';
import { useMotionAllowed } from '../motion';
import { reSpring } from '../motion-tokens';

export type Chip = { id: string; testID: string; label: string; lead?: (on: boolean) => ReactNode };
type Box = { x: number; y: number; width: number; height: number };
type Boxes = SharedValue<Record<string, Box>>;
const Label = Animated.createAnimatedComponent(Text);

export function ChipRow({ chips, selected, onSelect, style, contentContainerStyle }: { chips: Chip[]; selected: string; onSelect: (id: string) => void; style?: StyleProp<ViewStyle>; contentContainerStyle?: StyleProp<ViewStyle> }) {
  const motion = useMotionAllowed();
  const boxes = useSharedValue<Record<string, Box>>({}); const x = useSharedValue(0); const w = useSharedValue(0); const top = useSharedValue(0); const h = useSharedValue(0);
  const placed = useRef(false);
  // The chips' boxes as measured, kept here too: chips measured in the same frame would each read the shared value
  // before the others' writes reached it, and keep only the last one.
  const known = useRef<Record<string, Box>>({});
  const moveTo = useCallback((id: string, glide: boolean) => {
    const b = known.current[id]; if (!b) return;
    x.set(glide ? withSpring(b.x, reSpring.snappy) : b.x); w.set(glide ? withSpring(b.width, reSpring.snappy) : b.width); top.set(b.y); h.set(b.height);
  }, [x, w, top, h]);
  // A row that starts with nothing picked has no pill yet: its first pick places the pill, and later picks glide it.
  useEffect(() => { if (!known.current[selected]) return; moveTo(selected, motion && placed.current); placed.current = true; }, [selected, motion, moveTo]);
  // The pill is placed, not glided, the first time and whenever the picked chip changes size (the font arriving).
  const measured = (id: string) => (e: LayoutChangeEvent) => {
    known.current = { ...known.current, [id]: e.nativeEvent.layout }; boxes.set(known.current);
    if (id === selected) { moveTo(id, false); placed.current = true; }
  };
  const pill = useAnimatedStyle(() => ({ left: x.value, top: top.value, width: w.value, height: h.value }));
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={contentContainerStyle}>
    {chips.map(c => <Plate key={c.id} id={c.id} boxes={boxes} />)}
    <Animated.View pointerEvents="none" style={[s.pill, pill]} />
    {chips.map(c => { const on = c.id === selected;
      return <Tap key={c.id} testID={c.testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onSelect(c.id)} onLayout={measured(c.id)} style={[s.chip, !c.lead && s.plain]}>
        {c.lead?.(on)}
        <ChipLabel id={c.id} text={c.label} boxes={boxes} x={x} w={w} />
      </Tap>; })}
  </ScrollView>;
}

// A chip's white plate, under the pill.
function Plate({ id, boxes }: { id: string; boxes: Boxes }) {
  const style = useAnimatedStyle(() => { const b = boxes.value[id]; return b ? { opacity: 1, left: b.x, top: b.y, width: b.width, height: b.height } : { opacity: 0 }; });
  return <Animated.View pointerEvents="none" style={[s.plate, style]} />;
}

// A chip's words: dark on its plate, white as much as the pill is under it.
function ChipLabel({ id, text, boxes, x, w }: { id: string; text: string; boxes: Boxes; x: SharedValue<number>; w: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const b = boxes.value[id];
    const under = b?.width ? Math.max(0, Math.min(x.value + w.value, b.x + b.width) - Math.max(x.value, b.x)) / b.width : 0;
    return { color: interpolateColor(under, [0, 1], [colors.onSurface, colors.surface]) };
  });
  return <Label numberOfLines={1} style={[s.label, style]}>{text}</Label>;
}

const s = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 42, paddingLeft: 6, paddingRight: 14, borderRadius: radius.pill },
  plain: { paddingLeft: 14 },
  plate: { position: 'absolute', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  // The picked chip fills with the brand green, on a darker base.
  pill: { position: 'absolute', borderRadius: radius.pill, backgroundColor: colors.forest, boxShadow: popBase(3, colors.forestDeep) },
  label: { fontSize: 13, fontWeight: '700' },
});
