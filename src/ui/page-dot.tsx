// A carousel's page dot: the page showing's stretches into a bar in its own colour, the others ease back into small
// faint dots, so moving between pages never snaps. Home's hero, Food's ad slides and the product sheet's photos use it.
// `children` sit inside the bar (the hero's filling timer).
import { useEffect, type ReactNode } from 'react';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotionAllowed } from '../motion';
import { duration, reEasing } from '../motion-tokens';

type Props = { on: boolean; size: number; wide: number; color: string; onColor: string; children?: ReactNode };

export function PageDot({ on, size, wide, color, onColor, children }: Props) {
  const motion = useMotionAllowed(); const p = useSharedValue(on ? 1 : 0);
  useEffect(() => { p.set(motion ? withTiming(on ? 1 : 0, { duration: duration.base, easing: reEasing.standard }) : on ? 1 : 0); }, [on, motion, p]);
  const style = useAnimatedStyle(() => ({ width: size + (wide - size) * p.value, backgroundColor: interpolateColor(p.value, [0, 1], [color, onColor]) }));
  return <Animated.View style={[{ height: size, borderRadius: size / 2, overflow: 'hidden' }, style]}>{children}</Animated.View>;
}
