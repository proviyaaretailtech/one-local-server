import { filterProducts, resolveCity } from '../../../server/catalog';
import { json, route } from '../../../server/http';

export const GET = route(async request => {
  const q = new URL(request.url).searchParams;
  return json(await filterProducts(resolveCity(request), {
    category_id: q.get('category_id'), chip: q.get('chip'), department: q.get('department'), brand_id: q.get('brand_id'), q: q.get('q'),
  }));
});
