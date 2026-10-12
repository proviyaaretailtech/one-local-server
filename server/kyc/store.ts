// The canonical kyc_profiles / kyc_checks (database/migrations/0337_rider_kyc.sql), through the service-role client. Server only.
import { db, fromDbError } from '../db';
import type { KycKind, KycProfile, KycStore } from './types';

type Row = Record<string, any>;

const COLUMN: Record<keyof Omit<KycProfile, 'riderId'>, string> = {
  legalName: 'legal_name', dob: 'dob', gender: 'gender', aadhaarLast4: 'aadhaar_last4', aadhaarVerifiedAt: 'aadhaar_verified_at',
  digilockerVerificationId: 'digilocker_verification_id', digilockerStartedAt: 'digilocker_started_at', aadhaarPhotoEnc: 'aadhaar_photo_enc',
  aadhaarPhotoAt: 'aadhaar_photo_at', panMasked: 'pan_masked', panVerifiedAt: 'pan_verified_at', livenessScore: 'liveness_score', faceMatchScore: 'face_match_score',
  selfieVerifiedAt: 'selfie_verified_at', dlMasked: 'dl_masked', dlVerifiedAt: 'dl_verified_at', dlExpiresOn: 'dl_expires_on', rcNumber: 'rc_number',
  rcVerifiedAt: 'rc_verified_at', rcExpiresOn: 'rc_expires_on', updatedAt: 'updated_at',
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const toProfile = (r: Row): KycProfile => ({
  riderId: r.rider_id, legalName: r.legal_name, dob: r.dob, gender: r.gender, aadhaarLast4: r.aadhaar_last4, aadhaarVerifiedAt: r.aadhaar_verified_at,
  digilockerVerificationId: r.digilocker_verification_id, digilockerStartedAt: r.digilocker_started_at, aadhaarPhotoEnc: r.aadhaar_photo_enc, aadhaarPhotoAt: r.aadhaar_photo_at,
  panMasked: r.pan_masked, panVerifiedAt: r.pan_verified_at, livenessScore: num(r.liveness_score), faceMatchScore: num(r.face_match_score), selfieVerifiedAt: r.selfie_verified_at,
  dlMasked: r.dl_masked, dlVerifiedAt: r.dl_verified_at, dlExpiresOn: r.dl_expires_on, rcNumber: r.rc_number, rcVerifiedAt: r.rc_verified_at, rcExpiresOn: r.rc_expires_on, updatedAt: r.updated_at,
});

export const createDbKycStore = (): KycStore => ({
  async getProfile(riderId) {
    const { data, error } = await db().from('kyc_profiles').select('*').eq('rider_id', riderId).maybeSingle();
    if (error) fromDbError(error);
    return data ? toProfile(data) : null;
  },
  // An upsert of only the given columns: on conflict Postgres updates just those, so another request's fields are never overwritten.
  async patchProfile(riderId, patch) {
    const row: Row = { rider_id: riderId };
    for (const [k, v] of Object.entries(patch)) {
      const col = COLUMN[k as keyof typeof COLUMN];
      if (col) row[col] = v === undefined ? null : v;
    }
    const { error } = await db().from('kyc_profiles').upsert(row, { onConflict: 'rider_id' });
    if (error) fromDbError(error);
  },
  async insertCheck(c) {
    const { error } = await db().from('kyc_checks').insert({ id: c.id, rider_id: c.riderId, kind: c.kind, verification_id: c.verificationId, status: c.status, reason: c.reason, reference_id: c.referenceId, created_at: c.createdAt });
    if (error) fromDbError(error);
  },
  async countChecks(riderId, kind: KycKind, sinceIso, statuses) {
    let q = db().from('kyc_checks').select('id', { count: 'exact', head: true }).eq('rider_id', riderId).eq('kind', kind).gte('created_at', sinceIso);
    if (statuses?.length) q = q.in('status', statuses);
    const { count, error } = await q;
    if (error) fromDbError(error);
    return count ?? 0;
  },
  async purgeAadhaarPhotos(beforeIso) {
    const { error } = await db().rpc('kyc_purge_aadhaar_photos', { p_before: beforeIso });
    if (error) fromDbError(error);
  },
});
