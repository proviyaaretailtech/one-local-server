import React from 'react';
import type { ParseKeys } from 'i18next';
import { View, StyleSheet, ScrollView, Image } from 'react-native';
import { Text } from '@/src/ui/text';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme, radius, spacing } from '../theme';
import { GlassCard } from './glass-card';
import { orderStatusKey, useFormat, useTranslation } from '@/src/i18n';

export interface OrderTrackingProps {
  status: 'placed' | 'packed' | 'out' | 'delivered';
  eta_minutes: number;
  rider_name?: string;
  rider_phone?: string;
  items: any[];
  total: number;
}

// Labels are catalogue keys: status words come from the order-status mapping, "Being Packed" has its own line.
const STATUS_STEPS: { key: string; label: ParseKeys; icon: string }[] = [
  { key: 'placed', label: orderStatusKey('placed'), icon: '✓' },
  { key: 'packed', label: 'tracking.step.beingPacked', icon: '📦' },
  { key: 'out', label: orderStatusKey('out'), icon: '🚴' },
  { key: 'delivered', label: orderStatusKey('delivered'), icon: '🏠' },
];

/**
 * Real-time order tracking with status timeline
 */
export function OrderTracking({
  status,
  eta_minutes,
  rider_name,
  rider_phone,
  items,
  total,
}: OrderTrackingProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const fmt = useFormat();
  const styles = makeStyles(colors);
  const currentStepIndex = STATUS_STEPS.findIndex((s) => s.key === status);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* ETA Banner */}
      <Animated.View
        entering={FadeInDown.duration(500)}
        style={styles.etaBanner}
      >
        <Text style={styles.etaLabel}>{t('tracking.etaTitle')}</Text>
        <Text style={styles.etaTime}>{t('tracking.etaMinutes', { count: eta_minutes })}</Text>
      </Animated.View>

      {/* Status Timeline */}
      <View style={styles.timeline}>
        {STATUS_STEPS.map((step, index) => {
          const isActive = index <= currentStepIndex;
          const isCurrent = index === currentStepIndex;

          return (
            <Animated.View
              key={step.key}
              entering={FadeInDown.delay(index * 100).duration(500)}
              style={styles.step}
            >
              {/* Step circle */}
              <View
                style={[
                  styles.stepCircle,
                  isActive && styles.stepCircleActive,
                  isCurrent && styles.stepCircleCurrent,
                ]}
              >
                <Text style={styles.stepIcon}>{step.icon}</Text>
              </View>

              {/* Step label */}
              <Text
                style={[
                  styles.stepLabel,
                  isActive && styles.stepLabelActive,
                ]}
              >
                {t(step.label)}
              </Text>

              {/* Connector line */}
              {index < STATUS_STEPS.length - 1 && (
                <View
                  style={[
                    styles.connector,
                    isActive && styles.connectorActive,
                  ]}
                />
              )}
            </Animated.View>
          );
        })}
      </View>

      {/* Rider info (if assigned) */}
      {status !== 'placed' && rider_name && (
        <GlassCard variant="bright">
          <View style={styles.riderInfo}>
            <View style={styles.riderAvatar}>
              <Text style={styles.riderAvatarEmoji}>🚴</Text>
            </View>
            <View style={styles.riderDetails}>
              <Text style={styles.riderName}>{rider_name}</Text>
              <Text style={styles.riderPhone}>{rider_phone}</Text>
            </View>
          </View>
        </GlassCard>
      )}

      {/* Items summary */}
      <View style={styles.itemsSection}>
        <Text style={styles.itemsTitle}>{t('tracking.itemsHeading', { n: fmt.number(items.length) })}</Text>
        {items.map((item, index) => (
          <View key={item.id || index} style={styles.itemRow}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemQty}>× {item.qty}</Text>
            <Text style={styles.itemPrice}>{fmt.money(item.price)}</Text>
          </View>
        ))}
      </View>

      {/* Order total */}
      <GlassCard variant="default">
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('tracking.orderTotal')}</Text>
          <Text style={styles.totalAmount}>{fmt.money(total)}</Text>
        </View>
      </GlassCard>
    </ScrollView>
  );
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      padding: spacing.lg,
    },
    etaBanner: {
      backgroundColor: colors.lime,
      borderRadius: radius.md,
      padding: spacing.lg,
      marginBottom: spacing.xl,
      alignItems: 'center',
    },
    etaLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.onSurface,
      opacity: 0.7,
    },
    etaTime: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.forest,
      marginTop: spacing.sm,
    },
    timeline: {
      marginBottom: spacing.xl,
    },
    step: {
      marginBottom: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
    },
    stepCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 2,
      borderColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.lg,
    },
    stepCircleActive: {
      backgroundColor: colors.cityMid,
      borderColor: colors.forest,
    },
    stepCircleCurrent: {
      backgroundColor: colors.lime,
      borderColor: colors.forest,
      borderWidth: 3,
    },
    stepIcon: {
      fontSize: 24,
    },
    stepLabel: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.muted,
      flex: 1,
    },
    stepLabelActive: {
      color: colors.onSurface,
      fontWeight: '600',
    },
    connector: {
      position: 'absolute',
      left: 27,
      top: 56,
      width: 2,
      height: spacing.lg,
      backgroundColor: colors.border,
    },
    connectorActive: {
      backgroundColor: colors.forest,
    },
    riderInfo: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    riderAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.cityMid,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: spacing.md,
    },
    riderAvatarEmoji: {
      fontSize: 24,
    },
    riderDetails: {
      flex: 1,
    },
    riderName: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.onSurface,
    },
    riderPhone: {
      fontSize: 12,
      color: colors.muted,
      marginTop: spacing.xs,
    },
    itemsSection: {
      marginBottom: spacing.xl,
    },
    itemsTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.onSurface,
      marginBottom: spacing.md,
    },
    itemRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    itemName: {
      fontSize: 13,
      color: colors.onSurface,
      flex: 1,
    },
    itemQty: {
      fontSize: 12,
      color: colors.muted,
      marginRight: spacing.md,
    },
    itemPrice: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.forest,
    },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.md,
    },
    totalLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.onSurface,
    },
    totalAmount: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.forest,
    },
  });
