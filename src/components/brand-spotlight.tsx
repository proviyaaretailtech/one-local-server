import { useEffect, useRef, useState } from 'react';
import { useScreenPalette } from '../use-screen-path';
import { View, Pressable, Animated, StyleSheet, AccessibilityInfo, Platform } from 'react-native';
import { Text } from '@/src/ui/text';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { mediaUrl } from '../api';
import { FoodSpotlight } from './food-spotlight';
import { useLineHeight } from '../layout';
import { useFormat, useTranslation } from '../i18n';

// Words and prices live in the catalogue under home.spotlight.<variant>; what stays here is behaviour and look (picture, route, colour, icon).
const stories = {
  home: { asset: 'amul-cutout', price: 145, route: '/brand/amul', color: colors.forest, icon: 'heart-outline' },
  grocery: { asset: 'amul-cutout', route: '/brand/amul', color: colors.forest, icon: 'leaf-outline' },
  food: { asset: 'burger', price: 129, route: '/brand/mcdonalds', color: colors.food, icon: 'flame-outline' },
  shops: { asset: 'sneakers', price: 899, route: '/brand/nike', color: colors.book, icon: 'sparkles-outline' },
  care: { asset: 'skincare', price: 189, route: '/brand/nivea', color: colors.beauty, icon: 'flower-outline' },
  'book-it': { asset: 'concert', route: '/booking/e3', color: colors.book, icon: 'musical-notes-outline' },
} as const;
// A variant id is a code; the catalogue key group for it (camelCase).
const textKey = { home: 'home', grocery: 'grocery', food: 'food', shops: 'shops', care: 'care', 'book-it': 'bookIt' } as const;
const tagKey = { home: 'home.spotlight.home.tag', grocery: 'home.spotlight.grocery.tag', shops: 'home.spotlight.shops.tag', care: 'home.spotlight.care.tag' } as const;
export type SpotlightVariant = keyof typeof stories;
export function BrandSpotlight(props: { variant?: SpotlightVariant; switchable?: boolean }) { return props.variant === 'food' ? <FoodSpotlight /> : <DefaultBrandSpotlight {...props} />; }
function DefaultBrandSpotlight({ variant = 'home', switchable = false }: { variant?: SpotlightVariant; switchable?: boolean }) {
  const [selected, setSelected] = useState<SpotlightVariant>(variant);
  const { t } = useTranslation(); const fmt = useFormat(); const lineHeight = useLineHeight();
  const shown = switchable ? selected : variant;
  const baseStory = stories[shown];
  const currentPalette = useScreenPalette();
  const price = 'price' in baseStory ? fmt.money(baseStory.price) : '';
  const copy = {
    eyebrow: t(`home.spotlight.${textKey[shown]}.eyebrow`), title: t(`home.spotlight.${textKey[shown]}.title`), copy: t(`home.spotlight.${textKey[shown]}.copy`),
    // i18n-ignore: NIKS and Latur After Hours are proper names; every other tag is translated
    tag: shown === 'food' ? 'NIKS Brownies & Burger' : shown === 'book-it' ? 'Latur After Hours' : t(tagKey[shown]),
    detail: t(`home.spotlight.${textKey[shown]}.detail`, { price }), cta: t(`home.spotlight.${textKey[shown]}.cta`), badge: t(`home.spotlight.${textKey[shown]}.badge`),
  };
  const story = { ...baseStory, ...copy, color: currentPalette.color };
  const float = useRef(new Animated.Value(0)).current; const router = useRouter();
  useEffect(() => { let animation: Animated.CompositeAnimation | undefined; let disposed = false; AccessibilityInfo.isReduceMotionEnabled().then(reduce => { if (!reduce && !disposed) { animation = Animated.loop(Animated.sequence([Animated.timing(float, { toValue: -7, duration: 2100, useNativeDriver: Platform.OS !== 'web' }), Animated.timing(float, { toValue: 0, duration: 2100, useNativeDriver: Platform.OS !== 'web' })])); animation.start(); } }); return () => { disposed = true; animation?.stop(); }; }, [float]);
  // No background of its own: the page's shared gradient (app-shell) shows through, so there is no seam under the header.
  return <View testID={`spotlight-${variant}`} style={styles.wrap}>
    <View style={styles.hero}><View style={styles.glow} /><View style={styles.orbit} />
      <View style={styles.copy}><Text style={[styles.eyebrow, { color: story.color }]}>{story.eyebrow}</Text><Text testID={`spotlight-title-${variant}`} style={[styles.title, { lineHeight: lineHeight(25, 30) }]}>{story.title}</Text><Text style={styles.description}>{story.copy}</Text><Pressable testID={`spotlight-shop-${variant}`} accessibilityLabel={story.cta} onPress={() => router.push(story.route as any)} style={({ pressed }) => [styles.cta, { backgroundColor: story.color }, pressed && styles.pressed]}><Text style={styles.ctaText}>{story.cta}</Text><Icon name="arrow-forward" size={14} color={colors.surface} /></Pressable></View>
      <Animated.View style={[styles.art, { transform: [{ translateY: float }, { rotate: '-8deg' }] }]}><Image testID={`spotlight-image-${variant}`} source={mediaUrl(story.asset === 'amul-cutout' ? 'amul-float' : story.asset)} style={styles.image} contentFit={story.asset === 'amul-cutout' ? 'contain' : 'cover'} /></Animated.View>
      <View style={styles.sticker}><Icon name={story.icon as any} size={16} color={story.color} /><Text style={[styles.stickerText, { color: story.color }]}>{story.badge}</Text></View>
      <Pressable testID={`spotlight-brand-${variant}`} accessibilityLabel={t('home.spotlight.explore', { tag: story.tag })} onPress={() => router.push(story.route as any)} style={styles.floatingLabel}><View style={[styles.dot, { backgroundColor: story.color }]} /><View><Text style={styles.brandTag}>{story.tag}</Text><Text style={styles.detail}>{story.detail}</Text></View><Icon name="arrow-up-right-box-outline" size={14} color={story.color} /></Pressable>
    </View>
    {switchable ? <View style={styles.storyTabs}>{[{ id: 'home', text: t('home.spotlight.switchHome') }, { id: 'shops', text: t('home.spotlight.switchShops') }, { id: 'care', text: t('home.spotlight.switchCare') }].map(s => <Pressable testID={`spotlight-switch-${s.id}`} key={s.id} onPress={() => setSelected(s.id as SpotlightVariant)} style={[styles.storyTab, selected === s.id && styles.storySelected]}><View style={[styles.tinyDot, selected === s.id && { backgroundColor: colors.forest }]} /><Text style={styles.storyText}>{s.text}</Text></Pressable>)}</View> : <Text testID={`spotlight-notice-${variant}`} style={styles.sample}>{t('home.spotlight.sample')}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  // i18n-ignore: Latin design value; the Text overrides it with useLineHeight() in other languages
  wrap: { paddingBottom: 13 }, hero: { minHeight: 253, position: 'relative', overflow: 'hidden' }, copy: { marginTop: 17, marginLeft: 22, marginBottom: 12, width: '48%', zIndex: 2 }, eyebrow: { fontSize: 6.5, fontWeight: '600', letterSpacing: 1.2 }, title: { fontSize: 25, lineHeight: 30, fontWeight: '600', letterSpacing: -0.8, color: colors.onSurface, marginTop: 13 }, description: { color: colors.inkSoft, fontSize: 10, lineHeight: 16, marginTop: 10, width: 154 }, cta: { minHeight: 44, paddingHorizontal: 15, paddingVertical: 4, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 11, alignSelf: 'flex-start', marginTop: 17 }, ctaText: { color: colors.surface, fontSize: 10, fontWeight: '600' },
  art: { position: 'absolute', width: '47%', height: 182, right: -9, top: 32 }, image: { width: '100%', height: '100%', borderTopLeftRadius: 65, borderBottomRightRadius: 65, borderTopRightRadius: 32, borderBottomLeftRadius: 32 }, glow: { position: 'absolute', width: 222, height: 208, borderRadius: 108, backgroundColor: colors.glass, right: -36, top: 20, transform: [{ rotate: '-25deg' }] }, orbit: { position: 'absolute', width: 205, height: 200, borderRadius: 100, borderWidth: 1, borderColor: colors.glassLine, top: 40, right: -10 }, sticker: { position: 'absolute', right: 17, top: 5, backgroundColor: colors.glassBright, width: 65, height: 65, borderRadius: 33, alignItems: 'center', justifyContent: 'center', gap: 3, transform: [{ rotate: '11deg' }], zIndex: 3 }, stickerText: { textAlign: 'center', fontSize: 7, lineHeight: 10, fontWeight: '500' }, floatingLabel: { position: 'absolute', bottom: 0, right: 18, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, minHeight: 44, borderRadius: 22, backgroundColor: colors.glassBright, borderWidth: 1, borderColor: colors.glassLine, transform: [{ rotate: '-3deg' }], boxShadow: [{ offsetX: 0, offsetY: 5, blurRadius: 18, color: colors.shadow }] }, dot: { width: 6, height: 6, borderRadius: 3 }, brandTag: { fontSize: 9, color: colors.onSurface, fontWeight: '600' }, detail: { fontSize: 7, color: colors.muted, marginTop: 3 }, storyTabs: { flexDirection: 'row', marginHorizontal: 20, marginTop: 15, gap: 5 }, storyTab: { flex: 1, minHeight: 44, borderRadius: 24, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5 }, storySelected: { backgroundColor: colors.glassBright }, tinyDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }, storyText: { fontSize: 8, color: colors.onSurface }, sample: { marginTop: 16, textAlign: 'center', fontSize: 8, color: colors.muted }, pressed: { opacity: 0.7 },
});