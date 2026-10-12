import { json, route } from '../../server/http';
import { livePopups } from '../../server/popups';

// Live pop-ups for one city and screen: GET /api/popups?city=latur&screen=home&lang=hi&app_version=1.0.0&cart=1
export const GET = route(async request => json(await livePopups(request)));
