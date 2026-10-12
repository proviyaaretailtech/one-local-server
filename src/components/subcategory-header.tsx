import { useRef, useState } from 'react';
import { Animated, Text, TextInput, Pressable, Platform, Share, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { useDeliveryLocation } from '../delivery-location';
import { useTranslation } from '../i18n';

/** What the category screen's notice bar can say. Codes, not sentences, so it re-translates if the language changes while it shows. */
export type CategoryNotice = 'linkCopied' | 'shareFailed' | 'saveFailed';

export function SubcategoryHeader({ id, title, query, setQuery, scroll, onNotice }: { id: string; title: string; query: string; setQuery: (s: string) => void; scroll: Animated.Value; onNotice: (notice: CategoryNotice) => void }) {
  const router = useRouter(); const { location, edit } = useDeliveryLocation(); const { t } = useTranslation();
  const [searching, setSearching] = useState(false); const input = useRef<TextInput>(null);
  const share = async () => {
    const url = Linking.createURL(`/category/${id}`);
    try {
      if (Platform.OS === 'web') { await Clipboard.setStringAsync(url); onNotice('linkCopied'); }
      else await Share.share({ message: t('category.shareMessage', { title, url }), url });
    } catch { onNotice('shareFailed'); }
  };
  return <Animated.View testID="subcategory-header" style={[styles.header, { height: scroll.interpolate({ inputRange: [0, 90], outputRange: [65, 52], extrapolate: 'clamp' }) }]}>
    <Pressable testID="cat-back-btn" accessibilityLabel={t('common.goBack')} onPress={() => router.canGoBack() ? router.back() : router.replace('/categories')} style={styles.icon}><Icon name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
    {searching ? <TextInput ref={input} testID="category-search" accessibilityLabel={t('category.searchThis')} autoFocus value={query} onChangeText={setQuery} placeholder={t('category.searchPlaceholder')} placeholderTextColor={colors.muted} returnKeyType="search" style={styles.input} /> : <Pressable testID="subcategory-location" accessibilityLabel={t('category.changeAddress', { location })} onPress={edit} style={styles.heading}><Text testID="category-title" numberOfLines={1} style={styles.title}>{title}</Text><Animated.View style={[styles.delivery, { height: scroll.interpolate({ inputRange: [0, 90], outputRange: [19, 0], extrapolate: 'clamp' }), opacity: scroll.interpolate({ inputRange: [0, 65], outputRange: [1, 0], extrapolate: 'clamp' }) }]}><Text testID="subcategory-delivery-address" numberOfLines={1} style={styles.address}><Text style={styles.addressLabel}>{t('category.deliveringTo')} </Text>{location}</Text><Icon name="chevron-down" size={9} color={colors.forest} /></Animated.View></Pressable>}
    {!searching && <Pressable testID="subcategory-share" accessibilityLabel={t('category.shareCategory')} onPress={() => void share()} style={styles.icon}><Icon name="share-outline" size={22} color={colors.onSurface} /></Pressable>}
    <Pressable testID="subcategory-search-toggle" accessibilityLabel={searching ? t('category.closeSearch') : t('category.searchCategory')} onPress={() => { if (searching) setQuery(''); setSearching(!searching); }} style={styles.icon}><Icon name={searching ? 'close' : 'search-outline'} size={24} color={colors.onSurface} /></Pressable>
  </Animated.View>;
}
const styles = StyleSheet.create({ header: { backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, borderBottomWidth: 1, borderBottomColor: colors.border }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, heading: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingLeft: 5 }, title: { color: colors.onSurface, fontSize: 14, fontWeight: '700', letterSpacing: 0.1 }, delivery: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden', gap: 4 }, address: { flexShrink: 1, color: colors.muted, fontSize: 10 }, addressLabel: { fontWeight: '700', color: colors.forest }, input: { flex: 1, minHeight: 44, color: colors.onSurface, fontSize: 14, paddingHorizontal: 8 } });