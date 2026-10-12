// Becoming a rider: register, profile, where you work, what you ride, your documents, and the application itself.
// These routes need only a signed-in user (the rider row may not exist yet, or may not be approved yet), so they use
// requireUser/ownRider below instead of requireRider. As everywhere, the rider is found from the token, never the body.
// Routes: /api/rider/{register,profile,hub,type,store-link,vehicle,preferences,payout,kyc/*,submit,status}, /api/geo/*.
import { z } from 'zod';
import { distanceKm } from './catalog';
import { signedInUserId } from './auth';
import { db, fromDbError } from './db';
import { nearestPlace } from './geo';
import { HttpError } from './http';
import { kycEngine, readyEngine } from './kyc/config';
import { confirmAsset, notFound, parse } from './rider-extra';
import { digilockerResult, startDigilockerSession, verifyWithEngine } from './rider-kyc';
import { payoutMethodDto } from './rider-money';

type Row = Record<string, any>;
export type Applicant = { id: string; userId: string; status: string; type: string; row: Row };

// ---------- who is calling ----------

export async function requireUser(request: Request): Promise<string> {
  const userId = await signedInUserId(request);
  if (!userId) throw new HttpError(401, 'Sign in to continue.', undefined, 'unauthorized');
  return userId;
}

async function findRider(userId: string): Promise<Row | null> {
  const { data, error } = await db().from('riders').select('*').eq('user_id', userId).maybeSingle();
  if (error) fromDbError(error);
  return data;
}

// Any rider row, whatever its status, except a suspended one.
export async function ownRider(request: Request, opts: { editing?: boolean } = {}): Promise<Applicant> {
  const userId = await requireUser(request);
  const row = await findRider(userId);
  if (!row) throw new HttpError(403, 'You have not registered as a rider yet.', undefined, 'not_enrolled');
  if (row.status === 'suspended') throw new HttpError(403, 'Your rider account is suspended. Please contact support.', undefined, 'suspended');
  // The application can be changed only until it is sent in, or when it was sent back.
  if (opts.editing) assertEditable(row.status);
  return { id: row.id, userId, status: row.status, type: row.type, row };
}
const EDITABLE = ['draft', 'rejected', 'documents_expired'];
function assertEditable(status: string) {
  if (!EDITABLE.includes(status)) {
    throw new HttpError(409, status === 'approved' ? 'Your application is already approved.' : 'Your application is being checked, so it cannot be changed now.', undefined, 'locked');
  }
}

const fromDb = (e: any) => { if (e?.code === '23505') return true; fromDbError(e); };

// ---------- the rider as the app sees them (RiderDto) ----------

export function riderDto(r: Row) {
  const limit = r.cash_limit_minor != null ? Number(r.cash_limit_minor) / 100 : r.cash_limit != null ? Number(r.cash_limit) : undefined;
  return {
    id: r.id, rider_code: `RIDER-${String(r.id).slice(-4).toUpperCase()}`, user_id: r.user_id, phone: r.phone ?? '', full_name: r.full_name,
    photo_asset_id: r.photo_asset_id ?? undefined, email: r.email ?? undefined, language: r.language ?? 'en', type: r.type, status: r.status,
    status_reason: r.review_reason ?? undefined, city_id: r.city_id ?? undefined, zone_id: r.zone_id ?? undefined,
    organization_id: r.organization_id ?? undefined, acceptance: r.acceptance, categories: r.categories ?? [], multi_store: !!r.multi_store,
    store_ids: r.store_ids ?? [], cash_limit: limit, emergency_phone: r.emergency_phone ?? undefined, referral_code: r.referral_code ?? undefined, created_at: r.created_at, updated_at: r.updated_at,
  };
}

async function update(riderId: string, patch: Row) {
  const { data, error } = await db().from('riders').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', riderId).select('*').single();
  if (error) fromDbError(error);
  return data as Row;
}

// ---------- register ----------

const REFERRAL = /^[A-Z0-9-]{4,24}$/;
const registerBody = z.object({
  full_name: z.string().trim().min(2).max(80),
  referral_code: z.string().trim().toUpperCase().refine(v => v === '' || REFERRAL.test(v), 'not a valid referral code').nullish(),
});

