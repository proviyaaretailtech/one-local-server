import { useRef, useState } from 'react';
import { Animated, Pressable, Platform, Share, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/src/ui/text';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import Icon from '@react-native-vector-icons/ionicons';
import { Tap } from './tap';
import { colors, lightPane } from '../theme';
import { useDeliveryLocation } from '../delivery-location';
import { useScreenPalette } from '../use-screen-path';
import { useTranslation } from '../i18n';

/** What the category screen's notice bar can say. Codes, not sentences, so it re-translates if the language changes while it shows. */
export type CategoryNotice = 'linkCopied' | 'shareFailed';

// The category screen's top: a wash of the page's colour (Categories' purple) from under the status bar, with round soft
// buttons like the brand header's. It tightens as the products scroll, the delivery line folding away.
export function SubcategoryHeader({ id, title, query, setQuery, scroll, onNotice }: { id: string; title: string; query: string; setQuery: (s: string) => void; scroll: Animated.Value; onNotice: (notice: CategoryNotice) => void }) {
  const router = useRouter(); const { location, edit } = useDeliveryLocation(); const { t } = useTranslation(); const insets = useSafeAreaInsets(); const palette = useScreenPalette();
  const [searching, setSearching] = useState(false); const input = useRef<TextInput>(null);
  const share = async () => {
    const url = Linking.createURL(`/category/${id}`);
    try {
      if (Platform.OS === 'web') { await Clipboard.setStringAsync(url); onNotice('linkCopied'); }
      else await Share.share({ message: t('category.shareMessage', { title, url }), url });
    } catch { onNotice('shareFailed'); }
  };
  return <View testID="subcategory-header" style={{ paddingTop: insets.top }}>
    <LinearGradient pointerEvents="none" colors={[palette.top, palette.mid]} style={StyleSheet.absoluteFill} />
    <Animated.View style={[styles.row, { height: scroll.interpolate({ inputRange: [0, 90], outputRange: [68, 56], extrapolate: 'clamp' }) }]}>
      <Tap testID="cat-back-btn" accessibilityRole="button" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/categories')} style={styles.icon}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Tap>
      {searching ? <TextInput ref={input} testID="category-search" accessibilityLabel={t('category.searchThis')} autoFocus value={query} onChangeText={setQuery} placeholder={t('category.searchPlaceholder')} placeholderTextColor={colors.muted} returnKeyType="search" style={styles.input} /> : <Pressable testID="subcategory-location" accessibilityLabel={t('category.changeAddress', { location })} onPress={edit} style={styles.heading}><Text testID="category-title" numberOfLines={1} style={styles.title}>{title}</Text><Animated.View style={[styles.delivery, { height: scroll.interpolate({ inputRange: [0, 90], outputRange: [18, 0], extrapolate: 'clamp' }), opacity: scroll.interpolate({ inputRange: [0, 65], outputRange: [1, 0], extrapolate: 'clamp' }) }]}><Text testID="subcategory-delivery-address" numberOfLines={1} style={styles.address}><Text style={[styles.addressLabel, { color: palette.color }]}>{t('category.deliveringTo')} </Text>{location}</Text><Icon name="chevron-down" size={9} color={palette.color} /></Animated.View></Pressable>}
      {!searching && <Tap testID="subcategory-share" accessibilityRole="button" accessibilityLabel={t('category.shareCategory')} onPress={() => void share()} style={styles.icon}><Icon name="share-outline" size={19} color={colors.onSurface} /></Tap>}
      <Tap testID="subcategory-search-toggle" accessibilityRole="button" accessibilityLabel={searching ? t('category.closeSearch') : t('category.searchCategory')} onPress={() => { if (searching) setQuery(''); setSearching(!searching); }} style={styles.icon}><Icon name={searching ? 'close' : 'search-outline'} size={20} color={colors.onSurface} /></Tap>
    </Animated.View>
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  icon: { ...lightPane, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  title: { color: colors.onSurface, fontSize: 18, lineHeight: 23, fontWeight: '800', letterSpacing: -0.2 },
  delivery: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden', gap: 4 },
  address: { flexShrink: 1, color: colors.muted, fontSize: 11 },
  addressLabel: { fontWeight: '700' },
  // A text field takes no layered shadow, so it is the soft pane's fill and edge alone.
  input: { flex: 1, minHeight: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, fontSize: 14, paddingHorizontal: 16 },
});
