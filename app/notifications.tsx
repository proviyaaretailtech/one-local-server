import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { AccountLayout, ActionButton } from '@/src/components/account-layout';
import { clearInbox, markAllRead, useInbox } from '@/src/push';
import { colors } from '@/src/theme';
import { useTranslation } from '@/src/i18n';

// The notifications this phone has received, newest first. Kept on the phone only.
function ago(at: number, language: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(0, 'minute');
  if (minutes < 60) return new Intl.RelativeTimeFormat(language).format(-minutes, 'minute');
  if (minutes < 1440) return new Intl.RelativeTimeFormat(language).format(-Math.round(minutes / 60), 'hour');
  return new Date(at).toLocaleDateString(language, { day: 'numeric', month: 'short' });
}

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { items, unread } = useInbox();
  return (
    <AccountLayout id="notifications" title={t('notifications.inbox.title')} subtitle={unread ? t('notifications.inbox.subtitle', { count: unread }) : t('notifications.inbox.subtitleNone')}>
      {items.length === 0 ? (
        <View testID="notifications-empty" style={s.empty}>
          <Icon name="notifications-outline" size={44} color={colors.muted} />
          <Text style={s.emptyTitle}>{t('notifications.inbox.emptyTitle')}</Text>
          <Text style={s.emptyBody}>{t('notifications.inbox.emptyBody')}</Text>
        </View>
      ) : (
        <View style={s.list}>
          {items.map(item => (
            <Pressable key={item.id} testID={`notification-${item.id}`} accessibilityRole="button" onPress={() => { if (item.url) router.push(item.url as never); }} style={[s.row, !item.read && s.unread]}>
              {!item.read ? <View style={s.dot} /> : <View style={s.dotSpace} />}
              <View style={s.text}>
                <Text style={s.title}>{item.title}</Text>
                {item.body ? <Text style={s.body}>{item.body}</Text> : null}
                <Text style={s.time}>{ago(item.at, i18n.language)}</Text>
              </View>
            </Pressable>
          ))}
          <View style={s.actions}>
            {unread > 0 ? <ActionButton id="notifications-read" title={t('notifications.inbox.markRead')} onPress={markAllRead} /> : null}
            <ActionButton id="notifications-clear" title={t('notifications.inbox.clear')} onPress={clearInbox} />
          </View>
        </View>
      )}
    </AccountLayout>
  );
}

const s = StyleSheet.create({
  empty: { alignItems: 'center', gap: 10, paddingTop: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.onSurface },
  emptyBody: { fontSize: 14, color: colors.muted, textAlign: 'center', maxWidth: 280 },
  list: { gap: 10 },
  row: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7EAE7' },
  unread: { backgroundColor: '#F3FADF', borderColor: '#CFE98A' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6FD400', marginTop: 6 },
  dotSpace: { width: 8 },
  text: { flex: 1, gap: 3 },
  title: { fontSize: 15, fontWeight: '700', color: colors.onSurface },
  body: { fontSize: 14, color: colors.muted },
  time: { fontSize: 12, color: colors.muted, marginTop: 2 },
  actions: { gap: 10, marginTop: 8 },
});
