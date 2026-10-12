import { json, route } from '../../../../../server/http';
import { listDistricts } from '../../../../../server/geo';

// Districts of one state.
export const GET = route((_request, { state }) => json(listDistricts(state)));
