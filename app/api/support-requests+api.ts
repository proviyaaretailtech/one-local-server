import { json, route } from '../../server/http';
import { createSupportRequest } from '../../server/store';

export const POST = route(async request => json(await createSupportRequest(request)));
