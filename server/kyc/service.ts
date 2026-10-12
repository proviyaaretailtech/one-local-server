// Rider KYC on Cashfree Secure ID.
//
//  1. Aadhaar: DigiLocker consent (the rider signs in to DigiLocker; Cashfree returns the e-Aadhaar). The Aadhaar name must match the rider's
//     profile name; it becomes the legal name for the later checks.
//  2. PAN: PAN verification with Cashfree's name match against the Aadhaar name.
//  3. Selfie: face liveness, then face match against the Aadhaar photo (kept encrypted until then, 24 hours at most).
//  4. Driving licence: number + date of birth (from Aadhaar unless given); must be valid, not expired and in the rider's name.
//  5. Vehicle RC: must exist and be active; the owner may be someone else (rented vehicles).
//
// Every Cashfree call is billed, so each rider gets a few attempts per check per day. Nothing sensitive is logged or stored in full: masked
// numbers only, no document images. Nothing returned to the rider names a third party (a PAN or licence that belongs to someone else says
// so without saying whose it is).
import { base64ToBytes, bytesToBase64, decryptJson, encryptJson, hashIdentifier } from './crypto';
import { combineMatch, fromCashfreeMatch, matchNames } from './names';
import type { NameMatch } from './names';
import { sniffImageType } from './secure-id';
import type { SecureIdClient, SidResult } from './secure-id';
import type { FetchLike, KycCheck, KycKind, KycProfile, KycResult, KycStatus, KycStore } from './types';
import { KycError, emptyProfile } from './types';

export interface KycServiceDeps {
  store: KycStore;
  secureId: SecureIdClient;
  // AES-GCM key (base64, 32 bytes) for the Aadhaar photo kept until the face match.
  payloadKey: string;
  // Cashfree calls per rider, per check, per 24 h.
  attemptsPerDay: number;
  // 0-1; Cashfree's default is 0.7.
  faceMatchThreshold: number;
  // Riders must be between these ages (default 18 and 80), judged by the date of birth on the Aadhaar.
  minAge?: number;
  maxAge?: number;
  fetch?: FetchLike;
  now?: () => Date;
  newId?: () => string;
  log?: (event: string, data: Record<string, unknown>) => void;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const PHOTO_MAX_AGE_MS = 24 * 3600_000;

const result = (kind: KycKind, status: KycStatus, extra: Partial<KycResult> = {}): KycResult => ({
  kind, status, verificationId: null, numberMasked: null, reason: null, expiresOn: null, verifiedAt: null, details: {}, ...extra,
});

// "12-03-1994", "12/03/1994" or "1994-03-12" -> "1994-03-12"; null when it is not a real date.
export const normalizeDob = (v: string | undefined | null): string | null => {
  const s = (v ?? '').trim();
  let y: string | undefined, m: string | undefined, d: string | undefined;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) [, y, m, d] = r;
  else if ((r = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/))) [, d, m, y] = r;
  if (!y || !m || !d) return null;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(d) ? null : `${y}-${m}-${d}`;
};

export const normalizePan = (v: string) => v.replace(/\s/g, '').toUpperCase();
export const isPan = (v: string) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v);
export const maskPan = (pan: string) => `${pan.slice(0, 2)}XXXXX${pan.slice(-3)}`;
export const normalizeDl = (v: string) => v.replace(/[\s-]/g, '').toUpperCase();
export const isDl = (v: string) => /^[A-Z]{2}\d{2}[A-Z0-9]{5,14}$/.test(v);
export const maskDl = (dl: string) => `${dl.slice(0, 4)}${'•'.repeat(Math.max(3, dl.length - 8))}${dl.slice(-4)}`;
export const normalizeVehicle = (v: string) => v.replace(/[\s-]/g, '').toUpperCase();
export const isVehicleNumber = (v: string) => /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(v) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(v);
const last4 = (uid: string | undefined) => (uid ?? '').replace(/\D/g, '').slice(-4) || null;

