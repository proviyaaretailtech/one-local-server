import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useTheme, radius, spacing } from '../theme';

interface GlassCardProps {
  children: React.ReactNode;
  variant?: 'default' | 'bright' | 'subtle';
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

export function GlassCard({
  children,
  variant = 'default',
  style,
  onPress,
}: GlassCardProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const Component = onPress ? view : View;
  const pressableStyle = onPress ? { ...styles.card, ...styles[variant] } : [styles.card, styles[variant]];

  return (
    <View style={[pressableStyle, style]} {...(onPress && { onPress })}>
      {children}
    </View>
  );
}

// Fake pressable for non-interactive cards
const view = (props: any) => <View {...props} />;

const makeStyles = (colors: any) =>
  StyleSheet.create({
    card: {
      borderRadius: radius.md,
      borderWidth: 1,
      padding: spacing.md,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 8,
      elevation: 3,
    },
    // Variants
    default: {
      backgroundColor: colors.glass,      // 60% white glass
      borderColor: colors.glassLine,      // 70% white border
    },
    bright: {
      backgroundColor: colors.glassBright, // 88% white glass
      borderColor: colors.glassLine,
    },
    subtle: {
      backgroundColor: colors.surface,     // Opaque white
      borderColor: colors.border,
    },
  });