// POST /rider/register. One rider per signed-in user: asking again returns the same rider.
export async function register(userId: string, raw: unknown) {
  const b = parse(registerBody, raw);
  const existing = await findRider(userId);
  if (existing) return { rider_id: existing.id, status: existing.status };
  const u = await db().auth.admin.getUserById(userId);
  const phone = u.data.user?.phone ? `+${u.data.user.phone.replace(/^\+/, '')}` : null;
  const ins = await db().from('riders').insert({ user_id: userId, full_name: b.full_name, phone, status: 'draft', onboarding_step: 'registered', referral_code: b.referral_code || null }).select('id, status').single();
  if (ins.error) {
    if (!fromDb(ins.error)) throw ins.error;
    const again = await findRider(userId); // two taps at once: the other one won
    if (!again) throw new HttpError(409, 'That referral code is already in use.', undefined, 'conflict'); // referral_code is unique
    return { rider_id: again.id, status: again.status };
  }
  return { rider_id: ins.data.id, status: ins.data.status };
}

// ---------- profile ----------

const profileBody = z.object({
  full_name: z.string().trim().min(2).max(80), photo_asset_id: z.string().nullish(),
  emergency_phone: z.string().regex(/^\+?[0-9 ()-]{7,16}$/, 'not a phone number').nullish(), email: z.string().trim().toLowerCase().email().max(120).nullish(),
  language: z.enum(['en', 'hi', 'mr', 'kn']).default('en'),
});

// PUT /rider/profile.
export async function setProfile(a: Applicant, raw: unknown) {
  const b = parse(profileBody, raw);
  const open = EDITABLE.includes(a.status);
  if (!open && b.full_name !== a.row.full_name) throw new HttpError(409, 'Your name cannot be changed after you have applied.', undefined, 'locked');
  const patch: Row = { email: b.email ?? null, emergency_phone: b.emergency_phone ? b.emergency_phone.replace(/[ ()-]/g, '') : null, language: b.language, onboarding_step: open ? 'profile' : a.row.onboarding_step };
  if (open) patch.full_name = b.full_name;
  if (b.photo_asset_id) patch.photo_asset_id = await confirmAsset(a, b.photo_asset_id, ['profile_photo']);
  return riderDto(await update(a.id, patch));
}

// ---------- where: zones and the start hub ----------

type Area = { city: string; name: string; lat: number; lng: number; radiusKm: number };
async function areas(): Promise<Area[]> {
  const { data, error } = await db().from('ol_service_areas').select('city_id, name, lat, lng, radius_km').eq('active', true).is('deleted_at', null);
  if (error) fromDbError(error);
  return (data ?? []).map(r => ({ city: r.city_id, name: r.name, lat: Number(r.lat), lng: Number(r.lng), radiusKm: Number(r.radius_km) }));
}

// One zone per live city: the delivery circle. (There is no finer zone table yet.)
const zoneId = (city: string) => `${city}-all`;
const cityOfZone = (id: string) => (id.endsWith('-all') ? id.slice(0, -4) : null);
function boundary(a: Area) {
  const ring = Array.from({ length: 24 }, (_, i) => {
    const t = (i / 24) * 2 * Math.PI;
    return { lat: Math.round((a.lat + (a.radiusKm / 111.32) * Math.cos(t)) * 1e5) / 1e5, lng: Math.round((a.lng + (a.radiusKm / (111.32 * Math.cos((a.lat * Math.PI) / 180))) * Math.sin(t)) * 1e5) / 1e5 };
  });
  return [...ring, ring[0]];
}
const geoZone = (a: Area) => ({ id: zoneId(a.city), cityId: a.city, name: a.name, boundary: boundary(a), neighbours: [] as string[], active: true });
const geoCity = (a: Area, stateCode: string) => ({ id: a.city, stateCode, name: a.name, timezone: 'Asia/Kolkata', center: { lat: a.lat, lng: a.lng } });

const coords = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

function stateOf(p: { lat: number; lng: number }) {
  try { const s = nearestPlace(p); return { code: s.state_code, name: s.state }; } catch { return { code: 'IN', name: 'India' }; }
}

