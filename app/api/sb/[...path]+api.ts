import { route } from '../../../server/http';
import { relaySupabase } from '../../../server/supabase-relay';

// Sign-in for phones on networks that block *.supabase.co (see server/supabase-relay.ts).
const relay = route(request => relaySupabase(request));
export const GET = relay;
export const POST = relay;
export const PUT = relay;
export const DELETE = relay;
