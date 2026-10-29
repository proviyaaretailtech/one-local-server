// The one "SOON" mark for an entry point whose feature is not live yet (src/features.ts): a dark pill with
// lime text, pinned to the corner of the button it sits on. Tapping the button still opens the
// feature's coming-soon page, so the badge only sets the expectation before the tap.
import { StyleSheet, View } from 'react-native';
import { Text } from '@/src/ui/text';
import { useLanguage, useTranslation } from '../i18n';

export function SoonBadge({ testID, corner = true }: { testID?: string; corner?: boolean }) {
  const { t } = useTranslation(); const deva = useLanguage().active.script === 'devanagari';
  return <View testID={testID} pointerEvents="none" style={[s.pill, corner && s.corner]}>
    <Text style={[s.text, deva && s.deva]}>{t('common.soon').toUpperCase()}</Text>
  </View>;
}

const s = StyleSheet.create({
  pill: { alignSelf: 'flex-start', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 6, backgroundColor: '#0B1F16', borderWidth: 1, borderColor: '#FFFFFF' },
  corner: { position: 'absolute', top: -6, right: -8, zIndex: 3 },
  text: { color: '#B3F400', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  deva: { fontSize: 10, letterSpacing: 0 }, // Devanagari needs more size and no tracking
});
