// Web: Cashfree's hosted page opens in a popup window; its result page posts a message back to this window. The message is
// only a cue: the progress screen then asks the server. If the popup is blocked a button opens it (a tap is allowed to).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import Icon from '@react-native-vector-icons/ionicons';
import { colors } from '../theme';
import { useTranslation } from '@/src/i18n';
import type { HostedProps } from './payment-hosted';

export function HostedPage({ url, onCue, onClose }: HostedProps) {
  const { t } = useTranslation();
  const popup = useRef<Window | null>(null);
  const [blocked, setBlocked] = useState(false);
  const closing = useRef(false);

  const open = useCallback(() => {
    const w = window.open(url, 'ol-pay', 'popup=yes,width=480,height=760');
    popup.current = w;
    setTimeout(() => setBlocked(!w), 0);
    w?.focus();
  }, [url]);

  useEffect(() => {
    open();
    const origin = new URL(url).origin;
    const onMessage = (e: MessageEvent) => { if (e.origin === origin) { closing.current = true; try { popup.current?.close(); } catch { /* already gone */ } onCue(e.data); } };
    window.addEventListener('message', onMessage);
    // The popup closed by hand: the screen asks the server once.
    const timer = setInterval(() => { if (popup.current && popup.current.closed && !closing.current) { closing.current = true; onClose(); } }, 500);
    return () => { window.removeEventListener('message', onMessage); clearInterval(timer); try { popup.current?.close(); } catch { /* already gone */ } };
    // Opened once per page address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return <View testID="pay-hosted" style={s.box}>
    <Icon name="lock-closed" size={28} color={colors.forest} />
    <Text style={s.title}>{t('payui.open.title')}</Text>
    <Text style={s.body}>{blocked ? t('payui.open.blocked') : t('payui.open.web')}</Text>
    <Pressable testID="pay-hosted-reopen" accessibilityRole="button" onPress={() => { closing.current = false; open(); }} style={s.btn}><Text style={s.btnText}>{t('payui.open.reopen')}</Text></Pressable>
  </View>;
}
const s = StyleSheet.create({
  box: { alignItems: 'center', gap: 12, padding: 24 },
  title: { fontSize: 20, fontWeight: '800', color: colors.onSurface, textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: 'center' },
  btn: { minHeight: 48, paddingHorizontal: 22, borderRadius: 999, borderWidth: 1, borderColor: colors.forest, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: colors.forest, fontWeight: '800' },
});
