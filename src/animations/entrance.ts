import Animated, {
  FadeInDown,
  FadeInUp,
  SlideInRight,
  SlideInUp,
  SlideInLeft,
  BounceIn,
  FadeOutDown,
  SlideOutRight,
} from 'react-native-reanimated';

/**
 * Entrance animations for product lists, categories, collections
 * Staggered by index for cascade effect
 */
export const productListAnimation = (index: number) => ({
  entering: SlideInRight.delay(index * 80).duration(400).springify(),
  exiting: FadeOutDown.duration(300),
});

export const categoryChipAnimation = (index: number) => ({
  entering: BounceIn.delay(index * 50).duration(500),
  exiting: FadeOutDown.duration(300),
});

/**
 * Cart celebration: character pops up with bounce
 */
export const cartCelebrationAnimation = {
  entering: BounceIn.duration(600).springify(),
  exiting: FadeOutDown.duration(400),
};

/**
 * Order status update: slide from bottom
 */
export const orderStatusAnimation = {
  entering: SlideInUp.duration(400).springify(),
  exiting: FadeOutDown.duration(300),
};

/**
 * Department header: fade and slide
 */
export const departmentHeaderAnimation = {
  entering: FadeInDown.duration(500),
  exiting: FadeOutDown.duration(300),
};

/**
 * Search result entry: staggered fade
 */
export const searchResultAnimation = (index: number) => ({
  entering: FadeInUp.delay(index * 30).duration(400),
  exiting: FadeOutDown.duration(300),
});
