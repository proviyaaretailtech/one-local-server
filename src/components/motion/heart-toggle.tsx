// Save/unsave heart. Saving pops the heart (squash, overshoot, settle) and throws a small ring of
// sparks with a light "add" haptic; unsaving just deflates with a softer one. The pop plays on the
// user's tap, not when the saved list loads, so screens never fire hearts on their own.
// Reduce Motion: no pop, no sparks; the haptic stays.
import { Pressable, PressableProps, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Icon from '@react-native-vector-icons/ionicons';
import { haptic } from '../../haptics';
import { useMotionAllowed } from '../../motion';
import { duration, reEasing, reSpring } from '../../motion-tokens';
import { colors } from '../../theme';

const SPARKS = 6;

type Props = Omit<PressableProps, 'style' | 'children' | 'onPress'> & {
  saved: boolean; onToggle: () => void; size?: number; color?: string; savedColor?: string; style?: StyleProp<ViewStyle>;
};

export function HeartToggle({ saved, onToggle, size = 17, color = colors.muted, savedColor, style, ...rest }: Props) {
  const motion = useMotionAllowed();
  const scale = useSharedValue(1);
  const burst = useSharedValue(0);
  const press = () => {
    const saving = !saved;
    if (saving) haptic.add(); else haptic.remove();
    if (motion) {
      if (saving) {
        scale.value = withSequence(withTiming(0.7, { duration: duration.instant }), withSpring(1, reSpring.bouncy));
        burst.value = 0; burst.value = withTiming(1, { duration: duration.gentle, easing: reEasing.enter });
      } else {
        scale.value = withSequence(withTiming(0.82, { duration: duration.instant }), withSpring(1, reSpring.snappy));
      }
    }
    onToggle();
  };
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const tint = saved ? (savedColor ?? color) : color;
  return <Pressable {...rest} onPress={press} style={style}>
    <View pointerEvents="none" style={s.center}>
      {motion && Array.from({ length: SPARKS }, (_, i) => <Spark key={i} i={i} burst={burst} color={tint} reach={size * 0.95} />)}
      <Animated.View style={heartStyle}><Icon name={saved ? 'heart' : 'heart-outline'} size={size} color={tint} /></Animated.View>
    </View>
  </Pressable>;
}

function Spark({ i, burst, color, reach }: { i: number; burst: SharedValue<number>; color: string; reach: number }) {
  const angle = (i / SPARKS) * Math.PI * 2 - Math.PI / 2;
  const st = useAnimatedStyle(() => {
    const t = burst.value;
    const r = reach * (0.45 + 0.55 * t);
    return {
      opacity: t <= 0 || t >= 1 ? 0 : 1 - t,
      transform: [{ translateX: Math.cos(angle) * r }, { translateY: Math.sin(angle) * r }, { scale: 1 - 0.6 * t }],
    };
  });
  return <Animated.View style={[s.spark, { backgroundColor: color }, st]} />;
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  spark: { position: 'absolute', width: 4, height: 4, borderRadius: 2 },
});