// GET /geo/zones?lat=&lng=. Inside a live city: its state, city and zone. Outside: 200 with code out_of_zone and
// the nearest city (the app reads that body, see lookupZone in the rider app).
export async function lookupZone(q: URLSearchParams) {
  const p = parse(coords, { lat: q.get('lat'), lng: q.get('lng') });
  const list = await areas();
  const ranked = list.map(a => ({ a, km: distanceKm(p, a) })).sort((x, y) => x.km - y.km);
  const near = ranked[0];
  if (!near) return { status: 'out_of_zone', code: 'out_of_zone' };
  const state = stateOf(near.a);
  if (near.km > near.a.radiusKm) return { status: 'out_of_zone', code: 'out_of_zone', nearestCity: geoCity(near.a, state.code) };
  return { status: 'in_zone', state: { code: state.code, name: state.name }, city: geoCity(near.a, state.code), zone: geoZone(near.a), neighbours: [] };
}

// GET /geo/cities/:id/zones
export async function citiesZones(cityId: string) {
  const a = (await areas()).find(x => x.city === cityId);
  if (!a) throw new HttpError(404, 'City not found', undefined, 'not_found');
  return [geoZone(a)];
}

const hubBody = z.object({
  zone_id: z.string().min(1).max(80), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  address: z.string().trim().min(3).max(300), landmark: z.string().trim().max(200).nullish(),
});

// PUT /rider/hub. The pin must be inside the zone's city, or: 422 out_of_zone.
export async function setHub(a: Applicant, raw: unknown) {
  const b = parse(hubBody, raw);
  const city = cityOfZone(b.zone_id);
  const area = city ? (await areas()).find(x => x.city === city) : null;
  if (!area) throw new HttpError(404, 'Zone not found', undefined, 'not_found');
  if (distanceKm(b, area) > area.radiusKm) throw new HttpError(422, 'That start point is outside the delivery area.', undefined, 'out_of_zone');
  const up = await db().from('rider_hubs').upsert({ rider_id: a.id, zone_id: b.zone_id, lat: b.lat, lng: b.lng, address: b.address, landmark: b.landmark ?? null, updated_at: new Date().toISOString() }, { onConflict: 'rider_id' });
  if (up.error) fromDbError(up.error);
  await update(a.id, { zone_id: b.zone_id, city_id: area.city, onboarding_step: 'hub' });
  return { id: a.id, zoneId: b.zone_id, kind: 'rider_start', name: 'Start hub', lat: b.lat, lng: b.lng, address: b.address, landmark: b.landmark ?? undefined, source: 'rider_confirmed' };
}

// ---------- type, store link ----------

const typeBody = z.object({ type: z.enum(['store', 'solo', 'taxi']) });

// PUT /rider/type. Taxi is announced in the app but not open yet: 409 coming_soon.
export async function setType(a: Applicant, raw: unknown) {
  const { type } = parse(typeBody, raw);
  if (type === 'taxi') throw new HttpError(409, 'Taxi riding is coming soon.', undefined, 'coming_soon');
  return riderDto(await update(a.id, { type, ...(type === 'solo' ? { organization_id: null } : {}), onboarding_step: 'type' }));
}

const linkBody = z.object({ invite_code: z.string().trim().min(3).max(40) });

// POST /rider/store-link. The code must be an active invite (rider_store_invites) that has not expired and has uses left.
// A use is taken with a compare-and-swap on the `uses` column, so two riders cannot both take the last one. A rider who
// is already linked through this invite gets the same answer again without using up another.
// Any code that fails (unknown, off, expired, used up) gives the same "not valid" answer.
const notValid = () => new HttpError(404, 'That invite code is not valid. Please check it with your store manager.', undefined, 'not_found');

