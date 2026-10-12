// Shows CMS pop-ups (specs/home-cms/spec.md §2.5). Mounted once in app/_layout.tsx. Whatever the CMS says, the app keeps:
//  - at most one pop-up per app session and one per screen view (a strip does not count, and at most one strip per view);
//  - never on sign-in, cart / checkout, payment, payment result or live order tracking (rules.ts);
//  - the frequency cap per pop-up (once / daily / session), remembered on the phone;
//  - shown only after the screen settled (after interactions + 1 s) and only once its image is on the phone; if the image
//    cannot be fetched the pop-up waits for the next opportunity;
//  - one fade / slide on the UI thread (none with reduce motion); close always visible; back and tap outside close.
// If the API fails (or on web without a backend) nothing is shown.
import { useEffect, useRef, useState } from 'react';
import { useShowFirstRun } from '@/src/i18n/first-run';
import { InteractionManager, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Icon from '@react-native-vector-icons/ionicons';
import { useTranslation } from '@/src/i18n';
import { useCart } from '../cart';
import { useMotionAllowed } from '../motion';
import { colors, radius, spacing } from '../theme';
import { contentFor, fetchPopups, imageUrl, sendPopupEvent } from './api';
import { ComingSoonReceipts } from './coming-soon-receipt';
import { useDeliveryLocation } from '../delivery-location';
import { allowedByFrequency, isBlockedPath, markShown, screenOf, session } from './rules';
import type { Popup } from './types';

const SETTLE_MS = 1000;
const INTERACTIONS_CAP_MS = 1500;
const introShowing = () => !!(globalThis as { __onecityIntroShowing?: boolean }).__onecityIntroShowing;

export function PopupHost() {
  const pathname = usePathname() ?? '/';
  // No pop-up over the first-run language chooser either.
  const firstRun = useShowFirstRun();
  const blocked = isBlockedPath(pathname) || firstRun;
  const screen = screenOf(pathname);
  // The town the pop-ups were fetched for, printed on coming-soon receipts. PopupHost sits outside the shell, so this is
  // the saved town's default until the shell's location is lifted higher.
  const city = useDeliveryLocation().location.split(',')[0];
  const { i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? i18n.language ?? 'en').slice(0, 2);
  const hasCart = useCart().items.length > 0;
  const motion = useMotionAllowed();
  const { data } = useQuery({
    queryKey: ['popups', screen, lang, hasCart],
    queryFn: () => fetchPopups(screen, lang, hasCart),
    enabled: !blocked, staleTime: 60_000, retry: false,
  });
  const dataRef = useRef<Popup[] | undefined>(data);
  dataRef.current = data;

  const [modal, setModal] = useState<Popup | null>(null);
  const [strip, setStrip] = useState<Popup | null>(null);
  // One record per screen view: which view of the session it is, and whether this view already had its pop-up / strip.
  const view = useRef({ path: '', index: -1, modalDone: false, stripDone: false });
  const router = useRouter();

  // A new screen view starts a fresh record and closes what belonged to the previous screen. Declared before the effect
  // below so it runs first.
  useEffect(() => {
    if (view.current.path !== pathname) view.current = { path: pathname, index: session.viewIndex++, modalDone: false, stripDone: false };
    setStrip(null); setModal(null);
  }, [pathname]);

  const ready = data !== undefined;
  useEffect(() => {
    if (blocked || !ready) return;
    const v = view.current;
    if (!session.firstViewOf.has(screen)) session.firstViewOf.set(screen, v.index);
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tasks: { cancel: () => void }[] = [];

    const pick = async (wantStrip: boolean): Promise<Popup | null> => {
      for (const p of dataRef.current ?? []) {
        if ((p.format === 'strip') !== wantStrip || !p.screens.includes(screen)) continue;
        if (p.trigger === 'app_open' && session.firstViewOf.get(screen) !== v.index) continue;
        if (p.trigger === 'scroll_depth') continue;   // needs the screen's scroll position; not wired yet
        if (await allowedByFrequency(p)) return p;
      }
      return null;
    };
    const schedule = (p: Popup, show: (p: Popup) => void, stillAllowed: () => boolean) => {
      // Wait for interactions to finish, but never longer than INTERACTIONS_CAP_MS: an endless Animated loop
      // (e.g. the home hero's float) keeps InteractionManager busy forever.
      let started = false;
      const start = (run: () => void) => () => { if (started) return; started = true; run(); };
      const run = start(() => {
        const wait = SETTLE_MS + (p.trigger === 'after_seconds' ? Math.max(0, p.trigger_value ?? 0) * 1000 : 0);
        timers.push(setTimeout(async () => {
          while (!cancelled && introShowing()) await new Promise(r => setTimeout(r, 300));   // wait for the intro to finish
          if (cancelled || !stillAllowed()) return;
          const url = imageUrl(contentFor(p, lang).image);
          if (url) {
            const ok = await Image.prefetch(url).catch(() => false);
            if (!ok) return;   // not on the phone: try again at the next opportunity
          }
          if (cancelled || !stillAllowed()) return;
          await markShown(p);
          sendPopupEvent(p.id, 'impression');
          show(p);
        }, wait));
      });
      tasks.push(InteractionManager.runAfterInteractions(run));
      timers.push(setTimeout(run, INTERACTIONS_CAP_MS));
    };

    (async () => {
      if (!v.modalDone && !session.modalShown) {
        const p = await pick(false);
        if (p && !cancelled) schedule(p, x => { v.modalDone = true; setModal(x); }, () => !v.modalDone && !session.modalShown);
      }
      if (!v.stripDone) {
        const p = await pick(true);
        if (p && !cancelled) schedule(p, x => { v.stripDone = true; setStrip(x); }, () => !v.stripDone);
      }
    })();
    return () => { cancelled = true; timers.forEach(clearTimeout); tasks.forEach(t => t.cancel()); };
  }, [pathname, blocked, ready, screen, lang]);  // data is read through dataRef so a refetch does not restart the wait

  if (blocked) return null;
  const close = (p: Popup, set: (v: null) => void) => { sendPopupEvent(p.id, 'close'); set(null); };
  const open = (p: Popup, set: (v: null) => void) => {
    sendPopupEvent(p.id, 'tap');
    set(null);
    const route = contentFor(p, lang).cta_route;
    if (route && route.startsWith('/') && !route.startsWith('//')) router.push(route as never);
  };
  return <>
    {strip && <PopupStrip popup={strip} lang={lang} motion={motion} onClose={() => close(strip, setStrip)} onOpen={() => open(strip, setStrip)} />}
    {modal && modal.format === 'coming_soon' && !!contentFor(modal, lang).items?.length
      ? <ComingSoonReceipts title={contentFor(modal, lang).title} items={contentFor(modal, lang).items!} city={city} motion={motion} onClose={() => close(modal, setModal)} />
      : modal && modal.format !== 'coming_soon' && <PopupModal popup={modal} lang={lang} motion={motion} onClose={() => close(modal, setModal)} onOpen={() => open(modal, setModal)} />}
  </>;
}

type Props = { popup: Popup; lang: string; motion: boolean; onClose: () => void; onOpen: () => void };

// One fade (and a short slide) on the UI thread; with reduce motion it simply appears.
function useEntrance(motion: boolean, distance: number) {
  const progress = useSharedValue(motion ? 0 : 1);
  useEffect(() => { if (motion) progress.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }); }, [motion, progress]);
  return useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: (1 - progress.value) * distance }] }));
}

