// Cashfree Secure ID (Verification API, version 2023-12-18) client for rider KYC.
// Endpoints and fields follow Cashfree's official SDK (cashfree-verification 4.x):
//   POST /verification/digilocker · GET /verification/digilocker?verification_id=
//   GET  /verification/digilocker/document/AADHAAR?verification_id=
//   POST /verification/pan · POST /verification/driving-license · POST /verification/vehicle-rc
//   POST /verification/face-liveness (multipart) · POST /verification/face-match (multipart)
// Every call is bounded (timeout): network errors are returned, never thrown. Nothing here logs a header, a body or a number.
import { base64ToBytes, bytesToBase64 } from './crypto';
import type { FetchLike } from './types';

export type SecureIdEnvironment = 'sandbox' | 'production';

export interface SecureIdConfig {
  environment: SecureIdEnvironment;
  clientId: string;
  clientSecret: string;
  // Cashfree 2FA public key (PEM). Needed when the caller's IP is not whitelisted (a serverless host's never is).
  publicKeyPem?: string;
  apiVersion?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
  now?: () => number;
  newId?: () => string;
}

export type SidResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string; message: string; data?: unknown };

export interface SidDigilockerUrl { verification_id?: string; reference_id?: number; url?: string; status?: string }
export interface SidDigilockerStatus { verification_id?: string; reference_id?: number; status?: string; user_details?: { name?: string; dob?: string; gender?: string; mobile?: string } }
export interface SidAadhaarDocument { name?: string; dob?: string; gender?: string; uid?: string; photo_link?: string; care_of?: string; reference_id?: number }
export interface SidPan {
  pan?: string; valid?: boolean; pan_status?: string; registered_name?: string; name_pan_card?: string; name_match_result?: string; name_match_score?: string;
  message?: string; reference_id?: number;
}
export interface SidDrivingLicence {
  verification_id?: string; reference_id?: number; status?: string; dl_number?: string;
  dl_validity?: { non_transport?: { from?: string; to?: string }; transport?: { from?: string; to?: string } };
  details_of_driving_licence?: { name?: string; status?: string; date_of_issue?: string };
}
export interface SidVehicleRc {
  verification_id?: string; reference_id?: number; status?: string; reg_no?: string; owner?: string; rc_status?: string; rc_expiry_date?: string;
  model?: string; vehicle_manufacturer_name?: string; vehicle_insurance_upto?: string; class?: string;
}
export interface SidFaceLiveness { verification_id?: string; reference_id?: number; status?: string; liveness?: boolean; liveness_score?: number }
export interface SidFaceMatch { verification_id?: string; ref_id?: number; status?: string; face_match_result?: string; face_match_score?: number }

export interface SecureIdClient {
  createDigilockerUrl(req: { verification_id: string; document_requested: ['AADHAAR']; redirect_url: string }): Promise<SidResult<SidDigilockerUrl>>;
  getDigilockerStatus(verificationId: string): Promise<SidResult<SidDigilockerStatus>>;
  getAadhaarDocument(verificationId: string): Promise<SidResult<SidAadhaarDocument>>;
  verifyPan(req: { pan: string; name?: string }): Promise<SidResult<SidPan>>;
  verifyDrivingLicence(req: { verification_id: string; dl_number: string; dob: string }): Promise<SidResult<SidDrivingLicence>>;
  verifyVehicleRc(req: { verification_id: string; vehicle_number: string }): Promise<SidResult<SidVehicleRc>>;
  faceLiveness(verificationId: string, image: Uint8Array<ArrayBuffer>, contentType: string): Promise<SidResult<SidFaceLiveness>>;
  faceMatch(verificationId: string, first: Uint8Array<ArrayBuffer>, second: Uint8Array<ArrayBuffer>, threshold: number): Promise<SidResult<SidFaceMatch>>;
}

export const cashfreeBaseUrl = (env: SecureIdEnvironment): string => (env === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com');

// A Secure ID secret says which environment it belongs to.
export const environmentOfSecretKey = (secretKey: string): SecureIdEnvironment | null => {
  if (/^cfsk_ma_prod_/i.test(secretKey)) return 'production';
  if (/^cfsk_ma_test_/i.test(secretKey)) return 'sandbox';
  return null;
};

// Accepts a PEM with real or escaped (\n) newlines, or just its base64 body.
export const pemToDer = (pem: string): Uint8Array<ArrayBuffer> =>
  base64ToBytes(pem.replace(/\\n/g, '\n').replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, ''));

