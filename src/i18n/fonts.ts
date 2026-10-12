// Fonts a language needs, loaded with expo-font BEFORE the language is switched on (loader.ts awaits this), so
// the first Hindi screen never shows boxes (tofu) or jumps when a font arrives late.
//
// Today the app uses system fonts only, and every phone's system font already carries Devanagari (iOS:
// Devanagari Sangam MN / Kohinoor, Android: Noto Sans Devanagari), so no font has to be downloaded and the
// table below is empty. If a brand font is added to the theme, add its Devanagari companion here and it will
// be loaded on demand when Hindi is chosen:
//
//   hi: { NotoSansDevanagari: require('@/assets/fonts/NotoSansDevanagari-Regular.ttf') },
//
// Web (laptops, desktop browsers) has no such guarantee: app/+html.tsx puts a Devanagari-capable stack on the page
// (typography.ts).
import * as Font from 'expo-font';
import type { FontSource } from 'expo-font';

export const LOCALE_FONTS: Record<string, Record<string, FontSource>> = {
  hi: {},
};

export async function loadLocaleFonts(code: string): Promise<void> {
  const fonts = LOCALE_FONTS[code];
  if (!fonts || Object.keys(fonts).length === 0) return;
  await Font.loadAsync(fonts);
}
