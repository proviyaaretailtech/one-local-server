import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, radius, spacing } from '../theme';

interface GlassButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export function GlassButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
}: GlassButtonProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        styles[size],
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    button: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: 'row',
    },
    // Variants
    primary: {
      backgroundColor: colors.glassBright, // 88% white glass
      borderColor: colors.glassLine,      // 70% white border
    },
    secondary: {
      backgroundColor: colors.glass,      // 60% white glass
      borderColor: colors.glassLine,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderColor: colors.borderStrong,
    },
    // Sizes
    sm: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    md: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    lg: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
    },
    // States
    pressed: {
      opacity: 0.8,
      transform: [{ scale: 0.98 }],
    },
    disabled: {
      opacity: 0.5,
    },
    // Labels
    label: {
      fontSize: 16,
      fontWeight: '600',
    },
    primaryLabel: {
      color: colors.onSurface,
    },
    secondaryLabel: {
      color: colors.onSurface,
    },
    ghostLabel: {
      color: colors.brandPrimary,
    },
  });