function AdLabel() {
  const { t } = useTranslation();
  return <View style={s.ad}><Text style={s.adText}>{t('popups.ad')}</Text></View>;
}

function CloseButton({ onPress, light }: { onPress: () => void; light?: boolean }) {
  const { t } = useTranslation();
  return <Pressable testID="popup-close" accessibilityRole="button" accessibilityLabel={t('popups.closeA11y')} hitSlop={12} onPress={onPress}
    style={({ pressed }) => [s.close, light && s.closeLight, pressed && s.pressed]}>
    <Icon name="close" size={20} color={light ? colors.onSurfaceInverse : colors.onSurface} />
  </Pressable>;
}

function Cta({ label, onPress }: { label?: string; onPress: () => void }) {
  const { t } = useTranslation();
  return <Pressable testID="popup-cta" accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.cta, pressed && s.pressed]}>
    <Text style={s.ctaText}>{label || t('popups.open')}</Text>
  </Pressable>;
}

function PopupModal({ popup, lang, motion, onClose, onOpen }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const c = contentFor(popup, lang);
  const image = imageUrl(c.image);
  const hasCta = !!c.cta_route;
  const sheet = popup.format === 'popup_sheet';
  const full = popup.format === 'interstitial';
  const entrance = useEntrance(motion, sheet ? 48 : full ? 0 : 16);

  if (full) {
    return <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View testID="popup-interstitial" accessibilityViewIsModal accessibilityLabel={t('popups.dialogA11y')} style={[s.full, entrance]}>
        {image && <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" />}
        <View style={[s.fullTop, { top: insets.top + spacing.md }]}>
          {popup.is_sponsored ? <AdLabel /> : <View />}
          <Pressable testID="popup-skip" accessibilityRole="button" onPress={onClose} hitSlop={12} style={({ pressed }) => [s.skip, pressed && s.pressed]}>
            <Text style={s.skipText}>{t('popups.skip')}</Text>
          </Pressable>
        </View>
        <View style={[s.fullBottom, { paddingBottom: insets.bottom + spacing.xl }]}>
          {!!c.title && <Text style={s.fullTitle}>{c.title}</Text>}
          {!!c.body && <Text style={s.fullBody}>{c.body}</Text>}
          {hasCta && <Cta label={c.cta_label} onPress={onOpen} />}
        </View>
      </Animated.View>
    </Modal>;
  }

  return <Modal visible transparent animationType="none" onRequestClose={onClose}>
    <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t('popups.closeA11y')} />
    <View pointerEvents="box-none" style={sheet ? s.sheetWrap : s.centerWrap}>
      <Animated.View testID={sheet ? 'popup-sheet' : 'popup-center'} accessibilityViewIsModal accessibilityLabel={t('popups.dialogA11y')}
        style={[sheet ? [s.sheet, { paddingBottom: insets.bottom + spacing.lg }] : s.card, entrance]}>
        {sheet && <View style={s.handle} />}
        {image && <Image source={{ uri: image }} style={sheet ? s.sheetImage : s.cardImage} contentFit="cover" />}
        <View style={s.cardBody}>
          {popup.is_sponsored && <AdLabel />}
          {!!c.title && <Text style={s.title}>{c.title}</Text>}
          {!!c.body && <Text style={s.body} numberOfLines={sheet ? 4 : 2}>{c.body}</Text>}
          {hasCta && <Cta label={c.cta_label} onPress={onOpen} />}
        </View>
        <View style={s.closeCorner}><CloseButton onPress={onClose} light={!!image} /></View>
      </Animated.View>
    </View>
  </Modal>;
}

