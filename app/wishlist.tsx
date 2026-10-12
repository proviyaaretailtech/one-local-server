import { View, Text, StyleSheet } from 'react-native';
import { useAppDimensions } from '@/src/layout';
import Icon from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { useCustomer } from '@/src/customer';
import { useCatalog } from '@/src/use-catalog';
import { ProductCard } from '@/src/components/product-card';
import { LoadState } from '@/src/components/catalog-sections';
import { AccountLayout, ActionButton, Message } from '@/src/components/account-layout';
import { colors } from '@/src/theme';
import { useTranslation } from '@/src/i18n';
export default function Wishlist() {
  const { t } = useTranslation(); const { saved, ready, error } = useCustomer(); const { data, isError, refetch } = useCatalog(); const router = useRouter(); const { width } = useAppDimensions();
  if (!data || !ready) return <LoadState error={isError} retry={refetch} />;
  const products = data.products.filter(p => saved.includes(p.id));
  return <AccountLayout id="wishlist" title={t('wishlist.title')} subtitle={t('wishlist.subtitle', { count: products.length })}><Message id="wishlist-error" text={error} error />{products.length ? <View style={s.grid}>{products.map(p => <ProductCard key={p.id} scope="wishlist" product={p} width={(width - 52) / 2} />)}</View> : <View testID="wishlist-empty" style={s.empty}><Icon name="heart-outline" size={56} color={colors.shops} /><Text style={s.title}>{t('wishlist.emptyTitle')}</Text><Text style={s.copy}>{t('wishlist.emptyBody')}</Text><ActionButton id="wishlist-browse" title={t('wishlist.browse')} onPress={() => router.push('/categories')} /></View>}</AccountLayout>;
}
const s = StyleSheet.create({ grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, empty: { alignItems: 'center', gap: 18, paddingTop: 45 }, title: { textAlign: 'center', color: colors.onSurface, fontSize: 22, fontWeight: '700' }, copy: { textAlign: 'center', color: colors.muted, fontSize: 14, lineHeight: 22 } });