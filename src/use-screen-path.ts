import { createContext, useContext, useMemo } from 'react';
import { NavigationRouteContext } from 'expo-router/react-navigation';
import { paletteFor } from './departments';

// The path of the screen this component sits on, not the path the app is showing right now.
// usePathname() re-renders every subscriber on every navigation, so cards on the page being left
// repainted (in the next page's colours) in the middle of the slide. Nor is the route itself steady:
// every visit to a tab hands it a fresh route object, which re-rendered every card on the tab.
// So each screen's frame (src/components/app-shell.tsx) works its path out once and passes it down
// as a plain string, which never changes for a screen: components that read it render once.
const ScreenPathContext = createContext('/');
export const ScreenPathProvider = ScreenPathContext.Provider;
export const useScreenPath = () => useContext(ScreenPathContext);

/** A screen's path from its route, for its frame; everything inside the screen reads useScreenPath(). */
export function useRoutePath() {
  const route = useContext(NavigationRouteContext);
  return useMemo(() => {
    if (!route) return '/';
    const params = (route.params ?? {}) as Record<string, unknown>;
    const name = route.name.replace(/\[(\.\.\.)?(\w+)\]/g, (_, __, key) => String(params[key] ?? ''));
    return name === 'index' ? '/' : `/${name.replace(/(^|\/)index$/, '')}`;
  }, [route]);
}

export const useScreenPalette = () => { const path = useScreenPath(); return useMemo(() => paletteFor(path), [path]); };
