// Web build: babel turns `import { Pressable } from 'react-native'` into a per-component import; metro.config.js
// points that here so the web app gets the same press feel as native.
export { Pressable as default } from '../react-native';
