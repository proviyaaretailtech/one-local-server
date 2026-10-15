// Partner sign-up from the OneLocal partner website (founder, 10 Oct 2026). Public and unauthenticated by design: anyone
// may apply, so the guard is validation, rate limits and idempotency, and the answer never echoes personal data back.
// Stored in ol_partner_applications (migrations 0334, 0335); operations review it, and on approval the same details seed
// the partner's organisation and the VINII Partner app.
//
// Two stages, one row, keyed by the browser's submit key:
//   draft  — after the first screen (partner type, business, owner, phone, email): "then we save your draft".
//   submit — everything, with the category path checked against data/partner-taxonomy.json (the onboarding designs).
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import taxonomy from './data/partner-taxonomy.json';
import { resolveCity } from './catalog';
import { db, dbConfigured, fromDbError } from './db';
import { HttpError } from './http';
import { supabaseUrl } from './env';
import { limitCaller } from './limits';

export const CONSENT_VERSION = 'partner-signup-2026-10-10';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
// '' from an empty form field means "not given".
const optional = <T extends z.ZodTypeAny>(t: T) => z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v), t.optional());
const Phone = z.string().transform(s => s.replace(/\D/g, '').replace(/^(91|0)(?=[6-9]\d{9}$)/, '')).pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'));

const Basics = z.object({
  partner_type: z.enum(['store', 'restaurant', 'service', 'logistic']),
  business_name: z.string().transform(clean).pipe(z.string().min(2).max(120)),
  owner_name: z.string().transform(clean).pipe(z.string().min(2).max(120)),
  phone: Phone,
  email: z.string().trim().toLowerCase().email('That email looks wrong').max(200),
  consent: z.literal(true, { message: 'Please accept to continue' }),
  submit_key: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
});
const Full = Basics.extend({
  category_family: optional(z.string().max(80)),
  category: optional(z.string().max(80)),
  subcategories: z.array(z.string().max(80)).max(30).default([]),
  outlets: z.coerce.number().int().min(1).max(500).default(1),
  address: z.string().transform(clean).pipe(z.string().min(5).max(400)),
  pin_code: z.string().regex(/^[1-9][0-9]{5}$/, 'PIN code must be 6 digits'),
  whatsapp_ok: z.boolean().default(true),
  gstin: optional(z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'GSTIN looks wrong')),
  fssai: optional(z.string().trim().regex(/^[0-9]{14}$/, 'FSSAI licence is 14 digits')),
  services: z.array(z.enum(['delivery', 'pickup', 'dine_in'])).min(1).max(3).default(['delivery']),
  own_delivery: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
  // The partner app login (VINII Partner signs in with email + password). Never stored here, never logged.
  password: z.string().min(8, 'Password needs at least 8 characters').max(72, 'Password is too long')
    .regex(/[A-Za-z]/, 'Password needs a letter').regex(/[0-9]/, 'Password needs a number'),
});

type Category = { name: string; subcategories: string[] };
// The chosen path must exist in the onboarding tree; a restaurant picks types, a store a family + category, a service a category.
function checkPath(b: z.infer<typeof Full>): string | null {
  const subsOk = (allowed: string[]) => b.subcategories.length > 0 && b.subcategories.every(s => allowed.includes(s));
  if (b.partner_type === 'restaurant') return subsOk(taxonomy.restaurant.types.map(t => t.name)) ? null : 'Pick at least one restaurant type.';
  if (b.partner_type === 'logistic') return null;
  const cats: Category[] = b.partner_type === 'store'
    ? taxonomy.store.families.find(f => f.name === b.category_family)?.categories ?? []
    : taxonomy.service.categories;
  if (b.partner_type === 'store' && !cats.length) return 'Choose your store family.';
  const cat = cats.find(c => c.name === b.category);
  if (!cat) return 'Choose your category.';
  return subsOk(cat.subcategories) ? null : 'Select at least one subcategory.';
}
// The older single "business type" the rest of the platform reads, derived from the path.
function businessType(b: { partner_type: string; category_family?: string; category?: string; subcategories: string[] }): string {
  const has = (s: string) => b.subcategories.includes(s);
  if (b.partner_type === 'logistic') return 'logistics';
  if (b.partner_type === 'service') return 'service';
  if (b.partner_type === 'restaurant') return has('Café') || has('Bakery') ? 'cafe_bakery' : has('Sweets') ? 'sweets' : 'restaurant';
  if (has('Pharmacy / chemist')) return 'pharmacy';
  if (has('Supermarket')) return 'supermarket';
  if (b.category === 'Bakery and sweets') return 'sweets';
  if (b.category_family === 'Grocery and daily needs') return 'grocery';
  if (b.category === 'Beauty and health') return 'beauty';
  return 'retail';
}

export type ApplicationReceipt = { reference: string | null; status: string; existing: boolean; login?: 'created' | 'exists' | 'confirm_email' | 'failed' };

