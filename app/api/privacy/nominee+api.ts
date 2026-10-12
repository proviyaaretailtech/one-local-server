import { json, route } from '../../../server/http';
import { nominate } from '../../../server/privacy';

// DPDP Act s.14: nominate someone to act for you after death or incapacity.
export const POST = route(async request => json(await nominate(request)));
