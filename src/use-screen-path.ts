import { useContext, useMemo } from 'react';
import { NavigationRouteContext } from 'expo-router/react-navigation';
import { paletteFor } from './departments';

// The path of the screen this component sits on, not the path the app is showing right now.
// usePathname() re-renders every subscriber on every navigation, so cards on the page being left
// repainted (in the next page's colours) in the middle of the slide. A screen's own route never
// changes, so components that read this render once.
export function useScreenPath() {
  const route = useContext(NavigationRouteContext);
  return useMemo(() => {
    if (!route) return '/';
    const params = (route.params ?? {}) as Record<string, unknown>;
    const name = route.name.replace(/\[(\.\.\.)?(\w+)\]/g, (_, __, key) => String(params[key] ?? ''));
    return name === 'index' ? '/' : `/${name.replace(/(^|\/)index$/, '')}`;
  }, [route]);
}

export const useScreenPalette = () => { const path = useScreenPath(); return useMemo(() => paletteFor(path), [path]); };
