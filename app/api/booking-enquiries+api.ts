import { json, route } from '../../server/http';
import { createEnquiry } from '../../server/store';

export const POST = route(async request => json(await createEnquiry(request)));
