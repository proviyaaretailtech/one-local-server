import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, Catalog, Reel } from './api';

export function useDiscovery() {
  const { t } = useTranslation();
  // The catalogue photo ads are written here, not by the server, so their caption is translated when the cached list is
  // read (not when it is fetched): changing the language re-words them without another network call.
  const select = useCallback((reels: Reel[]) => reels.map(r => r.id.startsWith('photo-') ? { ...r, caption: t('discover.photoCaption', { name: r.product.name }) } : r), [t]);
  return useQuery({ queryKey: ['discovery'], select, queryFn: async () => {
    const [reels, catalog] = await Promise.all([api<Reel[]>('/reels'), api<Catalog>('/catalog')]);
    const featured = new Set(reels.map(r => r.product.id));
    const ids = ['f4', 'b2', 'p1', 'sneak1', 'f5', 'audio1', 'p3', 'h2', 'a3'];
    const photos: Reel[] = ids.flatMap(id => {
      const product = catalog.products.find(p => p.id === id);
      if (!product || featured.has(id)) return [];
      const brand = catalog.brands.find(b => b.id === product.brand_id);
      // i18n-ignore: caption is replaced by select() above; tag and tagline are not shown; 'OneLocal Fresh' is a brand name
      return [{ id: `photo-${id}`, video: '', video_web: '', product, caption: `${product.name}. A little find for your everyday.`, creator: brand?.name || 'OneLocal Fresh', likes: 0, tag: 'Catalogue photo', brand: brand || { id: product.store_id, name: 'OneLocal Fresh', department: product.department || 'grocery', logo: '', image: product.image, tagline: 'Your local finds' } }];
    });
    return [...reels, ...photos];
  }, retry: 1 });
}
