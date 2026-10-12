import { useEffect, useRef } from 'react';
import { Tap } from './tap';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import { colors } from '../theme';
import { departments, departmentName } from '../departments';
import { useTranslation } from '../i18n';
import { mediaUrl } from '../api';
import { nativeDriver, useMotionAllowed } from '../motion';

function DepartmentIcon({ id, selected, delay }: { id: string; selected: boolean; delay: number }) {
  const tilt = useRef(new Animated.Value(0)).current; const motion = useMotionAllowed();
  useEffect(() => {
    if (!motion) { tilt.setValue(0); return; }
    const animation = Animated.sequence([Animated.delay(delay), Animated.timing(tilt, { toValue: -6, duration: 240, useNativeDriver: nativeDriver }), Animated.spring(tilt, { toValue: 0, friction: 3, useNativeDriver: nativeDriver })]);
    animation.start(); return () => animation.stop();
  }, [delay, motion, selected, tilt]);
  return <Animated.View style={[styles.circle, selected && styles.selected, { transform: [{ translateY: tilt }, { rotate: tilt.interpolate({ inputRange: [-6, 0], outputRange: ['-8deg', '0deg'] }) }] }]}><Image testID={`department-icon-${id}`} source={mediaUrl(`icon-${id}-v2`)} style={[styles.icon, { borderRadius: 18 }]} contentFit="contain" /></Animated.View>;
}
export function DepartmentStrip() {
  const path = usePathname(); const router = useRouter(); const { t } = useTranslation();
  return <View testID="department-strip" style={styles.row}>{departments.map((d, i) => {
    const selected = path === d.route || (d.id === 'care' && ['/beauty', '/pharmacy'].includes(path));
    return <Tap testID={`department-${d.id}`} accessibilityRole="button" accessibilityLabel={departmentName(t, d.id).replace('\n', ' ')} accessibilityState={{ selected }} key={d.id} onPress={() => router.navigate(d.route as any)} style={[styles.item]}>
      <DepartmentIcon id={d.id} selected={selected} delay={i * 65} /><Text testID={`department-label-${d.id}`} style={[styles.label, selected && styles.active, selected && { color: d.color }]}>{departmentName(t, d.id)}</Text>{selected && <View style={[styles.dot, { backgroundColor: d.color }]} />}
    </Tap>;
  })}</View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 9, paddingBottom: 5 }, item: { flex: 1, alignItems: 'center', minHeight: 81, gap: 3 }, circle: { width: 51, height: 47, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, icon: { width: 51, height: 47 }, selected: { backgroundColor: colors.glassBright, boxShadow: [{ offsetX: 0, offsetY: 5, blurRadius: 10, color: colors.shadow }] }, label: { color: colors.onSurface, fontSize: 9, lineHeight: 12, fontWeight: '500', textAlign: 'center' }, active: { fontWeight: '700', color: colors.forest }, dot: { width: 12, height: 3, borderRadius: 2, backgroundColor: colors.forest }, pressed: { transform: [{ scale: 0.9 }], opacity: 0.8 } });