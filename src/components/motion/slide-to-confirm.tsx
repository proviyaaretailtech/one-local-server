// Slide to pay. The thumb follows the finger along the track, a fill grows behind it, the label fades
// as it travels, and a detent tick plays every fifth of the way. Past 85% the release snaps it home
// with a heavy "commit" haptic and pays; short of that it springs back. Money never moves on a
// brushed tap.
// Screen readers: activate pays directly (the double-tap is already deliberate). Web is a dev/test
// surface, so there it stays a plain button: tests and mouse users click it.
// Reduce Motion: no spring overshoot; the gesture and haptics are unchanged.
import { useEffect, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Platform, Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Icon from '@react-native-vector-icons/ionicons';
import { haptic } from '../../haptics';
import { useMotionAllowed } from '../../motion';
import { duration, reSpring } from '../../motion-tokens';

const THUMB = 44;
const PAD = 4;
const DONE_AT = 0.85;
const STEPS = 5;

type Props = {
  label: string; tapLabel: string; hint: string; onConfirm: () => void; disabled?: boolean; busy?: boolean; testID?: string;
  style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle>; thumbColor: string; arrowColor: string; fillColor?: string;
};

export function SlideToConfirm({ label, tapLabel, hint, onConfirm, disabled, busy, testID, style, textStyle, thumbColor, arrowColor, fillColor = 'rgba(0,0,0,0.12)' }: Props) {
  const motion = useMotionAllowed();
  const x = useSharedValue(0);
  const max = useSharedValue(0);
  const step = useSharedValue(0);
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => { setWidth(e.nativeEvent.layout.width); max.value = Math.max(0, e.nativeEvent.layout.width - THUMB - PAD * 2); };
  const [parked, setParked] = useState(0);
  const confirm = () => { haptic.commit(); setParked(n => n + 1); onConfirm(); };
  const pan = Gesture.Pan().enabled(!disabled && !busy).activeOffsetX(4).failOffsetY([-20, 20])
    .onBegin(() => { step.value = 0; scheduleOnRN(haptic.tick); })
    .onUpdate(e => {
      const v = Math.min(max.value, Math.max(0, e.translationX)); x.value = v;
      const s = max.value > 0 ? Math.floor((v / max.value) * STEPS) : 0;
      if (s !== step.value) { step.value = s; scheduleOnRN(haptic.tick); }
    })
    .onEnd(() => {
      if (max.value > 0 && x.value >= max.value * DONE_AT) { x.value = withTiming(max.value, { duration: duration.instant }); scheduleOnRN(confirm); }
      else { x.value = withSpring(0, reSpring.snappy); scheduleOnRN(haptic.remove); }
    });

  // Back to the start whenever the button is ready again (payment failed, sheet closed…).
  useEffect(() => { if (!busy) x.value = motion ? withSpring(0, reSpring.snappy) : withTiming(0, { duration: duration.quick }); }, [busy, motion, x]);

  // If paying stops before it starts (no address yet, sign-in needed), the thumb must not stay parked.
  useEffect(() => {
    if (!parked || busy) return;
    const t = setTimeout(() => { x.value = withSpring(0, reSpring.snappy); }, 700);
    return () => clearTimeout(t);
  }, [parked, busy, x]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + THUMB + PAD }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: max.value > 0 ? interpolate(x.value, [0, max.value * 0.6], [1, 0], 'clamp') : 1 }));

  if (Platform.OS === 'web') return <Pressable testID={testID} disabled={disabled || busy} accessibilityRole="button" onPress={onConfirm} style={[style, s.center]}>
    {busy ? <ActivityIndicator color={arrowColor} /> : <Text style={textStyle}>{tapLabel}</Text>}
  </Pressable>;

  return <GestureDetector gesture={pan}>
    <View testID={testID} onLayout={onLayout} accessible accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }} accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'activate' && !disabled && !busy) confirm(); }}
      style={[style, s.track, (disabled && !busy) && s.dim]}>
      <Animated.View pointerEvents="none" style={[s.fill, { backgroundColor: fillColor }, fillStyle]} />
      <Animated.View pointerEvents="none" style={[s.labelWrap, { paddingLeft: THUMB }, labelStyle]}>
        {busy ? <ActivityIndicator color={arrowColor} /> : <Text numberOfLines={1} style={textStyle}>{label}</Text>}
      </Animated.View>
      {width > 0 && <Animated.View pointerEvents="none" style={[s.thumb, { backgroundColor: thumbColor }, thumbStyle]}>
        <Icon name="chevron-forward" size={20} color={arrowColor} />
      </Animated.View>}
    </View>
  </GestureDetector>;
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  track: { overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 0 },
  dim: { opacity: 0.55 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999 },
  labelWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  thumb: { position: 'absolute', left: PAD, width: THUMB, height: THUMB, borderRadius: THUMB / 2, alignItems: 'center', justifyContent: 'center' },
});
