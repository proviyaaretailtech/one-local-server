// Categories: the brand header on a plain page, then each group of categories under its title, four mint tiles to a row.
// A tile opens the shops that sell its catalogue category.
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Text } from '@/src/ui/text';
import { IconTile } from '@/src/ui/icon-tile';
import { Tap } from '@/src/components/tap';
import { colors } from '@/src/theme';
import { CityScroll } from '@/src/motion';
import { useAppDimensions, useLineHeight } from '@/src/layout';
import { useScreenPalette } from '@/src/use-screen-path';
import { BrandHeader } from '@/src/components/brand-header';
import { CATEGORY_GROUPS } from '@/src/shop-categories';
import { useTranslation } from '@/src/i18n';

const SIDE = 16;
const GAP = 12;
const COLUMNS = 4;

export default function Categories() {
  const router = useRouter(); const { t } = useTranslation(); const palette = useScreenPalette(); const { width } = useAppDimensions(); const lineHeight = useLineHeight();
  const cell = (width - SIDE * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
  return <CityScroll testID="categories-screen" bleed showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
    {/* A light wash of the page's own colour (the purple the dock picks Categories out in), fading to white. */}
    <LinearGradient pointerEvents="none" colors={[palette.top, palette.mid, palette.fade]} locations={[0, 0.5, 1]} style={s.wash} />
    <BrandHeader tone="light" />
    {CATEGORY_GROUPS.map(group => <View key={group.id} testID={`category-group-${group.id}`} style={s.group}>
      <Text style={s.title}>{t(group.name)}</Text>
      <View style={s.grid}>
        {group.items.map(item => {
          const name = t(item.name);
          return <Tap key={item.id} testID={`category-tile-${item.id}`} accessibilityRole="button" accessibilityLabel={name} onPress={() => router.push(`/category/shops/${item.category}?tile=${item.id}`)} style={[s.cell, { width: cell }]}>
            <IconTile source={item.icon} variant="mint" />
            <Text numberOfLines={2} style={[s.name, { lineHeight: lineHeight(12, 15) }]}>{name}</Text>
          </Tap>;
        })}
      </View>
    </View>)}
  </CityScroll>;
}

const s = StyleSheet.create({
  content: { backgroundColor: colors.surface, paddingBottom: 24 },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 480 },
  group: { marginTop: 24, paddingHorizontal: SIDE, gap: 14 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.3, color: colors.onSurface },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: 18 },
  cell: { alignItems: 'center', gap: 8 },
  name: { fontSize: 12, lineHeight: 15, minHeight: 30, fontWeight: '600', textAlign: 'center', color: colors.onSurface },
});
