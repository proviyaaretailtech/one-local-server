// Responsive frame. Phones and portrait tablets use the whole screen. Wider screens (landscape iPad,
// laptop, desktop web) show the app as a wide centred column (up to 1120px) on a black/neon backdrop,
// with product grids that gain columns as the column widens.
// Components size themselves with useAppDimensions() (the column), never the raw window width.
import { createContext, useContext } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from './theme';
import { safeLineHeight } from './i18n/typography';

export const MAX_APP_WIDTH = 1120;
const FRAME_FROM = MAX_APP_WIDTH + 40;

// Laptop and desktop browsers get a top menu bar instead of the phone's floating dock.
export const DESKTOP_FROM = 1000;
export function useIsDesktop() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_FROM;
}

const AppWidth = createContext<number | null>(null);

export function useAppDimensions() {
  const window = useWindowDimensions();
  const width = useContext(AppWidth);
  return { ...window, width: width ?? window.width };
}

/**
 * A line height for tight display text. English keeps the designed value; any other language gets the Devanagari-safe
 * minimum (1.35 x the font size), so marks above and below the line are not clipped.
 *   const lineHeight = useLineHeight();  <Text style={[styles.title, { lineHeight: lineHeight(26, 29) }]}>
 */
export function useLineHeight() {
  const { i18n } = useTranslation();
  const latin = (i18n.resolvedLanguage ?? i18n.language ?? 'en') === 'en';
  return (fontSize: number, wanted: number) => (latin ? wanted : safeLineHeight(fontSize, wanted));
}

// Columns for product grids: 3 on phones, 4 from small tablets, 5 and 6 on laptops and desktops.
export const gridColumns = (width: number) => (width >= 1000 ? 6 : width >= 800 ? 5 : width >= 600 ? 4 : 3);

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  if (width < FRAME_FROM) return <AppWidth.Provider value={width}>{children}</AppWidth.Provider>;
  return <AppWidth.Provider value={MAX_APP_WIDTH}>
    <View testID="app-frame" style={s.backdrop}>
      <View style={s.glowA} /><View style={s.glowB} />
      <View style={s.column}>{children}</View>
    </View>
  </AppWidth.Provider>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.splashInk, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'center', overflow: 'hidden' },
  glowA: { position: 'absolute', left: -200, top: -160, width: 520, height: 520, borderRadius: 260, backgroundColor: colors.lime, opacity: 0.08 },
  glowB: { position: 'absolute', right: -220, bottom: -200, width: 560, height: 560, borderRadius: 280, backgroundColor: colors.electricLime, opacity: 0.06 },
  column: { width: MAX_APP_WIDTH, overflow: 'hidden', backgroundColor: colors.surface, boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 60, color: 'rgba(179,244,0,0.12)' }] },
});
