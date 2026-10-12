import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import { LogBox, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { CartProvider } from "@/src/cart";
import { AppShell } from '@/src/components/app-shell';
import { colors } from '@/src/theme';
import { CityMotionProvider } from '@/src/motion';
import { CustomerProvider } from '@/src/customer';
import { AuthProvider } from '@/src/auth';
import { IntroSplash } from '@/src/components/intro-splash';
import { CompareProvider } from '@/src/compare';
import { AppFrame } from '@/src/layout';
import { I18nProvider, LanguageFirstRun, ProfileLanguageSync } from '@/src/i18n';
import { UpdateGate } from '@/src/app-updates';
import { PopupHost } from '@/src/popups/popup-host';
import { NetworkStatus } from '@/src/network/network-status';

LogBox.ignoreAllLogs(true);

// Icon prewarm for expo go android - keep this logic
const prewarmIcons = () => {
  if (Platform.OS === "android") {
    try {
      const IonIcons = require("@react-native-vector-icons/ionicons").default;
      // no-op reference to warm the font
      IonIcons?.getImageSource?.("cart", 24);
    } catch {}
  }
};

export default function RootLayout() {
  useEffect(() => {
    prewarmIcons();
  }, []);

  return (
    <I18nProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <CartProvider>
              <StatusBar style="dark" />
              {Platform.OS === "web" && <Head><title>OneLocal</title></Head>}
              <CustomerProvider><ProfileLanguageSync /><AuthProvider><CompareProvider><CityMotionProvider><AppFrame><AppShell><Stack screenOptions={{ headerShown: false, title: 'OneLocal', animation: 'ios_from_right', gestureEnabled: true, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: colors.surface } }} /></AppShell><LanguageFirstRun /><IntroSplash /><NetworkStatus /><PopupHost /><UpdateGate /></AppFrame></CityMotionProvider></CompareProvider></AuthProvider></CustomerProvider>
            </CartProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </I18nProvider>
  );
}
