import { useEffect, useRef, useState } from 'react';
import { View, Pressable, Animated, StyleSheet } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { mediaUrl } from '../api';
import { useCatalog } from '../use-catalog';
import { nativeDriver, useMotionAllowed } from '../motion';
import { useTranslation } from '@/src/i18n';

// Catalogue keys (the words are looked up while rendering, in the current language).
const crew = {
  veggies: { name: 'cart.vendor.veggiesName', message: 'cart.vendor.veggiesMessage', packed: 'cart.vendor.veggiesPacked' },
  dairy: { name: 'cart.vendor.dairyName', message: 'cart.vendor.dairyMessage', packed: 'cart.vendor.dairyPacked' },
  food: { name: 'cart.vendor.foodName', message: 'cart.vendor.foodMessage', packed: 'cart.vendor.foodPacked' },
  care: { name: 'cart.vendor.careName', message: 'cart.vendor.careMessage', packed: 'cart.vendor.carePacked' },
  shops: { name: 'cart.vendor.shopsName', message: 'cart.vendor.shopsMessage', packed: 'cart.vendor.shopsPacked' },
} as const;
export function VendorNote({ items, status = 'cart' }: { items: { id: string; name: string }[]; status?: string }) {
  const { t } = useTranslation(); const { data } = useCatalog(); const [index, setIndex] = useState(0); const motion = useMotionAllowed();
  const wave = useRef(new Animated.Value(0)).current; const reveal = useRef(new Animated.Value(0)).current;
  const groups = [...new Set(items.map(item => {
    const p = data?.products.find(v => v.id === item.id);
    if (p?.department === 'food') return 'food';
    if (['pharmacy', 'beauty'].includes(p?.department || '')) return 'care';
    if (p?.department === 'shops') return 'shops';
    if (p?.brand_id === 'amul' || p?.category_id === 'c2' || /\b(milk|amul|paneer|butter|cheese|eggs)\b/i.test(item.name)) return 'dairy';
    return 'veggies';
  }))] as (keyof typeof crew)[];
  const key = groups[index % Math.max(groups.length, 1)] || 'veggies'; const vendor = crew[key];
  const amul = key === 'dairy' && items.some(i => /amul/i.test(i.name));
  const name = t(amul ? 'cart.vendor.amulName' : vendor.name);
  useEffect(() => { reveal.setValue(motion ? 0 : 1); const animation = Animated.spring(reveal, { toValue: 1, friction: 7, useNativeDriver: nativeDriver }); animation.start(); return () => animation.stop(); }, [key, items.length, motion, reveal]);
  const greet = () => { if (!motion) return; Animated.sequence([Animated.timing(wave, { toValue: 1, duration: 120, useNativeDriver: nativeDriver }), Animated.timing(wave, { toValue: -1, duration: 180, useNativeDriver: nativeDriver }), Animated.timing(wave, { toValue: 1, duration: 180, useNativeDriver: nativeDriver }), Animated.spring(wave, { toValue: 0, useNativeDriver: nativeDriver })]).start(); };
  useEffect(() => { if (!motion) return; const animation = Animated.sequence([Animated.timing(wave, { toValue: 1, duration: 180, useNativeDriver: nativeDriver }), Animated.spring(wave, { toValue: 0, friction: 3, useNativeDriver: nativeDriver })]); animation.start(); return () => animation.stop(); }, [key, motion, wave]);
  if (!items.length) return null;
  const message = status === 'cart' ? t(vendor.message) : status === 'placed' ? t('cart.vendor.placed') : status === 'delivered' ? t('cart.vendor.delivered') : t(vendor.packed);
  return <Animated.View testID="vendor-note" style={[styles.wrap, { opacity: reveal, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}><Pressable testID="vendor-wave-button" accessibilityLabel={t('cart.vendor.waveA11y')} onPress={greet}><Animated.View style={{ transform: [{ rotate: wave.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] }) }] }}><Image testID={`vendor-illustration-${key}`} source={mediaUrl(`vendor-${key}-v2`)} style={[styles.character, { borderRadius: 24 }]} contentFit="contain" /></Animated.View></Pressable><View style={styles.bubble}><View style={styles.tail} /><Text testID="vendor-name" style={styles.name}>{name}</Text><Text testID="vendor-message" style={styles.message}>{message}</Text><Text testID="vendor-preview-notice" style={styles.note}>{t('cart.vendor.note')}</Text></View>{groups.length > 1 && <Pressable testID="vendor-next" accessibilityLabel={t('cart.vendor.nextA11y')} onPress={() => setIndex(i => i + 1)} style={styles.next}><Icon name="chevron-forward" size={17} color={colors.forest} /><Text testID="vendor-page" style={styles.page}>{index % groups.length + 1}/{groups.length}</Text></Pressable>}</Animated.View>;
}
const styles = StyleSheet.create({ wrap: { marginHorizontal: 16, minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 3 }, character: { width: 79, height: 88 }, bubble: { flex: 1, padding: 11, borderRadius: 20, backgroundColor: colors.limeSoft }, tail: { position: 'absolute', left: -4, top: 27, width: 12, height: 12, backgroundColor: colors.limeSoft, transform: [{ rotate: '45deg' }] }, name: { color: colors.forest, fontSize: 11, fontWeight: '700' }, message: { color: colors.onSurface, fontSize: 11, lineHeight: 16, marginTop: 2 }, note: { color: colors.muted, fontSize: 7, marginTop: 5 }, next: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, page: { color: colors.muted, fontSize: 8 } });