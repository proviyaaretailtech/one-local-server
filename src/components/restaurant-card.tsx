// A restaurant in the Food list, in soft neumorphism: a card raised out of the page (`surface`, with `shade` below right),
// framing a swipeable strip of its dishes (each named with its price on a pill, dots for where you are) and a heart to
// follow it, then its name, a raised rating pill, its delivery time, and its best offer on the app's lime offer tag.
// `tint` colours the photo frame while it loads. Tapping it opens the restaurant.
import { memo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { Text } from '../ui/text';
import { Tap } from './tap';
import { HeartToggle } from './motion/heart-toggle';
import { colors, neu, photoIconShadow, radius, type NameTint } from '../theme';
import { useAppDimensions } from '../layout';
import { useFollowedStores } from '../followed';
import { useFormat, useTranslation } from '../i18n';
import type { Product, Store } from '../api';

const SIDE = 16;
const INSET = 10; // the card's frame around the photos
const SLIDES = 5; // dishes in the strip

type Props = { store: Store; dishes: Product[]; offer: number; tint: NameTint; surface: string; shade: string };

/** `offer` is the restaurant's best discount (%), 0 for none. */
export const RestaurantCard = memo(function RestaurantCard({ store, dishes, offer, tint: [wash], surface, shade }: Props) {
  const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat(); const { isFollowing, toggle } = useFollowedStores();
  const width = useAppDimensions().width - SIDE * 2 - INSET * 2; const [slide, setSlide] = useState(0);
  const shown = dishes.slice(0, SLIDES); const saved = isFollowing(store.id);
  return <Tap testID={`restaurant-${store.id}`} accessibilityRole="button" accessibilityLabel={t('home.shopStore', { name: store.name })} onPress={() => router.push(`/store/${store.id}`)} style={[s.card, { backgroundColor: surface, boxShadow: neu(7, shade) }]}>
    <View style={[s.photos, { backgroundColor: wash }]}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={e => setSlide(Math.round(e.nativeEvent.contentOffset.x / width))}>
        {shown.map(p => <View key={p.id} style={{ width }}>
          <Image source={p.image} style={s.photo} contentFit="cover" />
          <View style={s.dish}>
            <Text numberOfLines={1} style={s.dishName}>{p.name}</Text>
            <Text style={s.dishPrice}>{fmt.money(p.price)}</Text>
            {p.mrp > p.price && <Text style={s.dishMrp}>{fmt.money(p.mrp)}</Text>}
          </View>
        </View>)}
      </ScrollView>
      {/* The same heart as on the item cards. */}
      <HeartToggle testID={`restaurant-save-${store.id}`} accessibilityLabel={saved ? t('store.following') : t('store.follow')} accessibilityState={{ selected: saved }} saved={saved} onToggle={() => toggle(store.id)} hitSlop={8} style={s.save} size={22} color={colors.surface} savedColor={colors.onError} />
      {shown.length > 1 && <View style={s.dots}>{shown.map((p, n) => <View key={p.id} style={[s.dot, n === slide && s.dotOn]} />)}</View>}
    </View>
    <View style={s.body}>
      <View style={s.head}>
        <Text numberOfLines={1} style={s.name}>{store.name}</Text>
        <View style={[s.rating, { backgroundColor: surface, boxShadow: neu(2, shade) }]}><Icon name="star" size={12} color={colors.gold} /><Text style={s.ratingText}>{fmt.number(store.rating, { maxFractionDigits: 1 })}</Text></View>
      </View>
      <View style={s.line}>
        <Icon name="flash" size={13} color={colors.forest} /><Text style={s.time}>{fmt.deliveryTime(store.delivery_time)}</Text>
        {!!store.tagline && <><View style={s.sep} /><Text numberOfLines={1} style={s.tagline}>{store.tagline}</Text></>}
      </View>
      {offer > 0 && <View style={s.offer}>
        <Icon name="pricetag" size={12} color={colors.forestDeep} /><Text style={s.offerText}>{t('foodPage.offer', { pct: fmt.percent(offer) })}</Text>
      </View>}
    </View>
  </Tap>;
});

const s = StyleSheet.create({
  card: { marginHorizontal: SIDE, marginBottom: 28, padding: INSET, borderRadius: radius.lg },
  photos: { height: 190, borderRadius: radius.md, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  dish: { position: 'absolute', top: 10, left: 10, maxWidth: '78%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.overlay },
  dishName: { flexShrink: 1, fontSize: 12, fontWeight: '600', color: colors.surface },
  dishPrice: { fontSize: 12, fontWeight: '800', color: colors.surface },
  dishMrp: { fontSize: 11, color: colors.surface, opacity: 0.75, textDecorationLine: 'line-through' },
  // Just the heart on the photo, its shadow in its own shape so it reads on light and dark pictures alike.
  save: { position: 'absolute', top: 8, right: 8, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', ...photoIconShadow },
  dots: { position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.surface, opacity: 0.6 },
  dotOn: { width: 16, opacity: 1 },
  body: { paddingHorizontal: 6, paddingTop: 14, paddingBottom: 6, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontSize: 20, lineHeight: 25, fontWeight: '800', letterSpacing: -0.3, color: colors.onSurface },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, minHeight: 30, borderRadius: radius.pill },
  ratingText: { fontSize: 13, fontWeight: '800', color: colors.onSurface },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { fontSize: 13, fontWeight: '700', color: colors.forest },
  sep: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.muted },
  tagline: { flex: 1, fontSize: 13, color: colors.muted },
  // The app's offer tag: lime with deep green words, as on the item cards and the ads.
  offer: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.electricLime },
  offerText: { fontSize: 12, fontWeight: '800', color: colors.forestDeep },
});
