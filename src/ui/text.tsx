// The app's text, in Poppins. Every screen imports Text and TextInput from here instead of 'react-native'.
//
// A custom font in React Native is one file per weight, so the weight a style asks for (fontWeight: '800') is turned into the
// matching family (Poppins_800ExtraBold) and fontWeight is set back to normal, otherwise Android would thicken it a second time.
// Poppins carries Devanagari, so Hindi uses the same face. Until the fonts have loaded (or if they fail to) the system font is
// used, so text is never missing. Other styles (size, colour, lineHeight...) pass through untouched.
import type { ComponentPropsWithRef } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput } from 'react-native';

let ready = false;
/** Called by the root layout once the Poppins files are available. */
export const setPoppinsReady = (value: boolean) => { ready = value; };

const FAMILY = { 400: 'Poppins_400Regular', 500: 'Poppins_500Medium', 600: 'Poppins_600SemiBold', 700: 'Poppins_700Bold', 800: 'Poppins_800ExtraBold' } as const;

/** The Poppins family for a style's fontWeight ('normal', 'bold', '100'..'900', or a number). */
export function poppinsFamily(weight: unknown): string {
  const w = weight === 'bold' ? 700 : weight === 'normal' || weight === undefined || weight === null ? 400 : Number(weight);
  if (!Number.isFinite(w) || w <= 400) return FAMILY[400];
  if (w <= 500) return FAMILY[500];
  if (w <= 600) return FAMILY[600];
  if (w <= 700) return FAMILY[700];
  return FAMILY[800];
}

const withFont = <S,>(style: S) => (ready ? [style, { fontFamily: poppinsFamily((StyleSheet.flatten(style as never) as { fontWeight?: unknown } | undefined)?.fontWeight), fontWeight: 'normal' as const }] : style);

export function Text(props: ComponentPropsWithRef<typeof RNText>) {
  return <RNText {...props} style={withFont(props.style) as never} />;
}
export function TextInput(props: ComponentPropsWithRef<typeof RNTextInput>) {
  return <RNTextInput {...props} style={withFont(props.style) as never} />;
}
// So `useRef<TextInput>()` and `Text` as a type keep working in the files that use them.
export type Text = RNText;
export type TextInput = RNTextInput;
