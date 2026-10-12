// When the last haptic fired, from anywhere in app code. Written by src/native/expo-haptics.ts, read by
// src/native/react-native.tsx: a button whose handler already buzzed (add, success…) skips the generic tap.
let last = 0;
export const markHaptic = () => { last = Date.now(); };
export const lastHapticAt = () => last;