// x-cf-signature: RSA-OAEP (SHA-1) encryption of "<clientId>.<unix seconds>" with Cashfree's public key.
export const cashfreeSignature = async (clientId: string, publicKeyPem: string, unixSeconds: number): Promise<string> => {
  const key = await crypto.subtle.importKey('spki', pemToDer(publicKeyPem), { name: 'RSA-OAEP', hash: 'SHA-1' }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(`${clientId}.${unixSeconds}`));
  return bytesToBase64(new Uint8Array(ct));
};

// JPEG or PNG from the file's magic bytes (Cashfree accepts JPEG/JPG/PNG).
export const sniffImageType = (b: Uint8Array): 'image/jpeg' | 'image/png' | null => {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return null;
};

export const createSecureIdClient = (cfg: SecureIdConfig): SecureIdClient => {
  const fetchFn: FetchLike = cfg.fetch ?? ((i, init) => fetch(i, init));
  const now = cfg.now ?? (() => Date.now());
  const newId = cfg.newId ?? (() => crypto.randomUUID());
  const base = `${cashfreeBaseUrl(cfg.environment)}/verification`;
  const timeoutMs = cfg.timeoutMs ?? 25_000;

  const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown, query?: Record<string, string>): Promise<SidResult<T>> => {
    const url = `${base}${path}${query ? `?${new URLSearchParams(query).toString()}` : ''}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'x-client-id': cfg.clientId,
      'x-client-secret': cfg.clientSecret,
      'x-api-version': cfg.apiVersion ?? '2023-12-18',
      'x-request-id': newId(),
    };
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      if (cfg.publicKeyPem) headers['x-cf-signature'] = await cashfreeSignature(cfg.clientId, cfg.publicKeyPem, Math.floor(now() / 1000));
      res = await fetchFn(url, { method, headers, signal: AbortSignal.timeout(timeoutMs), body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) });
    } catch (e) {
      return { ok: false, status: 0, code: 'network', message: e instanceof Error ? e.name : 'error' };
    }
    let json: unknown = {};
    try { json = await res.json(); } catch { json = {}; }
    if (res.ok) return { ok: true, status: res.status, data: json as T };
    const err = (json ?? {}) as { code?: string; type?: string; message?: string };
    return { ok: false, status: res.status, code: String(err.code ?? err.type ?? `http_${res.status}`), message: String(err.message ?? `HTTP ${res.status}`).slice(0, 300), data: json };
  };

  const imageForm = (fields: Record<string, string>, files: Record<string, { bytes: Uint8Array<ArrayBuffer>; type: string }>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    for (const [k, f] of Object.entries(files)) form.append(k, new Blob([f.bytes], { type: f.type }), `${k}.${f.type === 'image/png' ? 'png' : 'jpg'}`);
    return form;
  };

  return {
    createDigilockerUrl: req => call<SidDigilockerUrl>('POST', '/digilocker', req),
    getDigilockerStatus: id => call<SidDigilockerStatus>('GET', '/digilocker', undefined, { verification_id: id }),
    getAadhaarDocument: id => call<SidAadhaarDocument>('GET', '/digilocker/document/AADHAAR', undefined, { verification_id: id }),
    verifyPan: req => call<SidPan>('POST', '/pan', req),
    verifyDrivingLicence: req => call<SidDrivingLicence>('POST', '/driving-license', req),
    verifyVehicleRc: req => call<SidVehicleRc>('POST', '/vehicle-rc', req),
    faceLiveness: (id, image, type) => call<SidFaceLiveness>('POST', '/face-liveness', imageForm({ verification_id: id }, { image: { bytes: image, type } })),
    faceMatch: (id, first, second, threshold) =>
      call<SidFaceMatch>('POST', '/face-match', imageForm({ verification_id: id, threshold: String(threshold) }, {
        first_image: { bytes: first, type: sniffImageType(first) ?? 'image/jpeg' }, second_image: { bytes: second, type: sniffImageType(second) ?? 'image/jpeg' } })),
  };
};
