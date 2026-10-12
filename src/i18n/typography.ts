// Devanagari reading comfort. Pure constants/helpers (no React Native), safe to import from app/+html.tsx.

/** The page font stack for web: Latin fonts first, then Devanagari-capable fonts, so Hindi never renders as boxes. */
export const WEB_FONT_STACK = [
  '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial',
  '"Noto Sans Devanagari"', '"Kohinoor Devanagari"', '"Devanagari Sangam MN"', '"Nirmala UI"', 'Mangal', 'sans-serif',
].join(', ');

/**
 * Devanagari has marks above and below the line (matras, the headline bar), so a line height that is fine for
 * English (1.1-1.2 x the font size) clips them on Android. Use at least this ratio wherever text can be Hindi.
 */
export const MIN_LINE_HEIGHT_RATIO = 1.35;

/** A line height that is safe for both scripts: your English value, raised to the Devanagari minimum. */
export const safeLineHeight = (fontSize: number, wanted?: number) => Math.round(Math.max(wanted ?? 0, fontSize * MIN_LINE_HEIGHT_RATIO));
