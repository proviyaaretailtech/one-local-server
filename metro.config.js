// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// Secret env files (.env.dispatch.local etc.) live at the project root. The client bundle never needs them, and
// Metro was trying to transform them as JS and failing the Android bundle.
config.resolver.blockList = [...config.resolver.blockList, /(^|[\\/])\.env\.[^\\/]+$/];

// Use a stable on-disk store (shared across web/android)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(root, 'cache') }),
];


// // Exclude unnecessary directories from file watching
// config.watchFolders = [__dirname];
// config.resolver.blacklistRE = /(.*)\/(__tests__|android|ios|build|dist|.git|node_modules\/.*\/android|node_modules\/.*\/ios|node_modules\/.*\/windows|node_modules\/.*\/macos)(\/.*)?$/;

// // Alternative: use a more aggressive exclusion pattern
// config.resolver.blacklistRE = /node_modules\/.*\/(android|ios|windows|macos|__tests__|\.git|.*\.android\.js|.*\.ios\.js)$/;

// App-wide touch feel. Imports of `react-native` and `expo-haptics` from the app's own code (app/, src/)
// resolve to thin wrappers in src/native/ that add haptics + press motion to every button; libraries
// and the wrappers themselves (plus the modules they depend on) get the real packages.
const appCode = [path.join(__dirname, 'app') + path.sep, path.join(__dirname, 'src') + path.sep];
const rnShim = path.join(__dirname, 'src/native/react-native.tsx');
// On web Expo rewrites `react-native` to `react-native-web` before this resolver sees it.
const shims = { 'react-native': rnShim, 'react-native-web': rnShim, 'expo-haptics': path.join(__dirname, 'src/native/expo-haptics.ts') };
const realFor = new Set(['src/native/react-native.tsx', 'src/native/expo-haptics.ts', 'src/native/haptic-clock.ts', 'src/motion.tsx', 'src/motion-tokens.ts', 'src/haptics.ts'].map(f => path.join(__dirname, f)));
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const from = context.originModulePath;
  if (appCode.some(dir => from.startsWith(dir)) && !realFor.has(from)) {
    if (shims[moduleName]) return { type: 'sourceFile', filePath: shims[moduleName] };
    // Web: babel-preset-expo rewrites `import { Pressable } from 'react-native'` to a per-component path.
    const web = /^react-native-web\/dist\/(?:cjs\/)?exports\/(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)(?:\/index(?:\.js)?)?$/.exec(moduleName);
    if (web) return { type: 'sourceFile', filePath: path.join(__dirname, 'src/native/web', `${web[1]}.ts`) };
  }
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

// Reduce the number of workers to decrease resource usage
config.maxWorkers = 2;

module.exports = config;
