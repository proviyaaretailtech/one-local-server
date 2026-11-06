// Touch feedback for anything tappable: while the finger is down the surface sinks a little and a light
// haptic confirms the tap. No outline or ring is drawn (glow is opt-in and off by default). Drop-in for Pressable — the style goes
// on the Pressable itself, so flex, widths and percentages behave exactly as before.
// (A plain Pressable with its pressed state, not an animated wrapper: animated Pressables drop their
// styles on react-native-web.) Reduce Motion skips the scale.
import { Pressable, PressableProps, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { haptic as buzz } from '../haptics';
import { markHaptic } from '../native/haptic-clock';
import { motionAllowedNow } from '../motion';
import { pressScale, webPressEase } from '../motion-tokens';
import { colors } from '../theme';

type Props = Omit<PressableProps, 'style' | 'children'> & { style?: StyleProp<ViewStyle>; glow?: boolean; haptic?: boolean; radius?: number; children?: React.ReactNode };

export function Tap({ style, glow = false, haptic = true, radius = 18, onPress, children, ...rest }: Props) {
  // haptic={false} still claims the moment (markHaptic), so the app-wide press feedback stays silent as well.
  return <Pressable {...rest}
    onPress={e => { if (haptic) buzz.tap(); else markHaptic(); onPress?.(e); }}
    style={({ pressed }) => [style, webPressEase, motionAllowedNow() && pressed && { transform: [{ scale: pressScale }] }]}>
    {({ pressed }) => <>
      {children}
      {glow && pressed && <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.ring, { borderRadius: radius }]} />}
    </>}
  </Pressable>;
}

const s = StyleSheet.create({
  ring: { borderWidth: 2, borderColor: colors.electricLime, boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 14, color: 'rgba(179,244,0,0.55)' }] },
});
