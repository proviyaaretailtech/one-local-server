// Rider KYC through Cashfree Secure ID: what the engine (server/kyc) says, written into the canonical rider_documents.
// The routes and rider-onboarding.ts call this only when the engine is switched on (server/kyc/config.ts); with no keys nothing here runs and
// the routes answer as before (501 provider_not_configured for DigiLocker, uploads that a person checks for everything else).
//
//  * One rider_documents row per (rider, kind, Cashfree verification id): a retry or a DigiLocker poll updates the row, a verified row is never
//    downgraded, and a new attempt is a new row (the newest row of a kind is the one that counts, as everywhere else).
//  * DigiLocker Aadhaar has source 'digilocker'. Everything else the engine checked has source 'upload' and a verification_id: software-verified
//    means status 'verified' with a verification_id.
//  * Only masked numbers are written (number_masked); the database refuses a full Aadhaar or PAN.
//  * A DigiLocker session the rider has not finished is not a document yet: it is answered but not stored, so it can never count as "sent in".
import { db, fromDbError } from './db';
import { clientIp, HttpError, limit } from './http';
import { kycPublicBase, readyEngine } from './kyc/config';
import type { KycService } from './kyc/service';
import type { KycKind, KycResult } from './kyc/types';
import { KycError } from './kyc/types';
import { BUCKET, confirmAsset } from './rider-extra';
import type { Applicant } from './rider-onboarding';

type Row = Record<string, any>;

const DB_KIND: Record<KycKind, string> = { aadhaar: 'aadhaar', pan: 'pan', selfie: 'selfie', dl: 'driving_licence', rc: 'vehicle_rc' };
const VERIFICATION_ID = /^[A-Za-z0-9_.-]{1,50}$/;
const MAX_SELFIE_BYTES = 10 * 1024 * 1024;

// Riders must be between 18 and 80 (the same rule as a typed date of birth).
export const ageAllowed = (dob: string): boolean => {
  const t = Date.parse(dob), age = (Date.now() - t) / (365.25 * 86_400_000);
  return Number.isFinite(t) && age >= 18 && age <= 80;
};

// A KycError becomes the API's error shape; the message is the plain words meant for the rider.
function asHttp(e: unknown): never {
  if (e instanceof KycError) throw new HttpError(e.status, e.message, undefined, e.code);
  throw e;
}

// Every call to Cashfree is billed: a rider gets a few an hour on top of the per-minute limit and the daily limit per check in the database.
const billed = (a: Applicant) => limit(a.id, 'rider-kyc-billed', 20, 3_600_000);

async function hasVerifiedAadhaar(a: Applicant): Promise<boolean> {
  const { data, error } = await db().from('rider_documents').select('status').eq('rider_id', a.id).eq('kind', 'aadhaar').order('created_at', { ascending: false }).limit(1);
  if (error) fromDbError(error);
  return data?.[0]?.status === 'verified';
}

// ---- writing the result ----

async function saveDocument(a: Applicant, r: KycResult, assetId: string | null): Promise<Row> {
  const kind = DB_KIND[r.kind];
  const patch: Row = {
    status: r.status, number_masked: r.numberMasked, expires_at: r.expiresOn, rejection_reason: r.status === 'verified' ? null : r.reason,
    source: r.kind === 'aadhaar' ? 'digilocker' : 'upload', verification_id: r.verificationId,
  };
  if (assetId) patch.asset_id = assetId;
  const find = async () => {
    const { data, error } = await db().from('rider_documents').select('*').eq('rider_id', a.id).eq('kind', kind).eq('verification_id', r.verificationId!).maybeSingle();
    if (error) fromDbError(error);
    return data as Row | null;
  };
  let row: Row | null = r.verificationId ? await find() : null;
  if (row?.status === 'verified') return row; // a replay never downgrades a verified document
  if (row) {
    const up = await db().from('rider_documents').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', row.id).neq('status', 'verified').select('*').maybeSingle();
    if (up.error) fromDbError(up.error);
    row = (up.data as Row | null) ?? (await find());
  } else {
    const ins = await db().from('rider_documents').insert({ rider_id: a.id, kind, ...patch }).select('*').single();
    if (ins.error) {
      if (ins.error.code !== '23505' || !r.verificationId) fromDbError(ins.error);
      row = await find(); // two requests at once: the other one inserted first
      if (!row) fromDbError(ins.error);
    } else row = ins.data as Row;
  }
  await db().from('riders').update({ onboarding_step: 'kyc', updated_at: new Date().toISOString() }).eq('id', a.id);
  return row!;
}

// What the app gets for a DigiLocker session that is still open: a pending Aadhaar that is not stored.
const openSession = (r: KycResult): Row => ({
  id: r.verificationId, kind: 'aadhaar', status: 'pending', number_masked: null, asset_id: null, source: 'digilocker', expires_at: null, rejection_reason: r.reason, reviewed_at: null,
});

// ---- DigiLocker ----

