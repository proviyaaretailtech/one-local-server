// One row per language (from the registry in locales.ts): its own name, its English name, a sample line in
// that language and a live ₹/date sample. Used by the Language screen (Profile) and the first-run chooser.
//
// How it behaves while a language loads: the row you tapped shows a small spinner, the rest of the screen
// and the language you are in stay exactly as they are; when the new language is ready the whole app swaps
// at once. If it fails or takes more than 8 seconds, that row says so, you stay in your current language,
// and Retry sits right there. Tap another row meanwhile and the last tap wins.
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import Icon from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme';
import { formatDate, formatMoney } from './format';
import { useLanguage } from './provider';

export type PickerTone = 'light' | 'dark';

export function LanguagePicker({ tone = 'light' }: { tone?: PickerTone }) {
  const { t } = useTranslation();
  const { state, locales, active, select, retry } = useLanguage();
  const dark = tone === 'dark';
  const now = new Date();

  return <View testID="language-picker" accessibilityRole="radiogroup" accessibilityLabel={t('language.title')} style={s.group}>
    {locales.map(meta => {
      const selected = state.active === meta.code;
      const loading = state.status === 'loading' && state.target === meta.code;
      const failed = state.status === 'error' && state.target === meta.code;
      // The sample uses THIS row's own formats, so the person sees what they will get: ₹ grouping and the date style.
      const ctx = { lng: meta.code, t };
      const preview = `${formatMoney(123456, ctx)} · ${formatDate(now, ctx, 'medium')}`;
      return <View key={meta.code}>
        <Pressable
          testID={`language-${meta.code}`}
          accessibilityRole="radio"
          accessibilityLabel={`${meta.nativeName}, ${meta.englishName}`}
          accessibilityHint={meta.sample}
          accessibilityState={{ checked: selected, selected, busy: loading }}
          aria-checked={selected} aria-busy={loading}
          onPress={() => { void Haptics.selectionAsync().catch(() => {}); void select(meta.code); }}
          style={({ pressed }) => [s.row, dark ? s.rowDark : s.rowLight, selected && (dark ? s.rowOnDark : s.rowOnLight), failed && s.rowFailed, pressed && s.pressed]}>
          <View style={[s.radio, dark ? s.radioDark : s.radioLight, selected && s.radioOn]}>{selected && <Icon name="checkmark" size={15} color={colors.electricLime} />}</View>
          <View style={s.text}>
            <View style={s.names}>
              <Text testID={`language-${meta.code}-name`} style={[s.native, dark && s.onDark]}>{meta.nativeName}</Text>
              {meta.englishName !== meta.nativeName && <Text style={[s.english, dark && s.softDark]}>{meta.englishName}</Text>}
            </View>
            <Text style={[s.sample, dark && s.softDark]}>{meta.sample}</Text>
            <Text style={[s.preview, dark && s.softDark]}>{preview}</Text>
          </View>
          {loading && <ActivityIndicator testID={`language-${meta.code}-spinner`} accessibilityLabel={t('common.loading')} color={dark ? colors.electricLime : colors.forest} />}
        </Pressable>
        {failed && <View testID={`language-${meta.code}-error`} accessibilityLiveRegion="polite" style={[s.error, dark && s.errorDark]}>
          <Text style={[s.errorText, dark && s.errorTextDark]}>{t(state.error === 'timeout' ? 'language.error.timeout' : 'language.error.load', { language: meta.nativeName, current: active.nativeName })}</Text>
          <Pressable testID="language-retry" accessibilityRole="button" onPress={() => void retry()} style={s.retry}><Text style={[s.retryText, dark && s.retryTextDark]}>{t('common.retry')}</Text></Pressable>
        </View>}
      </View>;
    })}
  </View>;
}

const s = StyleSheet.create({
  group: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5 },
  rowLight: { backgroundColor: colors.surface, borderColor: colors.border },
  rowDark: { backgroundColor: '#101210', borderColor: 'rgba(255,255,255,0.12)' },
  rowOnLight: { backgroundColor: colors.limeSoft, borderColor: colors.forest },
  rowOnDark: { borderColor: colors.electricLime },
  rowFailed: { borderColor: colors.onError },
  pressed: { opacity: 0.8 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioLight: { borderColor: colors.borderStrong },
  radioDark: { borderColor: 'rgba(255,255,255,0.45)' },
  radioOn: { backgroundColor: '#050605', borderColor: '#050605' },
  text: { flex: 1, gap: 3 },
  names: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 },
  native: { fontSize: 18, lineHeight: 26, fontWeight: '800', color: colors.onSurface },
  english: { fontSize: 12, lineHeight: 18, color: colors.muted, fontWeight: '600' },
  sample: { fontSize: 13, lineHeight: 20, color: colors.onSurfaceTertiary },
  preview: { fontSize: 11, lineHeight: 17, color: colors.muted },
  onDark: { color: '#fff' },
  softDark: { color: 'rgba(255,255,255,0.62)' },
  error: { marginTop: 6, padding: 12, borderRadius: 14, backgroundColor: colors.error, gap: 6 },
  errorDark: { backgroundColor: 'rgba(255,138,138,0.12)' },
  errorText: { color: colors.onError, fontSize: 13, lineHeight: 20 },
  errorTextDark: { color: '#FF8A8A' },
  retry: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  retryText: { color: colors.onError, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  retryTextDark: { color: colors.electricLime },
});
