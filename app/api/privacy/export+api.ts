import { json, route } from '../../../server/http';
import { exportMyData } from '../../../server/privacy';

// DPDP Act s.11: everything we hold about the signed-in person, as one JSON file. Never cached.
export const GET = route(async request => json(await exportMyData(request), { headers: { 'Cache-Control': 'no-store' } }));
