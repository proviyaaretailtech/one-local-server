// Rider KYC on Cashfree Secure ID: shared types. Ported from the rider folder's engine (One Rider app /onedriver/supabase/functions/_shared/kyc),
// which is runtime-agnostic (fetch + WebCrypto), so the logic is the same; what changed is the store (the canonical kyc_profiles / kyc_checks,
// keyed to riders.id) and the hardening listed in specs/rider-kyc-digilocker/spec.md (decision 7).
//
// Only what KYC needs is kept, and masked: never a full Aadhaar number, never a document image. The Aadhaar photo (for the selfie face match)
// is stored encrypted and deleted after the match, or after 24 hours at the latest.
export type KycKind = 'aadhaar' | 'pan' | 'selfie' | 'dl' | 'rc';
export type KycStatus = 'verified' | 'pending' | 'rejected';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// What the server gets back for one check (the route maps it onto rider_documents).
export interface KycResult {
  kind: KycKind;
  status: KycStatus;
  // The Cashfree verification id of this check: one rider_documents row per (rider, kind, verification id).
  verificationId: string | null;
  numberMasked: string | null;
  // Why it is pending or rejected, in plain words for the rider.
  reason: string | null;
  expiresOn: string | null;
  verifiedAt: string | null;
  // Non-sensitive facts for operations (name match, vehicle model ...).
  details: Record<string, string | number | boolean | null>;
}

export interface KycProfile {
  riderId: string;
  // Name as on Aadhaar (DigiLocker).
  legalName: string | null;
  // YYYY-MM-DD, from Aadhaar. Used for the driving licence check and the age rule.
  dob: string | null;
  gender: string | null;
  aadhaarLast4: string | null;
  aadhaarVerifiedAt: string | null;
  digilockerVerificationId: string | null;
  digilockerStartedAt: string | null;
  // AES-GCM encrypted base64 JPEG/PNG of the Aadhaar photo; cleared after the face match or 24 h.
  aadhaarPhotoEnc: string | null;
  aadhaarPhotoAt: string | null;
  panMasked: string | null;
  panVerifiedAt: string | null;
  livenessScore: number | null;
  faceMatchScore: number | null;
  selfieVerifiedAt: string | null;
  dlMasked: string | null;
  dlVerifiedAt: string | null;
  dlExpiresOn: string | null;
  rcNumber: string | null;
  rcVerifiedAt: string | null;
  rcExpiresOn: string | null;
  updatedAt: string;
}

// Audit row per Cashfree call (no document numbers or images). Also drives the daily attempt limit.
export interface KycCheck {
  id: string;
  riderId: string;
  kind: KycKind;
  verificationId: string;
  status: KycStatus | 'error';
  reason: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface KycStore {
  getProfile(riderId: string): Promise<KycProfile | null>;
  // Changes only the given fields and creates the row when it is missing. Never replaces the whole row: two checks running at the same
  // time (PAN and licence, a double tap) must not undo each other.
  patchProfile(riderId: string, patch: Partial<Omit<KycProfile, 'riderId'>>): Promise<void>;
  insertCheck(check: KycCheck): Promise<void>;
  countChecks(riderId: string, kind: KycKind, sinceIso: string, statuses?: string[]): Promise<number>;
  // Clears every Aadhaar photo stored before the given time.
  purgeAadhaarPhotos(beforeIso: string): Promise<void>;
}

export type KycErrorCode = 'validation' | 'provider_error' | 'rate_limited' | 'unauthorized' | 'unconfigured' | 'not_found' | 'conflict';

export class KycError extends Error {
  readonly code: KycErrorCode;
  readonly status: number;
  readonly meta?: Record<string, unknown>;
  constructor(code: KycErrorCode, message: string, status = 400, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'KycError';
    this.code = code;
    this.status = status;
    this.meta = meta;
  }
}

export const emptyProfile = (riderId: string, nowIso: string): KycProfile => ({
  riderId, legalName: null, dob: null, gender: null, aadhaarLast4: null, aadhaarVerifiedAt: null, digilockerVerificationId: null, digilockerStartedAt: null,
  aadhaarPhotoEnc: null, aadhaarPhotoAt: null, panMasked: null, panVerifiedAt: null, livenessScore: null, faceMatchScore: null, selfieVerifiedAt: null,
  dlMasked: null, dlVerifiedAt: null, dlExpiresOn: null, rcNumber: null, rcVerifiedAt: null, rcExpiresOn: null, updatedAt: nowIso,
});
