import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDimensions } from '@/src/layout';
import { useFeatures } from '@/src/features';
import { ComingSoon } from '@/src/components/coming-soon';
import { View, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '@/src/theme';
import { useErrorMessage, useTranslation } from '@/src/i18n';
import { AISearchResult, uploadSearch } from '@/src/api';
import { useCatalog } from '@/src/use-catalog';
import { VoiceSearchControl } from '@/src/components/voice-search-control';
import { ProductCard } from '@/src/components/product-card';

function SmartSearchScreen() {
  const { mode } = useLocalSearchParams<{ mode: string }>(); const voice = mode === 'voice'; const router = useRouter(); const { data } = useCatalog(); const width = useAppDimensions().width;
  const { t } = useTranslation(); const message = useErrorMessage();
  const [photo, setPhoto] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState<AISearchResult | null>(null);
  const request = useRef<AbortController | null>(null); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  const searchFile = useCallback(async (uri: string, filename: string, type: string) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setResult(null);
    const timeout = setTimeout(() => controller.abort(), 115000);
    try { const response = await uploadSearch(voice ? 'voice' : 'image', uri, filename, type, controller.signal); if (alive.current) setResult(response); }
    catch (e: any) { if (alive.current) setError(e.name === 'AbortError' ? t('search.smart.timeout') : e.message ? message(e) : t('search.smart.unavailable')); }
    finally { clearTimeout(timeout); if (alive.current) setBusy(false); }
  }, [voice, t, message]);
  const pick = async (camera: boolean) => {
    if (busy) return; setError('');
    try {
      if (camera) { const permission = await ImagePicker.requestCameraPermissionsAsync(); if (!permission.granted) { setError(t('search.smart.cameraOff')); return; } }
      const response = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, selectionLimit: 1 });
      if (response.canceled || !response.assets[0]) return;
      const asset = response.assets[0];
      const converted = await manipulateAsync(asset.uri, asset.width > 1400 ? [{ resize: { width: 1400 } }] : [], { compress: 0.85, format: SaveFormat.JPEG });
      setPhoto(converted.uri); await searchFile(converted.uri, 'product.jpg', 'image/jpeg');
    } catch { setError(t('search.smart.photoFailed')); }
  };
  const products = result?.product_ids.flatMap(id => data?.products.filter(p => p.id === id) || []) || [];
  return <ScrollView testID="smart-search-screen" contentContainerStyle={styles.content}>
    <View style={styles.header}><Pressable testID="smart-search-back" accessibilityLabel={t('common.goBack')} style={styles.round} onPress={() => router.canGoBack() ? router.back() : router.replace('/search' as any)}><Icon name="arrow-back" size={19} color={colors.onSurface} /></Pressable><View style={styles.flex}><Text testID="smart-search-title" style={styles.title}>{voice ? t('search.smart.titleVoice') : t('search.smart.titleImage')}</Text><Text style={styles.subtitle}>{t('search.smart.subtitle')}</Text></View>
      <View style={styles.aiTag}><Icon name="sparkles-outline" size={13} color={colors.forest} />
        <Text style={styles.tagText}>AI</Text>{/* i18n-ignore: the acronym stays Latin in every language */}
      </View></View>
    <View style={styles.panel}>
      <Text style={styles.description}>{voice ? t('search.smart.descVoice') : t('search.smart.descImage')}</Text>
      {voice ? <VoiceSearchControl onRecording={searchFile} onError={setError} disabled={busy} /> : <>{!!photo && <Image testID="ai-photo-preview" source={photo} style={styles.photo} contentFit="contain" />}<View style={styles.photoActions}><Pressable testID="ai-take-photo" disabled={busy} style={styles.photoButton} onPress={() => void pick(true)}><Icon name="camera-outline" size={23} color={colors.forest} /><Text style={styles.buttonText}>{t('search.smart.takePhoto')}</Text></Pressable><Pressable testID="ai-choose-photo" disabled={busy} style={styles.photoButton} onPress={() => void pick(false)}><Icon name="images-outline" size={23} color={colors.forest} /><Text style={styles.buttonText}>{t('search.smart.choosePhoto')}</Text></Pressable></View></>}
      <Text testID="ai-search-privacy" style={styles.privacy}>{voice ? t('search.smart.privacyVoice') : t('search.smart.privacyImage')}</Text>
    </View>
    {busy && <View testID="ai-search-loading" style={styles.loading}><ActivityIndicator color={colors.forest} /><Text style={styles.description}>{voice ? t('search.smart.loadingVoice') : t('search.smart.loadingImage')}</Text><Pressable testID="ai-search-cancel" style={styles.retry} onPress={() => request.current?.abort()}><Text style={styles.buttonText}>{t('search.smart.cancel')}</Text></Pressable></View>}
    {!!error && <View testID="ai-search-error" style={styles.error}><Text style={styles.errorText}>{error}</Text>{!voice && !!photo && <Pressable testID="ai-search-retry" style={styles.retry} onPress={() => void searchFile(photo, 'product.jpg', 'image/jpeg')}><Text style={styles.buttonText}>{t('search.smart.retryPhoto')}</Text></Pressable>}</View>}
    {result && <View style={styles.results}><Text testID="ai-recognised-query" style={styles.resultTitle}>{result.query}</Text>{!!result.transcript && <Text testID="voice-transcript" style={styles.transcript}>{t('search.smart.youSaid', { text: result.transcript })}</Text>}<Text testID="ai-search-explanation" style={styles.description}>{result.explanation}</Text><View style={styles.grid}>{products.map(p => <ProductCard product={p} key={p.id} scope="ai" width={(width - 52) / 2} />)}</View>{!products.length && <Text testID="ai-search-no-matches" style={styles.description}>{t('search.smart.noMatches')}</Text>}<Text style={styles.privacy}>{t('search.smart.mistakes')}</Text></View>}
    <Pressable testID="ai-use-text-search" onPress={() => router.replace(`/search?q=${encodeURIComponent(result?.query || '')}` as any)} style={styles.textSearch}><Icon name="search-outline" size={16} color={colors.forest} /><Text style={styles.buttonText}>{t('search.smart.typeInstead')}</Text><Icon name="arrow-forward" size={15} color={colors.forest} /></Pressable>
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { padding: 20, paddingBottom: 35 }, header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 22 }, round: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.glassBright, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 }, title: { color: colors.onSurface, fontSize: 23, fontWeight: '600', letterSpacing: -0.6 }, subtitle: { fontSize: 10, color: colors.muted, marginTop: 5 }, aiTag: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 10, borderRadius: 22, backgroundColor: colors.glassBright }, tagText: { fontSize: 10, fontWeight: '600', color: colors.forest }, panel: { borderRadius: 30, backgroundColor: colors.glassBright, borderWidth: 1, borderColor: colors.glassLine, padding: 21 }, description: { fontSize: 12, color: colors.muted, lineHeight: 20 }, photo: { width: '100%', height: 150, borderRadius: 24, marginTop: 15 }, photoActions: { flexDirection: 'row', gap: 12, marginTop: 20, marginBottom: 14 }, photoButton: { flex: 1, minHeight: 96, paddingVertical: 10, paddingHorizontal: 6, backgroundColor: colors.limeSoft, borderRadius: 25, alignItems: 'center', justifyContent: 'center', gap: 10 }, buttonText: { color: colors.forest, fontSize: 11, fontWeight: '600', textAlign: 'center' }, privacy: { fontSize: 9, color: colors.muted, lineHeight: 15, marginTop: 14 }, loading: { padding: 20, alignItems: 'center', gap: 12 }, error: { marginTop: 18, padding: 18, borderRadius: 23, backgroundColor: colors.error }, errorText: { color: colors.onError, fontSize: 12, lineHeight: 19 }, retry: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, results: { marginTop: 25 }, resultTitle: { fontSize: 21, fontWeight: '600', color: colors.onSurface }, transcript: { fontSize: 12, color: colors.forest, marginVertical: 12, lineHeight: 19 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 }, textSearch: { marginTop: 24, minHeight: 48, borderRadius: 25, backgroundColor: colors.glassBright, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 9 } });
// Live only once its feature is switched on (src/features.ts); otherwise a 'coming soon' screen.
export default function SmartSearch() { return useFeatures().ai_search ? <SmartSearchScreen /> : <ComingSoon feature="ai_search" />; }