export async function linkStore(a: Applicant, raw: unknown) {
  const { invite_code } = parse(linkBody, raw);
  const code = invite_code.toUpperCase();
  const read = async () => {
    const { data, error } = await db().from('rider_store_invites').select('*').eq('code', code).maybeSingle();
    if (error) fromDbError(error);
    return data as Row | null;
  };
  const usable = (i: Row | null) => !!i && i.active && (!i.expires_at || Date.parse(i.expires_at) > Date.now()) && (i.max_uses == null || i.uses < i.max_uses);
  let inv = await read();
  if (!inv) throw notValid();
  const invite: Row = inv;

  // the store this invite is for: its own store, or else the organisation's first live store
  let storeQ = db().from('ol_stores').select('id, name, city_id').is('deleted_at', null);
  storeQ = invite.store_id ? storeQ.eq('id', invite.store_id) : storeQ.eq('organization_id', invite.organization_id).order('sort_order').order('id');
  const st = await storeQ.limit(1).maybeSingle();
  if (st.error) fromDbError(st.error);
  if (!st.data) throw notValid();
  const store = st.data as Row;

  const already = await db().from('rider_store_links').select('store_id').eq('rider_id', a.id).eq('store_id', store.id).maybeSingle();
  if (already.error) fromDbError(already.error);
  let taken = false;
  if (!already.data) {
    for (let i = 0; i < 5 && !taken; i++) {
      if (!usable(inv)) throw notValid();
      const won = await db().from('rider_store_invites').update({ uses: inv!.uses + 1 }).eq('code', code).eq('uses', inv!.uses).eq('active', true).select('code');
      if (won.error) fromDbError(won.error);
      if (won.data?.length) taken = true; else inv = await read(); // somebody else took a use first: look again
    }
    if (!taken) throw notValid();
    const n = await db().from('rider_store_links').select('store_id', { count: 'exact', head: true }).eq('rider_id', a.id);
    const link = await db().from('rider_store_links').upsert({ rider_id: a.id, store_id: store.id, priority: (n.count ?? 0) + 1, status: 'active' }, { onConflict: 'rider_id,store_id', ignoreDuplicates: true });
    if (link.error) {
      await db().from('rider_store_invites').update({ uses: Math.max(0, inv!.uses) }).eq('code', code).eq('uses', inv!.uses + 1); // give the use back
      fromDbError(link.error);
    }
  }
  await update(a.id, { organization_id: invite.organization_id, onboarding_step: 'store_link' });
  const org = await db().from('organizations').select('name').eq('id', invite.organization_id).maybeSingle();
  return {
    organization: org.data?.name ?? '', store: { id: store.id, name: store.name, zone: store.city_id ? zoneId(store.city_id) : '' },
    manager_name: invite.manager_name ?? '', daily_pay_text: invite.daily_pay_text ?? '',
  };
}

// ---------- vehicle, preferences ----------

const vehicleBody = z.object({
  class: z.enum(['2w', '3w', '4w']), ownership: z.enum(['own', 'rent']),
  registration_no: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{4}$/, 'not a registration number'), rc_asset_id: z.string().nullish(),
});
const CLASS_TO_DB: Record<string, string> = { '2w': 'bike', '4w': 'car' };
const CLASS_FROM_DB: Record<string, string> = { bike: '2w', scooter: '2w', cycle: '2w', car: '4w' };

const vehicleDto = (r: Row) => ({
  class: CLASS_FROM_DB[r.vehicle] ?? '2w', ownership: r.vehicle_ownership === 'rented' ? 'rent' : 'own', registrationNo: r.vehicle_registration_no ?? '', rcDocumentId: r.rc_asset_id ?? undefined,
});

// PUT /rider/vehicle. The riders table has bike/scooter/cycle/car, so 2w is stored as bike and 4w as car; 3w has no home.
export async function setVehicle(a: Applicant, raw: unknown) {
  const b = parse(vehicleBody, raw);
  const dbClass = CLASS_TO_DB[b.class];
  if (!dbClass) throw new HttpError(422, 'Three-wheelers are not supported yet.', undefined, 'validation');
  const patch: Row = { vehicle: dbClass, vehicle_ownership: b.ownership === 'rent' ? 'rented' : 'own', vehicle_registration_no: b.registration_no.replace(/[ -]/g, ''), onboarding_step: 'vehicle' };
  if (b.rc_asset_id) patch.rc_asset_id = await confirmAsset(a, b.rc_asset_id, ['vehicle_rc']);
  return vehicleDto(await update(a.id, patch));
}

const prefsBody = z.object({
  categories: z.array(z.enum(['quick_drop', 'on_order', 'pick_drop'])).min(1).max(3), acceptance: z.enum(['auto', 'manual']),
  multi_store: z.boolean().default(false), store_ids: z.array(z.string().min(1).max(80)).max(20).default([]),
});

