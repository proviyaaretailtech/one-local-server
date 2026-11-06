// The launch intro, on every cold start, as a Diwali night: six diyas round the OneLocal wordmark light it up. It starts
// at once on the deep night green (the native splash fades into it), with the wordmark unlit in the middle and six brass
// diyas rising round it at the even hours of a clock. From twelve o'clock round, each diya's flame catches and sends a
// run of light along a garland of gold dots to the next one, which catches in turn; and from each diya a rangoli lotus
// petal is drawn in fine glowing gold towards the wordmark, a bead of light running down it to charge the wordmark a step
// and leave a jewel where it lands. As the last one lands, "One" glows white and "Local" green, a halo of gold dots
// round the wordmark pulses out like light through a jali, the sparkles on the garlands twinkle and the intro fades into
// the app (a little over 3 s in all). Everything runs from one clock on the UI thread, so the app starting up behind it
// cannot make it stutter. Tap anywhere to skip. With Reduce Motion the lit frame shows briefly, then fades.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { BrandLogo } from './brand-logo';
import { colors, goldLineGlow } from '../theme';
import { useTranslation } from '../i18n';

const launch = globalThis as unknown as { __onecityIntroPlayed?: boolean; __onecityIntroShowing?: boolean };
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const COUNT = 6; // diyas, at the even hours: none at three or nine, where the wordmark reaches out
const BEADS = 9; // dots on a garland; the middle one is a sparkle

// The timeline, in milliseconds on the one clock.
const APPEAR = 320; // the unlit wordmark settling in
const RISE = 120; // the diyas rise in, one just after another
const RISE_GAP = 50;
const RISE_LEN = 420;
const FIRST = 560; // the first flame catches
const GAP = 200; // and each next one after this, as the garland's light reaches it
const IGNITE = 300;
const LEAD = 40; // the light sets off this long after its flame catches
const RUN = 120; // the light's run along a garland, dot by dot
const TRACE = 440; // a petal's outline drawn from its diya inwards
const INNER = 140; // its inner outline follows this long after
const STEP = 260; // the wordmark charging one step as a petal's bead lands
const LIT = FIRST + (COUNT - 1) * GAP + LEAD + TRACE; // the last bead lands: fully alight
const PULSE = 900; // the halo of dots pulsing out
const EXIT = LIT + 700;
const FADE = 520;
const TOTAL = EXIT + FADE;
const HOLD = 900; // Reduce Motion: how long the lit frame stays

const RATIO = 900 / 188;
const SPLIT = 415 / 900; // where "One" ends and "Local" begins in the wordmark
const BEAD = 5;
const SPARKLE = 9;

// How far (0 to 1) the clock is through a stretch of the timeline, and the curves the micro-interactions follow.
const phase = (t: number, start: number, length: number) => { 'worklet'; return Math.min(1, Math.max(0, (t - start) / length)); };
const easeOut = (p: number) => { 'worklet'; return 1 - (1 - p) ** 3; };
const easeInOut = (p: number) => { 'worklet'; return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2; };
// Past the mark and back: the pop.
const pop = (p: number) => { 'worklet'; return 1 + 2.6 * (p - 1) ** 3 + 1.6 * (p - 1) ** 2; };
// Up and back down again: a swell of light.
const bump = (p: number) => { 'worklet'; return Math.sin(Math.PI * p); };
const lit = (i: number) => { 'worklet'; return FIRST + i * GAP; };
const landing = (i: number) => { 'worklet'; return lit(i) + LEAD + TRACE; };
// How charged the wordmark is: a sixth more as each bead lands.
const charge = (t: number) => { 'worklet'; let c = 0; for (let i = 0; i < COUNT; i++) c += pop(phase(t, landing(i), STEP)); return Math.min(1, c / COUNT); };
// The gold's brightness: steady once drawn, flaring once as the wordmark comes fully alight.
const gleam = (t: number) => { 'worklet'; return Math.min(1, 0.62 + 0.38 * bump(phase(t, LIT, 760))); };

