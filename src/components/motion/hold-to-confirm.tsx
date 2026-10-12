// Press-and-hold button for actions that are hard to undo (cancelling an order). While the finger is
// down a fill sweeps across the button with detent ticks at each third; when it is full a heavy
// "commit" haptic lands and the action runs. Letting go early drains the fill and, on a quick tap,
// swaps the label to the hold instruction so nobody is left wondering why nothing happened.
// Screen readers: the button's activate action confirms directly — the double-tap is already a
// deliberate gesture, and holding is hard with TalkBack/VoiceOver. Reduce Motion: no fill sweep
// (the timing, ticks and label still work).
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { haptic } from '../../haptics';
import { useMotionAllowed } from '../../motion';
import { duration } from '../../motion-tokens';

type Props = {
  label: string; holdLabel: string; hint: string; onConfirm: () => void;
  disabled?: boolean; holdMs?: number; testID?: string;
  style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle>; fillColor?: string;
};

export function HoldToConfirm({ label, holdLabel, hint, onConfirm, disabled, holdMs = 900, testID, style, textStyle, fillColor = 'rgba(0,0,0,0.22)' }: Props) {
  const motion = useMotionAllowed();
  const fill = useSharedValue(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const done = useRef(false);
  const [nudge, setNudge] = useState(false);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clear, []);
  useEffect(() => { if (!nudge) return; const t = setTimeout(() => setNudge(false), 1600); return () => clearTimeout(t); }, [nudge]);

  const start = () => {
    if (disabled) return;
    done.current = false; clear(); haptic.tick();
    if (motion) { fill.value = 0; fill.value = withTiming(1, { duration: holdMs, easing: Easing.linear }); }
    timers.current = [
      setTimeout(() => haptic.tick(), holdMs / 3),
      setTimeout(() => haptic.tick(), (holdMs * 2) / 3),
      setTimeout(() => { done.current = true; haptic.commit(); onConfirm(); }, holdMs),
    ];
  };
  const release = () => {
    if (done.current) { fill.value = withTiming(0, { duration: duration.gentle }); return; }
    const early = timers.current.length > 0;
    clear(); cancelAnimation(fill); fill.value = withTiming(0, { duration: duration.quick });
    if (early && !disabled) { setNudge(true); haptic.limit(); }
  };
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return <Pressable testID={testID} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
    accessibilityState={{ disabled: !!disabled }}
    accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'activate' && !disabled) { haptic.commit(); onConfirm(); } }}
    onPressIn={start} onPressOut={release} style={[style, s.clip]}>
    <Animated.View pointerEvents="none" style={[s.fill, { backgroundColor: fillColor }, fillStyle]} />
    <View pointerEvents="none"><Text style={textStyle}>{nudge ? holdLabel : label}</Text></View>
  </Pressable>;
}

const s = StyleSheet.create({
  clip: { overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
});
