import { memo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { Image } from 'expo-image';
import Icon from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { colors } from '../theme';
import { useCartActions, useCartQty } from '../cart';
import { useSavedProducts } from '../customer';
import { useScreenPalette } from '../use-screen-path';
import type { Product } from '../api';
import { useMotionAllowed } from '../motion';
import { useFormat, useTranslation } from '../i18n';
import { Tap } from './tap';
import { haptic } from '../haptics';
import { HeartToggle } from './motion/heart-toggle';
import { RollingNumber } from './motion/rolling-number';
// memo + per-product cart quantity: a card redraws only when its own product, quantity or the wishlist
// changes. Glovo-clean: no box around the card — a rounded picture tile carries it; the price leads; a
// round "+" sits on the picture and grows into the quantity stepper once the item is in the bag.
export const ProductCard = memo(function ProductCard({ product: p, width = 140, scope = '' }: { product: Product; width?: number | null; scope?: string }) {
  const router = useRouter(); const palette = useScreenPalette(); const { add, remove } = useCartActions(); const { saved, toggleSaved, ready } = useSavedProducts(); const { t } = useTranslation(); const fmt = useFormat();
  const qty = useCartQty(p.id); const id = scope ? `${scope}-${p.id}` : p.id; const isSaved = saved.includes(p.id); const narrow = !!width && width < 120;
  const motion = useMotionAllowed(); const imageH = narrow ? 104 : 124;
  const addOne = (e: { nativeEvent: { pageX: number; pageY: number } }) => { haptic.add(); add(p, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); };
  return <View testID={`product-card-${id}`} style={[s.card, width ? { width } : s.fill]}>
    <View style={[s.imageWrap, { height: imageH }]}>
      <Tap testID={`product-open-${id}`} accessibilityLabel={t('product.viewItem', { name: p.name })} onPress={() => router.push(`/product/${p.id}` as any)} style={s.imagePress} radius={16} glow={false} haptic={false}><Image testID={`product-image-${id}`} source={p.image} style={s.image} contentFit="cover" transition={150} /></Tap>
      <HeartToggle testID={`save-product-${id}`} disabled={!ready} accessibilityLabel={isSaved ? t('product.unsaveItem', { name: p.name }) : t('product.saveItem', { name: p.name })} accessibilityState={{ selected: isSaved }} saved={isSaved} onToggle={() => { void toggleSaved(p.id).catch(() => {}); }} style={s.heart} size={15} color={colors.onSurface} savedColor={colors.onError} />
      {!!p.discount_pct && <View style={s.discount}><Text testID={`product-discount-${id}`} style={s.discountText}>{t('product.off', { pct: fmt.percent(p.discount_pct) })}</Text></View>}
      <Animated.View layout={motion ? LinearTransition.springify().damping(18).stiffness(260) : undefined} style={s.addDock}>
        {!qty
          ? <Tap testID={`add-btn-${id}`} accessibilityLabel={t('product.addItem', { name: p.name })} haptic={false} onPress={addOne} radius={18} hitSlop={6} style={s.add}><Icon name="add" size={20} color={palette.color} /></Tap>
          : <View testID={`stepper-${id}`} style={s.stepper}>
              <Pressable testID={`dec-${id}`} accessibilityLabel={t('product.removeOneItem', { name: p.name })} onPress={() => { haptic.remove(); remove(p.id); }} hitSlop={4} style={s.step}><Icon name={qty === 1 ? 'trash-outline' : 'remove'} size={15} color={colors.surface} /></Pressable>
              <RollingNumber testID={`qty-${id}`} value={qty} text={fmt.number(qty)} lineHeight={16} style={s.qty} />
              <Pressable testID={`inc-${id}`} accessibilityLabel={t('product.addOneItem', { name: p.name })} onPress={addOne} hitSlop={4} style={s.step}><Icon name="add" size={15} color={colors.surface} /></Pressable>
            </View>}
      </Animated.View>
    </View>
    <Pressable testID={`product-name-open-${id}`} accessibilityLabel={t('product.viewItemDetails', { name: p.name })} onPress={() => router.push(`/product/${p.id}` as any)} style={s.content}>
      <View style={s.priceWrap}><Text testID={`product-price-${id}`} style={s.price}>{fmt.money(p.price)}</Text>{p.mrp > p.price && <Text testID={`product-mrp-${id}`} style={s.mrp}>{fmt.money(p.mrp)}</Text>}</View>
      <Text testID={`product-name-${id}`} numberOfLines={2} style={s.name}>{p.name}</Text>
      <Text testID={`product-weight-${id}`} numberOfLines={1} style={s.weight}>{p.weight}</Text>
    </Pressable>
  </View>;
});
const lift = { boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(13,18,14,0.16)' }] } as const;
const s = StyleSheet.create({
  card: { backgroundColor: 'transparent' }, fill: { width: '100%' },
  imageWrap: { borderRadius: 16, backgroundColor: colors.cream },
  imagePress: { width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden' }, image: { width: '100%', height: '100%' },
  heart: { position: 'absolute', top: 6, right: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  discount: { position: 'absolute', top: 8, left: 8, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: colors.electricLime, pointerEvents: 'none' }, discountText: { fontSize: 9, fontWeight: '800', color: colors.forestDeep },
  addDock: { position: 'absolute', right: 6, bottom: 6 },
  add: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...lift },
  stepper: { height: 36, borderRadius: 18, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.forestDeep, paddingHorizontal: 2, ...lift },
  step: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  qty: { color: colors.surface, fontSize: 13, fontWeight: '800', minWidth: 14, textAlign: 'center' },
  content: { paddingHorizontal: 2, paddingTop: 8, minHeight: 66 },
  priceWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 5 }, price: { fontSize: 15, fontWeight: '800', color: colors.onSurface, letterSpacing: -0.2 }, mrp: { fontSize: 10, color: colors.muted, textDecorationLine: 'line-through' },
  name: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: colors.onSurface, marginTop: 3 },
  weight: { fontSize: 10, color: colors.muted, marginTop: 3 },
});
