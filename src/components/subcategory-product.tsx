import { useEffect, useRef } from 'react';
import { Animated, View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Icon from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { Product } from '../api';
import { useCart } from '../cart';
import { colors } from '../theme';
import { nativeDriver, useMotionAllowed } from '../motion';
import { useFormat, useTranslation } from '../i18n';
import { unitPriceLabel } from '../unit-price';
import { haptic } from '../haptics';
import { HeartToggle } from './motion/heart-toggle';
import { RollingNumber } from './motion/rolling-number';

/** ₹ per 100 g / 100 ml from the pack text, as numbers; the words come from unitPriceLabel() at render time. */
export function unitPrice(product: Product): { amount: number; base: 'g' | 'ml' } | null {
  const match = product.weight.trim().match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|litres?|liters?|l)\b/i);
  if (!match) return null;
  const size = Number(match[1]); const unit = match[2].toLowerCase();
  if (!size) return null;
  const quantity = size * (['kg', 'l', 'litre', 'litres', 'liter', 'liters'].includes(unit) ? 1000 : 1);
  const amount = Number((product.price * 100 / quantity).toFixed(2));
  return { amount, base: ['g', 'kg'].includes(unit) ? 'g' : 'ml' };
}

export function SubcategoryProduct({ product: p, index, saved, onSave }: { product: Product; index: number; saved: boolean; onSave: () => void }) {
  const router = useRouter(); const { add, remove, qtyOf } = useCart(); const qty = qtyOf(p.id); const { t } = useTranslation(); const fmt = useFormat();
  const enter = useRef(new Animated.Value(0)).current; const motion = useMotionAllowed(); const unit = unitPrice(p);
  const discount = p.mrp > p.price ? Math.round((p.mrp-p.price)/p.mrp*100) : 0;
  useEffect(() => {
    if (!motion) { enter.setValue(1); return; }
    enter.setValue(0);
    const animation = Animated.sequence([Animated.delay(Math.min(index, 5)*45), Animated.spring(enter, { toValue: 1, friction: 9, useNativeDriver: nativeDriver })]);
    animation.start(); return () => animation.stop();
  }, [p.id, index, motion, enter]);
  return <Animated.View testID={`product-card-category-${p.id}`} style={[styles.card, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
    <View style={styles.picture}>
      <Pressable testID={`product-open-category-${p.id}`} accessibilityLabel={t('product.viewItem', { name: p.name })} onPress={() => router.push(`/product/${p.id}` as any)} style={({ pressed }) => [styles.imageArea, pressed && styles.pressed]}><Image testID={`product-image-category-${p.id}`} source={p.image} style={styles.image} contentFit="contain" transition={140} /></Pressable>
      <HeartToggle testID={`category-save-${p.id}`} accessibilityLabel={saved ? t('product.unsaveItem', { name: p.name }) : t('product.saveItem', { name: p.name })} accessibilityState={{ selected: saved }} saved={saved} onToggle={onSave} style={styles.heart} size={19} color={colors.muted} savedColor={colors.forest} />
      <View style={[styles.weightBand, qty > 0 && styles.selectedBand]}><Text testID={`product-weight-category-${p.id}`} style={[styles.weight, qty > 0 && styles.selectedWeight]} numberOfLines={1}>{/^\d/.test(p.weight) ? p.weight.split('·')[0].trim() : p.weight.split('·').pop()?.trim()}</Text></View>
      {!qty ? <Pressable testID={`add-btn-category-${p.id}`} accessibilityLabel={t('product.addItem', { name: p.name })} onPress={e => { haptic.add(); add(p, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); }} style={({ pressed }) => [styles.add, pressed && styles.pressed]}><Text style={styles.addText}>{t('product.add')}</Text></Pressable> : <View testID={`stepper-category-${p.id}`} style={styles.stepper}><Pressable testID={`dec-category-${p.id}`} accessibilityLabel={t('product.removeOneItem', { name: p.name })} onPress={() => { haptic.remove(); remove(p.id); }} style={styles.step}><Icon name="remove" size={16} color={colors.forest} /></Pressable><RollingNumber testID={`qty-category-${p.id}`} value={qty} text={fmt.number(qty)} lineHeight={15} style={styles.qty} /><Pressable testID={`inc-category-${p.id}`} accessibilityLabel={t('product.addOneItem', { name: p.name })} onPress={e => { haptic.add(); add(p, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); }} style={styles.step}><Icon name="add" size={16} color={colors.forest} /></Pressable></View>}
    </View>
    {!!unit && <Text testID={`category-unit-price-${p.id}`} style={styles.unit}>{unitPriceLabel(unit, t, fmt)}</Text>}
    <View style={styles.prices}><Text testID={`product-price-category-${p.id}`} style={styles.price}>{fmt.money(p.price)}</Text>{p.mrp > p.price && <Text testID={`category-mrp-${p.id}`} style={styles.mrp}>{fmt.money(p.mrp)}</Text>}</View>
    {!!discount && <Text testID={`product-discount-category-${p.id}`} style={styles.discount}>{t('category.offOnMrp', { pct: fmt.percent(discount) })}</Text>}
    <Pressable testID={`category-product-name-open-${p.id}`} accessibilityLabel={t('category.viewDetailsOf', { name: p.name })} onPress={() => router.push(`/product/${p.id}` as any)} style={styles.nameLink}><Text testID={`product-name-category-${p.id}`} numberOfLines={3} style={styles.name}>{p.name}</Text></Pressable>
    <View testID={`category-rating-${p.id}`} accessibilityLabel={t('category.ratedA11y', { rating: fmt.number(p.rating, { maxFractionDigits: 1 }) })} style={styles.rating}>{Array.from({ length: 5 }, (_, i) => <Icon key={i} name={p.rating >= i+1 ? 'star' : p.rating > i ? 'star-half' : 'star-outline'} size={11} color={colors.gold} />)}<Text style={styles.ratingValue}>{fmt.number(p.rating, { maxFractionDigits: 1 })}</Text></View>
    <View testID={`category-delivery-${p.id}`} accessibilityLabel={t('category.deliveryA11y', { count: p.delivery_min, value: fmt.number(p.delivery_min) })} style={styles.delivery}><Icon name="time-outline" size={12} color={colors.muted} /><Text style={styles.deliveryText}>{fmt.eta(p.delivery_min)}</Text></View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  selectedBand: { height: 64, justifyContent: 'flex-start', paddingTop: 5 }, selectedWeight: { maxWidth: '100%' },
  card: { width: '100%', backgroundColor: colors.surface }, picture: { marginBottom: 8, borderRadius: 13, backgroundColor: colors.cream }, imageArea: { width: '100%', aspectRatio: 1, overflow: 'hidden', borderTopLeftRadius: 13, borderTopRightRadius: 13 }, image: { width: '100%', height: '100%' }, heart: { position: 'absolute', top: 0, right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, weightBand: { height: 38, paddingHorizontal: 8, justifyContent: 'center', borderBottomLeftRadius: 13, borderBottomRightRadius: 13, borderWidth: 1, borderColor: colors.border }, weight: { color: colors.onSurface, fontSize: 10, fontWeight: '600', maxWidth: '45%' }, add: { position: 'absolute', bottom: -3, right: 0, minWidth: 59, minHeight: 44, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.forest, alignItems: 'center', justifyContent: 'center' }, addText: { color: colors.forest, fontSize: 12, fontWeight: '800' }, stepper: { position: 'absolute', bottom: -3, right: 0, backgroundColor: colors.limeSoft, height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.forest, flexDirection: 'row', alignItems: 'center' }, step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, qty: { minWidth: 14, textAlign: 'center', fontSize: 11, fontWeight: '700', color: colors.forest }, unit: { color: colors.muted, fontSize: 11, marginTop: 3 }, prices: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }, price: { fontSize: 17, fontWeight: '800', color: colors.onSurface, letterSpacing: -0.4 }, mrp: { fontSize: 10, color: colors.muted, textDecorationLine: 'line-through' }, discount: { color: colors.forest, fontSize: 9, fontWeight: '800', marginTop: 3 }, nameLink: { minHeight: 44, marginTop: 4 }, name: { fontSize: 12, lineHeight: 17, color: colors.onSurface, fontWeight: '500' }, rating: { flexDirection: 'row', alignItems: 'center', gap: 1, marginTop: 5 }, ratingValue: { color: colors.muted, fontSize: 9, marginLeft: 4 }, delivery: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 }, deliveryText: { fontSize: 10, color: colors.muted }, pressed: { opacity: 0.7 },
});