// Creates the partner's login through Supabase's normal sign-up (so the project's own rules apply: password strength,
// email confirmation when switched on). Returns the new account id, or null when the email already has an account
// (Supabase answers that case with an empty identities list rather than an error, so it cannot be used to probe emails).
async function createLogin(email: string, password: string, meta: Record<string, string>) {
  const url = supabaseUrl(); const key = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)?.trim();
  if (!url || !key) throw new HttpError(503, 'Account creation is not available right now.');
  const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth;
  const { data, error } = await auth.signUp({ email, password, options: { data: meta } });
  if (error) throw new HttpError(400, /weak|password/i.test(error.message) ? 'Choose a stronger password.' : 'We could not create your login. Please try again.');
  const user = data.user;
  if (!user || (user.identities && user.identities.length === 0)) return { id: null, state: 'exists' as const };
  return { id: user.id, state: data.session ? 'created' as const : 'confirm_email' as const };
}

function badRequest(error: z.ZodError): never {
  const first = error.issues[0];
  throw new HttpError(400, first?.message && !/^(Invalid|Expected|Required|Too small|Too big)/.test(first.message) ? first.message : `Please check ${String(first?.path?.[0] ?? 'the form').replace(/_/g, ' ')}.`);
}

async function byKey(key: string) {
  const { data, error } = await db().from('ol_partner_applications').select('id, reference, status').eq('submit_key', key).maybeSingle();
  if (error) fromDbError(error);
  return data as { id: string; reference: string; status: string } | null;
}

export async function submitPartnerApplication(request: Request, raw: unknown): Promise<ApplicationReceipt> {
  const stage = (raw as { stage?: unknown } | null)?.stage === 'draft' ? 'draft' : 'submit';
  // Drafts are saved as people go (auto-save), so they get a wider allowance than final submissions.
  if (stage === 'draft') await limitCaller(request, 'partner-draft', 30, 3_600_000, { verify: false, anonIpMax: 60 });
  else await limitCaller(request, 'partner-apply', 5, 3_600_000, { verify: false, anonIpMax: 15 });
  if (!dbConfigured()) throw new HttpError(503, 'Sign-ups are not open on this server yet.');
  const city = resolveCity(request);

  const parsed = (stage === 'draft' ? Basics : Full).safeParse(raw);
  if (!parsed.success) badRequest(parsed.error);
  const b = parsed.data as z.infer<typeof Full>;
  if (stage === 'submit') {
    const why = checkPath(b); if (why) throw new HttpError(400, why);
    if (b.password.toLowerCase().includes(b.phone) || b.password.toLowerCase() === b.email) throw new HttpError(400, 'Do not use your phone number or email as the password.');
  }

  const base = {
    city_id: city, partner_type: b.partner_type, business_name: b.business_name, owner_name: b.owner_name, phone: b.phone, email: b.email,
    business_type: businessType({ partner_type: b.partner_type, category_family: b.category_family, category: b.category, subcategories: b.subcategories ?? [] }),
    consent_version: CONSENT_VERSION, consent_at: new Date().toISOString(), source: 'partner_website',
  };
  const full = stage === 'draft' ? {} : {
    category_family: b.category_family ?? null, category: b.category ?? null, subcategories: b.subcategories,
    outlets: b.outlets, address: b.address, pin_code: b.pin_code, whatsapp_ok: b.whatsapp_ok, gstin: b.gstin ?? null, fssai: b.fssai ?? null,
    services: b.services, own_delivery: b.own_delivery, notes: b.notes?.trim() || null, status: 'submitted',
  };

  const prior = await byKey(b.submit_key);
  if (prior && prior.status !== 'draft') return { reference: prior.reference, status: prior.status, existing: true };
  const write = prior
    ? db().from('ol_partner_applications').update({ ...base, ...full }).eq('id', prior.id).eq('status', 'draft')
    : db().from('ol_partner_applications').insert({ ...base, ...full, submit_key: b.submit_key, status: stage === 'draft' ? 'draft' : 'submitted' });
  const { data, error } = await write.select('reference, status').single();
  if (!error) {
    if (stage === 'draft') return { reference: data.reference as string, status: data.status as string, existing: false };
    // The application is saved first; only then is the login created and linked, so a failed save never leaves a stray account.
    // If the login cannot be created the application still stands, and the answer says so.
    const login = await createLogin(b.email, b.password, { full_name: b.owner_name, business_name: b.business_name, signup_source: 'partner_website' })
      .catch(() => ({ id: null, state: 'failed' as const }));
    if (login.id) await db().from('ol_partner_applications').update({ applicant_user_id: login.id }).eq('reference', data.reference);
    return { reference: data.reference as string, status: data.status as string, existing: false, login: login.state };
  }
  if (error.code === '23505') {
    // An open application (draft or submitted) already exists for this phone: answer with that one, so the owner keeps one reference.
    const { data: open } = await db().from('ol_partner_applications').select('reference, status')
      .eq('city_id', city).eq('phone', b.phone).in('status', ['draft', 'submitted', 'reviewing']).limit(1).maybeSingle();
    // The reference is also the app sign-in code, so someone who only knows the phone number must not get it (migration 0347).
    if (open) return { reference: null, status: open.status as string, existing: true };
  }
  fromDbError(error);
}
