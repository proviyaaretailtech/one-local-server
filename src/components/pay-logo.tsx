// The real payment brand marks (Google Pay, PhonePe, Paytm, BHIM, WhatsApp, UPI, Visa, Mastercard, RuPay), shown wherever the
// customer picks how to pay, so the choices look like the apps they know. Rasterised (transparent PNG, 144 px tall) from each
// brand's own SVG on Wikimedia Commons; a mark is shown as it is: never recoloured, cropped or stretched.
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme';

export type PayBrand = 'google_pay' | 'phonepe' | 'paytm' | 'bhim' | 'whatsapp' | 'upi' | 'visa' | 'mastercard' | 'rupay';

// ratio = width / height of the image file, so a logo is drawn at its own proportions.
const LOGOS: Record<PayBrand, { src: number; ratio: number }> = {
  google_pay: { src: require('../../assets/images/pay/google-pay.png'), ratio: 384 / 144 },
  phonepe: { src: require('../../assets/images/pay/phonepe.png'), ratio: 475 / 144 },
  paytm: { src: require('../../assets/images/pay/paytm.png'), ratio: 459 / 144 },
  bhim: { src: require('../../assets/images/pay/bhim.png'), ratio: 582 / 144 },
  whatsapp: { src: require('../../assets/images/pay/whatsapp.png'), ratio: 1 },
  upi: { src: require('../../assets/images/pay/upi.png'), ratio: 408 / 144 },
  visa: { src: require('../../assets/images/pay/visa.png'), ratio: 444 / 144 },
  mastercard: { src: require('../../assets/images/pay/mastercard.png'), ratio: 185 / 144 },
  rupay: { src: require('../../assets/images/pay/rupay.png'), ratio: 547 / 144 },
};

export const isPayBrand = (id: string): id is PayBrand => id in LOGOS;

// One logo at a given height (the width follows the logo's own shape). Decorative: the row it sits in carries the name.
export function PayLogo({ brand, height = 16 }: { brand: PayBrand; height?: number }) {
  const logo = LOGOS[brand];
  return <Image source={logo.src} resizeMode="contain" accessible={false} style={{ height, width: Math.round(height * logo.ratio) }} />;
}

// A logo inside a white rounded tile, the size of the icon badge it replaces; the logo fits inside with a margin.
export function PayTile({ brand, width = 44, height = 34, style }: { brand: PayBrand; width?: number; height?: number; style?: StyleProp<ViewStyle> }) {
  const logo = LOGOS[brand];
  const pad = 5;
  const h = Math.min(height - pad * 2, (width - pad * 2) / logo.ratio);
  return <View style={[s.tile, { width, height }, style]}><PayLogo brand={brand} height={Math.floor(h)} /></View>;
}

// A row of small logos under a method's name, e.g. Visa, Mastercard and RuPay under "Card".
export function PayLogoStrip({ brands, height = 12 }: { brands: PayBrand[]; height?: number }) {
  return <View style={s.strip}>{brands.map(b => <PayLogo key={b} brand={b} height={height} />)}</View>;
}

// Which logos go under each method's name.
export const METHOD_LOGOS: Partial<Record<string, PayBrand[]>> = {
  upi: ['google_pay', 'phonepe', 'paytm', 'bhim'],
  card: ['visa', 'mastercard', 'rupay'],
};

const s = StyleSheet.create({
  tile: { borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
});