// PUT /rider/preferences. Stores must be ones this rider is linked to.
export async function setPreferences(a: Applicant, raw: unknown) {
  const b = parse(prefsBody, raw);
  if (b.store_ids.length) {
    const { data, error } = await db().from('rider_store_links').select('store_id').eq('rider_id', a.id).in('store_id', b.store_ids);
    if (error) fromDbError(error);
    if ((data?.length ?? 0) !== new Set(b.store_ids).size) throw new HttpError(422, 'store_ids: you are not linked to one of these stores', undefined, 'validation');
  }
  const r = await update(a.id, { categories: [...new Set(b.categories)], acceptance: b.acceptance, multi_store: b.multi_store, store_ids: b.store_ids, onboarding_step: 'preferences' });
  return { categories: r.categories, acceptance: r.acceptance, multiStore: r.multi_store, storeIds: r.store_ids ?? [] };
}

// ---------- payout method ----------

const providerRef = z.string().trim().min(1).max(100).nullish();
const payoutBody = z.discriminatedUnion('method', [
  z.object({ provider_ref: providerRef, method: z.literal('bank'), holder: z.string().trim().min(2).max(80), account_no: z.string().regex(/^\d{6,18}$/), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/) }),
  z.object({ provider_ref: providerRef, method: z.literal('upi'), vpa: z.string().trim().regex(/^[\w.-]{2,}@[A-Za-z]{2,}$/) }),
]);

// PUT /rider/payout. Keeps ONLY the kind and a masked display (payout_accounts). The raw account or UPI number is
// validated and then dropped: it is never stored, returned or logged. No payout provider is connected, so the account
// is saved as not verified (status "pending") and operations pays by hand.
const maskVpa = (v: string) => { const [name, host] = v.split('@'); return `${name.slice(0, 2)}***@${host}`; };
export async function setPayoutMethod(a: Applicant, raw: unknown) {
  const b = parse(payoutBody, raw);
  const row = b.method === 'upi' ? { kind: 'upi', display_masked: maskVpa(b.vpa) } : { kind: 'bank', display_masked: `XXXXXX${b.account_no.slice(-4)}` };
  const { data, error } = await db().from('payout_accounts')
    .upsert({ rider_id: a.id, ...row, provider_ref: b.provider_ref ?? null, verified: false, updated_at: new Date().toISOString() }, { onConflict: 'rider_id' }).select('rider_id, kind, display_masked, verified').single();
  if (error) fromDbError(error);
  return payoutMethodDto(data);
}

// ---------- KYC documents ----------

const DOC_TO_DB: Record<string, string> = { aadhaar: 'aadhaar', pan: 'pan', dl: 'driving_licence', rc: 'vehicle_rc', selfie: 'selfie', permit: 'permit', fitness: 'fitness' };
const DOC_FROM_DB: Record<string, string> = { aadhaar: 'aadhaar', pan: 'pan', driving_licence: 'dl', vehicle_rc: 'rc', selfie: 'selfie', permit: 'permit', fitness: 'fitness' };
const DOC_ASSET: Record<string, string> = { aadhaar: 'kyc_document', pan: 'kyc_document', driving_licence: 'kyc_document', vehicle_rc: 'vehicle_rc', selfie: 'kyc_selfie', permit: 'kyc_document', fitness: 'kyc_document' };
const NUMBER: Record<string, RegExp> = { aadhaar: /^\d{12}$/, pan: /^[A-Z]{5}\d{4}[A-Z]$/, driving_licence: /^[A-Z0-9 -]{8,20}$/ };

const docBody = z.object({
  kind: z.enum(['aadhaar', 'pan', 'dl', 'rc', 'selfie', 'permit', 'fitness']), asset_id: z.string().nullish(), number: z.string().trim().max(30).nullish(),
  source: z.enum(['digilocker', 'upload']), dob: z.string().regex(/^\d{4}-\d\d-\d\d$/).nullish(), verification_id: z.string().max(80).nullish(),
});

// Only the last four characters are ever kept.
const maskNumber = (kind: string, n: string) => (kind === 'aadhaar' ? `XXXX XXXX ${n.slice(-4)}` : `${'*'.repeat(Math.max(0, n.length - 4))}${n.slice(-4)}`);

export const docDto = (d: Row) => ({
  id: d.id, kind: DOC_FROM_DB[d.kind] ?? d.kind, status: d.status, number_masked: d.number_masked ?? null, asset_id: d.asset_id ?? null,
  source: d.source ?? null, expires_on: d.expires_at ?? null, rejection_reason: d.rejection_reason ?? null, reviewed_at: d.reviewed_at ?? null,
});

type DocBody = z.infer<typeof docBody>;

