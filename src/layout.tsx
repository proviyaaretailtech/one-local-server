// Responsive frame. Phones and portrait tablets use the whole screen. Wider screens (landscape iPad,
// laptop, desktop web) show the app as a centred column on a black/neon backdrop — with a brand
// panel on very wide screens — so every screen keeps its designed proportions.
// Components size themselves with useAppDimensions() (the column), never the raw window width.
import { createContext, useContext } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from './theme';
import { BrandLogo } from './components/brand-logo';
import { departmentName } from './departments';
import { safeLineHeight } from './i18n/typography';

export const MAX_APP_WIDTH = 820;
const FRAME_FROM = MAX_APP_WIDTH + 40;
const PANEL_FROM = 1280;
const INK = '#050605';

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

// Columns for product grids: 3 on phones, 4 from small tablets up.
export const gridColumns = (width: number) => (width >= 600 ? 4 : 3);

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions(); const { t } = useTranslation(); const lineHeight = useLineHeight();
  if (width < FRAME_FROM) return <AppWidth.Provider value={width}>{children}</AppWidth.Provider>;
  const panel = width >= PANEL_FROM;
  return <AppWidth.Provider value={MAX_APP_WIDTH}>
    <View testID="app-frame" style={s.backdrop}>
      <View style={s.glowA} /><View style={s.glowB} />
      {panel && <View style={s.panel}>
        <View style={s.brand}><BrandLogo tone="dark" height={44} /></View>
        <Text style={[s.headline, { lineHeight: lineHeight(48, 52) }]}>{t('shell.panel.headline')}</Text>
        <Text style={s.copy}>{t('shell.panel.copy')}</Text>
        <View style={s.chips}>{[{ id: 'food', label: departmentName(t, 'food') }, { id: 'grocery', label: departmentName(t, 'grocery') }, { id: 'shops', label: departmentName(t, 'shops') }, { id: 'care', label: t('shell.panel.care') }, { id: 'book-it', label: departmentName(t, 'book-it') }].map(c => <View key={c.id} style={s.chip}><Text style={s.chipText}>{c.label}</Text></View>)}</View>
      </View>}
      <View style={s.column}>{children}</View>
    </View>
  </AppWidth.Provider>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: INK, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'center', overflow: 'hidden' },
  glowA: { position: 'absolute', left: -200, top: -160, width: 520, height: 520, borderRadius: 260, backgroundColor: colors.lime, opacity: 0.08 },
  glowB: { position: 'absolute', right: -220, bottom: -200, width: 560, height: 560, borderRadius: 280, backgroundColor: colors.electricLime, opacity: 0.06 },
  column: { width: MAX_APP_WIDTH, overflow: 'hidden', backgroundColor: colors.surface, boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 60, color: 'rgba(179,244,0,0.12)' }] },
  panel: { width: 360, justifyContent: 'center', paddingRight: 56 },
  brand: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  // i18n-ignore: Latin value; the Text overrides it with useLineHeight() in other languages
  headline: { color: '#fff', fontSize: 48, lineHeight: 52, fontWeight: '800', letterSpacing: -1.8, marginTop: 28 },
  copy: { color: 'rgba(255,255,255,0.62)', fontSize: 15, lineHeight: 23, marginTop: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 24 },
  chip: { borderWidth: 1, borderColor: 'rgba(179,244,0,0.4)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: colors.electricLime, fontSize: 12, fontWeight: '700' },
});