// A thin bar near the top, under the header area; dismissible. It is not a modal, so the screen stays usable.
function PopupStrip({ popup, lang, motion, onClose, onOpen }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const c = contentFor(popup, lang);
  const entrance = useEntrance(motion, -12);
  return <View pointerEvents="box-none" style={[s.stripWrap, { top: insets.top + STRIP_OFFSET }]}>
    <Animated.View testID="popup-strip" style={[s.strip, entrance]}>
      <Pressable accessibilityRole="button" disabled={!c.cta_route} onPress={onOpen} style={s.stripMain}>
        {popup.is_sponsored && <AdLabel />}
        <Text style={s.stripText} numberOfLines={1}>{c.title}</Text>
        {!!c.cta_route && <Icon name="arrow-forward" size={16} color={colors.onSurface} />}
      </Pressable>
      <Pressable testID="popup-strip-close" accessibilityRole="button" accessibilityLabel={t('popups.closeA11y')} hitSlop={12} onPress={onClose} style={s.stripClose}>
        <Icon name="close" size={16} color={colors.muted} />
      </Pressable>
    </Animated.View>
  </View>;
}

// Screens draw their own headers; this keeps the strip below a typical header row rather than over the status bar.
const STRIP_OFFSET = 64;

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  centerWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  sheetWrap: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  cardImage: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surfaceSecondary },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: 'hidden' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong, marginTop: spacing.sm, marginBottom: spacing.sm },
  sheetImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surfaceSecondary },
  cardBody: { padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.onSurface },
  body: { fontSize: 14, lineHeight: 20, color: colors.muted },
  cta: { marginTop: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center' },
  ctaText: { color: colors.onBrand, fontSize: 15, fontWeight: '700' },
  closeCorner: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  close: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary },
  closeLight: { backgroundColor: colors.overlay },
  pressed: { opacity: 0.7 },
  ad: { alignSelf: 'flex-start', backgroundColor: colors.surfaceTertiary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  adText: { fontSize: 11, fontWeight: '700', color: colors.onSurfaceTertiary },
  full: { flex: 1, backgroundColor: colors.surfaceInverse },
  fullTop: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  skip: { backgroundColor: colors.overlay, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  skipText: { color: colors.onSurfaceInverse, fontSize: 14, fontWeight: '700' },
  fullBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.xl, gap: spacing.sm, backgroundColor: colors.overlay },
  fullTitle: { fontSize: 24, fontWeight: '800', color: colors.onSurfaceInverse },
  fullBody: { fontSize: 15, lineHeight: 21, color: colors.onSurfaceInverse },
  stripWrap: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  strip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.brandTertiary, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, minHeight: 40 },
  stripMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingLeft: spacing.md },
  stripText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.onBrandTertiary },
  stripClose: { padding: spacing.sm, paddingRight: spacing.md },
});
