import { colors } from './theme';
export const storePalette = (id: string, festival = 'ganesh') => {
  if (id === 'festive') return festival === 'navratri' ? { top: colors.careTop, soft: colors.careFade, ink: colors.beauty } : { top: colors.festiveTop, soft: colors.festiveSoft, ink: colors.festive };
  if (id === 'fitness') return { top: colors.fitnessTop, soft: colors.pastelBlue, ink: colors.fitness };
  if (id === 'trending') return { top: colors.shopsTop, soft: colors.shopsFade, ink: colors.shops };
  if (id === 'gourmet') return { top: colors.gourmetTop, soft: colors.foodFade, ink: colors.gourmet };
  return { top: colors.groceryTop, soft: colors.groceryFade, ink: colors.grocery };
};