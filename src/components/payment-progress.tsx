// What happens after "Pay": opening the payment page / UPI app / QR, waiting, confirming, then success, failure or
// cancel (spec: specs/cashfree-checkout/spec.md "UI standard"). The only thing believed is GET /payments/status; whatever
// a payment page, a deep link or the browser reports is a cue to ask the server again. The cart is never touched here:
// the parent clears it on `onPaid` only, so every other ending leaves the cart intact.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { useMotionAllowed } from '../motion';
import { useErrorMessage, useFormat, useTranslation } from '@/src/i18n';
import { fetchStatus, saveInFlight, clearInFlight, startUpi, type CashfreeStart, type UpiStart } from '../payments/api';
import {
  afterManualClose, DEFAULT_GIVE_UP_MS, errorAction, MIN_POLL_MS, failureText, mmss, nextPollDelay, parseHostedMessage, phaseAfterPoll, phaseFromStatus,
  secondsLeft, shouldGiveUp, UPI_WINDOW_S, type PayPick, type Phase, type StatusAnswer,
} from '../payments/logic';
import { HostedPage } from './payment-hosted';

type Launch = { kind: 'hosted' | 'intent' | 'qr' | 'collect'; at: number; url?: string; upi?: UpiStart };
type Props = {
  start: CashfreeStart; pick: PayPick; kind: 'food' | 'shopping'; total: number; resume?: boolean; startedAt?: number; canCash: boolean;
  onPaid: (orderId: string) => void; onOther: () => void; onRetry: () => void; onCash: () => void; onLeave: () => void;
};