type Pt = [number, number];
const point = (p: Pt) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
// A cubic curve from a, pulled towards b then c, to d: where it is at u (0 to 1), and its length (summed over short
// straight steps, so a stroke can be drawn along it).
function curve(a: Pt, b: Pt, c: Pt, d: Pt) {
  const at = (u: number): Pt => { const v = 1 - u; return [v ** 3 * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u ** 3 * d[0], v ** 3 * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u ** 3 * d[1]]; };
  let length = 0; let last = a;
  for (let i = 1; i <= 32; i++) { const p = at(i / 32); length += Math.hypot(p[0] - last[0], p[1] - last[1]); last = p; }
  return { d: `M${point(a)} C${point(b)} ${point(c)} ${point(d)}`, length, at };
}

// The rangoli, in the stage's points. For each diya: a lotus petal pointing at it (its two sides drawn from the tip in to
// the round base, an inner petal inside it, and its translucent body), the bead's way down its middle, and a garland of
// dots bowing outwards on to the next diya with a sparkle at its crest.
function rangoli(middle: number, radius: number, diya: number, base: number, tip: number) {
  const petals = []; const garlands = [];
  const length = tip - base; const wide = length * 0.3;
  for (let i = 0; i < COUNT; i++) {
    const angle = i * Math.PI / 3; const u: Pt = [Math.sin(angle), -Math.cos(angle)]; const v: Pt = [-u[1], u[0]];
    // A point `s` out along the petal from its base and `w` to its side.
    const at = (s: number, w: number): Pt => [middle + u[0] * (base + s) + v[0] * w, middle + u[1] * (base + s) + v[1] * w];
    // One side of a teardrop: from its point, swelling out and coming round to its base square on (its pull points too).
    const pulls = (from: number, size: number, half: number, s: number): Pt[] => [at(from + size * 0.5, s * half * 0.95), at(from - size * 0.02, s * half * 1.45)];
    const side = (from: number, size: number, half: number, s: number) => { const [b, c] = pulls(from, size, half, s); return curve(at(from + size, 0), b, c, at(from, 0)); };
    const outer = [side(0, length, wide, 1), side(0, length, wide, -1)];
    const inner = [side(length * 0.14, length * 0.62, wide * 0.55, 1), side(length * 0.14, length * 0.62, wide * 0.55, -1)];
    const [rb, rc] = pulls(0, length, wide, 1); const [lb, lc] = pulls(0, length, wide, -1); const tipAt = at(length, 0); const baseAt = at(0, 0);
    const body = `M${point(tipAt)} C${point(rb)} ${point(rc)} ${point(baseAt)} C${point(lc)} ${point(lb)} ${point(tipAt)} Z`;
    petals.push({ index: i, outer, inner, body, from: tipAt, to: baseAt });
    // Clear of both diyas, bowing out through a point beyond the ring.
    const clear = diya * 0.78 / radius; const a0 = angle + clear; const a1 = angle + Math.PI / 3 - clear; const crest = angle + Math.PI / 6;
    const pa: Pt = [middle + Math.sin(a0) * radius, middle - Math.cos(a0) * radius];
    const pb: Pt = [middle + Math.sin(a1) * radius, middle - Math.cos(a1) * radius];
    const q: Pt = [middle + Math.sin(crest) * radius * 1.22, middle - Math.cos(crest) * radius * 1.22];
    const arc = curve(pa, [pa[0] + (q[0] - pa[0]) * 2 / 3, pa[1] + (q[1] - pa[1]) * 2 / 3], [pb[0] + (q[0] - pb[0]) * 2 / 3, pb[1] + (q[1] - pb[1]) * 2 / 3], pb);
    const dots = Array.from({ length: BEADS }, (_, j) => { const f = (j + 0.5) / BEADS; return { f, at: arc.at(f), big: j % 2 === 0 }; });
    garlands.push({ index: i, dots, crest: [arc.at(0.5)[0] + Math.sin(crest) * diya * 0.12, arc.at(0.5)[1] - Math.cos(crest) * diya * 0.12] as Pt });
  }
  return { petals, garlands };
}

