import { useEffect, useRef } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { useTranslation } from 'react-i18next';
import { colors } from '@/src/theme';

// Over-the-air updates (EAS Update). expo-updates already checks once at launch (app.config.ts,
// checkAutomatically ON_LOAD) and applies a downloaded update on the next cold start. This adds:
// a re-check when the app comes back to the foreground (people leave the app open for days), and a
// small "update ready" strip with a Restart button. The app never reloads by itself mid-session, so
// nobody loses a cart or a half-typed address. Does nothing on web, in Expo Go, or without EAS_PROJECT_ID.
const enabled = Platform.OS !== 'web' && Updates.isEnabled;
const RECHECK_AFTER_MS = 30 * 60_000;

export function UpdateGate() {
  const { isUpdatePending } = Updates.useUpdates();
  const { t } = useTranslation();
  const lastCheck = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active' || Date.now() - lastCheck.current < RECHECK_AFTER_MS) return;
      lastCheck.current = Date.now();
      Updates.checkForUpdateAsync()
        .then(r => (r.isAvailable ? Updates.fetchUpdateAsync() : null))
        .catch(() => {}); // offline or server down: try again next time the app opens
    });
    return () => sub.remove();
  }, []);

  if (!enabled || !isUpdatePending) return null;
  return (
    <View style={styles.strip} testID="update-ready" accessibilityRole="alert">
      <Text style={styles.text}>{t('updates.ready')}</Text>
      <Pressable accessibilityRole="button" onPress={() => Updates.reloadAsync().catch(() => {})} style={styles.button} hitSlop={8}>
        <Text style={styles.buttonText}>{t('updates.restart')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', left: 12, right: 12, bottom: 96, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.forest },
  text: { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.lime },
  buttonText: { color: '#121212', fontSize: 14, fontWeight: '700' },
});
