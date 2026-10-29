import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import { LogBox, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useFonts, Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold } from "@expo-google-fonts/poppins";
import { setPoppinsReady } from "@/src/ui/text";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { CartProvider } from "@/src/cart";
import { AppShell } from '@/src/components/app-shell';
import { colors } from '@/src/theme';
import { CityMotionProvider } from '@/src/motion';
import { CustomerProvider } from '@/src/customer';
import { AuthProvider } from '@/src/auth';
import { ProfileGate } from '@/src/components/profile-gate';
import { PushRegistrar } from '@/src/push-registrar';
import { IntroSplash } from '@/src/components/intro-splash';
import { CompareProvider } from '@/src/compare';
import { AppFrame } from '@/src/layout';
import { I18nProvider, LanguageFirstRun, ProfileLanguageSync } from '@/src/i18n';
import { UpdateGate } from '@/src/app-updates';
import { PopupHost } from '@/src/popups/popup-host';
import { NetworkStatus } from '@/src/network/network-status';
import { ComingSoonGate } from '@/src/components/coming-soon-gate';

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
  // The app's typeface (src/ui/text.tsx). First render waits for it, so text never jumps from one font to another; if the files
  // cannot load, the app goes ahead with the system font rather than staying blank.
  const [fontsLoaded, fontError] = useFonts({ Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold });
  setPoppinsReady(fontsLoaded);
  if (!fontsLoaded && !fontError) return null;

  return (
    <I18nProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <CartProvider>
              <StatusBar style="dark" />
              {Platform.OS === "web" && <Head><title>OneLocal</title></Head>}
              <CustomerProvider><ProfileLanguageSync /><AuthProvider><ProfileGate /><CompareProvider><CityMotionProvider><AppFrame><AppShell><Stack screenOptions={{ headerShown: false, title: 'OneLocal', animation: 'ios_from_right', gestureEnabled: true, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: colors.surface } }} /></AppShell><ComingSoonGate /><LanguageFirstRun /><PushRegistrar /><IntroSplash /><NetworkStatus /><PopupHost /><UpdateGate /></AppFrame></CityMotionProvider></CompareProvider></AuthProvider></CustomerProvider>
            </CartProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </I18nProvider>
  );
}