// POST /rider/kyc/documents.
//  * Cashfree Secure ID is off (no keys): every document starts "pending" and a person at One Local reviews it. DigiLocker answers 501.
//  * Cashfree Secure ID is on (server/kyc): Aadhaar through DigiLocker, and a PAN, licence or RC number or a selfie, are verified by the engine
//    (verified / pending / rejected with a reason). Uploads still work, and are what is kept when Cashfree is down.
export async function addDocument(a: Applicant, raw: unknown) {
  const b = parse(docBody, raw);
  const kind = DOC_TO_DB[b.kind];
  if (!kind) throw new HttpError(422, 'That kind of document is not needed.', undefined, 'validation');
  if (b.source === 'digilocker') {
    readyEngine('DigiLocker verification is not available yet. Please upload the document instead.'); // 501 when off, 503 when set up wrongly
    if (b.kind !== 'aadhaar') throw new HttpError(422, 'DigiLocker gives your Aadhaar. Enter the number for this document instead.', undefined, 'validation');
    return docDto(await digilockerResult(a, b.verification_id));
  }
  if (kycEngine().state === 'ready') {
    const upload = b.asset_id ? () => uploadDocument(a, b, kind) : undefined;
    if ((b.kind === 'pan' || b.kind === 'dl' || b.kind === 'rc') && b.number) return docDto(await verifyWithEngine(a, { kind: b.kind, number: b.number, dob: b.dob, assetId: b.asset_id }, upload));
    if (b.kind === 'selfie' && b.asset_id) return docDto(await verifyWithEngine(a, { kind: 'selfie', assetId: b.asset_id }, upload));
  }
  return docDto(await uploadDocument(a, b, kind));
}

// The document as the rider sent it in, for a person to check.
async function uploadDocument(a: Applicant, b: DocBody, kind: string) {
  if (!b.asset_id) throw new HttpError(400, 'asset_id: upload the document first', undefined, 'validation');
  const asset = await confirmAsset(a, b.asset_id, [DOC_ASSET[kind]]);
  let masked: string | null = null;
  if (b.number) {
    const n = kind === 'aadhaar' ? b.number.replace(/\s+/g, '') : b.number.toUpperCase();
    const re = NUMBER[kind];
    if (re && !re.test(n)) throw new HttpError(400, 'number: not a valid number for this document', undefined, 'validation');
    masked = maskNumber(kind, n.replace(/[ -]/g, ''));
  }
  if (b.dob) {
    const t = Date.parse(b.dob), age = (Date.now() - t) / (365.25 * 86_400_000);
    if (!Number.isFinite(t) || age < 18 || age > 80) throw new HttpError(400, 'dob: riders must be between 18 and 80', undefined, 'validation');
    await update(a.id, { dob: b.dob });
  }
  const { data, error } = await db().from('rider_documents').insert({ rider_id: a.id, kind, asset_id: asset, number_masked: masked, source: 'upload', status: 'pending' }).select('*').single();
  if (error) fromDbError(error);
  await update(a.id, { onboarding_step: 'kyc' });
  return data as Row;
}

// POST /rider/kyc/digilocker/start. Opens a Cashfree DigiLocker session: the rider signs in there, DigiLocker sends them back to the app.
// No keys: 501 provider_not_configured, as before.
export async function startDigilocker(a: Applicant, request: Request) {
  readyEngine('DigiLocker verification is not available yet. Please upload your documents instead.');
  assertEditable(a.status);
  return startDigilockerSession(a, request);
}

// GET /rider/kyc/digilocker/status?verification_id=. Asks Cashfree how the rider's DigiLocker session went.
export async function digilockerStatus(a: Applicant, verificationId: string | null) {
  readyEngine('DigiLocker verification is not available yet. Please upload your documents instead.');
  assertEditable(a.status);
  return docDto(await digilockerResult(a, verificationId));
}

// POST /rider/kyc/{pan,driving-licence,vehicle-rc,selfie}: one check each, the same answer as POST /rider/kyc/documents.
const panBody = z.object({ number: z.string().trim().min(5).max(20) });
const dlBody = z.object({ number: z.string().trim().min(5).max(30), dob: z.string().regex(/^\d{4}-\d\d-\d\d$/).nullish(), asset_id: z.string().nullish() });
const rcBody = z.object({ number: z.string().trim().max(20).nullish() });
const selfieBody = z.object({ asset_id: z.string().min(1).max(60) });

