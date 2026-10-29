import { readText, route } from '../../../server/http';
import { sendSmsHook } from '../../../server/send-sms-hook';

// Supabase Auth "Send SMS" hook (Authentication → Hooks → Send SMS → HTTPS). Not for the app: Supabase calls it, signed.
export const POST = route(async request => sendSmsHook(request, await readText(request, 8 * 1024)));
