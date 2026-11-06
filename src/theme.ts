// OneLocal: soft, translucent surfaces and flowing department gradients.
import { useMemo } from "react";
import { Appearance, Platform, StyleSheet, useColorScheme, type BoxShadowValue, type ViewStyle } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#FFFFFF",
  onSurface: "#1A1A1A",
  surfaceSecondary: "#F5F6F8",
  onSurfaceSecondary: "#1A1A1A",
  surfaceTertiary: "#EAECEF",
  onSurfaceTertiary: "#4A4D52",
  surfaceInverse: "#1A1A1A",
  onSurfaceInverse: "#FFFFFF",
  muted: "#6B7280",

  // Brand
  brand: "#1A1A1A",
  onBrand: "#FFFFFF",
  brandPrimary: "#1A1A1A",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#76EC00",
  onBrandSecondary: "#1A1A1A",
  brandTertiary: "#F1FFD9",
  onBrandTertiary: "#1A1A1A",

  // Status
  success: "#E6F4EA",
  onSuccess: "#0C831F",
  warning: "#FFF7D6",
  onWarning: "#997300",
  error: "#FFE6E6",
  onError: "#CC0000",
  errorDeep: "#8A0000",
  info: "#F5F6F8",

  // Lines
  border: "#EAECEF",
  borderStrong: "#D1D5DB",
  divider: "#F5F6F8",

  // Pastel accents (traffic colors, pastel shades)
  pastelRed: "#FFE6E6",
  pastelYellow: "#FFF7D6",
  pastelGreen: "#E6F4EA",
  pastelBlue: "#E6F0FF",
  pastelPurple: "#F0E6FF",
  pastelPink: "#FFE6F0",
  pastelOrange: "#FFEDD6",
  pastelMint: "#DDF5EA",
  lime: "#76EC00",
  electricLime: '#B3F400',
  limeSoft: "#F0FFD7",
  forest: "#174D37",
  forestDeep: "#103B2B",
  food: "#9D441D",
  foodSoft: "#FFF0E4",
  pharmacy: "#9A416A",
  pharmacySoft: "#FCEAF2",
  beauty: "#9A416A",
  book: "#246784",
  bookSoft: "#E6F5FB",
  bookDark: "#173E58",
  grocery: '#876125',
  shops: '#6F4BA0',
  festive: '#984819',
  festiveTop: '#FFE0AE',
  festiveSoft: '#FFF5E6',
  festiveDeep: '#2C0707', // the top of the home backdrop
  popShade: 'rgba(0,0,0,0.22)', // the solid base under a raised sign or tile on a shop's colour
  neuShade: 'rgba(52,36,84,0.16)', // a neumorphic surface's soft shade, on cool (lavender) pages
  neuShadeWarm: 'rgba(122,62,20,0.16)', // the same on warm (peach) pages
  fitness: '#385B86',
  fitnessTop: '#C9DBF8',
  gourmet: '#884E37',
  gourmetTop: '#F3DAC6',
  cream: "#F8F9F5",
  transparent: "transparent",
  overlay: "rgba(0,0,0,0.45)",
  overlayDeep: "rgba(0,0,0,0.85)",
  whiteGlass: "rgba(255,255,255,0.18)",
  gold: "#FFC72C",
  cityMid: '#B8F49B',
  cityFade: '#F1FBEA',
  groceryTop: '#F6E5AD',
  groceryMid: '#FAEFCB',
  groceryFade: '#FFFAED',
  shopsTop: '#DECFF4',
  shopsMid: '#EBE1F9',
  shopsFade: '#F8F3FD',
  careTop: '#F7D3E2',
  careMid: '#FBE3EC',
  careFade: '#FFF3F7',
  bookTop: '#C9E8F5',
  bookMid: '#DFF1FA',
  bookFade: '#F1FAFE',
  foodTop: '#FFD7B8',
  foodMid: '#FFE7D4',
  foodFade: '#FFF6EF',
  glass: 'rgba(255,255,255,0.6)',
  glassBright: 'rgba(255,255,255,0.88)',
  glassLine: 'rgba(255,255,255,0.7)',
  inkSoft: '#416034',
  shadow: 'rgba(30,64,30,0.07)',
  walletInk: '#253E26',
  // India's food marks: green for veg, brown-red for non-veg, yellow for egg.
  veg: '#1B8A3A',
  nonVeg: '#B3261E',
  egg: '#D99A00',
  whiteGlassLine: 'rgba(255,255,255,0.28)',
  localGlass: 'rgba(118,236,0,0.55)', // the Local / National switch when on Local: the brand lime, see-through
  // Home service tiles: a soft gold card, pale where it glows in the middle.
  goldTile: '#EDD8AC',
  goldGlow: '#FBF2DE',
  // The Categories grid's tiles: the same card in a soft teal mint.
  mintTile: '#CDEBE3',
  mintGlow: '#EFFAF6',
  // The launch intro: the native splash's ink and the wordmark's own green; its Diwali night (a deep green, lighter in the
  // middle), and the diyas' brass, the brass in shadow and the flame's orange edge.
  splashInk: '#050605',
  logoGreen: '#72D400',
  diwaliNight: '#03150E',
  diwaliGreen: '#0E3626',
  diyaBrass: '#D9A04A',
  diyaShade: '#7A4E17',
  diyaFlame: '#FF8B21',
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? 'unspecified');
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === 'light' || system === 'dark') && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const colors = light;