// A halo of fine gold dots round the wordmark, like light through a carved jali: rows of dots on widening ovals, largest
// near the wordmark and fading to nothing outwards, none on the wordmark itself. One path, so it costs one shape to draw.
function jali(middle: number, k: number, hw: number, hh: number) {
  let d = ''; const step = 6.5 * k; const from = 22 * k; const to = 76 * k; const stretch = 2;
  for (let e = from, row = 0; e <= to; e += step, row++) {
    const around = Math.PI * (3 * (stretch * e + e) - Math.sqrt((3 * stretch * e + e) * (stretch * e + 3 * e)));
    const n = Math.round(around / step); const size = 1.45 * k * (1 - (e - from) / (to - from)) ** 1.15;
    if (size < 0.25) continue;
    for (let j = 0; j < n; j++) {
      const a = (j + (row % 2) / 2) * 2 * Math.PI / n; const x = Math.cos(a) * stretch * e; const y = Math.sin(a) * e;
      if ((x / hw) ** 2 + (y / hh) ** 2 < 1) continue;
      d += `M${(middle + x - size).toFixed(1)},${(middle + y).toFixed(1)}a${size.toFixed(2)},${size.toFixed(2)} 0 1,0 ${(2 * size).toFixed(2)},0a${size.toFixed(2)},${size.toFixed(2)} 0 1,0 ${(-2 * size).toFixed(2)},0`;
    }
  }
  return d;
}

const hideSplash = () => { void SplashScreen.hideAsync().catch(() => {}); };
// Keep the native splash up until the intro's first frame is ready to take over, then fade it into the intro.
void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 280 });

