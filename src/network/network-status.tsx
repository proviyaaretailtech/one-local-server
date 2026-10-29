// The app's connection and "cannot be used right now" states, mounted once in app/_layout.tsx:
//
//   - a slim strip under the status bar while offline ("You're offline. Showing what was saved." + Retry),
//     then a short "Back online" when the server answers again (src/network/online-state.ts);
//   - a full-screen block when the server answers 426 (update the app) or 503 'maintenance'
//     (src/network/app-blocked-state.ts).
//
// Animations run on the UI thread (Reanimated) and are skipped when the person has asked for reduced motion.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import Constants from 'expo-constants';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { useTranslation } from '@/src/i18n';
import { API } from '@/src/api';
import { updateHeaders } from '@/src/app-identity';
import { useMotionAllowed } from '@/src/motion';
import { colors } from '@/src/theme';
import { checkNow, configureProbe, isOnline, subscribeOnline } from './online-state';
import { getAppBlock, noteResponse, subscribeAppBlock } from './app-blocked-state';

const PROBE_TIMEOUT_MS = 6_000;
const BACK_ONLINE_MS = 2_500;

// Reachability: GET /api/health (app/api/health+api.ts). Any answer from the server counts as online;
// the answer is also checked for a 426 / maintenance block.
async function probeServer(path: string): Promise<boolean> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS) : null;
  try {
    const r = await fetch(`${API}${path}`, { headers: updateHeaders, signal: controller?.signal, cache: 'no-store' });
    // A healthy /health must not lift a maintenance block (the switch may spare the health check),
    // so from it only a blocking answer counts.
    if (path !== '/health' || !r.ok) await noteResponse(r).catch(() => {});
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
configureProbe(() => probeServer('/health'));

const useAppBlock = () => useSyncExternalStore(subscribeAppBlock, getAppBlock, getAppBlock);

export function NetworkStatus() {
  const block = useAppBlock();
  // Android back must not slip past the blocking screen into the app underneath.
  useEffect(() => {
    if (!block || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [block]);
  return (
    <>
      <OfflineStrip />
      {block ? <BlockingScreen block={block} /> : null}
    </>
  );
}

// ── Offline strip ────────────────────────────────────────────────────────────────────────────────────────────
type StripState = 'hidden' | 'offline' | 'back';

function OfflineStrip() {
  const motion = useMotionAllowed();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [state, setState] = useState<StripState>(() => (isOnline() ? 'hidden' : 'offline'));
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeOnline(() => {
      if (timer) clearTimeout(timer);
      if (!isOnline()) { setState('offline'); return; }
      setState(s => (s === 'offline' ? 'back' : s));
      timer = setTimeout(() => setState(s => (s === 'back' ? 'hidden' : s)), BACK_ONLINE_MS);
    });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, []);

  const shown = state !== 'hidden';
  const progress = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    progress.value = motion ? withTiming(shown ? 1 : 0, { duration: shown ? 220 : 180 }) : shown ? 1 : 0;
  }, [shown, motion, progress]);
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -16 }],
  }));

  const retry = async () => {
    if (checking) return;
    setChecking(true);
    try { await checkNow(); } finally { setChecking(false); }
  };

  const back = state === 'back';
  return (
    <Animated.View
      pointerEvents={shown ? 'box-none' : 'none'}
      style={[styles.stripWrap, { top: insets.top + 6 }, animated]}
    >
      {shown ? (
        <View
          style={[styles.strip, back && styles.stripBack]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          testID={back ? 'network-back-online' : 'network-offline'}
        >
          <Icon name={back ? 'checkmark-circle' : 'cloud-offline-outline'} size={18} color={back ? colors.forest : '#FFFFFF'} />
          <Text style={[styles.stripText, back && styles.stripTextBack]} numberOfLines={2}>
            {back ? t('network.backOnline') : t('network.offline')}
          </Text>
          {back ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: checking }}
              onPress={retry}
              hitSlop={8}
              style={({ pressed }) => [styles.stripButton, pressed && styles.pressed]}
              testID="network-retry"
            >
              <Text style={styles.stripButtonText}>{checking ? t('network.checking') : t('network.retry')}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </Animated.View>
  );
}

// ── Full-screen block ────────────────────────────────────────────────────────────────────────────────────────
function storeUrls(): string[] {
  const config = Constants.expoConfig;
  if (Platform.OS === 'android') {
    const pkg = config?.android?.package;
    return pkg ? [`market://details?id=${pkg}`, `https://play.google.com/store/apps/details?id=${pkg}`] : [];
  }
  if (Platform.OS === 'ios') {
    // The App Store link needs the numeric Apple id (set extra.appStoreId once the app is listed);
    // until then, open an App Store search for the app's name.
    const id = (config?.extra as { appStoreId?: string | number } | undefined)?.appStoreId;
    const name = encodeURIComponent(config?.name ?? 'OneLocal');
    return id
      ? [`itms-apps://apps.apple.com/app/id${id}`, `https://apps.apple.com/app/id${id}`]
      : [`itms-apps://itunes.apple.com/search?term=${name}&media=software`, `https://apps.apple.com/search?term=${name}`];
  }
  return [];
}

async function openStore() {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.location.reload();
    return;
  }
  for (const url of storeUrls()) {
    try { await Linking.openURL(url); return; } catch { /* try the next form */ }
  }
}