// Spacing tokens
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
};

// Radius tokens
export const radius = {
  sm: 14,
  md: 22,
  lg: 28,
  pill: 999,
};

// Transparent soft UI (glass neumorphism) for controls on a photo, filled with `colors.whiteGlass`: the photo shows
// through, and only the edges, lit from the top-left and shaded at the bottom-right, say the control is raised or sunken.
export const soft = {
  raised: [
    { offsetX: 0, offsetY: 8, blurRadius: 20, color: 'rgba(4,14,9,0.22)' },
    { inset: true, offsetX: 1.5, offsetY: 1.5, blurRadius: 2, color: 'rgba(255,255,255,0.4)' },
    { inset: true, offsetX: -1.5, offsetY: -1.5, blurRadius: 3, color: 'rgba(4,14,9,0.2)' },
  ],
  sunken: [
    { inset: true, offsetX: 2, offsetY: 2, blurRadius: 4, color: 'rgba(4,14,9,0.35)' },
    { inset: true, offsetX: -1, offsetY: -1, blurRadius: 2, color: 'rgba(255,255,255,0.3)' },
  ],
  // A switch's knob, resting on its sunken track.
  knob: [{ offsetX: 0, offsetY: 2, blurRadius: 5, color: 'rgba(4,14,9,0.3)' }],
  // Raised off a plain light page instead of a photo: a soft shadow and a bright top-left edge.
  lifted: [
    { offsetX: 0, offsetY: 4, blurRadius: 12, color: 'rgba(16,59,43,0.1)' },
    { inset: true, offsetX: 1, offsetY: 1, blurRadius: 2, color: 'rgba(255,255,255,0.9)' },
  ],
} satisfies Record<string, BoxShadowValue[]>;