export function IntroSplash() {
  const [visible, setVisible] = useState(!launch.__onecityIntroPlayed);
  const { t } = useTranslation(); // safe here: I18nProvider holds the first render until the saved language is loaded
  const { width, height } = useWindowDimensions();
  const clock = useSharedValue(0); const leave = useSharedValue(0);
  const started = useRef(false);

  const done = useCallback(() => { launch.__onecityIntroShowing = false; setVisible(false); }, []);
  // Asks the OS about Reduce Motion directly, as the app-wide answer may not be in yet this early.
  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    const end = (finished?: boolean) => { 'worklet'; if (finished) scheduleOnRN(done); };
    void AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then(reduce => {
      if (!reduce) { clock.value = withTiming(TOTAL, { duration: TOTAL, easing: Easing.linear }, end); return; }
      clock.value = EXIT;
      clock.value = withDelay(HOLD, withTiming(TOTAL, { duration: FADE, easing: Easing.linear }, end));
    });
  }, [clock, done]);
  // Once the intro has laid out, the native splash fades away over it.
  const shown = useCallback(() => requestAnimationFrame(hideSplash), []);
  const skip = () => {
    cancelAnimation(clock);
    leave.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }, finished => { if (finished) scheduleOnRN(done); });
  };

  useEffect(() => {
    if (!visible) { hideSplash(); return; }
    launch.__onecityIntroPlayed = true;
    // Read by the pop-up host so no pop-up opens over the intro.
    launch.__onecityIntroShowing = true;
    start();
    // Should the intro never lay out, the native splash still goes.
    const unblock = setTimeout(hideSplash, 1000);
    return () => clearTimeout(unblock);
  }, [visible, start]);

  const screen = useAnimatedStyle(() => ({ opacity: (1 - easeInOut(phase(clock.value, EXIT, FADE))) * (1 - leave.value) }));
  // Warm light behind the wordmark, brightening as it charges.
  const glowStyle = useAnimatedStyle(() => {
    const t = clock.value;
    return { opacity: easeOut(phase(t, 0, 600)) * Math.min(1, 0.3 + 0.5 * charge(t) + 0.3 * bump(phase(t, LIT, 700))) };
  });
  // The halo of dots: faint, warming as each bead lands, and brightest as the wordmark comes fully alight.
  const haloStyle = useAnimatedStyle(() => {
    const t = clock.value; let kick = 0;
    for (let i = 0; i < COUNT; i++) kick += bump(phase(t, landing(i), 360));
    return { opacity: Math.min(0.85, 0.08 * easeOut(phase(t, 0, 600)) + 0.3 * charge(t) + 0.12 * Math.min(1, kick) + 0.4 * bump(phase(t, LIT - 60, PULSE))), transform: [{ scale: 0.96 + 0.04 * easeOut(phase(t, LIT - 60, PULSE)) }] };
  });
  // And a copy of it pulsing outwards past the diyas, fading as it goes.
  const pulseStyle = useAnimatedStyle(() => {
    const p = phase(clock.value, LIT - 60, PULSE);
    return { opacity: p > 0 ? 0.7 * (1 - easeOut(p)) : 0, transform: [{ scale: 1 + 0.6 * easeOut(p) }] };
  });

  if (!visible) return null;
  // The diyas fit the screen with room to spare; at the even hours they leave the wordmark its full width.
  const k = Math.min(1, (width - 40) / 352);
  const radius = 140 * k; const diya = 38 * k;
  const logoWidth = Math.min(220, 2 * radius * Math.sin(Math.PI / 3) - diya * 0.6); const logoHeight = logoWidth / RATIO;
  const stage = 2 * (radius * 1.26 + diya); const middle = stage / 2;
  const pattern = rangoli(middle, radius, diya, 64 * k, 106 * k);
  const halo = jali(middle, k, logoWidth / 2 + 10 * k, logoHeight / 2 + 10 * k);
  const glow = stage * 0.9;
  return <Animated.View testID="intro-splash" accessibilityLabel={t('shell.introLoading')} onLayout={shown} style={[s.screen, screen]}>
    <StatusBar style="light" />
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs><RadialGradient id="intro-night" cx="50%" cy="50%" r="62%"><Stop offset="0" stopColor={colors.diwaliGreen} /><Stop offset="0.6" stopColor={colors.diwaliNight} /><Stop offset="1" stopColor={colors.diwaliNight} /></RadialGradient></Defs>
      <Ellipse cx={width / 2} cy={height / 2} rx={width} ry={height} fill="url(#intro-night)" />
    </Svg>
    <View style={{ width: stage, height: stage }}>
      <Animated.View style={[s.layer, { left: middle - glow / 2, top: middle - glow / 2 }, glowStyle]}>
        <Svg width={glow} height={glow}>
          <Defs><RadialGradient id="intro-glow" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={colors.gold} stopOpacity={0.28} /><Stop offset="0.45" stopColor={colors.diyaFlame} stopOpacity={0.09} /><Stop offset="1" stopColor={colors.diyaFlame} stopOpacity={0} /></RadialGradient></Defs>
          <Circle cx={glow / 2} cy={glow / 2} r={glow / 2} fill="url(#intro-glow)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[s.layer, pulseStyle]}><Svg width={stage} height={stage}><Path d={halo} fill={colors.gold} /></Svg></Animated.View>
      <Animated.View style={[s.layer, haloStyle]}><Svg width={stage} height={stage}><Path d={halo} fill={colors.gold} /></Svg></Animated.View>
      {/* The rangoli's gold, with a soft glow of its own. */}
      <View style={[s.layer, goldLineGlow]}>
        <Svg width={stage} height={stage}>
          {pattern.petals.map(p => <Body key={`b${p.index}`} d={p.body} start={landing(p.index) - 120} clock={clock} />)}
          {pattern.petals.map(p => p.outer.map((c, n) => <Trace key={`o${p.index}${n}`} d={c.d} length={c.length} start={lit(p.index) + LEAD} duration={TRACE} width={1.2} clock={clock} />))}
          {pattern.petals.map(p => p.inner.map((c, n) => <Trace key={`i${p.index}${n}`} d={c.d} length={c.length} start={lit(p.index) + LEAD + INNER} duration={TRACE - INNER} width={0.8} clock={clock} />))}
          {pattern.garlands.map(g => g.dots.map((b, j) => j === (BEADS - 1) / 2 ? null : <Dot key={`g${g.index}${j}`} at={b.at} size={(b.big ? 1.7 : 1.1) * k} start={lit(g.index) + LEAD + RUN * b.f} clock={clock} />))}
          {/* Where each bead lands it leaves a jewel of gold. */}
          {pattern.petals.map(p => <Dot key={`j${p.index}`} at={p.to} size={2.4 * k} start={landing(p.index) - 60} clock={clock} />)}
        </Svg>
      </View>
      {pattern.garlands.map(g => <Sparkle key={g.index} index={g.index} at={g.crest} size={SPARKLE * k} clock={clock} />)}
      {pattern.petals.map(p => <Bead key={p.index} index={p.index} from={p.from} to={p.to} clock={clock} />)}
      {pattern.petals.map(p => { const angle = p.index * Math.PI / 3;
        return <Diya key={p.index} index={p.index} left={middle + Math.sin(angle) * radius - diya / 2} top={middle - Math.cos(angle) * radius - diya * 1.25 * 0.68} size={diya} clock={clock} />; })}
      <View style={[s.layer, { left: middle - logoWidth / 2, top: middle - logoHeight / 2 }]}>
        <Wordmark width={logoWidth} clock={clock} />
      </View>
    </View>
    <Pressable style={StyleSheet.absoluteFill} onPress={skip} accessibilityRole="button" />
  </Animated.View>;
}

