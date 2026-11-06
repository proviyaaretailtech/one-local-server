// The search bar as a button: a slim soft pane, white glass on a photo or a soft panel on a light page. Tapping it opens
// the search screen, where the typing happens, so the bar itself never raises a keyboard.
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Search } from 'lucide-react-native';
import { Text } from './text';
import { colors, glassPane, lightPane, type Tone } from '../theme';

type Props = { placeholder: string; accessibilityLabel: string; onPress: () => void; tone?: Tone; testID?: string; style?: StyleProp<ViewStyle> };

export function SearchBar({ placeholder, accessibilityLabel, onPress, tone = 'photo', testID, style }: Props) {
  const onPhoto = tone === 'photo';
  return <Pressable testID={testID} accessibilityRole="search" accessibilityLabel={accessibilityLabel} onPress={onPress} style={[s.bar, onPhoto ? glassPane : lightPane, style]}>
    <Search size={18} color={onPhoto ? colors.surface : colors.forest} strokeWidth={2} />
    <Text numberOfLines={1} style={[s.placeholder, onPhoto ? s.placeholderPhoto : s.placeholderLight]}>{placeholder}</Text>
  </Pressable>;
}

const s = StyleSheet.create({
  bar: { height: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  placeholder: { flex: 1, fontSize: 14, fontWeight: '500' },
  placeholderPhoto: { color: colors.surface, opacity: 0.85 },
  placeholderLight: { color: colors.muted },
});