export function PaymentProgress({ start, pick, kind, total, resume, startedAt, canCash, onPaid, onOther, onRetry, onCash, onLeave }: Props) {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const message = useErrorMessage();
  const motion = useMotionAllowed();
  const english = (i18n.resolvedLanguage ?? i18n.language ?? 'en') === 'en';
  const id = start.checkout_id;
  const [began] = useState(() => startedAt ?? Date.now());
  const [phase, setPhase] = useState<Phase>(resume ? 'confirming' : 'starting');
  const [status, setStatus] = useState<StatusAnswer | null>(null);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [offline, setOffline] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);   // an error from starting the payment
  const [kick, setKick] = useState(0);                    // bump = ask the server right now
  const [now, setNow] = useState(() => Date.now());
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; });
  const finished = useRef(false);
  const lastCall = useRef(0); // when the server was last asked: never more often than every 2 seconds, however many nudges arrive

  // Keep a record on the phone while the payment is open, so a closed app or a link back can pick it up again.
  useEffect(() => { void saveInFlight({ checkout_id: id, order_id: start.order_id, kind, started: began, poll: start.poll }); }, [id, kind, began, start.order_id, start.poll]);

  // 1. Open the way to pay.
  useEffect(() => {
    if (resume) return;
    let dead = false;
    const hosted = () => {
      if (!start.checkout_url) { setProblem(new Error('no page')); setPhase('failed'); return; } // i18n-ignore: developer reason, never shown
      setLaunch({ kind: 'hosted', at: Date.now(), url: start.checkout_url }); setPhase('awaiting');
    };
    (async () => {
      if (pick.method !== 'upi' || !pick.mode || pick.mode === 'hosted') return hosted();
      try {
        const u = await startUpi({ checkout_id: id, mode: pick.mode, app: pick.app, upi_id: pick.mode === 'collect' ? pick.vpa : undefined });
        if (dead) return;
        if (pick.mode === 'intent') {
          const link = (pick.app && u.intent?.links?.[pick.app]) || u.intent?.links?.default || u.intent?.url;
          if (!link) return hosted();
          try { await Linking.openURL(link); } catch { return hosted(); } // no such app on this phone: the hosted page lists what works
        }
        setLaunch({ kind: pick.mode, at: Date.now(), upi: u }); setPhase('awaiting');
      } catch (e) {
        if (dead) return;
        if (errorAction((e as { code?: string })?.code) === 'use_hosted') return hosted();
        setProblem(e); setPhase('failed');
      }
    })();
    return () => { dead = true; };
    // Opened once per payment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const apply = useCallback((s: StatusAnswer) => { setStatus(s); setPhase(cur => phaseAfterPoll(cur, s)); }, []);

  // 2. Ask the server until it is final. Follows poll_after_ms, slows down, backs off without a connection, and stops with
  //    "still confirming" (never "failed") once the give-up time passes.
  useEffect(() => {
    if (phase !== 'awaiting' && phase !== 'confirming') return;
    let dead = false; let timer: ReturnType<typeof setTimeout> | undefined; let attempt = 0; let errors = 0;
    const giveUp = start.poll?.give_up_after_ms ?? DEFAULT_GIVE_UP_MS;
    const tick = async () => {
      let next: number;
      lastCall.current = Date.now();
      try {
        const s = await fetchStatus(id);
        if (dead) return;
        errors = 0; setOffline(false); apply(s);
        if (phaseFromStatus(s) !== 'confirming') return;
        if (shouldGiveUp(Date.now() - began, giveUp)) { setPhase('stuck'); return; }
        next = nextPollDelay({ attempt: attempt++, pollAfterMs: s.poll_after_ms ?? start.poll?.every_ms });
      } catch {
        if (dead) return;
        errors++; setOffline(true);
        if (shouldGiveUp(Date.now() - began, giveUp)) { setPhase('stuck'); return; }
        next = nextPollDelay({ attempt, errors });
      }
      timer = setTimeout(tick, next);
    };
    timer = setTimeout(tick, Math.max(0, MIN_POLL_MS - (Date.now() - lastCall.current)));
    return () => { dead = true; if (timer) clearTimeout(timer); };
  }, [phase === 'awaiting' || phase === 'confirming', kick, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back in the app (or the connection is back): ask now, and a UPI app that was opened has been left.
  useEffect(() => {
    const back = () => { if (phaseRef.current === 'awaiting' || phaseRef.current === 'confirming' || phaseRef.current === 'stuck') setKick(k => k + 1); };
    const sub = AppState.addEventListener('change', st => {
      if (st !== 'active') return;
      if (phaseRef.current === 'awaiting' && launch?.kind === 'intent') setPhase('confirming');
      if (phaseRef.current === 'stuck') setPhase('confirming');
      back();
    });
    let off: (() => void) | undefined;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const on = () => back();
      window.addEventListener('online', on); window.addEventListener('focus', on);
      off = () => { window.removeEventListener('online', on); window.removeEventListener('focus', on); };
    }
    return () => { sub.remove(); off?.(); };
  }, [launch?.kind]);

  // 3. The clock for a UPI request / QR code (5 minutes).
  const timed = phase === 'awaiting' && launch && launch.kind !== 'hosted';
  useEffect(() => {
    if (!timed) return;
    let askedAtEnd = false;
    const timer = setInterval(() => {
      const n = Date.now();
      setNow(n);
      // The window is over: ask the server once (it will say expired or paid).
      if (!askedAtEnd && launch && secondsLeft(launch.upi?.collect?.expires_at, n, launch.at) === 0) { askedAtEnd = true; setKick(k => k + 1); }
    }, 1000);
    return () => clearInterval(timer);
  }, [timed, launch]);
  const left = launch && launch.kind !== 'hosted' ? secondsLeft(launch.upi?.collect?.expires_at, now, launch.at) : UPI_WINDOW_S;
  const ended = !!timed && left === 0;

  // 4. The ending. Success hands the order to the parent after a short confirmation; the other endings drop the record.
  const orderId = status?.order_id ?? start.order_id;
  useEffect(() => {
    if (phase === 'paid') {
      if (finished.current) return;
      finished.current = true; void clearInFlight();
      const timer = setTimeout(() => onPaid(orderId), motion ? 1300 : 700);
      return () => clearTimeout(timer);
    }
    if (phase === 'failed' || phase === 'dropped') void clearInFlight();
  }, [phase, orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The payment page said something, or the customer closed it by hand: ask the server, then believe only that.
  const cue = (data: unknown) => { if (parseHostedMessage(data, id)) { setLaunch(l => l && { ...l, kind: 'hosted' }); setPhase('confirming'); setKick(k => k + 1); } };
  const closedByHand = async () => {
    try { const s = await fetchStatus(id); setStatus(s); setPhase(afterManualClose(s)); } catch { setPhase('confirming'); setKick(k => k + 1); }
  };

  const amount = fmt.money(total);
  const spinner = motion ? <ActivityIndicator size="large" color={colors.forest} /> : <Icon name="time-outline" size={40} color={colors.forest} />;
  const failure = status && (phase === 'failed') ? failureText(status, english) : null;
  const failedLine = problem ? message(problem) : failure ? ('text' in failure ? failure.text : t(failure.key)) : t('payui.failed.generic');
  const hostedFull = phase === 'awaiting' && launch?.kind === 'hosted' && Platform.OS !== 'web';

  const button = (testID: string, label: string, onPress: () => void, primary = false) => (
    <Pressable key={testID} testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.btn, primary ? s.btnPrimary : s.btnGhost, pressed && s.pressed]}>
      <Text style={[s.btnText, primary ? s.btnTextPrimary : s.btnTextGhost]}>{label}</Text>
    </Pressable>
  );

  let content: React.ReactNode = null;
  if (phase === 'starting') {
    content = <View style={s.center}>{spinner}<Text accessibilityLiveRegion="polite" style={s.title}>{t('payui.starting')}</Text></View>;
  } else if (phase === 'awaiting' && launch?.kind === 'hosted' && launch.url) {
    content = <HostedPage url={launch.url} checkoutId={id} onCue={cue} onResultLink={() => cue({ type: 'done', checkout_id: id })} onClose={closedByHand} onBroken={() => { setProblem(null); setPhase('failed'); }} />;
  } else if (phase === 'awaiting' && launch?.kind === 'qr' && launch.upi?.qr) {
    content = <View style={s.center}>
      <Text testID="pay-qr-title" accessibilityLiveRegion="polite" style={s.title}>{t('payui.qr.title', { amount })}</Text>
      <Image testID="pay-qr-image" accessibilityRole="image" accessibilityLabel={t('payui.qr.a11y', { amount })} source={{ uri: launch.upi.qr.image }} style={s.qr} />
      <Text style={s.body}>{t('payui.qr.body')}</Text>
      <Text testID="pay-timer" accessibilityLabel={t('payui.wait.timerA11y', { time: mmss(left) })} style={s.timer}>{ended ? t('payui.wait.timerEnded') : t('payui.wait.timer', { time: mmss(left) })}</Text>
      {button('pay-cancel', t('payment.cancelA11y'), closedByHand)}
    </View>;
  } else if (phase === 'awaiting') {
    const collect = launch?.upi?.collect;
    content = <View style={s.center}>
      <Icon name="phone-portrait-outline" size={44} color={colors.forest} />
      <Text testID="pay-wait-title" accessibilityLiveRegion="polite" style={s.title}>{collect ? t('payui.collect.title', { id: collect.upi_id_masked }) : t('payui.wait.title')}</Text>
      <Text style={s.body}>{collect ? t('payui.collect.body') : t('payui.wait.body', { amount })}</Text>
      <Text testID="pay-timer" accessibilityLabel={t('payui.wait.timerA11y', { time: mmss(left) })} style={s.timer}>{ended ? t('payui.wait.timerEnded') : t('payui.wait.timer', { time: mmss(left) })}</Text>
      {button('pay-cancel', t('payment.cancelA11y'), closedByHand)}
    </View>;
  } else if (phase === 'confirming') {
    content = <View style={s.center}>
      {spinner}
      <Text testID="pay-confirming-title" accessibilityLiveRegion="polite" style={s.title}>{t('payui.confirm.title')}</Text>
      <Text testID="pay-confirming-body" style={s.body}>{t('payui.confirm.body')}</Text>
      {offline && <Text testID="pay-offline" accessibilityRole="alert" style={s.offline}>{t('payui.confirm.offline')}</Text>}
    </View>;
  } else if (phase === 'stuck') {
    content = <View style={s.center}>
      <Icon name="time-outline" size={44} color={colors.onWarning} />
      <Text testID="pay-stuck-title" accessibilityLiveRegion="polite" style={s.title}>{t('payui.stuck.title')}</Text>
      <Text style={s.body}>{t('payui.stuck.body')}</Text>
      {button('pay-stuck-check', t('payui.stuck.check'), () => { setPhase('confirming'); setKick(k => k + 1); }, true)}
      {button('pay-stuck-back', t('payui.stuck.back'), onLeave)}
    </View>;
  } else if (phase === 'paid') {
    content = <View style={s.center}>
      <Icon name="checkmark-circle" size={64} color={colors.onSuccess} />
      <Text testID="pay-success-title" accessibilityLiveRegion="polite" style={s.title}>{t('payui.paid.title')}</Text>
      <Text style={s.body}>{t('payui.paid.body')}</Text>
    </View>;
  } else if (phase === 'failed') {
    content = <View style={s.center}>
      <Icon name="alert-circle" size={56} color={colors.onError} />
      <Text testID="pay-failed-title" accessibilityRole="alert" style={s.title}>{t('payui.failed.title')}</Text>
      <Text testID="pay-failed-reason" style={s.reason}>{failedLine}</Text>
      <Text style={s.body}>{t('payui.failed.body')}</Text>
      {(status?.retry_ok ?? true) && button('pay-try-again', t('payui.failed.again'), onRetry, true)}
      {button('pay-try-other', t('payui.failed.other'), onOther, !(status?.retry_ok ?? true))}
      {canCash && button('pay-switch-cash', t('payui.failed.cash'), onCash)}
    </View>;
  } else if (phase === 'dropped') {
    content = <View style={s.center}>
      <Icon name="close-circle" size={56} color={colors.muted} />
      <Text testID="pay-dropped-title" accessibilityLiveRegion="polite" style={s.title}>{t('payui.dropped.title')}</Text>
      <Text style={s.body}>{t('payui.dropped.body')}</Text>
      {button('pay-choose-method', t('payui.dropped.choose'), onOther, true)}
      {button('pay-try-again', t('payui.failed.again'), onRetry)}
    </View>;
  }

  return <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => { if (phase === 'awaiting') void closedByHand(); else if (phase === 'failed' || phase === 'dropped') onOther(); else if (phase === 'stuck') onLeave(); }}>
    <View testID="pay-progress" style={[s.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
      {!hostedFull && <View style={s.bar}><Icon name="lock-closed" size={14} color={colors.onSuccess} /><Text style={s.barText}>{t('payui.secure')}</Text><Text style={s.barAmount}>{amount}</Text></View>}
      {hostedFull ? content : <ScrollView contentContainerStyle={s.scroll}>{content}</ScrollView>}
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.border },
  barText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.onSurface },
  barAmount: { fontSize: 14, fontWeight: '800', color: colors.onSurface },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  center: { alignItems: 'center', gap: 14, minHeight: 360, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: 'center', maxWidth: 360 },
  reason: { fontSize: 15, lineHeight: 22, color: colors.onSurface, textAlign: 'center', fontWeight: '600', maxWidth: 360 },
  offline: { fontSize: 13, lineHeight: 19, color: colors.onWarning, backgroundColor: colors.warning, borderRadius: 12, padding: 12, textAlign: 'center', maxWidth: 360 },
  timer: { fontSize: 16, fontWeight: '800', color: colors.forest },
  qr: { width: 220, height: 220, backgroundColor: '#FFFFFF', borderRadius: 12 },
  btn: { minHeight: 48, minWidth: 240, paddingHorizontal: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.brandSecondary },
  btnGhost: { borderWidth: 1, borderColor: colors.forest },
  btnText: { fontSize: 15, fontWeight: '800' },
  btnTextPrimary: { color: colors.onBrandSecondary }, btnTextGhost: { color: colors.forest },
  pressed: { opacity: 0.7 },
});
