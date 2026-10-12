import { findProduct, resolveCity } from '../../../server/catalog';
import { HttpError, json, route } from '../../../server/http';

export const GET = route(async (request, { id }) => {
  const product = await findProduct(resolveCity(request), id);
  if (!product) throw new HttpError(404, 'Product not found');
  return json(product);
});
