// Shops one under another (Home, Categories), each a card in its own tint, with a title bar (logo, name and delivery time;
// tapping it opens the shop), a row of its kinds of item to pick from, and its items in a sideways rail.
import { memo, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Text } from '../ui/text';
import { Tap } from './tap';
import { ProductRail } from './catalog-sections';
import { colors, listTints, popBase, radius, type NameTint } from '../theme';
import { logoSize, logoTile } from '../logo-tile';
import { useFormat, useTranslation } from '../i18n';
import type { Category, Product, Store } from '../api';

// A card shows up to this many items of what is picked; the shop's page has the rest.
const RAIL = 8;

/** Each shop in its own tint (theme's listTints, so neighbours differ). `categories` names the kinds of item; `scope`
 *  prefixes each shop's test ids. */
export function ShopList({ shops, categories, scope }: { shops: { store: Store; products: Product[] }[]; categories: Category[]; scope: string }) {
  const names = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const tints = listTints(shops.map(s => s.store.id));
  return <>{shops.map(({ store, products }, n) => <ShopSection key={store.id} store={store} products={products} names={names} tint={tints[n]} scope={`${scope}-${store.id}`} />)}</>;
}

type Props = { store: Store; products: Product[]; names: Map<string, string>; scope: string; tint: NameTint };

// Memoised: the list re-renders a shop only when its shop or items change.
const ShopSection = memo(function ShopSection({ store, products, names, scope, tint: [wash, ink] }: Props) {
  const router = useRouter(); const { t } = useTranslation(); const fmt = useFormat();
  const [picked, setPicked] = useState<string | null>(null);
  // The shop's kinds of item in the order its items come, each with a photo of its first item.
  const kinds = useMemo(() => Array.from(new Map(products.map(p => [p.category_id, p.image]))), [products]);
  const shown = useMemo(() => (picked ? products.filter(p => p.category_id === picked) : products).slice(0, RAIL), [products, picked]);
  return <View testID={`${scope}-section`} style={[s.card, { backgroundColor: wash }]}>
    <Tap testID={`${scope}-open`} accessibilityRole="button" accessibilityLabel={t('home.shopStore', { name: store.name })} onPress={() => router.push(`/store/${store.id}`)} style={s.head}>
      <View style={s.logoTile}>{!!store.logo && <Image source={store.logo} style={s.logo} contentFit="contain" />}</View>
      <View style={s.copy}>
        <Text numberOfLines={1} style={[s.name, { color: ink }]}>{store.name}</Text>
        <Text numberOfLines={1} style={s.meta}>{t('home.storeMeta', { time: fmt.deliveryTime(store.delivery_time), rating: fmt.number(store.rating, { maxFractionDigits: 2 }) })}</Text>
      </View>
      <View style={[s.open, { backgroundColor: ink }]}><ChevronRight size={16} color={colors.surface} strokeWidth={2.5} /></View>
    </Tap>
    {/* One kind of item needs nothing to pick from. The picked one fills with the shop's deep colour, raised on a darker base. */}
    {kinds.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.kinds}>
      {[[null, ''] as const, ...kinds].map(([kind, photo]) => {
        const on = kind === picked; const label = kind ? names.get(kind) ?? kind : t('common.all');
        return <Tap key={kind ?? 'all'} testID={`${scope}-kind-${kind ?? 'all'}`} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => setPicked(kind)} style={[s.kind, !photo && s.kindPlain, on && [s.kindOn, { backgroundColor: ink }]]}>
          {!!photo && <Image source={photo} style={[s.thumb, on && s.thumbOn]} contentFit="cover" />}
          <Text numberOfLines={1} style={[s.kindText, { color: on ? colors.surface : ink }]}>{label}</Text>
        </Tap>;
      })}
    </ScrollView>}
    {/* Keyed by what is picked, so a new pick starts the rail from its first item. */}
    <ProductRail key={picked ?? 'all'} products={shown} scope={scope} accent={ink} />
  </View>;
});

const s = StyleSheet.create({
  card: { marginTop: 16, marginHorizontal: 12, paddingVertical: 16, gap: 14, borderRadius: radius.md, overflow: 'hidden' },
  // Inset to the rail's own padding, so the logo lines up with the first item.
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, minHeight: 48 },
  logoTile: logoTile(44),
  logo: { width: logoSize(44), height: logoSize(44) },
  copy: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 12, color: colors.muted },
  open: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  // Room below for the picked pill's base.
  kinds: { paddingHorizontal: 20, paddingBottom: 3, gap: 8 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingLeft: 5, paddingRight: 12, borderRadius: radius.pill, backgroundColor: colors.surface },
  kindPlain: { paddingLeft: 12 },
  kindOn: { boxShadow: popBase(3) },
  thumb: { width: 24, height: 24, borderRadius: 12 },
  thumbOn: { borderWidth: 1.5, borderColor: colors.surface },
  kindText: { fontSize: 12, fontWeight: '700' },
});