// The gold service tiles: a warm glow around the card with a bright top-left edge, and the light in its middle (blurred
// far past its small circle, so it reads as a soft glow).
export const goldCard = {
  glow: [
    { offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(255,196,96,0.32)' },
    { inset: true, offsetX: 1, offsetY: 1, blurRadius: 2, color: 'rgba(255,255,255,0.7)' },
  ],
  light: [{ offsetX: 0, offsetY: 0, blurRadius: 30, spreadDistance: 12, color: light.goldGlow }],
} satisfies Record<string, BoxShadowValue[]>;
/** The same for the mint tiles, with a cool glow. */
export const mintCard = {
  glow: [
    { offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(56,170,145,0.26)' },
    { inset: true, offsetX: 1, offsetY: 1, blurRadius: 2, color: 'rgba(255,255,255,0.7)' },
  ],
  light: [{ offsetX: 0, offsetY: 0, blurRadius: 30, spreadDistance: 12, color: light.mintGlow }],
} satisfies Record<string, BoxShadowValue[]>;
/** The same in Book It's sky blue (its tile is `bookTop`, its light `bookFade`). */
export const skyCard = {
  glow: [
    { offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(36,103,132,0.24)' },
    { inset: true, offsetX: 1, offsetY: 1, blurRadius: 2, color: 'rgba(255,255,255,0.7)' },
  ],
  light: [{ offsetX: 0, offsetY: 0, blurRadius: 30, spreadDistance: 12, color: light.bookFade }],
} satisfies Record<string, BoxShadowValue[]>;
/**
 * A shadow in the shape of what a view holds, not of its box. iOS does not draw the drop-shadow filter, but its layer
 * shadow follows the content's shape when the view has no background; Android and web use the filter.
 */
const shapeShadow = (y: number, blur: number, rgb: string, alpha: number) => Platform.select<ViewStyle>({
  ios: { shadowColor: `rgb(${rgb})`, shadowOffset: { width: 0, height: y }, shadowOpacity: alpha, shadowRadius: blur },
  default: { filter: `drop-shadow(0px ${y}px ${blur}px rgba(${rgb},${alpha}))` },
});
/** The shadow a gold tile's icon casts on it. */
export const goldIconShadow = shapeShadow(8, 6, '96,58,14', 0.55);
/** The shadow a mint tile's icon casts on it. */
export const mintIconShadow = shapeShadow(8, 6, '18,82,68', 0.45);
/** The shadow a sky tile's icon casts on it. */
export const skyIconShadow = shapeShadow(8, 6, '20,70,92', 0.45);
/** Keeps a white icon readable on any photo, light or dark. */
export const photoIconShadow = shapeShadow(1, 3, '0,0,0', 0.45);
/** A soft glow of gold round fine gold lines on a dark ground (the launch intro's rangoli). */
export const goldLineGlow = shapeShadow(0, 3, '255,199,44', 0.85);

/** What a control sits on: a photo (white glass) or a plain light page (soft panes). */
export type Tone = 'photo' | 'light';
/** A raised pane of soft glass on a photo (search bar, buttons): spread into a style. */
export const glassPane = { backgroundColor: light.whiteGlass, borderWidth: 1, borderColor: light.whiteGlassLine, boxShadow: soft.raised };
/** The same pane on a plain light page. */
export const lightPane = { backgroundColor: light.surfaceSecondary, borderWidth: 1, borderColor: light.surface, boxShadow: soft.lifted };

// Soft tint + deep ink pairs for things with a name but no colour of their own (brand monograms, shop cards). Each picks
// its pair from its name or id, so it never changes between visits.
export const nameTints = [['#FCEAF2', '#8A2F5C'], ['#E6F4EA', '#1F6B3A'], ['#FFF0E4', '#9D441D'], ['#E6F0FF', '#244F9A'], ['#F0E6FF', '#5B3A9B'], ['#FFF7D6', '#7A5A00']] as const;
export type NameTint = (typeof nameTints)[number];

/** Neumorphism on a light page: raised out of a surface of its own colour, lit from the top left (a soft shade below
 *  right, a bright edge above left), `depth` points deep; `shade` suits the page's tone. */
export const neu = (depth: number, shade: string = light.neuShade): BoxShadowValue[] => [
  { offsetX: depth, offsetY: depth, blurRadius: depth * 2.5, color: shade },
  { offsetX: -depth, offsetY: -depth, blurRadius: depth * 2.5, color: 'rgba(255,255,255,0.95)' },
];
/** The same surface pressed in: a well. */
export const neuWell: BoxShadowValue[] = [
  { inset: true, offsetX: 2, offsetY: 2, blurRadius: 5, color: light.neuShade },
  { inset: true, offsetX: -2, offsetY: -2, blurRadius: 5, color: 'rgba(255,255,255,0.95)' },
];

/** Pop-art lift: a solid, unblurred base `y` points deep under a sign, tile or picture, like a raised key or a sticker. */
export const popBase = (y: number, color: string = light.popShade): BoxShadowValue[] => [{ offsetX: 0, offsetY: y, blurRadius: 0, color }];
export const nameTintIndex = (key: string) => [...key].reduce((n, ch) => n + ch.charCodeAt(0), 0) % nameTints.length;
/** Tints for things listed together (shops): each keeps its own unless it would match the one before it, which then
 *  takes the next pair, so neighbours never look alike. */
export const listTints = (keys: readonly string[]) => keys.reduce<number[]>((picked, key) => { const own = nameTintIndex(key); return [...picked, own === picked.at(-1) ? (own + 1) % nameTints.length : own]; }, []).map(i => nameTints[i]);
