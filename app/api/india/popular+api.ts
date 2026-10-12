import { json, route } from '../../../server/http';
import { popularCities } from '../../../server/geo';

export const GET = route(() => json(popularCities()));
