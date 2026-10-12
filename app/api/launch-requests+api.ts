import { json, route } from '../../server/http';
import { createLaunchRequest } from '../../server/store';

// "Launch One Local here": demand from places we don't deliver to yet.
export const POST = route(async request => json(await createLaunchRequest(request)));
