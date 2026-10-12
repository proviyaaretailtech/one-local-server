// App code's `expo-haptics` (metro.config.js points imports from app/ and src/ here). Same API; each
// call is timestamped so app-wide press feedback never doubles a haptic a handler already played.
import * as Real from 'expo-haptics';
import { markHaptic } from './haptic-clock';

export { NotificationFeedbackType, ImpactFeedbackStyle, AndroidHaptics } from 'expo-haptics';
export const selectionAsync: typeof Real.selectionAsync = () => { markHaptic(); return Real.selectionAsync(); };
export const impactAsync: typeof Real.impactAsync = (...a) => { markHaptic(); return Real.impactAsync(...a); };
export const notificationAsync: typeof Real.notificationAsync = (...a) => { markHaptic(); return Real.notificationAsync(...a); };
export const performAndroidHapticsAsync: typeof Real.performAndroidHapticsAsync = (...a) => { markHaptic(); return Real.performAndroidHapticsAsync(...a); };
