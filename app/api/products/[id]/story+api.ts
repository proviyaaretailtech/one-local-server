import { getCatalog, inCity, resolveCity } from '../../../../server/catalog';
import { HttpError, json, route } from '../../../../server/http';

// Everything the immersive product page needs in one call: a gallery (product shot first, then
// the store's and brand's photos), the best video (the product's own reel, else its store's
// film), the store and brand, and similar items for "More like this" and Compare.
export const GET = route(async (request, { id }) => {
  const city = resolveCity(request);
  const catalog = await getCatalog();
  const products = inCity(catalog.products, city);
  const product = products.find(p => p.id === id);
  if (!product) throw new HttpError(404, 'Product not found');

  const store = inCity(catalog.stores, city).find(s => s.id === product.store_id) ?? null;
  const brand = catalog.brands.find(b => b.id === product.brand_id) ?? null;
  const category = catalog.categories.find(c => c.id === product.category_id) ?? null;
  const reel = catalog.reels.find(r => r.product_id === product.id) ?? null;
  const storeVideo = store?.media.find(m => m.type === 'video') ?? null;

  const gallery = [...new Set([
    product.image,
    ...(store?.media ?? []).filter(m => m.type === 'image').map(m => m.url),
    brand?.image, category?.image,
  ].filter((u): u is string => !!u))].slice(0, 6);

  const video = reel
    ? { url: reel.video, web: `${reel.video}-webm`, poster: product.image, label: 'Watch it in action' }
    : storeVideo ? { url: storeVideo.url, web: storeVideo.video_web ?? storeVideo.url, poster: storeVideo.thumbnail ?? product.image, label: `Inside ${store!.name}` } : null;

  const related = products.filter(p => p.id !== product.id && p.category_id === product.category_id);
  const more = products.filter(p => p.id !== product.id && p.category_id !== product.category_id && p.department === product.department);
  return json({
    product, gallery, video, category: category && { id: category.id, name: category.name },
    store: store && { id: store.id, name: store.name, logo: store.logo, tagline: store.tagline, delivery_time: store.delivery_time, rating: store.rating },
    brand: brand && { id: brand.id, name: brand.name, logo: brand.logo, tagline: brand.tagline },
    related: [...related, ...more].slice(0, 10),
  });
});