export async function verifyKyc(a: Applicant, check: 'pan' | 'dl' | 'rc' | 'selfie', raw: unknown) {
  readyEngine('Verification is not available yet. Please upload your documents instead.');
  assertEditable(a.status);
  switch (check) {
    case 'pan': { const b = parse(panBody, raw); return docDto(await verifyWithEngine(a, { kind: 'pan', number: b.number })); }
    case 'dl': {
      const b = parse(dlBody, raw);
      const upload = b.asset_id ? () => uploadDocument(a, { kind: 'dl', source: 'upload', asset_id: b.asset_id, number: b.number, dob: b.dob }, DOC_TO_DB.dl) : undefined;
      return docDto(await verifyWithEngine(a, { kind: 'dl', number: b.number, dob: b.dob, assetId: b.asset_id }, upload));
    }
    case 'rc': {
      const b = parse(rcBody, raw);
      const number = b.number || a.row.vehicle_registration_no;
      if (!number) throw new HttpError(400, 'number: enter the vehicle registration number', undefined, 'validation');
      return docDto(await verifyWithEngine(a, { kind: 'rc', number }));
    }
    case 'selfie': {
      const b = parse(selfieBody, raw);
      return docDto(await verifyWithEngine(a, { kind: 'selfie', assetId: b.asset_id }, () => uploadDocument(a, { kind: 'selfie', source: 'upload', asset_id: b.asset_id }, DOC_TO_DB.selfie)));
    }
  }
}

// ---------- submit and status ----------

const REQUIRED_DOCS = ['aadhaar', 'pan', 'driving_licence', 'selfie'];

// The newest document of each kind that is not rejected or expired.
async function liveDocs(riderId: string) {
  const { data, error } = await db().from('rider_documents').select('kind, status, expires_at, created_at').eq('rider_id', riderId).order('created_at', { ascending: false });
  if (error) fromDbError(error);
  const seen = new Map<string, Row>();
  for (const d of data ?? []) if (!seen.has(d.kind)) seen.set(d.kind, d);
  return seen;
}

// POST /rider/submit. draft -> submitted once everything is in. Asking again changes nothing.
export async function submit(a: Applicant) {
  if (['submitted', 'verification_pending'].includes(a.status)) return { status: a.status };
  if (a.status === 'approved') throw new HttpError(409, 'Your application is already approved.', undefined, 'locked');
  const r = a.row, missing: string[] = [];
  if (!r.full_name) missing.push('profile');
  if (!r.zone_id) missing.push('zone');
  if (a.type === 'solo') { const h = await db().from('rider_hubs').select('rider_id').eq('rider_id', a.id).maybeSingle(); if (!h.data) missing.push('hub'); }
  if (a.type === 'store') { const l = await db().from('rider_store_links').select('store_id').eq('rider_id', a.id).limit(1); if (!l.data?.length) missing.push('store_link'); }
  if (!r.vehicle || !r.vehicle_registration_no || !r.vehicle_ownership) missing.push('vehicle');
  if (r.vehicle_ownership === 'own' && !r.rc_asset_id) missing.push('rc');
  if (!(r.categories ?? []).length) missing.push('preferences');
  const docs = await liveDocs(a.id), today = new Date().toISOString().slice(0, 10);
  for (const k of REQUIRED_DOCS) {
    const d = docs.get(k);
    if (!d || !['pending', 'verified'].includes(d.status) || (d.expires_at && d.expires_at < today)) missing.push(DOC_FROM_DB[k]);
  }
  if (missing.length) throw Object.assign(new HttpError(422, 'Your application is not complete yet.', undefined, 'validation'), { extra: { missing } });
  const next = await update(a.id, { status: 'submitted', submitted_at: new Date().toISOString(), onboarding_step: 'submitted' });
  return { status: next.status };
}

// GET /rider/status
export async function status(a: Applicant) {
  const docs = await liveDocs(a.id), today = new Date().toISOString().slice(0, 10);
  const expired = [...docs.entries()].filter(([, d]) => d.status === 'expired' || (d.expires_at && d.expires_at < today)).map(([k]) => DOC_FROM_DB[k] ?? k);
  return { status: a.status, reason: a.row.review_reason ?? undefined, expired_documents: expired, eta_text: undefined };
}
