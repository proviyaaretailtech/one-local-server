// Lottie animations (LottieFiles JSON format) for the app's key moments. Brand-built files live in
// assets/lottie; any animation downloaded from LottieFiles can be dropped in there and added to
// SOURCES. With Reduce Motion on, animations show their final frame instead of playing.
import LottieView from 'lottie-react-native';
import { StyleProp, ViewStyle } from 'react-native';
import { useMotionAllowed } from '../motion';

const SOURCES = {
  'order-success': require('../../assets/lottie/order-success.json'),
  'neon-loader': require('../../assets/lottie/neon-loader.json'),
};
export type LottieName = keyof typeof SOURCES;

export function OneLottie({ name, size = 96, loop = false, style, onFinish, testID }: { name: LottieName; size?: number; loop?: boolean; style?: StyleProp<ViewStyle>; onFinish?: () => void; testID?: string }) {
  const motion = useMotionAllowed();
  return <LottieView testID={testID} source={SOURCES[name]} autoPlay={motion} loop={motion && loop} progress={motion ? undefined : 1}
    onAnimationFinish={onFinish} style={[{ width: size, height: size }, style]} resizeMode="contain" />;
}
