// OneLocal: soft, translucent surfaces and flowing department gradients.
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

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
  info: "#F5F6F8",
  onInfo: "#1A1A1A",

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
  beautySoft: "#FCEAF2",
  book: "#246784",
  bookSoft: "#E6F5FB",
  bookDark: "#173E58",
  grocery: '#876125',
  shops: '#6F4BA0',
  festive: '#984819',
  festiveTop: '#FFE0AE',
  festiveSoft: '#FFF5E6',
  fitness: '#385B86',
  fitnessTop: '#C9DBF8',
  gourmet: '#884E37',
  gourmetTop: '#F3DAC6',
  characterSkin: '#F4B88D',
  characterLight: '#FFDCB9',
  characterShadow: '#C47C51',
  characterShoe: '#3C354C',
  characterBlush: '#EC927E',
  characterBody: '#BFA4EA',
  characterDeep: '#7964AA',
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
