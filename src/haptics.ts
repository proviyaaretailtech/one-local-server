// Haptic vocabulary — one name per *meaning*, so the same moment feels the same on every screen and
// the whole app can be retuned here. Use these instead of calling expo-haptics directly.
//   tap      : any ordinary button or link
//   select   : choosing one of several (chips, tabs, radio)
//   tick     : a detent while dragging/holding (throttled, safe to call every frame)
//   add      : something went INTO the cart/list (a little weight)
//   remove   : something came out (lighter than add)
//   limit    : hit a wall (max stock, min quantity, end of a scrubber)
//   commit   : a deliberate, hard-to-undo action finished (hold-to-cancel, slide-to-pay)
//   success / warning / error : the outcome of a request
// Web has no haptics: expo-haptics no-ops there, and every call swallows errors so a missing motor
// never breaks a tap.
import * as Haptics from 'expo-haptics';

// (Every expo-haptics call in app code is timestamped by src/native/expo-haptics.ts, so the app-wide
// press feedback can tell when a handler already chose its own haptic.)
const run = (p: Promise<void>) => { void p.catch(() => {}); };

// Ticks fire from gestures many times a second; the motor needs a gap or they blur into a buzz.
const TICK_GAP_MS = 45;
let lastTick = 0;

export const haptic = {
  tap: () => run(Haptics.selectionAsync()),
  select: () => run(Haptics.selectionAsync()),
  tick: () => { const now = Date.now(); if (now - lastTick < TICK_GAP_MS) return; lastTick = now; run(Haptics.selectionAsync()); },
  add: () => run(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  remove: () => run(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
  limit: () => run(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
  commit: () => run(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success: () => run(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
} as const;

export type HapticName = keyof typeof haptic;
