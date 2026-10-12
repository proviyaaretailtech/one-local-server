import { useEffect, useId, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme';
import { nativeDriver, useMotionAllowed } from '../motion';
import { useTranslation } from 'react-i18next'; // not '../i18n': that index imports this file (first-run.tsx)

export function OneGlyph({ size = 36 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return <Svg width={size * 0.62} height={size} viewBox="0 0 48 80"><Defs><LinearGradient id={`one-face-${id}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.electricLime} /><Stop offset="1" stopColor={colors.lime} /></LinearGradient><LinearGradient id={`one-fold-${id}`}><Stop offset="0" stopColor={colors.electricLime} /><Stop offset="1" stopColor={colors.forest} /></LinearGradient></Defs><Path d="M26 0 L0 25 L26 25 Z" fill={`url(#one-fold-${id})`} /><Path d="M26 0 H48 V80 H26 Z" fill={`url(#one-face-${id})`} /></Svg>;
}
export function OneButton({ onDiscover, onAssistant, selected }: { onDiscover: () => void; onAssistant: () => void; selected: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current; const scale = useRef(new Animated.Value(1)).current;
  const held = useRef(false); const motion = useMotionAllowed(); const { t } = useTranslation();
  useEffect(() => { if (!motion || !selected) { pulse.setValue(0); return; } const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: nativeDriver }), Animated.timing(pulse, { toValue: 0, duration: 1200, useNativeDriver: nativeDriver })])); loop.start(); return () => loop.stop(); }, [motion, selected, pulse]);
  const glow = () => { if (motion) Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 120, useNativeDriver: nativeDriver }), Animated.timing(pulse, { toValue: 0, duration: 600, useNativeDriver: nativeDriver })]).start(); void Haptics.selectionAsync().catch(() => {}); };
  return <View style={styles.wrap}><Animated.View style={[styles.halo, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.5] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.32] }) }] }]} /><Pressable testID="tab-reels" accessibilityRole="button" accessibilityLabel={t('nav.discoverButton')} accessibilityHint={t('nav.discoverHint')} delayLongPress={420} onPressIn={() => { held.current = false; if (motion) Animated.spring(scale, { toValue: 0.9, useNativeDriver: nativeDriver }).start(); }} onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver }).start()} onLongPress={() => { held.current = true; glow(); onAssistant(); }} onPress={() => { if (!held.current) { glow(); onDiscover(); } }}><Animated.View style={[styles.button, { transform: [{ scale }] }]}><OneGlyph /></Animated.View></Pressable></View>;
}
const styles = StyleSheet.create({ wrap: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' }, halo: { position: 'absolute', width: 58, height: 58, borderRadius: 29, backgroundColor: colors.lime }, button: { width: 54, height: 54, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary, borderWidth: 1, borderColor: colors.forest } });