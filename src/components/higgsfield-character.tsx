import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme, radius, spacing } from '../theme';
import { useTranslation } from '../i18n';

interface HiggsfieldCharacterProps {
  type: 'bappa' | 'shopping_character' | 'rider' | 'store';
  scale?: number;
  animated?: boolean;
  onLoad?: () => void;
}

/**
 * Higgsfield 3D character integration
 * Placeholders for:
 * - Bappa mascot (Ganesh Chaturthi festival theme)
 * - Shopping character (cart celebration)
 * - Rider avatar (live tracking)
 * - Store avatar (merchant profile)
 *
 * TODO: Replace with actual Higgsfield 3D models when integrated
 */
export function HiggsfieldCharacter({
  type,
  scale = 1,
  animated = true,
  onLoad,
}: HiggsfieldCharacterProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const bounceY = useSharedValue(0);
  const rotationZ = useSharedValue(0);

  useEffect(() => {
    if (!animated) return;

    // Bouncing animation
    bounceY.value = withRepeat(
      withTiming(10, { duration: 600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );

    // Subtle rotation
    rotationZ.value = withRepeat(
      withTiming(5, { duration: 3000, easing: Easing.linear }),
      -1,
      true
    );
  }, [animated]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: bounceY.value },
      { rotateZ: `${rotationZ.value}deg` },
      { scale },
    ],
  }));

  const characterEmoji = {
    bappa: '🙏',      // Ganesh/Bappa
    shopping_character: '👋', // Waving
    rider: '🚴',       // Rider
    store: '🏪',       // Store
  }[type];

  const characterLabel = t(`home.character.${type}`);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.characterBox,
          animated && animatedStyle,
        ]}
        onLayout={() => onLoad?.()}
      >
        <Text style={styles.emoji}>{characterEmoji}</Text>
      </Animated.View>
      <Text style={styles.label}>{characterLabel}</Text>

      {/* Placeholder notice for development */}
      <Text style={styles.placeholder}>
        {/* i18n-ignore: developer placeholder, never shown in a real build */}
        [Higgsfield 3D Asset Placeholder]
      </Text>
    </View>
  );
}

/**
 * Higgsfield character loader
 * Async loading + error handling for 3D models
 */
export function useHiggsfieldCharacter(type: string) {
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [assetUrl, setAssetUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    // TODO: Replace with actual Higgsfield API call
    // const loadCharacter = async () => {
    //   try {
    //     const response = await fetch('/api/higgsfield/generate', {
    //       method: 'POST',
    //       body: JSON.stringify({ prompt: `3D ${type} character` }),
    //     });
    //     const { url } = await response.json();
    //     setAssetUrl(url);
    //   } catch (err) {
    //     setError(`Failed to load ${type}`);
    //   } finally {
    //     setIsLoading(false);
    //   }
    // };

    // For now, simulate loading
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [type]);

  return { isLoading, error, assetUrl };
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    characterBox: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: colors.cityMid,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: spacing.md,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 1,
      shadowRadius: 16,
      elevation: 10,
    },
    emoji: {
      fontSize: 64,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.onSurface,
      marginBottom: spacing.sm,
    },
    placeholder: {
      fontSize: 10,
      color: colors.muted,
      fontStyle: 'italic',
    },
  });
