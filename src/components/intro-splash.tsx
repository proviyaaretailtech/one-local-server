// First-launch intro, tuned to feel calm and expensive rather than busy:
//   1. a soft lime light blooms out of the black,
//   2. the neon "1" settles in (scale + fade, one gentle overshoot — no drop, no bounce),
//   3. "neCity" unfolds from behind the "1" while a light sweep glides across the lockup,
//   4. the tagline rises, then everything eases forward and dissolves into the app.
// Runs entirely on the UI thread (Reanimated), so the app loading behind it can't make it stutter.
// Plays once per launch (~1.9 s). With Reduce Motion it is a short, still fade.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming, interpolate, Extrapolation } from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useMotionAllowed } from '../motion';
import { BrandLogo } from './brand-logo';
import { colors } from '../theme';
import { useTranslation } from '../i18n';

const launch = globalThis as unknown as { __onecityIntroPlayed?: boolean };
const INK = '#050605';
const outExpo = Easing.bezier(0.16, 1, 0.3, 1);     // long, silky settle
const inOut = Easing.bezier(0.65, 0, 0.35, 1);
const overshoot = Easing.bezier(0.34, 1.36, 0.64, 1); // one soft overshoot, no wobble

// Keep the native splash (same ink colour) up until the intro's first frame, so there is no flash.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export function IntroSplash() {
  const [visible, setVisible] = useState(!launch.__onecityIntroPlayed);
  const { t } = useTranslation(); // safe here: I18nProvider holds the first render until the saved language is loaded
  const motion = useMotionAllowed();
  const bloom = useSharedValue(0);  // lime light
  const glyph = useSharedValue(0);  // the "1"
  const word = useSharedValue(0);   // wordmark unfold
  const sweep = useSharedValue(0);  // light band across the lockup
  const tag = useSharedValue(0);    // tagline
  const exit = useSharedValue(0);   // ease forward + dissolve
  // The animation starts once the logo image is drawn (on the web it is fetched), or after 1.2 s whatever happens.
  const [logoReady, setLogoReady] = useState(false);
  useEffect(() => { const id = setTimeout(() => setLogoReady(true), 1200); return () => clearTimeout(id); }, []);

  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
    if (!visible || !logoReady) return;
    launch.__onecityIntroPlayed = true;
    // Read by the pop-up host so no pop-up opens over the intro.
    (globalThis as { __onecityIntroShowing?: boolean }).__onecityIntroShowing = true;
    const done = () => { (globalThis as { __onecityIntroShowing?: boolean }).__onecityIntroShowing = false; setVisible(false); };
    if (!motion) {
      glyph.value = 1; word.value = 1; tag.value = 1; bloom.value = 0.6;
      exit.value = withDelay(650, withTiming(1, { duration: 260 }, f => { if (f) runOnJS(done)(); }));
      return;
    }
    bloom.value = withTiming(1, { duration: 900, easing: outExpo });
    glyph.value = withDelay(80, withTiming(1, { duration: 620, easing: overshoot }));
    word.value = withDelay(420, withTiming(1, { duration: 620, easing: outExpo }));
    sweep.value = withDelay(620, withTiming(1, { duration: 700, easing: inOut }));
    tag.value = withDelay(820, withTiming(1, { duration: 500, easing: outExpo }));
    exit.value = withDelay(1450, withSequence(withTiming(1, { duration: 450, easing: Easing.bezier(0.4, 0, 0.2, 1) }, f => { if (f) runOnJS(done)(); })));
  }, [visible, logoReady, motion, bloom, glyph, word, sweep, tag, exit]);

  const screen = useAnimatedStyle(() => ({ opacity: interpolate(exit.value, [0, 1], [1, 0]) }));
  const stage = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(exit.value, [0, 1], [1, 1.12]) }] }));
  const halo = useAnimatedStyle(() => ({
    opacity: interpolate(bloom.value, [0, 1], [0, 0.5]),
    transform: [{ scale: interpolate(bloom.value, [0, 1], [0.5, 1]) }],
  }));
  const one = useAnimatedStyle(() => ({
    opacity: interpolate(glyph.value, [0, 0.4], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(glyph.value, [0, 1], [0.82, 1]) }],
  }));
  const wordmark = useAnimatedStyle(() => ({
    opacity: word.value,
    transform: [{ translateX: interpolate(word.value, [0, 1], [-28, 0]) }],
  }));
  const band = useAnimatedStyle(() => ({
    opacity: interpolate(sweep.value, [0, 0.15, 0.85, 1], [0, 1, 1, 0]),
    transform: [{ translateX: interpolate(sweep.value, [0, 1], [-160, 320]) }, { skewX: '-18deg' }],
  }));
  const tagline = useAnimatedStyle(() => ({
    opacity: tag.value,
    transform: [{ translateY: interpolate(tag.value, [0, 1], [10, 0]) }],
  }));

  if (!visible) return null;
  return <Animated.View testID="intro-splash" accessibilityLabel={t('shell.introLoading')} style={[s.screen, screen]} pointerEvents="none">
    <StatusBar style="light" />
    <Animated.View style={[s.center, stage]}>
      <Animated.View style={[s.halo, halo]}>
        <Svg width={420} height={420}><Defs><RadialGradient id="introHalo" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={colors.lime} stopOpacity={0.9} /><Stop offset="0.35" stopColor={colors.lime} stopOpacity={0.35} /><Stop offset="1" stopColor={colors.lime} stopOpacity={0} />
        </RadialGradient></Defs><Rect width={420} height={420} fill="url(#introHalo)" /></Svg>
      </Animated.View>
      <View style={s.lockup}>
        <Animated.View style={one}><Animated.View style={wordmark}><BrandLogo tone="dark" height={64} onLoad={() => setLogoReady(true)} /></Animated.View></Animated.View>
        <Animated.View style={[s.band, band]} />
      </View>
      <Animated.Text style={[s.tagline, tagline]}>{t('shell.introTagline')}</Animated.Text>
    </Animated.View>
    <Animated.Text style={[s.made, tagline]}>{t('shell.introMade')}</Animated.Text>
  </Animated.View>;
}

const s = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, zIndex: 1000, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center' },
  halo: { position: 'absolute', top: -170, width: 420, height: 420 },
  lockup: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, overflow: 'hidden', paddingHorizontal: 6 },
  band: { position: 'absolute', top: -20, bottom: -20, left: 0, width: 46, backgroundColor: 'rgba(255,255,255,0.16)' },
  tagline: { color: colors.electricLime, fontSize: 11, fontWeight: '700', letterSpacing: 3.2, marginTop: 24 },
  made: { position: 'absolute', bottom: 58, color: 'rgba(255,255,255,0.42)', fontSize: 10, letterSpacing: 1.6 },
});
