import { json, route } from '../../../server/http';
import { requestErasure } from '../../../server/privacy';

// Delete my account: erases or anonymises what can go, keeps what the law requires (unlinked).
export const POST = route(async request => json(await requestErasure(request)));
