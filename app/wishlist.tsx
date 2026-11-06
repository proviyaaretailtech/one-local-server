import { View, StyleSheet } from 'react-native';
import { useAppDimensions } from '@/src/layout';
import { useRouter } from 'expo-router';
import { useCustomer } from '@/src/customer';
import { useCatalog } from '@/src/use-catalog';
import { ProductCard } from '@/src/components/product-card';
import { LoadState } from '@/src/components/catalog-sections';
import { AccountLayout, Message } from '@/src/components/account-layout';
import { Button } from '@/src/ui/button';
import { EmptyState } from '@/src/ui/states';
import { useTranslation } from '@/src/i18n';
export default function Wishlist() {
  const { t } = useTranslation(); const { saved, ready, error } = useCustomer(); const { data, isError, refetch } = useCatalog(); const router = useRouter(); const { width } = useAppDimensions();
  if (!data || !ready) return <LoadState error={isError} retry={refetch} />;
  const products = data.products.filter(p => saved.includes(p.id));
  return <AccountLayout id="wishlist" title={t('wishlist.title')} subtitle={t('wishlist.subtitle', { count: products.length })}><Message id="wishlist-error" text={error} error />{products.length ? <View style={s.grid}>{products.map(p => <ProductCard key={p.id} scope="wishlist" product={p} width={(width - 44) / 2} />)}</View> : <EmptyState testID="wishlist-empty" icon="heart-outline" title={t('wishlist.emptyTitle')} body={t('wishlist.emptyBody')}><Button testID="wishlist-browse" title={t('wishlist.browse')} onPress={() => router.push('/categories')} /></EmptyState>}</AccountLayout>;
}
const s = StyleSheet.create({ grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 } });
