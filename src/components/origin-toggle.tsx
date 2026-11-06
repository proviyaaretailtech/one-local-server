// The Local / National switch beside the search bar: on is Local, off is National (src/origin.ts says what each shows).
import { StyleSheet, View } from 'react-native';
import { Flag, MapPin } from 'lucide-react-native';
import { Text } from '../ui/text';
import { Toggle } from '../ui/toggle';
import { useOrigin } from '../origin';
import { useTranslation } from '../i18n';
import { haptic } from '../haptics';
import { colors, glassPane, lightPane, type Tone } from '../theme';

export function OriginToggle({ tone = 'photo' }: { tone?: Tone }) {
  const { origin, setOrigin } = useOrigin(); const { t } = useTranslation();
  const local = origin === 'local'; const onPhoto = tone === 'photo';
  // A save that fails leaves the switch where it was; the provider keeps the error for Account to show.
  const change = (on: boolean) => { void setOrigin(on ? 'local' : 'national').catch(haptic.error); };
  return <View style={[s.pane, onPhoto ? glassPane : lightPane]}>
    <Text numberOfLines={1} style={[s.label, onPhoto ? s.labelPhoto : s.labelLight]}>{local ? t('home.origin.local') : t('home.origin.national')}</Text>
    <Toggle testID="home-origin-toggle" value={local} onValueChange={change} tint={colors.localGlass} tone={tone} accessibilityLabel={t('home.origin.only')}
      knob={local ? <MapPin size={12} color={colors.forest} strokeWidth={2.4} /> : <Flag size={11} color={colors.muted} strokeWidth={2.4} />} />
  </View>;
}

const s = StyleSheet.create({
  // Wide enough for the longer word, so the search bar beside it never shifts when the mode changes.
  pane: { width: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 8.5, lineHeight: 11, fontWeight: '800', letterSpacing: 0.6 },
  labelPhoto: { color: colors.surface },
  labelLight: { color: colors.forest },
});
