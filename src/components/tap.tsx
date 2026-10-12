// Touch feedback for anything tappable: while the finger is down the surface sinks a little and a
// neon ring glows around it; a light haptic confirms the tap. Drop-in for Pressable — the style goes
// on the Pressable itself, so flex, widths and percentages behave exactly as before.
// (A plain Pressable with its pressed state, not an animated wrapper: animated Pressables drop their
// styles on react-native-web.) Reduce Motion keeps the ring but skips the scale.
import { Platform, Pressable, PressableProps, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { haptic as buzz } from '../haptics';
import { useMotionAllowed } from '../motion';
import { duration, pressScale } from '../motion-tokens';
import { colors } from '../theme';

type Props = Omit<PressableProps, 'style' | 'children'> & { style?: StyleProp<ViewStyle>; glow?: boolean; haptic?: boolean; radius?: number; children?: React.ReactNode };

// Smooths the press on the web (native applies it instantly, which reads as a crisp tap).
const webEase = Platform.OS === 'web' ? ({ transitionProperty: 'transform', transitionDuration: `${duration.instant}ms`, transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)' } as unknown as ViewStyle) : null;

export function Tap({ style, glow = true, haptic = true, radius = 18, onPress, children, ...rest }: Props) {
  const motion = useMotionAllowed();
  return <Pressable {...rest}
    onPress={e => { if (haptic) buzz.tap(); onPress?.(e); }}
    style={({ pressed }) => [style, webEase, motion && pressed && { transform: [{ scale: pressScale }] }]}>
    {({ pressed }) => <>
      {children}
      {glow && pressed && <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.ring, { borderRadius: radius }]} />}
    </>}
  </Pressable>;
}

const s = StyleSheet.create({
  ring: { borderWidth: 2, borderColor: colors.electricLime, boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 14, color: 'rgba(179,244,0,0.55)' }] },
});
