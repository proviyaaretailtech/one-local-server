import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { ThemedStore } from '../api';
import { colors } from '../theme';
import { useTranslation } from '../i18n';
export function StoreRail({ stores, scope = 'categories' }: { stores: ThemedStore[]; scope?: string }) {
  const router = useRouter(); const { t } = useTranslation();
  return <ScrollView horizontal testID={`${scope}-store-rail`} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
    {stores.map((store, i) => <Pressable testID={`${scope}-store-${store.id}`} accessibilityLabel={t('home.shopStore', { name: store.name })} key={store.id} onPress={() => router.push(`/collection/${store.id}` as any)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.art}><Image testID={`${scope}-store-image-${store.id}`} source={store.image} contentFit="cover" style={styles.image} transition={180} /><View style={styles.number}><Text style={styles.numberText}>0{i + 1}</Text></View><View style={styles.arrow}><Icon name="arrow-up-right-box-outline" size={14} color={colors.forest} /></View></View>
      <Text testID={`${scope}-store-name-${store.id}`} style={styles.name}>{store.name}</Text>
    </Pressable>)}
  </ScrollView>;
}
const styles = StyleSheet.create({ rail: { paddingHorizontal: 18, gap: 10, paddingBottom: 4 }, card: { width: 118 }, art: { width: 118, height: 128, borderRadius: 26, overflow: 'hidden', backgroundColor: colors.cityFade }, image: { width: '100%', height: '100%' }, number: { position: 'absolute', top: 9, left: 10 }, numberText: { fontSize: 8, letterSpacing: 1, fontWeight: '700', color: colors.inkSoft }, arrow: { position: 'absolute', right: 7, bottom: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.glassBright, alignItems: 'center', justifyContent: 'center' }, name: { fontSize: 12, lineHeight: 16, fontWeight: '700', textAlign: 'center', color: colors.onSurface, marginTop: 9, paddingHorizontal: 6 }, pressed: { opacity: 0.8, transform: [{ scale: 0.94 }, { rotate: '-2deg' }] } });