import { json, route } from '../../../../server/http';
import { recordPopupEvent } from '../../../../server/popups';

// Records one impression / tap / close for this device. Body: { event }.
export const POST = route(async (request, params) => json(await recordPopupEvent(request, params?.id ?? ''), { status: 201 }));
