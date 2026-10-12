import { json, route } from '../../../../server/http';
import { listStates } from '../../../../server/geo';

export const GET = route(() => json(listStates()));
