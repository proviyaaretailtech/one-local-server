import { createContext, memo, useContext } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import Icon from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { colors, photoIconShadow, popBase } from '../theme';
import { useSavedProducts } from '../customer';
import { useScreenPalette } from '../use-screen-path';
import type { Product } from '../api';
import { useFormat, useTranslation } from '../i18n';
import { useEtaMinutes } from '../use-store-etas';
import { Tap } from './tap';
import { AddToCart } from './add-to-cart';
import { HeartToggle } from './motion/heart-toggle';
/** Set where items open in place instead of on a page of their own: the product sheet shows a related item in itself. */
export const OpenProductContext = createContext<((id: string) => void) | null>(null);

// memo: a card redraws only when its own product or the wishlist changes (its "+" watches the bag by itself).
// Glovo-clean: no box around the card — a rounded picture tile carries it; the price leads; a round "+" sits on the
// picture and grows into the quantity stepper once the item is in the bag.
// `accent` (a shop's deep colour, in its shop card) stands the picture on a solid base of that colour, like a raised key,
// and colours the "+".
export const ProductCard = memo(function ProductCard({ product: p, width = 140, scope = '', accent }: { product: Product; width?: number | null; scope?: string; accent?: string }) {
  const router = useRouter(); const palette = useScreenPalette(); const { saved, toggleSaved, ready } = useSavedProducts(); const { t } = useTranslation(); const fmt = useFormat();
  const id = scope ? `${scope}-${p.id}` : p.id; const isSaved = saved.includes(p.id); const narrow = !!width && width < 120;
  const imageH = narrow ? 104 : 124; const eta = useEtaMinutes(p);
  const openHere = useContext(OpenProductContext); const open = () => openHere ? openHere(p.id) : router.push(`/product/${p.id}`);
  return <View testID={`product-card-${id}`} style={[s.card, width ? { width } : s.fill]}>
    <View style={[s.imageWrap, { height: imageH }, !!accent && [s.standing, { boxShadow: popBase(BASE, accent) }]]}>
      <View pointerEvents="none" style={s.placeholder}><Icon name="image-outline" size={28} color="rgba(11,31,22,0.22)" /></View>
      <Tap testID={`product-open-${id}`} accessibilityLabel={t('product.viewItem', { name: p.name })} onPress={open} style={s.imagePress} radius={16} glow={false} haptic={false}><Image testID={`product-image-${id}`} source={p.image} style={s.image} contentFit="cover" transition={150} cachePolicy="memory-disk" /></Tap>
      <HeartToggle testID={`save-product-${id}`} disabled={!ready} accessibilityLabel={isSaved ? t('product.unsaveItem', { name: p.name }) : t('product.saveItem', { name: p.name })} accessibilityState={{ selected: isSaved }} saved={isSaved} onToggle={() => { void toggleSaved(p.id).catch(() => {}); }} hitSlop={8} style={s.heart} size={19} color={colors.surface} savedColor={colors.onError} />
      {!!p.discount_pct && <View style={s.discount}><Text testID={`product-discount-${id}`} style={s.discountText}>{t('product.off', { pct: fmt.percent(p.discount_pct) })}</Text></View>}
      <View style={s.addDock}><AddToCart product={p} id={id} tint={accent ?? palette.color} /></View>
    </View>
    <Pressable testID={`product-name-open-${id}`} accessibilityLabel={t('product.viewItemDetails', { name: p.name })} onPress={open} style={s.content}>
      <View style={s.priceWrap}><Text testID={`product-price-${id}`} style={s.price}>{fmt.money(p.price)}</Text>{p.mrp > p.price && <Text testID={`product-mrp-${id}`} style={s.mrp}>{fmt.money(p.mrp)}</Text>}</View>
      <Text testID={`product-name-${id}`} numberOfLines={2} style={s.name}>{p.name}</Text>
      <Text testID={`product-weight-${id}`} numberOfLines={1} style={s.weight}>{p.weight}</Text>
      {eta > 0 && <View testID={`product-eta-${id}`} style={s.eta}><Icon name="flash" size={10} color={colors.forest} /><Text style={s.etaText}>{fmt.eta(eta)}</Text></View>}
    </Pressable>
  </View>;
});
// How far the accent base shows below the picture.
const BASE = 5;
const s = StyleSheet.create({
  card: { backgroundColor: 'transparent' }, fill: { width: '100%' },
  imageWrap: { borderRadius: 16, backgroundColor: colors.cream, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,31,22,0.08)' },
  // Keeps the text's usual gap below the base.
  standing: { marginBottom: BASE },
  placeholder: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  imagePress: { width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden' }, image: { width: '100%', height: '100%' },
  // Just the heart on the photo, its shadow in its own shape so it reads on light and dark pictures alike.
  heart: { position: 'absolute', top: 6, right: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', ...photoIconShadow },
  discount: { position: 'absolute', top: 8, left: 8, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: colors.electricLime, pointerEvents: 'none' }, discountText: { fontSize: 10, fontWeight: '800', color: colors.forestDeep },
  addDock: { position: 'absolute', right: 6, bottom: 6 },
  content: { paddingHorizontal: 2, paddingTop: 8 },
  eta: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 3 },
  etaText: { fontSize: 11, fontWeight: '700', color: colors.forest },
  priceWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 5 }, price: { fontSize: 15, fontWeight: '800', color: colors.onSurface, letterSpacing: -0.2 }, mrp: { fontSize: 11, color: colors.muted, textDecorationLine: 'line-through' },
  name: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: colors.onSurface, marginTop: 3 },
  weight: { fontSize: 11, color: colors.muted, marginTop: 3 },
});
