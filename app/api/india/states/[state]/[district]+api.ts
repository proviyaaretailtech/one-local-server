import { json, route } from '../../../../../server/http';
import { listPlaces } from '../../../../../server/geo';

// Every city, town and village in one district.
export const GET = route((_request, { state, district }) => json(listPlaces(state, district)));
