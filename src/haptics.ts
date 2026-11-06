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
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// (Every expo-haptics call in app code is timestamped by src/native/expo-haptics.ts, so the app-wide
// press feedback can tell when a handler already chose its own haptic.)
const run = (p: Promise<void>) => { void p.catch(() => {}); };

// Ticks fire from gestures many times a second; the motor needs a gap or they blur into a buzz.
const TICK_GAP_MS = 45;
let lastTick = 0;

// Android plays the phone's own touch feedback (it follows the system setting and feels like a system button); there
// the selection, impact and notification calls drive the vibration motor directly.
const android = Platform.OS === 'android';
const system = (type: Haptics.AndroidHaptics) => run(Haptics.performAndroidHapticsAsync(type));
const { AndroidHaptics: A } = Haptics;

export const haptic = {
  tap: () => android ? system(A.Virtual_Key) : run(Haptics.selectionAsync()),
  select: () => android ? system(A.Segment_Tick) : run(Haptics.selectionAsync()),
  tick: () => { const now = Date.now(); if (now - lastTick < TICK_GAP_MS) return; lastTick = now; if (android) system(A.Segment_Frequent_Tick); else run(Haptics.selectionAsync()); },
  add: () => android ? system(A.Confirm) : run(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  remove: () => android ? system(A.Toggle_Off) : run(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
  limit: () => android ? system(A.Reject) : run(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
  commit: () => android ? system(A.Long_Press) : run(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success: () => android ? system(A.Confirm) : run(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => android ? system(A.Reject) : run(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => android ? system(A.Reject) : run(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
} as const;

