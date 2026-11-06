// An on/off switch in soft UI: a white knob slides along a sunken track (see-through on a photo, soft grey on a light
// page) that takes on `tint` when on.
// What the knob shows is up to the caller. Reduce Motion: the knob jumps instead of springing across.
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { colors, soft, type Tone } from '../theme';
import { useMotionAllowed } from '../motion';
import { reSpring } from '../motion-tokens';

const KNOB = 22;
const PAD = 3;
const WIDTH = 46;
const TRAVEL = WIDTH - KNOB - PAD * 2;

type Props = { value: boolean; onValueChange: (next: boolean) => void; accessibilityLabel: string; tint: string; tone?: Tone; knob?: React.ReactNode; testID?: string; disabled?: boolean };

export function Toggle({ value, onValueChange, accessibilityLabel, tint, tone = 'photo', knob, testID, disabled }: Props) {
  const motion = useMotionAllowed(); const x = useSharedValue(value ? TRAVEL : 0);
  useEffect(() => { x.set(motion ? withSpring(value ? TRAVEL : 0, reSpring.snappy) : value ? TRAVEL : 0); }, [value, motion, x]);
  // The tint follows the knob, so the colour arrives as it slides rather than switching at once.
  const off = tone === 'photo' ? colors.whiteGlass : colors.surfaceTertiary;
  const fill = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(x.value, [0, TRAVEL], [off, tint]) }));
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return <Pressable testID={testID} accessibilityRole="switch" accessibilityLabel={accessibilityLabel} accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onValueChange(!value)} hitSlop={10}>
    <Animated.View style={[s.track, fill]}><Animated.View style={[s.knob, slide]}>{knob}</Animated.View></Animated.View>
  </Pressable>;
}

const s = StyleSheet.create({
  track: { width: WIDTH, height: KNOB + PAD * 2, borderRadius: KNOB / 2 + PAD, padding: PAD, boxShadow: soft.sunken },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, boxShadow: soft.knob },
});
