// The Discover button in the middle of the dock. Tap: Discover. Hold: the button lifts off the dock and hovers while a red
// siren rises above it. Let go where it is and One AI opens (the hold it always had); drag it onto the siren and the
// emergency helplines open. Reduce Motion: no hover drift or siren pulse; the lift and the drag stay.
import { useEffect, useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTranslation } from 'react-i18next'; // not '../i18n': that index imports this file (first-run.tsx)
import { Text } from '../ui/text';
import { colors } from '../theme';
import { haptic } from '../haptics';
import { useMotionAllowed } from '../motion';
import { duration, reEasing, reSpring } from '../motion-tokens';
import { EmergencyHelplines } from './emergency-helplines';

const HOLD_MS = 420; // a press this long lifts the button (the One AI hold, unchanged)
const RISE = 118;    // the siren's centre sits this far above the button's
const CATCH = 46;    // letting go this close to the siren's centre opens the helplines
const STILL = 14;    // letting go this close to where it lifted counts as "where it is": One AI
const SIREN = 64;

// The "1" spans 0–48 of its box, but its weight is the upright on the right (26–48), so centring the outline leaves it
// looking pushed right. The box runs on to 62, putting its middle between the outline's and the upright's: in a round
// badge the "1" then looks centred.
export function OneGlyph({ size = 36 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return <Svg width={size * 62 / 80} height={size} viewBox="0 0 62 80"><Defs><LinearGradient id={`one-face-${id}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.electricLime} /><Stop offset="1" stopColor={colors.lime} /></LinearGradient><LinearGradient id={`one-fold-${id}`}><Stop offset="0" stopColor={colors.electricLime} /><Stop offset="1" stopColor={colors.forest} /></LinearGradient></Defs><Path d="M26 0 L0 25 L26 25 Z" fill={`url(#one-fold-${id})`} /><Path d="M26 0 H48 V80 H26 Z" fill={`url(#one-face-${id})`} /></Svg>;
}
export function OneButton({ onDiscover, onAssistant, selected }: { onDiscover: () => void; onAssistant: () => void; selected: boolean }) {
  const motion = useMotionAllowed(); const { t } = useTranslation(); const [sos, setSos] = useState(false);
  const glow = useSharedValue(0);   // halo: breathes while Discover is open, flashes on a tap
  const press = useSharedValue(0);  // finger down
  const lift = useSharedValue(0);   // 0 docked, 1 lifted; the siren comes and goes with it
  const drift = useSharedValue(0);  // the hover float while lifted
  const ring = useSharedValue(0);   // the siren's pulse
  const dx = useSharedValue(0); const dy = useSharedValue(0); // drag offset from the dock
  const over = useSharedValue(0);   // 1 while the button sits over the siren
  const inside = useSharedValue(false);
  useEffect(() => {
    if (!motion || !selected) { glow.value = 0; return; }
    glow.value = withRepeat(withTiming(1, { duration: duration.story }), -1, true);
    return () => cancelAnimation(glow);
  }, [motion, selected, glow]);

  const flash = () => { if (motion) glow.set(withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 600 }))); haptic.select(); };
  const discover = () => { flash(); onDiscover(); };
  const assistant = () => { flash(); onAssistant(); };
  const emergency = () => { haptic.warning(); setSos(true); };

  const tap = Gesture.Tap().maxDuration(HOLD_MS).onEnd((_e, success) => { if (success) scheduleOnRN(discover); });
  const drag = Gesture.Pan().activateAfterLongPress(HOLD_MS)
    .onBegin(() => { press.value = withSpring(1, reSpring.press); })
    .onStart(() => {
      lift.value = withSpring(1, reSpring.bouncy);
      if (motion) {
        drift.value = withRepeat(withTiming(1, { duration: 900, easing: reEasing.standard }), -1, true);
        ring.value = withRepeat(withTiming(1, { duration: duration.story }), -1);
      }
      scheduleOnRN(haptic.select);
    })
    .onUpdate(e => {
      dx.value = e.translationX; dy.value = e.translationY;
      const near = Math.hypot(e.translationX, e.translationY + RISE) < CATCH;
      if (near !== inside.value) { inside.value = near; over.value = withSpring(near ? 1 : 0, reSpring.press); scheduleOnRN(haptic.tick); }
    })
    .onEnd(e => {
      if (inside.value) {
        // Settle into the siren for a beat, then fly home behind the opening pop-up.
        const settle = (to: number) => withSequence(withSpring(to, reSpring.press), withDelay(260, withSpring(0, reSpring.snappy)));
        dx.value = settle(0); dy.value = settle(-RISE);
        lift.value = withDelay(320, withSpring(0, reSpring.snappy)); over.value = withDelay(320, withSpring(0, reSpring.snappy));
        scheduleOnRN(emergency);
      } else if (Math.hypot(e.translationX, e.translationY) < STILL) scheduleOnRN(assistant);
    })
    .onFinalize(() => {
      press.value = withSpring(0, reSpring.press); drift.value = withTiming(0, { duration: duration.quick }); ring.value = 0;
      if (!inside.value) { dx.value = withSpring(0, reSpring.snappy); dy.value = withSpring(0, reSpring.snappy); lift.value = withSpring(0, reSpring.snappy); }
      inside.value = false;
    });

  const halo = useAnimatedStyle(() => ({ opacity: (0.08 + 0.42 * glow.value) * (1 - lift.value), transform: [{ scale: 1 + 0.32 * glow.value }] }));
  // Lifted: a little above the dock, bigger, drifting. Over the siren it drops to the circle's centre and shrinks to fit.
  const float = useAnimatedStyle(() => ({ transform: [
    { translateX: dx.value },
    { translateY: dy.value + lift.value * (1 - over.value) * (drift.value * 4 - 14) },
    { scale: 1 + 0.14 * lift.value - 0.16 * over.value - (motion ? 0.1 * press.value * (1 - lift.value) : 0) },
  ] }));
  const shadow = useAnimatedStyle(() => ({ opacity: lift.value }));
  const siren = useAnimatedStyle(() => ({ opacity: lift.value, transform: [{ translateY: 20 * (1 - lift.value) }, { scale: 0.6 + 0.4 * lift.value + 0.16 * over.value }] }));
  const pulse = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - ring.value), transform: [{ scale: 1 + 0.7 * ring.value }] }));
  const hint = useAnimatedStyle(() => ({ opacity: lift.value * (1 - over.value) }));

  return <View style={styles.wrap}>
    <Animated.View pointerEvents="none" style={[styles.halo, halo]} />
    <Animated.View pointerEvents="none" style={[styles.hint, hint]}><View style={styles.hintPill}><Text style={styles.hintText}>{t('sos.dropHere')}</Text></View></Animated.View>
    <Animated.View pointerEvents="none" style={[styles.siren, siren]}>
      <Animated.View style={[styles.sirenPulse, pulse]} />
      <View style={styles.sirenFace}><Text style={styles.sirenIcon}>🚨</Text></View>
    </Animated.View>
    <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
      <Animated.View testID="tab-reels" accessible accessibilityRole="button" accessibilityLabel={t('nav.discoverButton')} accessibilityHint={t('nav.discoverHint')}
        accessibilityActions={[{ name: 'activate' }, { name: 'longpress' }, { name: 'sos', label: t('sos.open') }]}
        onAccessibilityAction={e => ({ longpress: assistant, sos: emergency }[e.nativeEvent.actionName] ?? discover)()}
        style={[styles.button, float]}>
        <Animated.View pointerEvents="none" style={[styles.shadow, shadow]} />
        <OneGlyph />
      </Animated.View>
    </GestureDetector>
    <EmergencyHelplines visible={sos} onClose={() => setSos(false)} />
  </View>;
}
const styles = StyleSheet.create({
  wrap: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' }, halo: { position: 'absolute', width: 58, height: 58, borderRadius: 29, backgroundColor: colors.lime },
  button: { width: 54, height: 54, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary, borderWidth: 1, borderColor: colors.forest },
  shadow: { ...StyleSheet.absoluteFill, borderRadius: 24, boxShadow: [{ offsetX: 0, offsetY: 14, blurRadius: 24, color: 'rgba(16,59,43,0.35)' }] },
  siren: { position: 'absolute', top: (58 - SIREN) / 2 - RISE, width: SIREN, height: SIREN },
  sirenPulse: { ...StyleSheet.absoluteFill, borderRadius: SIREN / 2, backgroundColor: colors.onError },
  sirenFace: { flex: 1, borderRadius: SIREN / 2, borderWidth: 5, borderColor: colors.surface, backgroundColor: colors.onError, alignItems: 'center', justifyContent: 'center', boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 22, color: 'rgba(204,0,0,0.35)' }] },
  sirenIcon: { fontSize: 28 },
  hint: { position: 'absolute', top: (58 - SIREN) / 2 - RISE - 40, left: -80, right: -80, alignItems: 'center' },
  hintPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.forestDeep }, hintText: { fontSize: 12, fontWeight: '700', color: colors.surface },
});
