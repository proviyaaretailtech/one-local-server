import { fail, route } from '../../../server/http';

// The AI assistant and photo/voice search depended on MongoDB and an AI key that is not
// configured. They are switched off until they are rebuilt on the new backend.
const off = route(() => fail(503, 'This AI feature is switched off while it moves to the new backend. Please use text search.'));
export const GET = off;
export const POST = off;
