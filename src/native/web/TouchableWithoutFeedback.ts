// Web build: babel turns `import { TouchableWithoutFeedback } from 'react-native'` into a per-component import; metro.config.js
// points that here so the web app gets the same press feel as native.
export { TouchableWithoutFeedback as default } from '../react-native';
