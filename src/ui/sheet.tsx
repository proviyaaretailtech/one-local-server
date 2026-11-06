// A sheet over the dimmed page for a question that needs an answer before going on (sign out, delete, clear): its title,
// a line about what happens, then the caller's buttons. Tapping the dimmed page calls `onClose`.
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './text';
import { colors, radius } from '../theme';

type Props = { testID: string; visible: boolean; onClose: () => void; title: string; body: string; children: ReactNode };

export function Sheet({ testID, visible, onClose, title, body, children }: Props) {
  const insets = useSafeAreaInsets();
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
    <Pressable style={s.dim} onPress={onClose} accessible={false}>
      {/* Taken by the sheet, so a tap on it never reaches the dimmed page behind. */}
      <View testID={testID} onStartShouldSetResponder={() => true} style={[s.sheet, { paddingBottom: insets.bottom + 22 }]}>
        <View style={s.grabber} />
        <Text style={s.title}>{title}</Text>
        <Text style={s.body}>{body}</Text>
        {children}
      </View>
    </Pressable>
  </Modal>;
}

const s = StyleSheet.create({
  dim: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: { maxHeight: '92%', gap: 10, paddingHorizontal: 22, paddingTop: 10, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.surface },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: 10, backgroundColor: colors.surfaceTertiary },
  title: { fontSize: 21, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4, color: colors.onSurface },
  body: { fontSize: 14, lineHeight: 21, color: colors.muted, marginBottom: 8 },
});
