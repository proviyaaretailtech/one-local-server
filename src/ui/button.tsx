// A page's action button. `variant`: 'primary' is the raised lime key (as on the product page), 'quiet' a soft pane.
// `tone`: 'danger' turns either one red, for signing out and deleting. While `busy` it shows a spinner and takes no taps.
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Icon from '@react-native-vector-icons/ionicons';
import { Text } from './text';
import { colors, lightPane, neu, neuWell, popBase, radius, soft } from '../theme';

type Variant = 'primary' | 'quiet';
type Tone = 'brand' | 'danger';
type Props = { testID: string; title: string; onPress: () => void; variant?: Variant; tone?: Tone; icon?: ComponentProps<typeof Icon>['name']; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> };

export function Button({ testID, title, onPress, variant = 'primary', tone = 'brand', icon, busy, disabled, style }: Props) {
  const look = LOOKS[variant][tone]; const off = busy || disabled;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
    style={({ pressed }) => [s.button, look.box, pressed && look.pressed, off && s.off, style]}>
    {busy ? <ActivityIndicator color={look.ink} /> : !!icon && <Icon name={icon} size={18} color={look.ink} />}
    <Text testID={`${testID}-label`} style={[s.title, { color: look.ink }]}>{title}</Text>
  </Pressable>;
}

const s = StyleSheet.create({
  button: { minHeight: 54, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 10 },
  title: { flexShrink: 1, textAlign: 'center', fontSize: 15, lineHeight: 21, fontWeight: '800' },
  off: { opacity: 0.5 },
  lime: { backgroundColor: colors.electricLime, boxShadow: [...neu(5), ...soft.raised.slice(1)] },
  red: { backgroundColor: colors.onError, boxShadow: popBase(4, colors.errorDeep) },
  pane: lightPane,
  sunk: { boxShadow: soft.sunken },
  redDown: { boxShadow: popBase(1, colors.errorDeep) },
  paneDown: { boxShadow: neuWell },
});
const LOOKS = {
  primary: { brand: { box: s.lime, pressed: s.sunk, ink: colors.forestDeep }, danger: { box: s.red, pressed: s.redDown, ink: colors.surface } },
  quiet: { brand: { box: s.pane, pressed: s.paneDown, ink: colors.onSurface }, danger: { box: s.pane, pressed: s.paneDown, ink: colors.onError } },
} satisfies Record<Variant, Record<Tone, object>>;
