// The top of Home and Categories: the brand, the location, wallet and profile, then search and
// the Local / National switch. `tone`: 'photo' is white glass over a backdrop (Home), 'light' is soft panes on a plain
// page (Categories). `origin`: whether the page lists products, so the switch has something to filter (Book It does
// not); without it the search bar takes the whole row. It starts below the status bar, and its heights are fixed so where
// its search bar sits (HEADER_COMPACT_AT) is known before layout: the shell's compact search bar takes over from there.
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, MapPin, User, Wallet } from 'lucide-react-native';
import { Text } from '../ui/text';
import { SearchBar } from '../ui/search-bar';
import { Tap } from './tap';
import { BrandLogo } from './brand-logo';
import { OriginToggle } from './origin-toggle';
import { SoonBadge } from './soon-badge';
import { colors, glassPane, lightPane, type Tone } from '../theme';
import { useDeliveryLocation } from '../delivery-location';
import { useTranslation } from '../i18n';
import { useIsDesktop } from '../layout';
import { useFeatures } from '../features';

const TOP_GAP = 6;
const LOGO = 18;
const PLACE = 32;
const SEARCH_GAP = 14;
/** Scroll offset where the shell's compact header takes over: as this header's search bar slides up under it. */
export const HEADER_COMPACT_AT = TOP_GAP + LOGO + PLACE + SEARCH_GAP + 6;

function HeaderIcon({ testID, label, onPress, tone, children, soon }: { testID: string; label: string; onPress: () => void; tone: Tone; children: React.ReactNode; soon?: boolean }) {
  return <Tap testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} style={[s.icon, tone === 'photo' ? glassPane : lightPane]}>
    {children}{soon && <SoonBadge testID={`${testID}-soon`} />}
  </Tap>;
}

export function BrandHeader({ tone, origin = true }: { tone: Tone; origin?: boolean }) {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { t } = useTranslation();
  const { location, edit } = useDeliveryLocation(); const features = useFeatures(); const desktop = useIsDesktop();
  const onPhoto = tone === 'photo'; const ink = onPhoto ? colors.surface : colors.onSurface;
  return <View style={[s.header, { paddingTop: insets.top + TOP_GAP }]}>
    <View style={s.top}>
      <View style={s.lead}>
        {onPhoto ? <BrandLogo testID="company-logo" tone="dark" tint={colors.surface} height={LOGO} /> : <BrandLogo testID="company-logo" tone="light" height={LOGO} />}
        {/* No delivery-time chip: the founder removed 'Delivery in N min' from every header. */}
        <Tap testID="location-button" accessibilityRole="button" accessibilityLabel={t('shell.changeLocation')} onPress={edit} style={s.place}>
          <MapPin size={15} color={ink} strokeWidth={2.2} />
          <Text testID="selected-location" numberOfLines={1} style={[s.placeText, { color: ink }]}>{location}</Text>
          <ChevronDown size={15} color={ink} strokeWidth={2.2} />
        </Tap>
      </View>
      {/* Desktop has these in its top menu. */}
      {!desktop && <View style={s.actions}>
        <HeaderIcon testID="header-wallet-button" label={t('shell.wallet')} tone={tone} onPress={() => router.navigate('/wallet')} soon={!features.wallet}><Wallet size={19} color={ink} strokeWidth={1.8} /></HeaderIcon>
        <HeaderIcon testID="header-profile-btn" label={t('shell.profile')} tone={tone} onPress={() => router.navigate('/account')}><User size={19} color={ink} strokeWidth={1.8} /></HeaderIcon>
      </View>}
    </View>
    <View style={s.searchRow}>
      <SearchBar testID="header-search-button" tone={tone} placeholder={t('home.hero.searchPlaceholder')} accessibilityLabel={t('shell.searchProducts')} onPress={() => router.navigate('/search')} style={s.search} />
      {origin && <OriginToggle tone={tone} />}
    </View>
  </View>;
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20 },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lead: { flexShrink: 1 },
  // Devanagari: Android measures "10 मिनट" with letter-spacing too narrow, wraps "मिनट" and the fixed-height row cuts it off.
  place: { height: PLACE, flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', maxWidth: '100%' },
  placeText: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', gap: 12, marginTop: SEARCH_GAP },
  search: { flex: 1 },
});
