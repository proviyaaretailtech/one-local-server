// Motion tokens — one vocabulary for every animation in the app, so timing feels consistent and
// can be tuned in one place. Use these instead of raw numbers.
//   duration.* : milliseconds      easing.* : curves (Animated / Reanimated both accept Easing)
//   spring.*   : Animated.spring configs (friction/tension)      stagger : per-item delay in lists
// Everything must also respect Reduce Motion (useMotionAllowed in src/motion.tsx).
import { Easing } from 'react-native';
import { Easing as ReEasing } from 'react-native-reanimated';

export const duration = {
  instant: 90,    // press feedback, toggles
  quick: 160,     // small state changes (chips, checkmarks)
  base: 240,      // most transitions (sheets, cards appearing)
  gentle: 360,    // larger surfaces, page-level fades
  slow: 520,      // hero reveals, intro text
  story: 1200,    // ambient loops (glows, pulses)
} as const;

export const easing = {
  standard: Easing.bezier(0.2, 0, 0, 1),     // default for moving things
  enter: Easing.bezier(0, 0, 0, 1),          // things arriving
  exit: Easing.bezier(0.3, 0, 1, 1),         // things leaving
  emphasized: Easing.bezier(0.2, 0, 0, 1.25) // a little overshoot for celebratory moments
} as const;

export const spring = {
  press: { friction: 7, tension: 260 },      // tap down/up — fast, no wobble
  snappy: { friction: 8, tension: 90 },      // cards, sheets
  bouncy: { friction: 5, tension: 70 },      // celebratory pops (mascot, success)
  gentle: { friction: 9, tension: 50 },      // large surfaces
} as const;

export const stagger = 50;                   // ms between items in a list reveal
export const pressScale = 0.96;              // how far a tappable card sinks when pressed

// Reanimated curves: the same shapes as `easing`, built with Reanimated's Easing so they run on the UI
// thread. React Native's Easing is a plain JS function; handing it to withTiming crashes the app
// ("Tried to synchronously call a Remote Function") on Reanimated 4.
export const reEasing = {
  standard: ReEasing.bezier(0.2, 0, 0, 1),
  enter: ReEasing.bezier(0, 0, 0, 1),
  exit: ReEasing.bezier(0.3, 0, 1, 1),
  emphasized: ReEasing.bezier(0.2, 0, 0, 1.25),
} as const;

// Reanimated springs (damping/stiffness/mass) for gesture-driven and worklet animations. Same feel as
// `spring` above, expressed in the physics Reanimated uses.
export const reSpring = {
  press: { damping: 18, stiffness: 420, mass: 0.6 },   // tap down/up
  snappy: { damping: 20, stiffness: 260, mass: 0.8 },  // thumbs returning, digits settling
  bouncy: { damping: 9, stiffness: 220, mass: 0.7 },   // hearts, pops
  gentle: { damping: 22, stiffness: 140, mass: 1 },    // large surfaces
} as const;
