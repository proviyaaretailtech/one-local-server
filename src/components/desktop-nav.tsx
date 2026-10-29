// Top menu bar for laptop and desktop browsers (see useIsDesktop). It replaces the phone's floating
// dock: the same five places, plus search, bag and account, in one sticky row above every screen.
import { StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { usePathname, useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { Tap } from './tap';
import { BrandLogo } from './brand-logo';
import { colors } from '../theme';
import { useCart } from '../cart';
import { departmentName } from '../departments';
import { useTranslation } from '../i18n';

const tabs = [
  { id: 'home', path: '/', route: '/(tabs)' },
  { id: 'categories', path: '/categories', route: '/(tabs)/categories' },
  { id: 'discover', path: '/discover', route: '/(tabs)/discover' },
  { id: 'food', path: '/food', route: '/(tabs)/food' },
  { id: 'book-it', path: '/book-it', route: '/(tabs)/book-it' },
];

export function DesktopNav() {
  const path = usePathname(); const router = useRouter(); const { t } = useTranslation(); const { totalItems } = useCart();
  const labels: Record<string, string> = { home: t('nav.home'), categories: t('nav.categories'), discover: t('nav.discover'), food: departmentName(t, 'food'), 'book-it': departmentName(t, 'book-it') };
  const selected = (id: string, route: string) => path === route || (id === 'categories' && (path.startsWith('/collection/') || path.startsWith('/category/')));
  return <View testID="desktop-nav" style={s.bar}>
    <Tap testID="desktop-nav-brand" accessibilityLabel={t('nav.home')} glow={false} haptic={false} onPress={() => router.navigate('/(tabs)' as never)}><BrandLogo tone="light" height={26} /></Tap>
    <View accessibilityRole="tablist" style={s.tabs}>
      {tabs.map(tab => {
        const on = selected(tab.id, tab.path);
        return <Tap key={tab.id} testID={`desktop-tab-${tab.id}`} accessibilityRole="tab" accessibilityLabel={labels[tab.id]} accessibilityState={{ selected: on }} glow={false} haptic={false} onPress={() => router.navigate(tab.route as never)} style={[s.tab, on && s.tabOn]}>
          <Text style={[s.label, on && s.labelOn]}>{labels[tab.id]}</Text>
        </Tap>;
      })}
    </View>
    <View style={s.actions}>
      <Tap testID="desktop-search" accessibilityLabel={t('shell.searchProducts')} glow={false} haptic={false} onPress={() => router.navigate('/search' as never)} style={s.icon}><Icon name="search-outline" size={20} color={colors.onSurface} /></Tap>
      <Tap testID="desktop-cart" accessibilityLabel={t('shell.cart')} glow={false} haptic={false} onPress={() => router.navigate('/cart' as never)} style={s.icon}>
        <Icon name="bag-handle-outline" size={20} color={colors.onSurface} />
        {totalItems > 0 && <View style={s.badge}><Text style={s.badgeText}>{totalItems}</Text></View>}
      </Tap>
      <Tap testID="desktop-account" accessibilityLabel={t('shell.profile')} glow={false} haptic={false} onPress={() => router.navigate('/account' as never)} style={s.icon}><Icon name="person-outline" size={20} color={colors.onSurface} /></Tap>
    </View>
  </View>;
}

const s = StyleSheet.create({
  bar: { height: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, gap: 32, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.glassLine, zIndex: 60 },
  tabs: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  tab: { height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.glassBright },
  label: { fontSize: 14, fontWeight: '500', color: colors.muted },
  labelOn: { color: colors.forest, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.whiteGlass },
  // i18n-ignore: a count, not text
  badge: { position: 'absolute', right: 1, top: 1, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest, paddingHorizontal: 3 },
  badgeText: { color: colors.surface, fontSize: 9, fontWeight: '700' },
});
