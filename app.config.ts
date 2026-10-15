import config from './app.json';

// Customer app identity comes from .env (CUSTOMER_APP_BUNDLE_ID), falling back to app.json.
const bundleIdentifier = process.env.CUSTOMER_APP_BUNDLE_ID || config.expo.ios.bundleIdentifier;
// Shared with the home-screen widget (targets/widget) so it can show the latest order.
export const APP_GROUP = `group.${bundleIdentifier}`;

// Over-the-air updates (expo-updates / EAS Update): JavaScript and UI changes ship without a store
// rebuild. The runtime version is a fingerprint of the native code, so an update only reaches
// builds whose native side it matches; adding native modules or widget Swift needs a new build.
// Project id from `eas init` (public, not a secret). Kept in code, not .env, because .env is not
// uploaded to EAS build servers and a build without it could never receive updates.
// EAS_PROJECT_ID overrides it for a different Expo project — see docs/OTA_UPDATES.md.
const easProjectId = process.env.EAS_PROJECT_ID || '08ae9031-c338-4b72-82a9-4b655d93382e';

// Only public values go into `extra` (it ships inside the app). Server secrets such as
// GOOGLE_MAPS_API_KEY stay in process.env and are read only by app/api routes.
export default {
  ...config.expo,
  name: 'OneLocal',
  // The app version (app.json "version") is the runtime version: identical on every machine, so a build made from a
  // folder whose node_modules is a link, or that also holds a generated android/ project, matches on EAS. Raise the
  // version whenever native code changes, before sending an over-the-air update to that build.
  runtimeVersion: { policy: 'appVersion' },
  updates: easProjectId
    ? { enabled: true, url: `https://u.expo.dev/${easProjectId}`, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 }
    : { enabled: false },
  ios: {
    ...config.expo.ios,
    bundleIdentifier,
    // Live Activities (order tracking on the lock screen and in the Dynamic Island).
    infoPlist: { ...config.expo.ios.infoPlist, NSSupportsLiveActivities: true },
    entitlements: { 'com.apple.security.application-groups': [APP_GROUP] },
  },
  plugins: [
    ...config.expo.plugins,
    // iOS add-in layer: notifications, Live Activities / Dynamic Island, home-screen widget.
    // All three need a development build (`npx expo run:ios`); Expo Go and the web skip them.
    ['expo-notifications', { color: '#B3F400' }],
    '@bacons/apple-targets',
    'expo-dev-client',
    // The launch screen (expo-splash-screen) is configured in app.json: Android 12+ shows it inside a 192 dp circle, so its
    // imageWidth stays at 160 dp to keep the whole wide logo visible (220 cut it to "OneLoca").
    // Our folder name has spaces; keeps pod build scripts working (see the plugin).
    './plugins/with-space-safe-paths',
  ],
  extra: {
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    backendUrl: process.env.BACKEND_URL,
    // APP_SUPABASE_URL: the address a phone on the same Wi-Fi uses (e.g. http://192.168.x.x:54321), while
    // the dev server itself keeps SUPABASE_URL=http://127.0.0.1:54321 (server/env.ts only accepts local hosts).
    supabaseUrl: process.env.APP_SUPABASE_URL || process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
    googleMapsBrowserKey: process.env.GOOGLE_MAPS_BROWSER_KEY,
    appGroup: APP_GROUP,
  },
};
