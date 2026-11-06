// A row in a menu of places to go or things to do (the profile's lists, Privacy's rights): the row's icon on a soft mint
// tile, its name and a line under it, and at its end a chevron unless `trailing` puts something else there. ListGroup
// lays rows on one white card with a hairline between each.
import { Children, Fragment, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Icon from '@react-native-vector-icons/ionicons';
import { Text } from './text';
import { colors, radius, soft } from '../theme';

type Props = { testID: string; icon: ComponentProps<typeof Icon>['name']; title: string; subtitle?: string; trailing?: ReactNode; onPress: () => void; disabled?: boolean; accessibilityHint?: string };

export function ListRow({ testID, icon, title, subtitle, trailing, onPress, disabled, accessibilityHint }: Props) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityHint={accessibilityHint} disabled={disabled} onPress={onPress} style={s.row}>
    <View style={s.tile}><Icon name={icon} size={20} color={colors.forest} /></View>
    <View style={s.copy}>
      <Text testID={`${testID}-label`} style={s.title}>{title}</Text>
      {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
    </View>
    {trailing ? <View>{trailing}</View> : <Icon name="chevron-forward" size={18} color={colors.muted} />}
  </Pressable>;
}

export function ListGroup({ testID, children }: { testID?: string; children: ReactNode }) {
  return <View testID={testID} style={s.group}>{Children.toArray(children).map((row, i) => <Fragment key={i}>{i > 0 && <View style={s.line} />}{row}</Fragment>)}</View>;
}

const TILE = 40;
const SIDE = 16;
const s = StyleSheet.create({
  group: { borderRadius: radius.md, backgroundColor: colors.surface, boxShadow: soft.lifted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 70, paddingVertical: 12, paddingHorizontal: SIDE },
  tile: { width: TILE, height: TILE, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintTile },
  copy: { flex: 1 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: colors.onSurface },
  subtitle: { fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 1 },
  // Starts under the words, not the tile, so the tiles read as one column.
  line: { height: 1, marginLeft: SIDE + TILE + 14, backgroundColor: colors.border },
});
