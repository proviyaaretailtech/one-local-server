// One look for every brand/store logo in the app: no outline, the logo nearly filling a rounded square, and a
// soft two-layer shadow underneath so it sits above the page like a button. Round, square and wide logos all
// read at one size because each is fitted ("contain") into the same square.
// Two sizes: small (lists, cart, product) and large (rails, page headers).
import type { ViewStyle } from 'react-native';

export const LOGO_TILE_BG = '#FFFFFF';
export const logoShadow: ViewStyle['boxShadow'] = [{ offsetX: 0, offsetY: 8, blurRadius: 18, color: 'rgba(11,31,22,0.14)' }, { offsetX: 0, offsetY: 2, blurRadius: 4, color: 'rgba(11,31,22,0.08)' }];

const base: ViewStyle = { backgroundColor: LOGO_TILE_BG, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: logoShadow };

/** A logo tile `size` points square: radius scales with size (14 at 48, 20 at 72). The image inside is `logoSize(size)`. */
export function logoTile(size: number): ViewStyle {
  return { ...base, width: size, height: size, borderRadius: size <= 52 ? 14 : 20 };
}
/** The square the logo image is fitted into, about 94% of the tile (tight, no padding ring). */
export const logoSize = (size: number) => Math.round(size * 0.94);
