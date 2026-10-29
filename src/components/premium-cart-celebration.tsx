import React, { useEffect } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '@/src/ui/text';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  BounceIn,
  FadeOut,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { useTheme, radius, spacing } from '../theme';
import { GlassButton } from './glass-button';
import { useTranslation } from '@/src/i18n';

interface PremiumCartCelebrationProps {
  productName: string;
  quantity: number;
  onDismiss: () => void;
  onViewCart: () => void;
  autoDismissMs?: number;
}

/**
 * Premium cart celebration overlay with animated character
 * Replaces plain toast with celebratory 3D character
 */
export function PremiumCartCelebration({
  productName,
  quantity,
  onDismiss,
  onViewCart,
  autoDismissMs = 2200,
}: PremiumCartCelebrationProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  
  // Character scale animation
  const characterScale = useSharedValue(0);
  const characterRotate = useSharedValue(0);
  
  const characterAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: characterScale.value },
      { rotateZ: `${characterRotate.value}deg` },
    ],
  }));

  useEffect(() => {
    // Pop in with bounce
    characterScale.value = withSpring(1, {
      damping: 6,
      mass: 1,
      overshootClamping: false,
    });
    
    // Subtle wave motion
    characterRotate.value = withSequence(
      withTiming(5, { duration: 200 }),
      withTiming(-5, { duration: 200 }),
      withTiming(0, { duration: 200 })
    );

    // Auto dismiss
    if (autoDismissMs > 0) {
      const timer = setTimeout(() => {
        characterScale.value = withTiming(0, { duration: 300 }, () => {
          onDismiss();
        });
      }, autoDismissMs);

      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <View style={styles.container}>
      {/* Glass overlay backdrop */}
      <Pressable style={styles.backdrop} onPress={onDismiss} />

      {/* Celebration card */}
      <Animated.View
        entering={BounceIn.duration(600).springify()}
        exiting={FadeOut.duration(300)}
        style={styles.card}
      >
        {/* 3D Character (Placeholder — replace with Higgsfield asset) */}
        <Animated.View
          style={[styles.characterContainer, characterAnimatedStyle]}
        >
          <View style={styles.character}>
            {/* Placeholder: emoji + gradient background */}
            <Text style={styles.characterEmoji}>👋</Text>
          </View>
        </Animated.View>

        {/* Celebration text */}
        <Text style={styles.title}>{t('cart.celebration.added')}</Text>
        <Text style={styles.subtitle}>
          {quantity} × {productName}
        </Text>

        {/* Quantity badge */}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{quantity}</Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <GlassButton
            label={t('cart.celebration.continue')}
            variant="ghost"
            size="sm"
            onPress={onDismiss}
          />
          <GlassButton
            label={t('cart.celebration.view')}
            variant="primary"
            size="sm"
            onPress={onViewCart}
          />
        </View>

        {/* Confetti particles (decorative) */}
        {[...Array(8)].map((_, i) => (
          <ConfettiParticle key={i} index={i} />
        ))}
      </Animated.View>
    </View>
  );
}

/**
 * Decorative confetti particle
 */
function ConfettiParticle({ index }: { index: number }) {
  const { colors } = useTheme();
  const posX = useSharedValue(0);
  const posY = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    // Animate particle falling and fading
    posX.value = withTiming(Math.random() * 80 - 40, { duration: 1200 });
    posY.value = withTiming(Math.random() * 100 + 40, { duration: 1200 });
    opacity.value = withTiming(0, { duration: 1000 });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: posX.value }, { translateY: posY.value }],
    opacity: opacity.value,
  }));

  const colors_list = [
    colors.pastelRed,
    colors.pastelYellow,
    colors.pastelGreen,
    colors.pastelBlue,
    colors.pastelPurple,
    colors.pastelPink,
  ];

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors_list[index % colors_list.length],
        },
        animatedStyle,
      ]}
    />
  );
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'flex-end',
      alignItems: 'center',
      zIndex: 1000,
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.overlay,
    },
    card: {
      backgroundColor: colors.glassBright,
      borderWidth: 1,
      borderColor: colors.glassLine,
      borderRadius: radius.md,
      padding: spacing.lg,
      alignItems: 'center',
      marginBottom: spacing.xl,
      width: '85%',
      maxWidth: 300,
    },
    characterContainer: {
      marginBottom: spacing.lg,
    },
    character: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.cityMid,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 12,
      elevation: 8,
    },
    characterEmoji: {
      fontSize: 48,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.onSurface,
      marginBottom: spacing.sm,
    },
    subtitle: {
      fontSize: 14,
      color: colors.muted,
      marginBottom: spacing.lg,
    },
    badge: {
      backgroundColor: colors.brandSecondary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      marginBottom: spacing.lg,
    },
    badgeText: {
      color: colors.onSurface,
      fontWeight: '600',
      fontSize: 12,
    },
    actions: {
      gap: spacing.md,
      width: '100%',
    },
  });