export async function startDigilockerSession(a: Applicant, request: Request) {
  const { service } = readyEngine();
  if (await hasVerifiedAadhaar(a)) throw new HttpError(409, 'Your Aadhaar is already verified.', undefined, 'already_verified');
  billed(a);
  try {
    const s = await service.startDigilocker({ riderId: a.id, returnUrlBase: kycPublicBase(request) });
    return { redirect_url: s.url, verification_id: s.verificationId };
  } catch (e) { return asHttp(e); }
}

// Asks Cashfree for the DigiLocker result. Verified, rejected (consent denied, expired, wrong name, outside 18 to 80) or still pending.
export async function digilockerResult(a: Applicant, verificationId: string | null | undefined): Promise<Row> {
  const { service } = readyEngine();
  if (verificationId && !VERIFICATION_ID.test(verificationId)) throw new HttpError(400, 'verification_id: not valid', undefined, 'validation');
  let r: KycResult;
  try {
    r = await service.completeDigilocker({ riderId: a.id, riderName: a.row.full_name, verificationId: verificationId ?? undefined });
  } catch (e) { return asHttp(e); }
  if (r.status === 'pending') return openSession(r);
  if (r.status === 'verified') {
    // The date of birth on a verified Aadhaar (already held to the 18 to 80 rule by the engine) is the rider's date of birth.
    const profile = await service.profile(a.id);
    if (profile?.dob) await db().from('riders').update({ dob: profile.dob, updated_at: new Date().toISOString() }).eq('id', a.id);
  }
  return saveDocument(a, r, null);
}

// GET /rider/kyc/digilocker/return. DigiLocker sends the rider's browser here; it carries no data and sends them back into the app.
export function digilockerReturn(request: Request): Response {
  let ready: ReturnType<typeof readyEngine>;
  try { ready = readyEngine(); } catch { return new Response('Not found', { status: 404 }); }
  limit(clientIp(request), 'kyc-return', 30, 60_000);
  const url = new URL(request.url);
  const location = ready.service.returnLocation(ready.config.appReturnUrl, url.searchParams.get('v') ?? url.searchParams.get('verification_id'));
  return new Response('DigiLocker finished. You can go back to the OneLocal Rider app.', {
    status: 302, headers: { Location: location, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

// ---- PAN, selfie, driving licence, vehicle RC ----

async function selfieBytes(a: Applicant, assetId: string): Promise<Uint8Array<ArrayBuffer>> {
  await confirmAsset(a, assetId, ['kyc_selfie']);
  const { data: asset, error } = await db().from('delivery_assets').select('storage_path, size_bytes').eq('id', assetId).eq('rider_id', a.id).single();
  if (error) fromDbError(error);
  if (asset.size_bytes != null && Number(asset.size_bytes) > MAX_SELFIE_BYTES) throw new HttpError(422, 'The selfie is larger than 10 MB.', undefined, 'validation');
  const file = await db().storage.from(BUCKET).download(asset.storage_path);
  if (file.error || !file.data) throw new HttpError(422, 'The file has not finished uploading.', undefined, 'upload_missing');
  return new Uint8Array(await file.data.arrayBuffer());
}

export type EngineDocument = { kind: 'pan' | 'selfie' | 'dl' | 'rc'; number?: string | null; dob?: string | null; assetId?: string | null };

// Runs one check. `fallback` saves the rider's photo as a pending upload for a person: used when Cashfree is down and there is a photo.
export async function verifyWithEngine(a: Applicant, input: EngineDocument, fallback?: () => Promise<Row>): Promise<Row> {
  const { service } = readyEngine();
  const run = async (s: KycService): Promise<{ r: KycResult; asset: string | null }> => {
    const name = a.row.full_name as string;
    switch (input.kind) {
      case 'pan': return { r: await s.verifyPan({ riderId: a.id, riderName: name, pan: input.number ?? '' }), asset: null };
      case 'dl': {
        if (input.dob && !ageAllowed(input.dob)) throw new HttpError(400, 'dob: riders must be between 18 and 80', undefined, 'validation');
        const asset = input.assetId ? await confirmAsset(a, input.assetId, ['kyc_document']) : null;
        const r = await s.verifyDrivingLicence({ riderId: a.id, riderName: name, dlNumber: input.number ?? '', dob: input.dob ?? undefined });
        if (input.dob && r.status === 'verified') await db().from('riders').update({ dob: input.dob, updated_at: new Date().toISOString() }).eq('id', a.id);
        return { r, asset };
      }
      case 'rc': return { r: await s.verifyVehicleRc({ riderId: a.id, riderName: name, vehicleNumber: input.number ?? '' }), asset: null };
      case 'selfie': {
        if (!input.assetId) throw new HttpError(400, 'asset_id: take the selfie first', undefined, 'validation');
        const bytes = await selfieBytes(a, input.assetId);
        return { r: await s.verifySelfie({ riderId: a.id, image: bytes }), asset: input.assetId };
      }
    }
  };
  billed(a);
  let done: { r: KycResult; asset: string | null };
  try {
    done = await run(service);
  } catch (e) {
    // Cashfree is down: a photo is still worth keeping for a person to check. Without a photo the rider is told to try again.
    if (e instanceof KycError && e.code === 'provider_error' && fallback && input.assetId) return fallback();
    return asHttp(e);
  }
  return saveDocument(a, done.r, done.asset);
}