// One line of the rangoli's gold, drawn along its length from where it starts.
function Trace({ d, length, start, duration, width, clock }: { d: string; length: number; start: number; duration: number; width: number; clock: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    const t = clock.value; const p = easeInOut(phase(t, start, duration));
    return { strokeDashoffset: length * (1 - p), strokeOpacity: p > 0 ? gleam(t) : 0 };
  });
  return <AnimatedPath d={d} fill="none" stroke={colors.gold} strokeWidth={width} strokeLinecap="round" strokeDasharray={[length, length]} animatedProps={props} />;
}

// A petal's body: a faint wash of gold filling it once its outline is drawn.
function Body({ d, start, clock }: { d: string; start: number; clock: SharedValue<number> }) {
  const props = useAnimatedProps(() => { const t = clock.value; return { fillOpacity: 0.09 * easeOut(phase(t, start, 420)) + 0.06 * bump(phase(t, LIT, 760)) }; });
  return <AnimatedPath d={d} fill={colors.gold} animatedProps={props} />;
}

// A gold dot (on a garland, or a jewel), popping in as the light reaches it.
function Dot({ at, size, start, clock }: { at: Pt; size: number; start: number; clock: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ r: size * pop(phase(clock.value, start, 260)), fillOpacity: gleam(clock.value) }));
  return <AnimatedCircle cx={at[0]} cy={at[1]} fill={colors.gold} animatedProps={props} />;
}

// The four-pointed sparkle at a garland's crest: it opens as the light passes, and twinkles once as the wordmark lights.
function Sparkle({ index, at, size, clock }: { index: number; at: Pt; size: number; clock: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = clock.value; const open = pop(phase(t, lit(index) + LEAD + RUN / 2, 320)); const twinkle = bump(phase(t, LIT + index * 40, 520));
    return { opacity: Math.min(1, open * 1.5) * (0.75 + 0.25 * twinkle), transform: [{ scale: open * (1 + 0.45 * twinkle) }, { rotate: `${45 * twinkle}deg` }] };
  });
  const r = size / 2;
  return <Animated.View style={[s.layer, goldLineGlow, { left: at[0] - r, top: at[1] - r, width: size, height: size }, style]}>
    <Svg width={size} height={size}><Path d={`M${r},0 Q${r},${r} ${size},${r} Q${r},${r} ${r},${size} Q${r},${r} 0,${r} Q${r},${r} ${r},0 Z`} fill={colors.festiveTop} /></Svg>
  </Animated.View>;
}

