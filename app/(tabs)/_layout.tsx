import { Tabs } from 'expo-router';
import { colors } from '@/src/theme';
export default function TabsLayout() {
  return <Tabs backBehavior="history" tabBar={() => null} screenOptions={{ headerShown: false, title: 'OneLocal', lazy: true, freezeOnBlur: true, animation: 'none', sceneStyle: { backgroundColor: colors.surface } }}>
    {['index', 'categories', 'discover', 'food', 'book-it'].map(name => <Tabs.Screen key={name} name={name} />)}
    {['reels', 'cart', 'account', 'grocery', 'pharmacy', 'beauty', 'shops', 'care'].map(name => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
  </Tabs>;
}