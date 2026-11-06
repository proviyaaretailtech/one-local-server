// App code's `react-native` (metro.config.js points imports from app/ and src/ here; libraries keep the
// real one). Everything is re-exported untouched except the press components, which gain the app's
// touch feel on every button without each screen having to remember it:
//   - a selection haptic on press (and on long press), unless the handler already played its own
//     (add, success, warning…) — then that meaning wins and nothing doubles;
//   - Pressable also sinks a few pixels while held: small buttons ~4%, wide rows ~1.5%, so a full-width
//     card never lurches. Skipped under Reduce Motion, when disabled, or when the caller already sets
//     its own transform (Tap, animated cards).
// TouchableOpacity/Highlight keep their own visual feedback and only gain the haptic.
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import * as RN from 'react-native';
import type { GestureResponderEvent, PressableProps, PressableStateCallbackType, StyleProp, View, ViewStyle } from 'react-native';
import { haptic } from '../haptics';
import { motionAllowedNow } from '../motion';
import { webPressEase as webEase } from '../motion-tokens';
import { lastHapticAt } from './haptic-clock';

export * from 'react-native';
export default RN;
// Shadows react-native's deprecated lazy getter. Fast Refresh walks every export of this module in development, and reading
// that getter builds a NativeEventEmitter for a native module this app does not link, which throws on iOS at startup.
// The app does not use it (expo-notifications handles notifications).
export const PushNotificationIOS = undefined;

type Handler = ((e: GestureResponderEvent) => unknown) | null | undefined;
// Run the handler, then play the generic tap only if it did not buzz on its own.
function withHaptic(fn: Handler) {
  if (!fn) return fn;
  return (e: GestureResponderEvent) => { const at = Date.now(); const r = fn(e); if (lastHapticAt() < at) haptic.tap(); return r; };
}

const SINK_PX = 6; // how far the edges travel in, at most

export const Pressable = forwardRef<View, PressableProps>(function Pressable({ onPress, onLongPress, onPressIn, style, disabled, ...rest }, ref) {
  const node = useRef<View>(null);
  useImperativeHandle(ref, () => node.current as View);
  const [width, setWidth] = useState(0);
  // Reduce Motion is read at the press itself rather than subscribed to, so a trip to the background and back does
  // not re-render every button in the app.
  const pressIn = useCallback((e: GestureResponderEvent) => {
    if (motionAllowedNow() && !width) try { node.current?.measure((_x, _y, w) => { if (w) setWidth(w); }); } catch { /* not mounted */ }
    onPressIn?.(e);
  }, [width, onPressIn]);
  const styleFn = useCallback((state: PressableStateCallbackType) => {
    const own = typeof style === 'function' ? style(state) : style;
    if (!motionAllowedNow() || disabled || !state.pressed || !width) return webEase ? [own, webEase] : own;
    if (RN.StyleSheet.flatten(own)?.transform) return own;
    return [own, webEase, { transform: [{ scale: Math.max(0.96, 1 - SINK_PX / width) }] }] as StyleProp<ViewStyle>;
  }, [style, disabled, width]);
  return <RN.Pressable {...rest} ref={node} disabled={disabled} onPressIn={pressIn} style={styleFn}
    onPress={withHaptic(onPress) ?? undefined} onLongPress={withHaptic(onLongPress) ?? undefined} />;
});

type TouchableProps<P> = P & { onPress?: Handler; onLongPress?: Handler };
function hapticTouchable<P extends object, R>(Base: React.ComponentType<P>, name: string) {
  const C = forwardRef<R, TouchableProps<P>>(({ onPress, onLongPress, ...rest }, ref) =>
    <Base {...(rest as P)} ref={ref} onPress={withHaptic(onPress) ?? undefined} onLongPress={withHaptic(onLongPress) ?? undefined} />);
  C.displayName = name;
  return C as unknown as typeof Base;
}
export const TouchableOpacity = hapticTouchable(RN.TouchableOpacity as React.ComponentType<RN.TouchableOpacityProps>, 'TouchableOpacity') as typeof RN.TouchableOpacity;
export const TouchableHighlight = hapticTouchable(RN.TouchableHighlight as React.ComponentType<RN.TouchableHighlightProps>, 'TouchableHighlight') as typeof RN.TouchableHighlight;
export const TouchableWithoutFeedback = hapticTouchable(RN.TouchableWithoutFeedback as React.ComponentType<RN.TouchableWithoutFeedbackProps>, 'TouchableWithoutFeedback') as typeof RN.TouchableWithoutFeedback;