// A bead of light running down the middle of a petal, from its diya into the wordmark, where it is taken in.
function Bead({ index, from, to, clock }: { index: number; from: Pt; to: Pt; clock: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const p = phase(clock.value, lit(index) + LEAD, TRACE); const e = easeInOut(p);
    return { opacity: Math.min(1, p * 6, (1 - p) * 6), transform: [{ translateX: from[0] + (to[0] - from[0]) * e - BEAD / 2 }, { translateY: from[1] + (to[1] - from[1]) * e - BEAD / 2 }] };
  });
  return <Animated.View style={[s.bead, style]} />;
}

// A brass diya, drawn on a 40 x 50 grid: it rises in unlit, then its flame catches with a soft pop and flickers on, its
// glow warming the brass.
function Diya({ index, left, top, size, clock }: { index: number; left: number; top: number; size: number; clock: SharedValue<number> }) {
  const height = size * 1.25; const glow = size * 2.4;
  const rise = useAnimatedStyle(() => {
    const p = easeOut(phase(clock.value, RISE + index * RISE_GAP, RISE_LEN));
    return { opacity: p, transform: [{ translateY: (1 - p) * 10 }] };
  });
  const brass = useAnimatedStyle(() => ({ opacity: 0.45 + 0.55 * easeOut(phase(clock.value, lit(index), IGNITE)) }));
  const flame = useAnimatedStyle(() => {
    const t = clock.value; const on = pop(phase(t, lit(index), IGNITE));
    const flicker = 0.06 * Math.sin(t * 0.021 + index * 1.7) + 0.035 * Math.sin(t * 0.047 + index);
    return { opacity: Math.min(1, on * 2), transform: [{ scaleX: on * (1 - flicker * 0.5) }, { scaleY: on * (1 + flicker) }] };
  });
  const halo = useAnimatedStyle(() => {
    const t = clock.value; const on = easeOut(phase(t, lit(index), IGNITE));
    return { opacity: on * (0.85 + 0.15 * Math.sin(t * 0.017 + index)), transform: [{ scale: 0.6 + 0.4 * on + 0.18 * bump(phase(t, lit(index), 620)) + 0.1 * bump(phase(t, LIT, 700)) }] };
  });
  return <Animated.View style={[s.layer, { left, top, width: size, height }, rise]}>
    <Animated.View style={[s.layer, { left: size / 2 - glow / 2, top: height * 0.34 - glow / 2 }, halo]}>
      <Svg width={glow} height={glow}>
        <Defs><RadialGradient id={`diya-halo-${index}`} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={colors.gold} stopOpacity={0.55} /><Stop offset="0.35" stopColor={colors.diyaFlame} stopOpacity={0.2} /><Stop offset="1" stopColor={colors.diyaFlame} stopOpacity={0} /></RadialGradient></Defs>
        <Circle cx={glow / 2} cy={glow / 2} r={glow / 2} fill={`url(#diya-halo-${index})`} />
      </Svg>
    </Animated.View>
    <Animated.View style={[s.layer, brass]}>
      <Svg width={size} height={height} viewBox="0 0 40 50">
        <Defs><LinearGradient id={`diya-brass-${index}`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={colors.gold} /><Stop offset="0.55" stopColor={colors.diyaBrass} /><Stop offset="1" stopColor={colors.diyaShade} /></LinearGradient></Defs>
        <Path d="M17.5 44.6 L22.5 44.6 L21.6 42 L18.4 42 Z" fill={colors.diyaShade} />
        <Path d="M3 27 C5 38 13 42.6 20 42.6 C27 42.6 35 38 37 27 Z" fill={`url(#diya-brass-${index})`} />
        <Ellipse cx="20" cy="27" rx="17" ry="3.2" fill={colors.diyaShade} />
        <Ellipse cx="20" cy="26.6" rx="15.4" ry="2.2" fill={colors.splashInk} fillOpacity={0.5} />
        <Circle cx="12.5" cy="33.5" r="0.9" fill={colors.festiveTop} /><Circle cx="20" cy="36.2" r="0.9" fill={colors.festiveTop} /><Circle cx="27.5" cy="33.5" r="0.9" fill={colors.festiveTop} />
        <Path d="M20 26.8 L20 24.2" stroke={colors.splashInk} strokeWidth={1} strokeLinecap="round" />
      </Svg>
    </Animated.View>
    {/* The flame grows and sways from the middle of the grid, just above the wick. */}
    <Animated.View style={[s.layer, { width: size, height }, flame]}>
      <Svg width={size} height={height} viewBox="0 0 40 50">
        <Defs><RadialGradient id={`diya-flame-${index}`} cx="50%" cy="78%" r="65%"><Stop offset="0" stopColor={colors.festiveSoft} /><Stop offset="0.45" stopColor={colors.gold} /><Stop offset="1" stopColor={colors.diyaFlame} /></RadialGradient></Defs>
        <Path d="M20 5 C23.5 10.5 26.5 15 25.8 19.4 C25.2 22.8 22.9 24.6 20 24.6 C17.1 24.6 14.8 22.8 14.2 19.4 C13.5 15 16.5 10.5 20 5 Z" fill={`url(#diya-flame-${index})`} />
        <Path d="M20 13 C21.6 16 22.6 18.4 22.2 20.4 C21.9 22 21 22.8 20 22.8 C19 22.8 18.1 22 17.8 20.4 C17.4 18.4 18.4 16 20 13 Z" fill={colors.festiveSoft} fillOpacity={0.85} />
      </Svg>
    </Animated.View>
  </Animated.View>;
}

// The wordmark: it settles in unlit, then charges, "One" in white and "Local" in its own green filling left to right.
function Wordmark({ width, clock }: { width: number; clock: SharedValue<number> }) {
  const height = width / RATIO; const split = width * SPLIT;
  const settle = useAnimatedStyle(() => {
    const t = clock.value; let kick = 0;
    for (let i = 0; i < COUNT; i++) kick += bump(phase(t, landing(i), 220));
    const appear = easeOut(phase(t, 0, APPEAR));
    return { opacity: appear, transform: [{ scale: (0.96 + 0.04 * appear) * (1 + 0.025 * Math.min(1, kick) + 0.06 * bump(phase(t, LIT, 520))) }] };
  });
  const fill = useAnimatedStyle(() => ({ width: width * charge(clock.value) }));
  return <Animated.View style={[{ width, height }, settle]}>
    <BrandLogo tone="dark" height={height} tint={colors.splashInk} style={s.layer} />
    <Animated.View style={[s.layer, s.clip, { height }, fill]}>
      <View style={[s.layer, s.clip, { width: split, height }]}><BrandLogo tone="dark" height={height} tint={colors.surface} /></View>
      <View style={[s.layer, s.clip, { left: split, width: width - split, height }]}><BrandLogo tone="dark" height={height} tint={colors.logoGreen} style={{ marginLeft: -split }} /></View>
    </Animated.View>
  </Animated.View>;
}

const s = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, zIndex: 1000, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.diwaliNight },
  layer: { position: 'absolute', left: 0, top: 0 },
  clip: { overflow: 'hidden' },
  bead: { position: 'absolute', left: 0, top: 0, width: BEAD, height: BEAD, borderRadius: BEAD / 2, backgroundColor: colors.festiveSoft, boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 8, color: colors.gold }] },
});
