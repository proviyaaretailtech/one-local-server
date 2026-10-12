import { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import Icon from '@react-native-vector-icons/ionicons';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { colors } from '../theme';
import { nativeDriver, useMotionAllowed } from '../motion';
import { storePalette } from '../store-palettes';
function Rangoli({ ink }: { ink: string }) {
  return <Svg width={250} height={250} viewBox="0 0 200 200"><G>{Array.from({ length: 12 }, (_, i) => <G key={i} transform={`rotate(${i * 30} 100 100)`}><Ellipse cx="100" cy="48" rx="12" ry="33" fill="none" stroke={ink} strokeWidth="1" /><Circle cx="100" cy="13" r="3" fill={ink} /></G>)}<Circle cx="100" cy="100" r="25" stroke={ink} strokeWidth="1" fill="none" /></G></Svg>;
}
export function StoreAtmosphere({ id, festival, active = true }: { id: string; festival: string; active?: boolean }) {
  const progress = useRef(new Animated.Value(0)).current; const motion = useMotionAllowed(); const palette = storePalette(id, festival);
  useEffect(() => {
    if (!motion || !active) { progress.setValue(0.4); return; }
    const animation = Animated.loop(Animated.sequence([Animated.timing(progress, { toValue: 1, duration: 5200, useNativeDriver: nativeDriver }), Animated.timing(progress, { toValue: 0, duration: 5200, useNativeDriver: nativeDriver })]));
    animation.start(); return () => animation.stop();
  }, [active, id, motion, progress]);
  const symbols = id === 'festive' ? ['flower', 'sparkles', 'flower-outline'] : id === 'fitness' ? ['barbell-outline', 'fitness-outline', 'flash-outline'] : id === 'trending' ? ['sparkles', 'star-outline', 'musical-note'] : id === 'gourmet' ? ['cafe-outline', 'heart-outline', 'cafe-outline'] : ['leaf-outline', 'sunny-outline', 'basket-outline'];
  return <View testID={`store-animation-${id}`} style={s.layer}>
    {id === 'festive' && <View style={s.toran}><Svg width="100%" height={50} viewBox="0 0 360 50"><Path d="M0 1 Q45 55 90 1 Q135 55 180 1 Q225 55 270 1 Q315 55 360 1" stroke={palette.ink} strokeWidth="1.5" opacity="0.3" fill="none" />{Array.from({ length: 9 }, (_, i) => <Circle key={i} cx={i * 45} cy={11} r={4} fill={colors.gold} />)}</Svg></View>}
    <Animated.View testID="store-aura-motion" style={[s.aura, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.32] }), transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['-15deg', '20deg'] }) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.1] }) }] }]}>{id === 'festive' ? <Rangoli ink={palette.ink} /> : <View style={[s.ring, { borderColor: palette.ink }]} />}</Animated.View>
    {Array.from({ length: 7 }, (_, i) => <Animated.View key={i} testID={`store-particle-${id}-${i}`} style={[s.particle, { left: `${5 + i * 14}%`, top: 18 + (i % 4) * 102, opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.28] }), transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [18 + i * 2, -18 - i * 4] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '30deg'] }) }] }]}><Icon name={symbols[i % 3] as any} size={i % 2 ? 18 : 27} color={palette.ink} /></Animated.View>)}
  </View>;
}
const s = StyleSheet.create({ layer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, overflow: 'hidden', pointerEvents: 'none' }, toran: { position: 'absolute', top: 0, left: 0, right: 0 }, aura: { position: 'absolute', right: -35, top: 138 }, ring: { width: 250, height: 250, borderRadius: 125, borderWidth: 1 }, particle: { position: 'absolute' } });