import { useMemo } from 'react';
import { usePathname } from 'expo-router';
import { colors } from './theme';
import { paletteFor } from './departments';
export function usePageColors() {
  const path = usePathname();
  return useMemo(() => {
    if (path === '/') return colors;
    const p = paletteFor(path);
    return { ...colors, forest: p.color, forestDeep: p.color, lime: p.top, limeSoft: p.fade, cityMid: p.mid, cityFade: p.fade, brandSecondary: p.top, electricLime: p.top, inkSoft: p.color };
  }, [path]);
}