import { useEffect, useId, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Path, Ellipse, Circle, Rect, G } from 'react-native-svg';
import { colors } from '../theme';
import { nativeDriver, useMotionAllowed } from '../motion';
import { useTranslation } from '@/src/i18n';

// Layered illustration: the arm waves independently at its shoulder; the face
// blinks separately from the body bob. All gradients use instance-unique IDs.
export function CartCharacter({ revision, size = 174 }: { revision: number; size?: number }) {
  const id = useId().replace(/:/g, ''); const wave = useRef(new Animated.Value(0)).current; const bob = useRef(new Animated.Value(0)).current; const blink = useRef(new Animated.Value(1)).current; const motion = useMotionAllowed(); const { t } = useTranslation();
  useEffect(() => {
    wave.setValue(0); bob.setValue(0); blink.setValue(1); if (!motion) return;
    const waving = Animated.loop(Animated.sequence([Animated.timing(wave, { toValue: 1, duration: 240, useNativeDriver: nativeDriver }), Animated.timing(wave, { toValue: -1, duration: 300, useNativeDriver: nativeDriver }), Animated.timing(wave, { toValue: 0, duration: 240, useNativeDriver: nativeDriver })]), { iterations: 4 });
    const floating = Animated.loop(Animated.sequence([Animated.timing(bob, { toValue: -5, duration: 950, useNativeDriver: nativeDriver }), Animated.timing(bob, { toValue: 0, duration: 950, useNativeDriver: nativeDriver })]));
    const eyes = Animated.sequence([Animated.delay(1100), Animated.timing(blink, { toValue: 0.1, duration: 85, useNativeDriver: nativeDriver }), Animated.timing(blink, { toValue: 1, duration: 120, useNativeDriver: nativeDriver })]);
    waving.start(); floating.start(); eyes.start(); return () => { waving.stop(); floating.stop(); eyes.stop(); };
  }, [wave, bob, blink, motion, revision]);
  return <View testID="cart-character" accessibilityLabel={t('cart.character.a11y')} style={{ width: size, height: size * 1.08 }}>
    <Animated.View style={[s.character, { transform: [{ translateY: bob }] }]}>
      <Svg width="100%" height="100%" viewBox="0 0 200 216"><Defs>
        <RadialGradient id={`${id}skin`} cx="35%" cy="25%" r="80%"><Stop offset="0" stopColor={colors.characterLight} /><Stop offset="0.65" stopColor={colors.characterSkin} /><Stop offset="1" stopColor={colors.characterShadow} /></RadialGradient>
        <LinearGradient id={`${id}shirt`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.shopsMid} /><Stop offset="0.45" stopColor={colors.characterBody} /><Stop offset="1" stopColor={colors.characterDeep} /></LinearGradient>
        <LinearGradient id={`${id}bag`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.surface} /><Stop offset="1" stopColor={colors.groceryTop} /></LinearGradient>
      </Defs>
      <Ellipse cx="94" cy="203" rx="52" ry="7" fill={colors.overlay} opacity="0.12" />
      <Path d="M71 166L68 190Q52 195 58 202L84 202L88 167 M105 167L108 200L135 200Q138 192 124 190L124 166" fill={colors.characterShoe} />
      <Path d="M73 100Q42 106 39 139Q36 155 52 155L68 128" fill={`url(#${id}shirt)`} /><Ellipse cx="46" cy="148" rx="10" ry="12" fill={`url(#${id}skin)`} />
      <Path d="M68 102Q95 93 123 102Q140 126 136 161Q133 177 98 179Q63 177 58 161Q58 125 68 102" fill={`url(#${id}shirt)`} />
      <Path d="M79 99L96 121L114 99" fill={colors.surface} opacity="0.8" />
      <Rect x="79" y="121" width="34" height="28" rx="11" fill={colors.surface} opacity="0.9" /><Path d="M92 130L99 127L99 142" stroke={colors.characterDeep} strokeWidth="5" fill="none" strokeLinecap="round" />
      <Ellipse cx="60" cy="70" rx="10" ry="15" fill={`url(#${id}skin)`} /><Ellipse cx="131" cy="70" rx="10" ry="15" fill={`url(#${id}skin)`} /><Rect x="59" y="25" width="74" height="83" rx="34" fill={`url(#${id}skin)`} />
      <Path d="M59 56Q49 18 81 14Q120 4 134 37L132 57Q121 34 99 42Q68 48 66 33Z" fill={colors.characterShoe} /><Path d="M69 24Q92 9 116 25" stroke={colors.characterDeep} strokeWidth="5" strokeLinecap="round" opacity="0.6" fill="none" />
      <Ellipse cx="71" cy="82" rx="9" ry="5" fill={colors.characterBlush} opacity="0.6" /><Ellipse cx="122" cy="82" rx="8" ry="5" fill={colors.characterBlush} opacity="0.6" />
      <Path d="M87 88Q97 100 109 86" fill={colors.characterShoe} /><Path d="M89 89L105 89" stroke={colors.surface} strokeWidth="3" strokeLinecap="round" /><Ellipse cx="99" cy="79" rx="6" ry="4" fill={colors.characterShadow} opacity="0.35" />
      <Path d="M148 146Q146 130 158 131Q171 129 171 146" stroke={colors.grocery} strokeWidth="4" fill="none" /><Path d="M139 143L181 144L185 186Q160 196 138 186Z" fill={`url(#${id}bag)`} /><Path d="M145 151L177 151" stroke={colors.groceryTop} strokeWidth="2" /><G fill={colors.grocery}><Circle cx="151" cy="167" r="2" /><Circle cx="170" cy="167" r="2" /><Path d="M155 176Q160 180 166 175" stroke={colors.grocery} strokeWidth="2" fill="none" /></G>
      </Svg>
      <Animated.View testID="cart-character-eyes" style={[s.eyes, { transform: [{ scaleY: blink }] }]}><Svg width="100%" height="100%" viewBox="0 0 50 18"><Ellipse cx="9" cy="10" rx="5" ry="7" fill={colors.characterShoe} /><Circle cx="10" cy="7" r="1.8" fill={colors.surface} /><Ellipse cx="40" cy="10" rx="5" ry="7" fill={colors.characterShoe} /><Circle cx="41" cy="7" r="1.8" fill={colors.surface} /></Svg></Animated.View>
      <Animated.View testID="cart-character-waving-arm" style={[s.arm, { transform: [{ rotate: wave.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-17deg', '6deg', '23deg'] }) }] }]}><Svg width="100%" height="100%" viewBox="0 0 65 100"><Defs><LinearGradient id={`${id}hand`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.characterLight} /><Stop offset="1" stopColor={colors.characterShadow} /></LinearGradient></Defs><Path d="M8 88Q2 76 12 71L30 49L45 55Q37 80 22 94Q15 99 8 88" fill={colors.characterBody} /><Path d="M28 57L25 36Q23 29 29 28L33 39L31 13Q32 6 36 13L39 34L39 7Q41 2 45 9L45 33L48 12Q52 6 54 15L51 37L57 25Q63 22 62 29L54 51Q46 65 28 57" fill={`url(#${id}hand)`} /><Path d="M33 45Q42 42 49 46" stroke={colors.characterShadow} opacity="0.5" strokeWidth="1.5" fill="none" /></Svg></Animated.View>
    </Animated.View>
  </View>;
}
const s = StyleSheet.create({ character: { flex: 1 }, eyes: { position: 'absolute', left: '37%', top: '27%', width: '25%', height: '8.3%' }, arm: { position: 'absolute', left: '59%', top: '9%', width: '32.5%', height: '46.3%', transformOrigin: '12% 88%' } });