// Aadhaar e-KYC photo as bytes: a data URI, bare base64, or an https link from Cashfree.
const photoBytes = async (fetchFn: FetchLike, link: string | undefined): Promise<Uint8Array<ArrayBuffer> | null> => {
  const v = (link ?? '').trim();
  if (!v) return null;
  try {
    if (/^https:\/\//i.test(v)) {
      const res = await fetchFn(v, { method: 'GET', signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return bytes.length <= MAX_IMAGE_BYTES && sniffImageType(bytes) ? bytes : null;
    }
    const bytes = base64ToBytes(v.replace(/^data:image\/[a-z]+;base64,/i, ''));
    return bytes.length <= MAX_IMAGE_BYTES && sniffImageType(bytes) ? bytes : null;
  } catch {
    return null;
  }
};

export const createKycService = (deps: KycServiceDeps) => {
  const { store, secureId } = deps;
  const now = deps.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const log = deps.log ?? (() => {});
  const fetchFn: FetchLike = deps.fetch ?? ((i, init) => fetch(i, init));

  const profileOf = async (riderId: string) => (await store.getProfile(riderId)) ?? emptyProfile(riderId, iso());
  // Writes only the changed fields (the store never replaces the row); returns the profile as it now reads.
  const save = async (p: KycProfile, patch: Partial<Omit<KycProfile, 'riderId'>>): Promise<KycProfile> => {
    const next = { ...p, ...patch, updatedAt: iso() };
    await store.patchProfile(p.riderId, { ...patch, updatedAt: next.updatedAt });
    return next;
  };
  // The Aadhaar photo is kept 24 hours at most. Older ones are cleared on every call (the hourly job in the database is the backstop).
  const purgeStalePhotos = async () => {
    try { await store.purgeAadhaarPhotos(new Date(now().getTime() - PHOTO_MAX_AGE_MS).toISOString()); } catch { /* the hourly job and the age check below still hold */ }
  };
  const ageAllowed = (dob: string) => {
    const years = (now().getTime() - Date.parse(`${dob}T00:00:00Z`)) / (365.25 * 86_400_000);
    return Number.isFinite(years) && years >= (deps.minAge ?? 18) && years <= (deps.maxAge ?? 80);
  };
  const photoIsFresh = (p: KycProfile) => !!p.aadhaarPhotoEnc && !!p.aadhaarPhotoAt && now().getTime() - Date.parse(p.aadhaarPhotoAt) <= PHOTO_MAX_AGE_MS;

  // A fresh Cashfree verification id (<= 50 chars, [A-Za-z0-9_]) that does not reveal the rider.
  const verificationIdFor = async (kind: KycKind, riderId: string) =>
    `ol_${kind}_${(await hashIdentifier('kyc', riderId)).slice(0, 12)}_${now().getTime().toString(36)}${newId().replace(/[^a-z0-9]/gi, '').slice(0, 6)}`;

  // Aadhaar attempts are counted at the start of a DigiLocker session (waiting for the rider is not an attempt).
  const guard = async (riderId: string, kind: KycKind) => {
    const since = new Date(now().getTime() - 24 * 3600_000).toISOString();
    const used = await store.countChecks(riderId, kind, since, kind === 'aadhaar' ? ['pending', 'error'] : undefined);
    if (used >= deps.attemptsPerDay) throw new KycError('rate_limited', 'Too many attempts for this check today. Try again tomorrow or contact support.', 429);
  };
  const record = async (riderId: string, kind: KycKind, verificationId: string, status: KycCheck['status'], reason: string | null, referenceId?: number | string) => {
    await store.insertCheck({ id: newId(), riderId, kind, verificationId, status, reason, referenceId: referenceId !== undefined ? String(referenceId) : null, createdAt: iso() });
    log('kyc.check', { kind, status });
  };
  // Cashfree answered with an error: network / 5xx / key or plan problems -> try again later; other 4xx -> the details are wrong.
  const failed = async <T>(r: SidResult<T> & { ok: false }, riderId: string, kind: KycKind, vid: string, rejectedReason: string): Promise<KycResult> => {
    if (r.status === 0 || r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 422) {
      await record(riderId, kind, vid, 'error', `cashfree ${r.status} ${r.code}`);
      log('kyc.provider_error', { kind, status: r.status, code: r.code });
      throw new KycError('provider_error', 'Verification is unavailable right now. Try again in a few minutes.', 502, { cashfreeStatus: r.status });
    }
    await record(riderId, kind, vid, 'rejected', rejectedReason);
    return result(kind, 'rejected', { verificationId: vid, reason: rejectedReason });
  };
  const nameAgainst = (p: KycProfile, riderName: string | undefined) => p.legalName ?? riderName?.trim() ?? '';

  // ---- 1. Aadhaar via DigiLocker ----
  // returnUrlBase: where DigiLocker sends the rider after consent (the server's /api/rider/kyc), without a trailing slash.
  const startDigilocker = async (input: { riderId: string; returnUrlBase: string }) => {
    const riderId = (input.riderId ?? '').trim();
    if (!riderId) throw new KycError('validation', 'riderId is required');
    await purgeStalePhotos();
    await guard(riderId, 'aadhaar');
    const vid = await verificationIdFor('aadhaar', riderId);
    const base = input.returnUrlBase.replace(/\/$/, '');
    const r = await secureId.createDigilockerUrl({ verification_id: vid, document_requested: ['AADHAAR'], redirect_url: `${base}/digilocker/return?v=${encodeURIComponent(vid)}` });
    if (!r.ok || !r.data.url) {
      await record(riderId, 'aadhaar', vid, 'error', r.ok ? 'no url' : `cashfree ${r.status} ${r.code}`);
      throw new KycError('provider_error', 'DigiLocker is unavailable right now. Try again in a few minutes.', 502);
    }
    await record(riderId, 'aadhaar', vid, 'pending', 'digilocker started', r.data.reference_id);
    // A new session starts a new verification: the previous Aadhaar result is cleared so it cannot be replayed for this one.
    await save(await profileOf(riderId), { digilockerVerificationId: vid, digilockerStartedAt: iso(), aadhaarVerifiedAt: null, aadhaarLast4: null, aadhaarPhotoEnc: null, aadhaarPhotoAt: null });
    return { verificationId: vid, url: r.data.url };
  };

  const completeDigilocker = async (input: { riderId: string; riderName: string; verificationId?: string }): Promise<KycResult> => {
    const riderId = (input.riderId ?? '').trim();
    if (!riderId) throw new KycError('validation', 'riderId is required');
    if (!input.riderName?.trim()) throw new KycError('validation', "riderName is required (the rider's name as entered in the profile)");
    await purgeStalePhotos();
    const p = await profileOf(riderId);
    const vid = input.verificationId ?? p.digilockerVerificationId;
    // Only the rider who started this DigiLocker session can complete it.
    if (!vid || vid !== p.digilockerVerificationId) throw new KycError('not_found', 'Start DigiLocker first.', 404);
    if (p.aadhaarVerifiedAt && p.aadhaarLast4) return aadhaarResult(p);

    const st = await secureId.getDigilockerStatus(vid);
    if (!st.ok) throw new KycError('provider_error', 'DigiLocker is unavailable right now. Try again in a few minutes.', 502);
    const status = (st.data.status ?? '').toUpperCase();
    if (status === 'PENDING') return result('aadhaar', 'pending', { verificationId: vid, reason: 'Finish signing in to DigiLocker and allow access to your Aadhaar.' });
    if (status !== 'AUTHENTICATED') {
      const reason = status === 'EXPIRED' ? 'The DigiLocker session expired. Start again.' : 'DigiLocker access was not given. Start again and allow access to your Aadhaar.';
      await record(riderId, 'aadhaar', vid, 'rejected', status === 'EXPIRED' ? 'session expired' : 'consent not given', st.data.reference_id);
      return result('aadhaar', 'rejected', { verificationId: vid, reason });
    }

    const doc = await secureId.getAadhaarDocument(vid);
    if (!doc.ok || !doc.data.name) throw new KycError('provider_error', 'Could not read your Aadhaar from DigiLocker. Try again in a few minutes.', 502);
    const aadhaarName = doc.data.name.trim();
    const match = matchNames(input.riderName ?? '', aadhaarName).result;
    if (match === 'poor') {
      const reason = `The name on your Aadhaar (${aadhaarName}) does not match your profile name (${input.riderName.trim()}). Update your profile to your name as on Aadhaar.`;
      await record(riderId, 'aadhaar', vid, 'rejected', 'name mismatch', doc.data.reference_id);
      return result('aadhaar', 'rejected', { verificationId: vid, reason, details: { nameMatch: match } });
    }
    const dob = normalizeDob(doc.data.dob ?? st.data.user_details?.dob);
    if (dob && !ageAllowed(dob)) {
      await record(riderId, 'aadhaar', vid, 'rejected', 'age not allowed', doc.data.reference_id);
      return result('aadhaar', 'rejected', { verificationId: vid, reason: `Riders must be between ${deps.minAge ?? 18} and ${deps.maxAge ?? 80} years old.` });
    }
    const photo = await photoBytes(fetchFn, doc.data.photo_link);
    const saved = await save(p, {
      legalName: aadhaarName,
      dob,
      gender: doc.data.gender ?? st.data.user_details?.gender ?? null,
      aadhaarLast4: last4(doc.data.uid),
      aadhaarVerifiedAt: iso(),
      aadhaarPhotoEnc: photo ? await encryptJson(deps.payloadKey, bytesToBase64(photo)) : null,
      aadhaarPhotoAt: photo ? iso() : null,
    });
    await record(riderId, 'aadhaar', vid, 'verified', null, doc.data.reference_id);
    return aadhaarResult(saved, match);
  };

  const aadhaarResult = (p: KycProfile, match?: NameMatch): KycResult =>
    result('aadhaar', 'verified', {
      verificationId: p.digilockerVerificationId,
      numberMasked: p.aadhaarLast4 ? `XXXX XXXX ${p.aadhaarLast4}` : null,
      verifiedAt: p.aadhaarVerifiedAt,
      details: { legalName: p.legalName, source: 'digilocker', ...(match ? { nameMatch: match } : {}) },
    });

  // ---- 2. PAN ----
  const verifyPan = async (input: { riderId: string; riderName?: string; pan: string }): Promise<KycResult> => {
    const riderId = (input.riderId ?? '').trim();
    const pan = normalizePan(input.pan ?? '');
    if (!riderId) throw new KycError('validation', 'riderId is required');
    if (!isPan(pan)) throw new KycError('validation', 'Enter a valid PAN, e.g. ABCDE1234F');
    const p = await profileOf(riderId);
    const name = nameAgainst(p, input.riderName);
    if (!name) throw new KycError('validation', 'Verify Aadhaar first so your PAN can be matched to your name.');
    await guard(riderId, 'pan');
    const vid = await verificationIdFor('pan', riderId);
    const r = await secureId.verifyPan({ pan, name });
    if (!r.ok) return failed(r, riderId, 'pan', vid, 'This PAN could not be verified. Check the number and try again.');
    const valid = r.data.valid ?? ['VALID', 'E'].includes((r.data.pan_status ?? '').toUpperCase());
    if (!valid) {
      await record(riderId, 'pan', vid, 'rejected', 'invalid pan', r.data.reference_id);
      return result('pan', 'rejected', { verificationId: vid, numberMasked: maskPan(pan), reason: 'This PAN is not valid. Check the number and try again.' });
    }
    const registered = r.data.registered_name ?? r.data.name_pan_card ?? '';
    const match = combineMatch(registered ? matchNames(name, registered).result : 'poor', fromCashfreeMatch(r.data.name_match_result));
    if (match === 'poor') {
      await record(riderId, 'pan', vid, 'rejected', 'name mismatch', r.data.reference_id);
      // Whose PAN it is stays between Cashfree and us: the form must not turn into a way to look up who owns a PAN.
      return result('pan', 'rejected', { verificationId: vid, numberMasked: maskPan(pan), reason: `This PAN is registered to a different name. Add your own PAN (${name}).`, details: { nameMatch: match } });
    }
    await save(p, { panMasked: maskPan(pan), panVerifiedAt: iso() });
    await record(riderId, 'pan', vid, 'verified', null, r.data.reference_id);
    return result('pan', 'verified', { verificationId: vid, numberMasked: maskPan(pan), verifiedAt: iso(), details: { nameMatch: match } });
  };

  // ---- 3. Selfie: liveness + face match with the Aadhaar photo ----
  const verifySelfie = async (input: { riderId: string; image: Uint8Array<ArrayBuffer> }): Promise<KycResult> => {
    const riderId = (input.riderId ?? '').trim();
    if (!riderId) throw new KycError('validation', 'riderId is required');
    const image = input.image;
    const type = image ? sniffImageType(image) : null;
    if (!image || !type) throw new KycError('validation', 'Send the selfie as a JPEG or PNG.');
    if (image.length > MAX_IMAGE_BYTES) throw new KycError('validation', 'The selfie is larger than 10 MB.');

    await purgeStalePhotos();
    await guard(riderId, 'selfie');
    const vid = await verificationIdFor('selfie', riderId);
    const live = await secureId.faceLiveness(vid, image, type);
    if (!live.ok) return failed(live, riderId, 'selfie', vid, "We couldn't check this selfie. Retake it facing the camera in good light.");
    if (live.data.liveness !== true) {
      const reason = "We couldn't confirm a live selfie. Retake it facing the camera in good light, without a mask or sunglasses.";
      await record(riderId, 'selfie', vid, 'rejected', 'liveness failed', live.data.reference_id);
      return result('selfie', 'rejected', { verificationId: vid, reason, details: { livenessScore: live.data.liveness_score ?? null } });
    }
    let p = await save(await profileOf(riderId), { livenessScore: live.data.liveness_score ?? null });
    if (!photoIsFresh(p)) {
      // No Aadhaar photo to compare with (Aadhaar not verified yet, the photo was not available, or it is older than 24 hours): a person decides.
      if (p.aadhaarPhotoEnc) p = await save(p, { aadhaarPhotoEnc: null, aadhaarPhotoAt: null });
      await record(riderId, 'selfie', vid, 'pending', 'awaiting aadhaar photo', live.data.reference_id);
      return result('selfie', 'pending', {
        verificationId: vid,
        reason: p.aadhaarVerifiedAt ? 'Liveness passed. Our team will compare it with your Aadhaar.' : 'Liveness passed. It will be matched with your Aadhaar photo once Aadhaar is verified.',
        details: { liveness: true, livenessScore: live.data.liveness_score ?? null },
      });
    }
    let aadhaarPhoto: Uint8Array<ArrayBuffer>;
    try {
      aadhaarPhoto = base64ToBytes(await decryptJson<string>(deps.payloadKey, p.aadhaarPhotoEnc!));
    } catch {
      // The stored photo cannot be read (the key changed): drop it and let a person decide.
      await save(p, { aadhaarPhotoEnc: null, aadhaarPhotoAt: null });
      await record(riderId, 'selfie', vid, 'pending', 'aadhaar photo unreadable', live.data.reference_id);
      return result('selfie', 'pending', { verificationId: vid, reason: 'Liveness passed. Our team will compare it with your Aadhaar.', details: { liveness: true } });
    }
    const mvid = `${vid}m`;
    const fm = await secureId.faceMatch(mvid, image, aadhaarPhoto, deps.faceMatchThreshold);
    if (!fm.ok) return failed(fm, riderId, 'selfie', vid, "We couldn't compare your selfie with your Aadhaar photo. Retake it in good light.");
    const score = typeof fm.data.face_match_score === 'number' ? fm.data.face_match_score : Number(fm.data.face_match_score ?? 0);
    const matched = (fm.data.face_match_result ?? '').toUpperCase() === 'YES' || score >= deps.faceMatchThreshold;
    if (!matched) {
      await save(p, { faceMatchScore: score });
      await record(riderId, 'selfie', mvid, 'rejected', 'face mismatch', fm.data.ref_id);
      return result('selfie', 'rejected', { verificationId: vid, reason: 'Your selfie does not match your Aadhaar photo. Retake it facing the camera in good light.', details: { faceMatchScore: score } });
    }
    // The Aadhaar photo is no longer needed once the faces matched.
    p = await save(p, { faceMatchScore: score, selfieVerifiedAt: iso(), aadhaarPhotoEnc: null, aadhaarPhotoAt: null });
    await record(riderId, 'selfie', mvid, 'verified', null, fm.data.ref_id);
    return result('selfie', 'verified', { verificationId: vid, verifiedAt: p.selfieVerifiedAt, details: { liveness: true, faceMatchScore: score } });
  };

  // ---- 4. Driving licence ----
  const verifyDrivingLicence = async (input: { riderId: string; riderName?: string; dlNumber: string; dob?: string }): Promise<KycResult> => {
    const riderId = (input.riderId ?? '').trim();
    const dl = normalizeDl(input.dlNumber ?? '');
    if (!riderId) throw new KycError('validation', 'riderId is required');
    if (!isDl(dl)) throw new KycError('validation', 'Enter the licence number as printed (state code + digits), e.g. MH14 20110012345.');
    const p = await profileOf(riderId);
    const dob = normalizeDob(input.dob) ?? p.dob;
    if (!dob) throw new KycError('validation', 'Enter your date of birth as on the licence (or verify Aadhaar first).');
    await guard(riderId, 'dl');
    const vid = await verificationIdFor('dl', riderId);
    const r = await secureId.verifyDrivingLicence({ verification_id: vid, dl_number: dl, dob });
    if (!r.ok) return failed(r, riderId, 'dl', vid, 'No licence was found for this number and date of birth.');
    if ((r.data.status ?? '').toUpperCase() !== 'VALID') {
      await record(riderId, 'dl', vid, 'rejected', 'invalid', r.data.reference_id);
      return result('dl', 'rejected', { verificationId: vid, numberMasked: maskDl(dl), reason: 'No licence was found for this number and date of birth. Check both and try again.' });
    }
    const expiresOn = normalizeDob(r.data.dl_validity?.non_transport?.to ?? r.data.dl_validity?.transport?.to);
    const today = iso().slice(0, 10);
    if (expiresOn && expiresOn < today) {
      await record(riderId, 'dl', vid, 'rejected', 'expired', r.data.reference_id);
      return result('dl', 'rejected', { verificationId: vid, numberMasked: maskDl(dl), expiresOn, reason: `This licence expired on ${expiresOn}. Renew it and try again.` });
    }
    const holder = r.data.details_of_driving_licence?.name ?? '';
    const name = nameAgainst(p, input.riderName);
    const match = holder && name ? matchNames(name, holder).result : 'partial';
    if (match === 'poor') {
      await record(riderId, 'dl', vid, 'rejected', 'name mismatch', r.data.reference_id);
      return result('dl', 'rejected', { verificationId: vid, numberMasked: maskDl(dl), reason: 'This licence is in a different name. Add your own licence.', details: { nameMatch: match } });
    }
    await save(p, { dlMasked: maskDl(dl), dlVerifiedAt: iso(), dlExpiresOn: expiresOn, dob: p.dob ?? dob });
    await record(riderId, 'dl', vid, 'verified', null, r.data.reference_id);
    return result('dl', 'verified', { verificationId: vid, numberMasked: maskDl(dl), expiresOn, verifiedAt: iso(), details: { nameMatch: match } });
  };

  // ---- 5. Vehicle RC ----
  const verifyVehicleRc = async (input: { riderId: string; riderName?: string; vehicleNumber: string }): Promise<KycResult> => {
    const riderId = (input.riderId ?? '').trim();
    const reg = normalizeVehicle(input.vehicleNumber ?? '');
    if (!riderId) throw new KycError('validation', 'riderId is required');
    if (!isVehicleNumber(reg)) throw new KycError('validation', 'Enter a valid registration number, e.g. MH 24 AB 1234.');
    await guard(riderId, 'rc');
    const vid = await verificationIdFor('rc', riderId);
    const r = await secureId.verifyVehicleRc({ verification_id: vid, vehicle_number: reg });
    if (!r.ok) return failed(r, riderId, 'rc', vid, 'No vehicle was found for this registration number.');
    if ((r.data.status ?? '').toUpperCase() !== 'VALID') {
      await record(riderId, 'rc', vid, 'rejected', 'invalid', r.data.reference_id);
      return result('rc', 'rejected', { verificationId: vid, numberMasked: reg, reason: 'No vehicle was found for this registration number. Check it and try again.' });
    }
    const rcStatus = (r.data.rc_status ?? '').toUpperCase();
    if (/SUSPEND|CANCEL|BLACKLIST|SEIZED/.test(rcStatus)) {
      await record(riderId, 'rc', vid, 'rejected', `rc ${rcStatus.toLowerCase()}`.slice(0, 60), r.data.reference_id);
      return result('rc', 'rejected', { verificationId: vid, numberMasked: reg, reason: "This vehicle's registration is not active." });
    }
    const expiresOn = normalizeDob(r.data.rc_expiry_date);
    if (expiresOn && expiresOn < iso().slice(0, 10)) {
      await record(riderId, 'rc', vid, 'rejected', 'expired', r.data.reference_id);
      return result('rc', 'rejected', { verificationId: vid, numberMasked: reg, expiresOn, reason: `This vehicle's registration expired on ${expiresOn}.` });
    }
    const p = await profileOf(riderId);
    const name = nameAgainst(p, input.riderName);
    const ownerMatch = r.data.owner && name ? matchNames(name, r.data.owner).result : null;
    await save(p, { rcNumber: reg, rcVerifiedAt: iso(), rcExpiresOn: expiresOn });
    await record(riderId, 'rc', vid, 'verified', null, r.data.reference_id);
    return result('rc', 'verified', {
      verificationId: vid, numberMasked: reg, expiresOn, verifiedAt: iso(),
      details: {
        ownerIsRider: ownerMatch ? ownerMatch !== 'poor' : null,
        model: [r.data.vehicle_manufacturer_name, r.data.model].filter(Boolean).join(' ') || null,
        vehicleClass: r.data.class ?? null,
        insuranceUpto: normalizeDob(r.data.vehicle_insurance_upto),
      },
    });
  };

  // What is verified so far (masked; no date of birth, no photo).
  const getSummary = async (riderId: string) => {
    const p = await store.getProfile(riderId);
    if (!p) throw new KycError('not_found', 'No KYC yet for this rider', 404);
    return {
      riderId,
      legalName: p.legalName,
      aadhaar: p.aadhaarVerifiedAt ? { numberMasked: p.aadhaarLast4 ? `XXXX XXXX ${p.aadhaarLast4}` : null, verifiedAt: p.aadhaarVerifiedAt } : null,
      pan: p.panVerifiedAt ? { numberMasked: p.panMasked, verifiedAt: p.panVerifiedAt } : null,
      selfie: p.selfieVerifiedAt ? { verifiedAt: p.selfieVerifiedAt, faceMatchScore: p.faceMatchScore } : { pendingFaceMatch: p.livenessScore !== null },
      dl: p.dlVerifiedAt ? { numberMasked: p.dlMasked, expiresOn: p.dlExpiresOn, verifiedAt: p.dlVerifiedAt } : null,
      rc: p.rcVerifiedAt ? { number: p.rcNumber, expiresOn: p.rcExpiresOn, verifiedAt: p.rcVerifiedAt } : null,
      complete: !!(p.aadhaarVerifiedAt && p.panVerifiedAt && p.selfieVerifiedAt && p.dlVerifiedAt),
    };
  };

  // DigiLocker sends the rider here after consent: back into the app (the result comes from Cashfree, not from this address).
  const returnLocation = (appReturnUrl: string, verificationId: string | null): string => {
    const v = verificationId && /^[A-Za-z0-9_.-]{1,50}$/.test(verificationId) ? verificationId : null;
    return v ? `${appReturnUrl}${appReturnUrl.includes('?') ? '&' : '?'}digilocker=${encodeURIComponent(v)}` : appReturnUrl;
  };

  // The profile as it stands (for the age rule); never returned to the app.
  const profile = (riderId: string) => store.getProfile(riderId);

  return { startDigilocker, completeDigilocker, verifyPan, verifySelfie, verifyDrivingLicence, verifyVehicleRc, getSummary, returnLocation, profile };
};

export type KycService = ReturnType<typeof createKycService>;