function BlockingScreen({ block }: { block: NonNullable<ReturnType<typeof getAppBlock>> }) {
  const { t, i18n } = useTranslation();
  const motion = useMotionAllowed();
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(false);
  const [stillDown, setStillDown] = useState(false);

  const progress = useSharedValue(motion ? 0 : 1);
  useEffect(() => { progress.value = motion ? withTiming(1, { duration: 240 }) : 1; }, [motion, progress]);
  const animated = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.98 + progress.value * 0.02 }] }));

  const update = block.kind === 'update';
  const lng = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const serverMessage = block.kind === 'maintenance' ? block.message : undefined;
  // In English the server's own sentence replaces ours; in another language ours stays and theirs is added below.
  const body = update ? t('network.update.body') : serverMessage && lng === 'en' ? serverMessage : t('network.maintenance.body');
  const extra = !update && serverMessage && lng !== 'en' ? serverMessage : null;

  const tryAgain = async () => {
    if (checking) return;
    setChecking(true); setStillDown(false);
    // A real route (not /health), so a maintenance switch that spares the health check is still seen.
    const reached = await probeServer('/features');
    setChecking(false);
    if (reached && getAppBlock()?.kind === 'maintenance') setStillDown(true);
    if (!reached) { setStillDown(true); void checkNow(); }
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.blockRoot]} accessibilityViewIsModal testID={update ? 'app-update-required' : 'app-maintenance'}>
      <Animated.View style={[styles.blockCard, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }, animated]}>
        <View style={styles.blockIcon}>
          <Icon name={update ? 'arrow-up-circle-outline' : 'construct-outline'} size={40} color={colors.forest} />
        </View>
        <Text style={styles.blockTitle} accessibilityRole="header">
          {update ? t('network.update.title') : t('network.maintenance.title')}
        </Text>
        <Text style={styles.blockBody}>{body}</Text>
        {extra ? <Text style={styles.blockExtra}>{extra}</Text> : null}
        {stillDown ? <Text style={styles.blockExtra} accessibilityLiveRegion="polite">{t('network.maintenance.still')}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: checking }}
          onPress={update ? openStore : tryAgain}
          style={({ pressed }) => [styles.blockButton, pressed && styles.pressed]}
          testID={update ? 'app-update-open-store' : 'app-maintenance-retry'}
        >
          {checking ? <ActivityIndicator color={colors.onBrandSecondary} /> : (
            <Text style={styles.blockButtonText}>
              {update ? (Platform.OS === 'web' ? t('network.update.reload') : t('network.update.button')) : t('network.maintenance.retry')}
            </Text>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stripWrap: { position: 'absolute', left: 12, right: 12, zIndex: 900, elevation: 12 },
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 8, paddingLeft: 14, paddingRight: 8,
    borderRadius: 14, backgroundColor: colors.surfaceInverse,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  stripBack: { backgroundColor: colors.limeSoft },
  stripText: { flex: 1, color: colors.onSurfaceInverse, fontSize: 13, fontWeight: '600' },
  stripTextBack: { color: colors.forest },
  stripButton: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.lime },
  stripButtonText: { color: colors.onBrandSecondary, fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.75 },
  blockRoot: { zIndex: 2000, elevation: 24, backgroundColor: colors.surface },
  blockCard: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  blockIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.limeSoft, marginBottom: 8 },
  blockTitle: { color: colors.onSurface, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  blockBody: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 360 },
  blockExtra: { color: colors.onSurfaceTertiary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 360 },
  blockButton: { marginTop: 12, minWidth: 200, minHeight: 50, paddingHorizontal: 24, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime },
  blockButtonText: { color: colors.onBrandSecondary, fontSize: 16, fontWeight: '700' },
});
