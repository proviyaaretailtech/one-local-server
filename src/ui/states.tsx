// What a list shows while it has nothing in it: its icon on a soft mint tile, a line saying so, and (as children) the way
// to fill it.
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Icon from '@react-native-vector-icons/ionicons';
import { Text } from './text';
import { colors, mintCard, radius } from '../theme';

export function EmptyState({ testID, icon, title, body, children }: { testID?: string; icon: ComponentProps<typeof Icon>['name']; title: string; body?: string; children?: ReactNode }) {
  return <View testID={testID} style={s.box}>
    <View style={s.tile}><Icon name={icon} size={34} color={colors.forest} /></View>
    <Text style={s.title}>{title}</Text>
    {!!body && <Text style={s.body}>{body}</Text>}
    {children}
  </View>;
}

const s = StyleSheet.create({
  box: { alignItems: 'center', gap: 12, paddingTop: 36, paddingHorizontal: 8 },
  tile: { width: 84, height: 84, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: 6, backgroundColor: colors.mintTile, boxShadow: mintCard.glow },
  title: { fontSize: 20, lineHeight: 27, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center', color: colors.onSurface },
  body: { fontSize: 14, lineHeight: 21, textAlign: 'center', color: colors.muted, marginBottom: 8 },
});
