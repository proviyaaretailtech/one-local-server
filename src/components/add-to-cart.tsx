// The round "+" on an item's picture (item cards, restaurant menus), which grows into the quantity stepper once the item is
// in the bag. Watches only its own item's quantity, so a change re-draws just this button. The caller places it.
import { Pressable, StyleSheet } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { useCartActions, useCartQty } from '../cart';
import { useMotionAllowed } from '../motion';
import { useFormat, useTranslation } from '../i18n';
import { haptic } from '../haptics';
import { Tap } from './tap';
import { RollingNumber } from './motion/rolling-number';
import type { Product } from '../api';

/** `id` suffixes the test ids (add-btn-, stepper-, dec-, qty-, inc-); `tint` colours the "+". */
export function AddToCart({ product: p, id, tint }: { product: Product; id: string; tint: string }) {
  const { add, remove } = useCartActions(); const qty = useCartQty(p.id); const motion = useMotionAllowed(); const { t } = useTranslation(); const fmt = useFormat();
  const addOne = (e: { nativeEvent: { pageX: number; pageY: number } }) => { haptic.add(); add(p, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); };
  // The stepper grows in on entering, not through a layout transition on its parent: a layout transition also moves the
  // parent whenever the card moves, which sent every "+" flying when search results re-flowed.
  return !qty
    ? <Tap testID={`add-btn-${id}`} accessibilityLabel={t('product.addItem', { name: p.name })} haptic={false} onPress={addOne} radius={15} hitSlop={7} style={s.add}><Icon name="add" size={17} color={tint} /></Tap>
    : <Animated.View entering={motion ? ZoomIn.springify().damping(18).stiffness(260) : undefined} testID={`stepper-${id}`} style={s.stepper}>
        <Pressable testID={`dec-${id}`} accessibilityLabel={t('product.removeOneItem', { name: p.name })} onPress={() => { haptic.remove(); remove(p.id); }} hitSlop={7} style={s.step}><Icon name={qty === 1 ? 'trash-outline' : 'remove'} size={14} color={colors.surface} /></Pressable>
        <RollingNumber testID={`qty-${id}`} value={qty} text={fmt.number(qty)} lineHeight={16} style={s.qty} />
        <Pressable testID={`inc-${id}`} accessibilityLabel={t('product.addOneItem', { name: p.name })} onPress={addOne} hitSlop={7} style={s.step}><Icon name="add" size={14} color={colors.surface} /></Pressable>
      </Animated.View>;
}

const lift = { boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(13,18,14,0.16)' }] } as const;
const s = StyleSheet.create({
  add: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...lift },
  stepper: { height: 30, borderRadius: 15, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.forestDeep, paddingHorizontal: 2, ...lift },
  step: { width: 28, height: 30, alignItems: 'center', justifyContent: 'center' },
  qty: { color: colors.surface, fontSize: 13, fontWeight: '800', minWidth: 14, textAlign: 'center' },
});
