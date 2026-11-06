// The emergency pop-up (drop the Discover button on the siren, see one-button.tsx): a red panel that slides down from the
// top with India's helplines, each opening the phone app with the number filled in. Nothing is dialled until the person
// confirms the call there.
import { Linking, Modal, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next'; // not '../i18n': its index imports one-button.tsx, which imports this file
import { Text } from '../ui/text';
import { colors } from '../theme';
import { haptic } from '../haptics';
import { useMotionAllowed } from '../motion';
import { duration, reEasing, reSpring } from '../motion-tokens';

const HELPLINES = [
  { number: '112', name: 'sos.emergency', icon: '🚨' },
  { number: '108', name: 'sos.ambulance', icon: '🚑' },
  { number: '100', name: 'sos.police', icon: '🚓' },
  { number: '101', name: 'sos.fire', icon: '🚒' },
] as const;
const OVERHANG = 48; // the panel reaches this far above the screen, so the spring's settle never opens a gap at the top

export function EmergencyHelplines({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation(); const motion = useMotionAllowed(); const insets = useSafeAreaInsets();
  const y = useSharedValue(-2000); const height = useSharedValue(0);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  // Drops in from above once its height is known; closing slides it back up before the pop-up goes.
  const enter = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height; height.value = h;
    y.set(motion ? withSequence(withTiming(-h, { duration: 0 }), withSpring(0, reSpring.snappy)) : 0);
  };
  const close = () => {
    if (!motion) { onClose(); return; }
    y.set(withTiming(-height.value, { duration: duration.base, easing: reEasing.exit }, done => { if (done) scheduleOnRN(onClose); }));
  };
  // A device with no dialler (iPad, simulator, desktop) refuses the link; the number stays on screen to dial by hand.
  const call = (number: string) => { void Linking.openURL(`tel:${number}`).catch(haptic.error); };
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
    <View style={s.overlay}>
      <Pressable testID="sos-backdrop" accessibilityLabel={t('common.close')} onPress={close} style={StyleSheet.absoluteFill} />
      <Animated.View testID="sos-sheet" onLayout={enter} style={[s.panel, slide]}>
        <LinearGradient colors={[colors.onError, colors.errorDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.sheet, { paddingTop: insets.top + OVERHANG + 12 }]}>
          <View style={s.head}>
            <View style={s.badge}><Text style={s.badgeIcon}>🚨</Text></View>
            <View style={s.headText}><Text style={s.title}>{t('sos.title')}</Text><Text style={s.body}>{t('sos.body')}</Text></View>
          </View>
          {HELPLINES.map((h, i) => <Pressable key={h.number} testID={`sos-call-${h.number}`} accessibilityRole="button" accessibilityLabel={t('sos.call', { name: t(h.name), number: h.number })} onPress={() => call(h.number)} style={[s.line, i === 0 && s.urgent]}>
            <Text style={s.lineIcon}>{h.icon}</Text>
            <Text style={[s.lineName, i === 0 && s.urgentText]}>{t(h.name)}</Text>
            <Text style={[s.lineNumber, i === 0 && s.urgentText]}>{h.number}</Text>
          </Pressable>)}
          <Pressable testID="sos-close" onPress={close} style={s.close}><Text style={s.closeText}>{t('common.close')}</Text></Pressable>
        </LinearGradient>
      </Animated.View>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay },
  panel: { marginTop: -OVERHANG, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, boxShadow: [{ offsetX: 0, offsetY: 16, blurRadius: 36, color: 'rgba(138,0,0,0.35)' }] },
  sheet: { borderBottomLeftRadius: 28, borderBottomRightRadius: 28, paddingHorizontal: 22, paddingBottom: 12, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 6 }, headText: { flex: 1, gap: 2 },
  badge: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.whiteGlass, alignItems: 'center', justifyContent: 'center' }, badgeIcon: { fontSize: 26 },
  title: { fontSize: 20, fontWeight: '800', color: colors.surface }, body: { fontSize: 14, lineHeight: 20, color: colors.surface, opacity: 0.85 },
  line: { minHeight: 56, borderRadius: 16, backgroundColor: colors.whiteGlass, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  urgent: { backgroundColor: colors.surface },
  lineIcon: { fontSize: 22 }, lineName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.surface },
  lineNumber: { fontSize: 20, fontWeight: '800', color: colors.surface, letterSpacing: 0.5 }, urgentText: { color: colors.onError },
  close: { minHeight: 48, alignItems: 'center', justifyContent: 'center' }, closeText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
});
