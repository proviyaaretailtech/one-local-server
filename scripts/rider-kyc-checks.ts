// Rider KYC on Cashfree Secure ID against a FAKE Cashfree (globalThis.fetch stubbed: nothing here can reach the network).
// Part A (no database): the engine in server/kyc with an in-memory store. DigiLocker verified / pending / rejected (consent denied) / expired /
//   wrong name, PAN, driving licence, vehicle RC, selfie liveness and face match, the 24 hour photo rule, the daily attempt limit, the request
//   Cashfree sees (headers, signature), and that nothing stored or logged holds a full Aadhaar, PAN or licence number or a third party's name.
// Part B (LOCAL Supabase from .env.localdb.off): the real routes. No keys = the old answers (501 provider_not_configured, uploads). With keys:
//   Aadhaar -> PAN -> selfie -> licence -> RC end to end into rider_documents (verified, masked numbers only), replays, rejected / expired /
//   under-age sessions, Cashfree down (the photo is kept as a pending upload), per rider limits, the public DigiLocker return address.
//   Cleans up after itself (audit_logs rows are append-only and stay).
// Run from frontend/:  npx tsx scripts/rider-kyc-checks.ts   (part B needs frontend/.env.localdb.off and the local stack running)
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const localEnv: Record<string, string> = {};
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) localEnv[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(localEnv.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'ALLOW_REMOTE', 'TRUSTED_PROXY_HOPS', 'CASHFREE_SECURE_ID_CLIENT_ID', 'CASHFREE_SECURE_ID_CLIENT_SECRET',
  'CASHFREE_SECURE_ID_PUBLIC_KEY', 'CASHFREE_SECURE_ID_ENV', 'KYC_PAYLOAD_KEY', 'KYC_ATTEMPTS_PER_DAY', 'KYC_APP_RETURN_URL', 'KYC_PUBLIC_BASE_URL', 'PUBLIC_BASE_URL']) delete process.env[k];

const originalError = console.error;
let passed = 0;
const check = (what: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) { originalError('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };
const refused = async (what: string, status: number, code: string | undefined, run: () => Promise<unknown>) => {
  try { await run(); check(what, false, 'was accepted'); } catch (e) { const x = e as { status?: number; code?: string; message?: string }; check(what, x.status === status && (!code || x.code === code), `${x.status} ${x.code} ${x.message}`); }
};

// ---------------- the fake Cashfree ----------------
const SECRET = 'cfsk_ma_test_FAKE_kyc_checks_secret';
const CLIENT = 'CHECKS_SID_ID';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const JPEG_B64 = Buffer.from(JPEG).toString('base64');
const FULL = { aadhaar: '123456789012', pan: 'ABCDE1234F', dl: 'MH1420110012345' };
type Fake = {
  digilocker: string; aadhaarName: string; dob: string; photo: 'data' | 'link' | 'none'; panValid: boolean; panName: string; panMatch: string;
  dlStatus: string; dlName: string; dlTo: string; rcStatus: string; rcState: string; rcOwner: string; rcExpiry: string; liveness: boolean; match: string; down: number;
};
const defaults = (): Fake => ({
  digilocker: 'AUTHENTICATED', aadhaarName: 'Asha Patil', dob: '12-03-1994', photo: 'data', panValid: true, panName: 'ASHA PATIL', panMatch: 'DIRECT_MATCH',
  dlStatus: 'VALID', dlName: 'ASHA PATIL', dlTo: '2040-01-01', rcStatus: 'VALID', rcState: 'ACTIVE', rcOwner: 'ASHA PATIL', rcExpiry: '2040-01-01', liveness: true, match: 'YES', down: 0,
});
const fake: Fake = defaults();
const calls: { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: any }[] = [];
const callsTo = (p: string) => calls.filter(c => c.path === p).length;
const cashfree = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.host === 'photos.example.test') return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  if (url.host !== 'sandbox.cashfree.com') throw new Error(`unexpected fetch ${url}`);
  const path = url.pathname.replace(/^\/verification/, ''), method = init?.method ?? 'GET';
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  let body: any;
  if (init?.body instanceof FormData) { body = {}; for (const [k, v] of init.body.entries()) body[k] = typeof v === 'string' ? v : `file:${(v as File).type}:${(v as File).size}`; }
  else if (init?.body) body = JSON.parse(String(init.body));
  calls.push({ method, path, query: Object.fromEntries(url.searchParams), headers, body });
  if (fake.down) return Response.json({ code: 'internal_error', message: 'Cashfree is down' }, { status: fake.down });
  const ok = (b: unknown) => Response.json(b);
  switch (`${method} ${path}`) {
    case 'POST /digilocker': return ok({ verification_id: body.verification_id, reference_id: 1001, url: `https://digilocker.example.test/consent?x=${body.verification_id}`, status: 'PENDING' });
    case 'GET /digilocker': return ok({ verification_id: url.searchParams.get('verification_id'), reference_id: 1002, status: fake.digilocker, user_details: { name: fake.aadhaarName, dob: fake.dob, gender: 'F' } });
    case 'GET /digilocker/document/AADHAAR': return ok({ name: fake.aadhaarName, dob: fake.dob, gender: 'F', uid: FULL.aadhaar, reference_id: 1003,
      ...(fake.photo === 'data' ? { photo_link: `data:image/jpeg;base64,${JPEG_B64}` } : fake.photo === 'link' ? { photo_link: 'https://photos.example.test/aadhaar.jpg' } : {}) });
    case 'POST /pan': return ok({ pan: body.pan, valid: fake.panValid, pan_status: fake.panValid ? 'VALID' : 'INVALID', registered_name: fake.panName, name_match_result: fake.panMatch, reference_id: 1004 });
    case 'POST /driving-license': return ok({ verification_id: body.verification_id, reference_id: 1005, status: fake.dlStatus, dl_number: body.dl_number, dl_validity: { non_transport: { to: fake.dlTo } }, details_of_driving_licence: { name: fake.dlName } });
    case 'POST /vehicle-rc': return ok({ verification_id: body.verification_id, reference_id: 1006, status: fake.rcStatus, rc_status: fake.rcState, owner: fake.rcOwner, rc_expiry_date: fake.rcExpiry, model: 'Splendor', vehicle_manufacturer_name: 'Hero', class: 'M-CYCLE' });
    case 'POST /face-liveness': return ok({ verification_id: body.verification_id, reference_id: 1007, status: 'SUCCESS', liveness: fake.liveness, liveness_score: fake.liveness ? 0.93 : 0.12 });
    case 'POST /face-match': return ok({ verification_id: body.verification_id, ref_id: 1008, status: 'SUCCESS', face_match_result: fake.match, face_match_score: fake.match === 'YES' ? 0.91 : 0.31 });
  }
  return Response.json({ code: 'not_found', message: `no fake for ${method} ${path}` }, { status: 404 });
};
const realFetch = globalThis.fetch;
const tokenToUser = new Map<string, string>();
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith('/auth/v1/user')) { const t = String(init?.headers?.Authorization ?? '').slice(7); return tokenToUser.has(t) ? Response.json({ id: tokenToUser.get(t) }) : new Response('{}', { status: 401 }); }
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return realFetch(input, init); // the LOCAL Supabase only
  return cashfree(input, init);
}) as typeof fetch;
const reset = () => { Object.assign(fake, defaults()); calls.length = 0; };

async function main() {
  const { createKycService } = await import('../server/kyc/service');
  const { createSecureIdClient, cashfreeSignature } = await import('../server/kyc/secure-id');
  const { createMemoryKycStore } = await import('../server/kyc/store-memory');
  const { encryptJson, decryptJson, isPayloadKey } = await import('../server/kyc/crypto');
  const { matchNames } = await import('../server/kyc/names');
  const { KycError } = await import('../server/kyc/types');

  // =============== A. the engine ===============
  const PAYLOAD_KEY = randomBytes(32).toString('base64');
  let clock = Date.parse('2026-10-11T10:00:00Z');
  const logs: string[] = [];
  const mk = (over: Partial<Parameters<typeof createKycService>[0]> = {}) => {
    const store = createMemoryKycStore();
    const secureId = createSecureIdClient({ environment: 'sandbox', clientId: CLIENT, clientSecret: SECRET, fetch: cashfree });
    const service = createKycService({ store, secureId, payloadKey: PAYLOAD_KEY, attemptsPerDay: 5, faceMatchThreshold: 0.75, fetch: cashfree, now: () => new Date(clock), log: (e, d) => logs.push(JSON.stringify({ e, d })), ...over });
    return { store, service };
  };
  const RIDER = 'a0000000-0000-4000-8000-000000000001', OTHER = 'a0000000-0000-4000-8000-000000000002', NAME = 'Asha Patil';
  const base = 'https://api.example.test/api/rider/kyc';

  reset();
  let { store, service } = mk();
  const started = await service.startDigilocker({ riderId: RIDER, returnUrlBase: `${base}/` });
  const startCall = calls.find(c => c.path === '/digilocker' && c.method === 'POST')!;
  check('digilocker start: returns the DigiLocker address and a verification id', started.url.startsWith('https://digilocker.example.test/') && /^ol_aadhaar_[0-9a-f]{12}_/.test(started.verificationId), started);
  check('digilocker start: the verification id does not contain the rider id', !started.verificationId.includes(RIDER) && started.verificationId.length <= 50, started.verificationId);
  check('digilocker start: asks only for AADHAAR and returns to the server callback with the id', JSON.stringify(startCall.body.document_requested) === '["AADHAAR"]' && startCall.body.redirect_url === `${base}/digilocker/return?v=${started.verificationId}`, startCall.body);
  check('cashfree request: client id, secret, api version and a request id are sent; no signature without a public key', startCall.headers['x-client-id'] === CLIENT && startCall.headers['x-client-secret'] === SECRET && startCall.headers['x-api-version'] === '2023-12-18' && !!startCall.headers['x-request-id'] && !startCall.headers['x-cf-signature'], Object.keys(startCall.headers));

  fake.digilocker = 'PENDING';
  let r = await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  check('digilocker pending: the rider is told to finish in DigiLocker; nothing verified, Aadhaar not fetched', r.status === 'pending' && r.verificationId === started.verificationId && !!r.reason && callsTo('/digilocker/document/AADHAAR') === 0 && !store.profiles.get(RIDER)?.aadhaarVerifiedAt, r);
  check('digilocker pending: waiting is not an attempt', (await store.countChecks(RIDER, 'aadhaar', '2000-01-01', ['pending', 'error'])) === 1);
  fake.digilocker = 'CONSENT_DENIED';
  r = await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  check('digilocker consent denied: rejected with the plain reason, nothing verified', r.status === 'rejected' && /not given/.test(r.reason ?? '') && !store.profiles.get(RIDER)?.aadhaarVerifiedAt, r);
  fake.digilocker = 'EXPIRED';
  r = await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  check('digilocker expired: rejected, "start again"', r.status === 'rejected' && /expired/.test(r.reason ?? ''), r);
  fake.digilocker = 'AUTHENTICATED'; fake.aadhaarName = 'Ramesh Kumar';
  r = await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  check('digilocker wrong name: rejected, both names shown (the rider\'s own), not verified', r.status === 'rejected' && /Ramesh Kumar/.test(r.reason ?? '') && /Asha Patil/.test(r.reason ?? '') && !store.profiles.get(RIDER)?.aadhaarVerifiedAt, r);
  fake.aadhaarName = 'Asha Patil';
  await refused('digilocker: another rider cannot complete this session: 404', 404, 'not_found', () => service.completeDigilocker({ riderId: OTHER, riderName: NAME, verificationId: started.verificationId }));
  await refused('digilocker: a verification id the rider never started: 404', 404, 'not_found', () => service.completeDigilocker({ riderId: RIDER, riderName: NAME, verificationId: 'ol_aadhaar_notmine' }));

  r = await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  let prof = store.profiles.get(RIDER)!;
  check('digilocker verified: masked number only (last four), legal name, date of birth', r.status === 'verified' && r.numberMasked === 'XXXX XXXX 9012' && prof.legalName === 'Asha Patil' && prof.dob === '1994-03-12' && prof.aadhaarLast4 === '9012', { r, prof: { ...prof, aadhaarPhotoEnc: '…' } });
  check('digilocker verified: the result carries the verification id of the session', r.verificationId === started.verificationId, r);
  check('aadhaar: the full number is in no profile, audit row, result or log line', ![JSON.stringify([...store.profiles.values()]), JSON.stringify(store.checks), JSON.stringify(r), logs.join('\n')].some(t => t.includes(FULL.aadhaar)));
  check('aadhaar photo: stored encrypted (the picture is not in the row), with its time', !!prof.aadhaarPhotoEnc && prof.aadhaarPhotoEnc.startsWith('v1.') && !prof.aadhaarPhotoEnc.includes(JPEG_B64) && !!prof.aadhaarPhotoAt);
  check('aadhaar photo: it decrypts to the picture with the key, and not with another key', (await decryptJson<string>(PAYLOAD_KEY, prof.aadhaarPhotoEnc!)) === JPEG_B64 && await decryptJson(randomBytes(32).toString('base64'), prof.aadhaarPhotoEnc!).then(() => false, () => true));
  const before = calls.length;
  r = await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  check('digilocker verified: asking again is answered from the record, with no new Cashfree call', r.status === 'verified' && calls.length === before, r);
  fake.digilocker = 'CONSENT_DENIED';
  r = await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  check('digilocker verified: a later "denied" from Cashfree does not undo it', r.status === 'verified', r);
  fake.digilocker = 'AUTHENTICATED';

  // the date of birth in other formats and a link photo
  ({ store, service } = mk());
  fake.photo = 'link'; fake.dob = '1990-01-02';
  await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
  r = await service.completeDigilocker({ riderId: RIDER, riderName: 'Asha P Patil' });
  check('digilocker: an initial in the profile name still matches; the https photo link is fetched and kept encrypted; ISO date of birth read', r.status === 'verified' && store.profiles.get(RIDER)!.dob === '1990-01-02' && !!store.profiles.get(RIDER)!.aadhaarPhotoEnc, r);
  ({ store, service } = mk());
  fake.photo = 'none'; fake.dob = '12/03/1994';
  await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
  r = await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  check('digilocker: no photo from Cashfree is not an error (the selfie goes to a person later); dd/mm/yyyy read', r.status === 'verified' && store.profiles.get(RIDER)!.aadhaarPhotoEnc === null && store.profiles.get(RIDER)!.dob === '1994-03-12', r);

  // the 18 to 80 rule, judged on the Aadhaar's date of birth
  for (const [dob, what] of [['05-05-2015', 'under 18'], ['01-01-1930', 'over 80']] as const) {
    reset(); ({ store, service } = mk()); fake.dob = dob;
    await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
    r = await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
    prof = store.profiles.get(RIDER)!;
    check(`digilocker ${what}: rejected "between 18 and 80", and nothing of the Aadhaar is kept`, r.status === 'rejected' && /between 18 and 80/.test(r.reason ?? '') && !prof.aadhaarVerifiedAt && !prof.aadhaarLast4 && !prof.aadhaarPhotoEnc && !prof.dob && r.numberMasked === null, { r, prof });
  }

  // a new DigiLocker session clears the old result
  reset(); ({ store, service } = mk());
  await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
  await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  const first = store.profiles.get(RIDER)!.digilockerVerificationId;
  const second = await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
  prof = store.profiles.get(RIDER)!;
  check('digilocker: a new session starts a new verification and clears the previous Aadhaar result', second.verificationId !== first && prof.digilockerVerificationId === second.verificationId && !prof.aadhaarVerifiedAt && !prof.aadhaarLast4 && !prof.aadhaarPhotoEnc, prof);
  fake.down = 503;
  await refused('digilocker start: Cashfree down: 502 provider_error, recorded as an error', 502, 'provider_error', () => service.startDigilocker({ riderId: RIDER, returnUrlBase: base }));
  check('digilocker start: the failed attempt is in the audit trail as an error', store.checks.some(c => c.kind === 'aadhaar' && c.status === 'error'));
  reset();

  // ---- PAN ----
  ({ store, service } = mk());
  await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
  await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  r = await service.verifyPan({ riderId: RIDER, pan: ' abcde 1234f ' });
  check('pan valid: normalised, matched to the Aadhaar name, masked', r.status === 'verified' && r.numberMasked === 'ABXXXXX34F' && store.profiles.get(RIDER)!.panMasked === 'ABXXXXX34F' && calls.at(-1)!.body.pan === 'ABCDE1234F' && calls.at(-1)!.body.name === 'Asha Patil', r);
  check('pan: the full number is in no profile, audit row, result or log line', ![JSON.stringify([...store.profiles.values()]), JSON.stringify(store.checks), JSON.stringify(r), logs.join('\n')].some(t => t.includes(FULL.pan)));
  fake.panValid = false;
  r = await service.verifyPan({ riderId: RIDER, pan: FULL.pan });
  check('pan invalid: rejected with a plain reason', r.status === 'rejected' && /not valid/.test(r.reason ?? ''), r);
  fake.panValid = true; fake.panName = 'SOMEONE ELSEWHERE'; fake.panMatch = 'NO_MATCH';
  r = await service.verifyPan({ riderId: RIDER, pan: FULL.pan });
  check('pan of someone else: rejected, and the holder\'s name is NOT in the answer', r.status === 'rejected' && !JSON.stringify(r).includes('SOMEONE') && /different name/.test(r.reason ?? ''), r);
  await refused('pan: a malformed PAN is refused before Cashfree is called: 400', 400, 'validation', () => service.verifyPan({ riderId: RIDER, pan: 'ABC123' }));
  ({ store, service } = mk());
  await refused('pan: no Aadhaar and no profile name: 400, verify Aadhaar first', 400, 'validation', () => service.verifyPan({ riderId: RIDER, pan: FULL.pan }));
  reset();
  r = await service.verifyPan({ riderId: RIDER, riderName: 'Asha Patil', pan: FULL.pan });
  check('pan: before Aadhaar the profile name is what it is matched to', r.status === 'verified', r);

  // ---- driving licence ----
  ({ store, service } = mk());
  await refused('licence: no Aadhaar and no date of birth: 400', 400, 'validation', () => service.verifyDrivingLicence({ riderId: RIDER, riderName: NAME, dlNumber: FULL.dl }));
  await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
  await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  r = await service.verifyDrivingLicence({ riderId: RIDER, dlNumber: 'mh14 2011-0012345' });
  check('licence valid: date of birth from Aadhaar, masked number, expiry kept', r.status === 'verified' && r.numberMasked === 'MH14•••••••2345' && r.expiresOn === '2040-01-01' && calls.at(-1)!.body.dob === '1994-03-12' && calls.at(-1)!.body.dl_number === FULL.dl, r);
  check('licence: the full number is in no profile, audit row, result or log line', ![JSON.stringify([...store.profiles.values()]), JSON.stringify(store.checks), JSON.stringify(r), logs.join('\n')].some(t => t.includes(FULL.dl)));
  fake.dlTo = '2020-01-01';
  r = await service.verifyDrivingLicence({ riderId: RIDER, dlNumber: FULL.dl });
  check('licence expired: rejected with the date', r.status === 'rejected' && r.expiresOn === '2020-01-01' && /expired on 2020-01-01/.test(r.reason ?? ''), r);
  fake.dlTo = '2040-01-01'; fake.dlName = 'OTHER PERSON';
  r = await service.verifyDrivingLicence({ riderId: RIDER, dlNumber: FULL.dl });
  check('licence of someone else: rejected, and the holder\'s name is NOT in the answer', r.status === 'rejected' && !JSON.stringify(r).includes('OTHER') && /different name/.test(r.reason ?? ''), r);
  fake.dlName = 'ASHA PATIL'; fake.dlStatus = 'INVALID';
  r = await service.verifyDrivingLicence({ riderId: RIDER, dlNumber: FULL.dl });
  check('licence not found: rejected', r.status === 'rejected', r);
  await refused('licence: a malformed number is refused: 400', 400, 'validation', () => service.verifyDrivingLicence({ riderId: RIDER, dlNumber: '12' }));
  reset();
  r = await service.verifyDrivingLicence({ riderId: OTHER, riderName: NAME, dlNumber: FULL.dl, dob: '1994-03-12' });
  check('licence: without Aadhaar a typed date of birth is used', r.status === 'verified' && calls.at(-1)!.body.dob === '1994-03-12', r);

  // ---- vehicle RC ----
  ({ store, service } = mk());
  r = await service.verifyVehicleRc({ riderId: RIDER, riderName: NAME, vehicleNumber: 'mh 24 ab 1234' });
  check('rc valid: active registration, owner is the rider, details for operations', r.status === 'verified' && r.numberMasked === 'MH24AB1234' && r.details.ownerIsRider === true && r.details.model === 'Hero Splendor', r);
  fake.rcOwner = 'RAMESH KUMAR'; r = await service.verifyVehicleRc({ riderId: RIDER, riderName: NAME, vehicleNumber: 'MH24AB1234' });
  check('rc rented: another owner is allowed (ownerIsRider false)', r.status === 'verified' && r.details.ownerIsRider === false, r);
  fake.rcExpiry = '2020-05-05'; r = await service.verifyVehicleRc({ riderId: RIDER, riderName: NAME, vehicleNumber: 'MH24AB1234' });
  check('rc expired: rejected', r.status === 'rejected' && r.expiresOn === '2020-05-05', r);
  fake.rcExpiry = '2040-01-01'; fake.rcState = 'SUSPENDED'; r = await service.verifyVehicleRc({ riderId: RIDER, riderName: NAME, vehicleNumber: 'MH24AB1234' });
  check('rc suspended: rejected', r.status === 'rejected', r);
  fake.rcState = 'ACTIVE'; fake.rcStatus = 'INVALID'; r = await service.verifyVehicleRc({ riderId: RIDER, riderName: NAME, vehicleNumber: 'MH24AB1234' });
  check('rc not found: rejected', r.status === 'rejected', r);
  await refused('rc: a malformed registration is refused: 400', 400, 'validation', () => service.verifyVehicleRc({ riderId: RIDER, riderName: NAME, vehicleNumber: 'ABC' }));
  reset();

  // ---- selfie ----
  const selfie = (s = service, rider = RIDER) => s.verifySelfie({ riderId: rider, image: new Uint8Array(JPEG) as Uint8Array<ArrayBuffer> });
  ({ store, service } = mk());
  await refused('selfie: not an image: 400', 400, 'validation', () => service.verifySelfie({ riderId: RIDER, image: new Uint8Array([1, 2, 3, 4, 5]) as Uint8Array<ArrayBuffer> }));
  await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
  await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  fake.liveness = false;
  r = await selfie();
  check('selfie liveness failed: rejected, no face match attempted', r.status === 'rejected' && callsTo('/face-match') === 0 && /live selfie/.test(r.reason ?? ''), r);
  fake.liveness = true; fake.match = 'NO';
  r = await selfie();
  check('selfie face mismatch: rejected, the Aadhaar photo is kept for the retake', r.status === 'rejected' && /does not match/.test(r.reason ?? '') && !!store.profiles.get(RIDER)!.aadhaarPhotoEnc, r);
  fake.match = 'YES';
  r = await selfie();
  const fm = calls.filter(c => c.path === '/face-match').at(-1)!;
  check('selfie face match: verified; both pictures and the threshold were sent', r.status === 'verified' && fm.body.threshold === '0.75' && /^file:image\/jpeg:/.test(fm.body.first_image) && /^file:image\/jpeg:/.test(fm.body.second_image), { r, body: fm.body });
  prof = store.profiles.get(RIDER)!;
  check('selfie face match: the Aadhaar photo is deleted right after the match; scores kept', prof.aadhaarPhotoEnc === null && prof.aadhaarPhotoAt === null && prof.faceMatchScore === 0.91 && !!prof.selfieVerifiedAt, prof);
  r = await selfie();
  check('selfie: a second try after the match needs no photo: a person decides (pending)', r.status === 'pending', r);

  // the 24 hour rule
  reset(); ({ store, service } = mk());
  await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
  await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  clock += 23 * 3600_000;
  r = await selfie();
  check('photo 24 h: still compared at 23 hours', r.status === 'verified', r);
  reset(); ({ store, service } = mk());
  await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
  await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  clock += 25 * 3600_000;
  check('photo 24 h: the stored photo is still there before anyone calls the engine', !!store.profiles.get(RIDER)!.aadhaarPhotoEnc);
  r = await selfie();
  check('photo 24 h: at 25 hours it is gone, no face match is made, a person decides', r.status === 'pending' && callsTo('/face-match') === 0 && store.profiles.get(RIDER)!.aadhaarPhotoEnc === null && store.profiles.get(RIDER)!.aadhaarPhotoAt === null, r);
  clock -= 25 * 3600_000;
  reset(); ({ store, service } = mk());
  await service.startDigilocker({ riderId: RIDER, returnUrlBase: base });
  await service.completeDigilocker({ riderId: RIDER, riderName: NAME });
  await service.startDigilocker({ riderId: OTHER, returnUrlBase: base }); // any KYC call purges stale photos
  clock += 25 * 3600_000;
  await service.startDigilocker({ riderId: OTHER, returnUrlBase: base });
  check('photo 24 h: any KYC call clears every photo older than 24 hours', store.profiles.get(RIDER)!.aadhaarPhotoEnc === null);
  clock -= 25 * 3600_000;
  reset(); ({ store, service } = mk());
  r = await selfie();
  check('selfie before Aadhaar: liveness only, pending with a plain reason', r.status === 'pending' && /once Aadhaar is verified/.test(r.reason ?? '') && callsTo('/face-match') === 0, r);
  fake.down = 500;
  await refused('selfie: Cashfree down: 502 provider_error', 502, 'provider_error', () => selfie());
  reset();

  // ---- limits and failures ----
  ({ store, service } = mk({ attemptsPerDay: 2 }));
  await service.verifyPan({ riderId: RIDER, riderName: NAME, pan: FULL.pan });
  await service.verifyPan({ riderId: RIDER, riderName: NAME, pan: FULL.pan });
  const callsBefore = calls.length;
  await refused('limit: the third PAN check in a day: 429 rate_limited, Cashfree not called', 429, 'rate_limited', () => service.verifyPan({ riderId: RIDER, riderName: NAME, pan: FULL.pan }));
  check('limit: the refusal made no Cashfree call', calls.length === callsBefore);
  r = await service.verifyPan({ riderId: OTHER, riderName: NAME, pan: FULL.pan });
  check('limit: it is per rider', r.status === 'verified');
  clock += 25 * 3600_000;
  r = await service.verifyPan({ riderId: RIDER, riderName: NAME, pan: FULL.pan });
  check('limit: the next day it works again', r.status === 'verified', r); clock -= 25 * 3600_000;
  fake.down = 503;
  ({ store, service } = mk());
  await refused('pan: Cashfree 5xx: 502 provider_error (try again later), recorded as an error not a rejection', 502, 'provider_error', () => service.verifyPan({ riderId: RIDER, riderName: NAME, pan: FULL.pan }));
  check('pan: the error is in the audit trail with no number', store.checks.length === 1 && store.checks[0].status === 'error' && !JSON.stringify(store.checks).includes('ABCDE'));
  reset();
  fake.down = 404;
  r = await mk().service.verifyPan({ riderId: RIDER, riderName: NAME, pan: FULL.pan });
  check('pan: Cashfree 404 means "not found": rejected, not an outage', r.status === 'rejected', r);
  reset();

  // ---- the signed request, keys, names ----
  const kp = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' }, true, ['encrypt', 'decrypt']);
  const pem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(await crypto.subtle.exportKey('spki', kp.publicKey)).toString('base64')}\n-----END PUBLIC KEY-----`;
  const sig = await cashfreeSignature(CLIENT, pem.replace(/\n/g, '\\n'), 1_760_000_000);
  const plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, kp.privateKey, Buffer.from(sig, 'base64')));
  check('signature: x-cf-signature is the client id and the time, RSA-OAEP encrypted with the public key (PEM with \\n accepted)', plain === `${CLIENT}.1760000000`, plain);
  await createSecureIdClient({ environment: 'sandbox', clientId: CLIENT, clientSecret: SECRET, publicKeyPem: pem, now: () => 1_760_000_000_000, fetch: cashfree }).verifyPan({ pan: FULL.pan });
  check('signature: sent on every call when a public key is set', !!calls.at(-1)!.headers['x-cf-signature']);
  const net = await createSecureIdClient({ environment: 'sandbox', clientId: CLIENT, clientSecret: SECRET, fetch: async () => { throw new Error(`boom ${SECRET}`); } }).verifyPan({ pan: FULL.pan });
  check('network error: returned, never thrown, and it does not carry the secret', !net.ok && net.status === 0 && !JSON.stringify(net).includes(SECRET), net);
  check('payload key: 32 bytes in base64 only', isPayloadKey(PAYLOAD_KEY) && !isPayloadKey('short') && !isPayloadKey(randomBytes(16).toString('base64')));
  check('encrypt: two encryptions of the same value differ (random IV)', (await encryptJson(PAYLOAD_KEY, 'x')) !== (await encryptJson(PAYLOAD_KEY, 'x')));
  check('names: initials and titles match; a stranger does not', matchNames('Asha Patil', 'ASHA K PATIL').result === 'good' && matchNames('Mr Rahul Sharma', 'RAHUL SHARMA').result === 'good' && matchNames('Asha Patil', 'RAMESH KUMAR').result === 'poor');
  check('errors: a KycError carries its status and code', new KycError('rate_limited', 'x', 429).status === 429);

  // =============== B. the routes against the local database ===============
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const { db } = await import('../server/db');
  Object.assign(process.env, { SUPABASE_URL: localEnv.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: localEnv.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY: localEnv.SUPABASE_ANON_KEY, SUPABASE_PUBLISHABLE_KEY: localEnv.SUPABASE_PUBLISHABLE_KEY });
  const d = db();
  const R = async (p: string) => import(`../app/api/${p}+api`);
  const route = {
    register: await R('rider/register'), start: await R('rider/kyc/digilocker/start'), status: await R('rider/kyc/digilocker/status'), back: await R('rider/kyc/digilocker/return'),
    docs: await R('rider/kyc/documents'), pan: await R('rider/kyc/pan'), dl: await R('rider/kyc/driving-licence'), rc: await R('rider/kyc/vehicle-rc'), selfie: await R('rider/kyc/selfie'),
    uploads: await R('rider/uploads'),
  };
  const EMAIL = (n: string) => `zz-kyc-${n}@example.test`;
  const names = ['a', 'b', 'c', 'd', 'e'];
  const list = (await d.auth.admin.listUsers({ perPage: 1000 })).data.users;
  const users: Record<string, string> = {};
  for (const [i, n] of names.entries()) {
    const found = list.find(u => u.email === EMAIL(n));
    users[n] = found ? found.id : (await d.auth.admin.createUser({ email: EMAIL(n), phone: `91990001000${i}`, email_confirm: true, phone_confirm: true })).data.user!.id;
  }
  const jwt = (id: string) => { const t = `token-${id}-`.padEnd(60, 'x'); tokenToUser.set(t, id); return t; };
  const as = (uid: string | null, url: string, method = 'GET', body?: unknown) =>
    new Request(`http://localhost/api/${url}`, { method, headers: { ...(uid ? { authorization: `Bearer ${jwt(uid)}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const go = async (handler: any, req: Request) => { const res: Response = await handler(req, {}); const text = await res.text(); let body: any; try { body = JSON.parse(text); } catch { body = text; } return { status: res.status, body, headers: res.headers }; };
  const realNow = Date.now.bind(Date); let skew = 0;
  Date.now = () => realNow() + skew;
  const freshRateWindow = () => { skew += 61_000; };

  async function cleanup() {
    const rids = (must(await d.from('riders').select('id').in('user_id', Object.values(users))) as any[]).map(r => r.id as string);
    if (rids.length) {
      const assets = (must(await d.from('delivery_assets').select('storage_path').in('rider_id', rids)) as any[]).map(a => a.storage_path);
      if (assets.length) await d.storage.from('rider-uploads').remove(assets);
      await d.from('rider_documents').delete().in('rider_id', rids);
      await d.from('riders').update({ photo_asset_id: null, rc_asset_id: null }).in('id', rids);
      await d.from('delivery_assets').delete().in('rider_id', rids);
      await d.from('riders').delete().in('id', rids);   // kyc_profiles and kyc_checks go with the rider (on delete cascade)
    }
  }
  await cleanup();
  const KEYS = { CASHFREE_SECURE_ID_CLIENT_ID: CLIENT, CASHFREE_SECURE_ID_CLIENT_SECRET: SECRET, KYC_PAYLOAD_KEY: PAYLOAD_KEY };
  const keys = (on: boolean, extra: Record<string, string> = {}) => {
    for (const k of Object.keys(KEYS)) delete process.env[k];
    for (const k of ['CASHFREE_SECURE_ID_ENV', 'KYC_ATTEMPTS_PER_DAY', 'KYC_APP_RETURN_URL', 'KYC_PUBLIC_BASE_URL']) delete process.env[k];
    if (on) Object.assign(process.env, KEYS, extra);
  };
  const register = async (n: string, fullName: string) => { const x = await go(route.register.POST, as(users[n], 'rider/register', 'POST', { full_name: fullName })); if (x.status !== 200) throw new Error(JSON.stringify(x)); return x.body.rider_id as string; };
  const up = async (n: string, kind: string) => {
    const x = await go(route.uploads.POST, as(users[n], 'rider/uploads', 'POST', { kind, content_type: 'image/jpeg' }));
    const p = await realFetch(x.body.upload_url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: JPEG }); if (!p.ok) throw new Error('upload failed ' + await p.text());
    return x.body.asset_id as string;
  };
  const docsOf = async (rid: string, kind?: string) => { const q = d.from('rider_documents').select('*').eq('rider_id', rid).order('created_at'); return must(await (kind ? q.eq('kind', kind) : q)) as any[]; };
  const post = (n: string, handler: any, url: string, body: unknown) => go(handler.POST, as(users[n], url, 'POST', body));

  const rA = await register('a', 'Asha Patil'), rB = await register('b', 'Asha Patil');
  await register('c', 'Asha Patil'); await register('d', 'Asha Patil'); // riders c and d only meet the limits
  const rE = await register('e', 'Asha Patil');

  // ---- no keys, partial keys, wrong keys ----
  keys(false); reset();
  let x = await post('a', route.start, 'rider/kyc/digilocker/start', {});
  check('no keys: digilocker start: 501 provider_not_configured, same words as before', x.status === 501 && x.body.code === 'provider_not_configured' && x.body.detail === 'DigiLocker verification is not available yet. Please upload your documents instead.', x);
  x = await post('a', route.docs, 'rider/kyc/documents', { kind: 'aadhaar', source: 'digilocker', verification_id: 'v1' });
  check('no keys: DigiLocker document: 501 provider_not_configured, same words as before', x.status === 501 && x.body.code === 'provider_not_configured' && x.body.detail === 'DigiLocker verification is not available yet. Please upload the document instead.', x);
  x = await go(route.status.GET, as(users.a, 'rider/kyc/digilocker/status?verification_id=v1'));
  check('no keys: digilocker status: 501', x.status === 501 && x.body.code === 'provider_not_configured', x);
  for (const [name, h, body] of [['pan', route.pan, { number: FULL.pan }], ['driving-licence', route.dl, { number: FULL.dl }], ['vehicle-rc', route.rc, {}], ['selfie', route.selfie, { asset_id: crypto.randomUUID() }]] as const) {
    x = await post('a', h, `rider/kyc/${name}`, body);
    check(`no keys: kyc/${name}: 501 provider_not_configured`, x.status === 501 && x.body.code === 'provider_not_configured', x);
  }
  x = await go(route.back.GET, new Request('http://localhost/api/rider/kyc/digilocker/return?v=ol_aadhaar_x'));
  check('no keys: the DigiLocker return address is not found', x.status === 404, x);
  x = await post('a', route.docs, 'rider/kyc/documents', { kind: 'pan', number: FULL.pan, source: 'upload' });
  check('no keys: a PAN number without a file: 400 "upload the document first" (unchanged)', x.status === 400 && /upload the document first/.test(x.body.detail), x);
  const selfieA = await up('a', 'selfie');
  x = await post('a', route.docs, 'rider/kyc/documents', { kind: 'selfie', source: 'upload', asset_id: selfieA });
  check('no keys: a selfie upload is saved pending for a person (unchanged)', x.status === 200 && x.body.status === 'pending' && x.body.source === 'upload', x);
  check('no keys: nothing in Cashfree was called and no KYC row was made', calls.length === 0 && must(await d.from('kyc_profiles').select('rider_id').eq('rider_id', rA)).length === 0 && must(await d.from('kyc_checks').select('id').eq('rider_id', rA)).length === 0);
  check('no keys: the pending upload has no verification id (a person checks it)', (await docsOf(rA, 'selfie'))[0].verification_id === null);
  Object.assign(process.env, { CASHFREE_SECURE_ID_CLIENT_ID: CLIENT, CASHFREE_SECURE_ID_CLIENT_SECRET: SECRET });
  x = await post('a', route.start, 'rider/kyc/digilocker/start', {});
  check('partial keys (no KYC_PAYLOAD_KEY): still 501 provider_not_configured', x.status === 501 && x.body.code === 'provider_not_configured', x);
  keys(true, { KYC_PAYLOAD_KEY: 'not-a-key' });
  x = await post('a', route.start, 'rider/kyc/digilocker/start', {});
  check('wrong payload key: 503 kyc_misconfigured, and the answer names no variable value', x.status === 503 && x.body.code === 'kyc_misconfigured' && !JSON.stringify(x.body).includes('not-a-key'), x);
  const upl = await up('a', 'aadhaar');
  x = await post('a', route.docs, 'rider/kyc/documents', { kind: 'aadhaar', source: 'upload', asset_id: upl });
  check('wrong payload key: uploads still work (pending)', x.status === 200 && x.body.status === 'pending', x);
  keys(true, { CASHFREE_SECURE_ID_ENV: 'production' });
  x = await post('a', route.start, 'rider/kyc/digilocker/start', {});
  check('environment that does not match the secret: 503 kyc_misconfigured', x.status === 503 && x.body.code === 'kyc_misconfigured', x);
  await d.from('rider_documents').delete().eq('rider_id', rA);

  // ---- keys on: rider A, the whole journey ----
  keys(true); freshRateWindow();
  const logged: string[] = []; const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(saved) as (keyof typeof saved)[]) console[k] = (...a: any[]) => { logged.push(a.map(String).join(' ')); };
  x = await post('a', route.start, 'rider/kyc/digilocker/start', {});
  const vidA = x.body.verification_id as string;
  check('start: 200 with the DigiLocker address and a verification id', x.status === 200 && x.body.redirect_url.startsWith('https://digilocker.example.test/') && /^ol_aadhaar_/.test(vidA), x);
  check('start: Cashfree is told to send the rider back to this server\'s return address', calls.find(c => c.path === '/digilocker' && c.method === 'POST')!.body.redirect_url === `http://localhost/api/rider/kyc/digilocker/return?v=${vidA}`);
  x = await post('a', route.start, 'rider/kyc/digilocker/start', { rider_id: rB });
  check('start: a rider_id in the body changes nothing: the session is the signed-in rider\'s own', x.status === 200 && (await db().from('kyc_profiles').select('digilocker_verification_id').eq('rider_id', rB)).data?.length === 0, x);
  const vidA2 = x.body.verification_id as string;
  fake.digilocker = 'PENDING';
  x = await post('a', route.docs, 'rider/kyc/documents', { kind: 'aadhaar', source: 'digilocker', verification_id: vidA2 });
  check('documents: DigiLocker still open: pending, and nothing stored as a document yet', x.status === 200 && x.body.status === 'pending' && x.body.source === 'digilocker' && (await docsOf(rA, 'aadhaar')).length === 0, x);
  fake.digilocker = 'AUTHENTICATED';
  x = await go(route.status.GET, as(users.a, `rider/kyc/digilocker/status?verification_id=${vidA2}`));
  check('status: verified, masked Aadhaar, source digilocker', x.status === 200 && x.body.kind === 'aadhaar' && x.body.status === 'verified' && x.body.number_masked === 'XXXX XXXX 9012' && x.body.source === 'digilocker' && x.body.rejection_reason === null, x);
  const docId = x.body.id;
  x = await post('a', route.docs, 'rider/kyc/documents', { kind: 'aadhaar', source: 'digilocker', verification_id: vidA2 });
  check('documents: the same session again: the same document, no second row', x.status === 200 && x.body.id === docId && (await docsOf(rA, 'aadhaar')).length === 1, x);
  fake.digilocker = 'CONSENT_DENIED';
  x = await go(route.status.GET, as(users.a, `rider/kyc/digilocker/status?verification_id=${vidA2}`));
  check('status: a later "denied" does not downgrade a verified document', x.status === 200 && x.body.status === 'verified', x);
  fake.digilocker = 'AUTHENTICATED';
  const aadhaarRow = (await docsOf(rA, 'aadhaar'))[0];
  check('rider_documents: aadhaar verified, digilocker, verification id, masked, no rejection reason', aadhaarRow.status === 'verified' && aadhaarRow.source === 'digilocker' && aadhaarRow.verification_id === vidA2 && aadhaarRow.number_masked === 'XXXX XXXX 9012' && aadhaarRow.rejection_reason === null, aadhaarRow);
  check('riders: date of birth from the verified Aadhaar', must(await d.from('riders').select('dob').eq('id', rA))[0].dob === '1994-03-12');
  x = await post('a', route.start, 'rider/kyc/digilocker/start', {});
  check('start: a rider whose Aadhaar is verified cannot start again: 409 already_verified', x.status === 409 && x.body.code === 'already_verified', x);

  x = await post('a', route.docs, 'rider/kyc/documents', { kind: 'pan', number: ' abcde1234f ', source: 'upload' });
  check('documents: PAN number: verified by Cashfree, masked, no file needed', x.status === 200 && x.body.kind === 'pan' && x.body.status === 'verified' && x.body.number_masked === 'ABXXXXX34F' && x.body.source === 'upload', x);
  const panRow = (await docsOf(rA, 'pan'))[0];
  check('rider_documents: pan verified with a verification id', panRow.status === 'verified' && !!panRow.verification_id && panRow.asset_id === null, panRow);
  freshRateWindow();
  x = await post('a', route.pan, 'rider/kyc/pan', { number: FULL.pan });
  check('kyc/pan: the dedicated route gives the same kind of answer (a new attempt is a new row)', x.status === 200 && x.body.status === 'verified' && (await docsOf(rA, 'pan')).length === 2, x);

  const selfieAsset = await up('a', 'selfie');
  x = await post('a', route.docs, 'rider/kyc/documents', { kind: 'selfie', source: 'upload', asset_id: selfieAsset });
  check('documents: selfie: liveness and face match with the Aadhaar photo: verified, the file is kept on the document', x.status === 200 && x.body.status === 'verified' && x.body.asset_id === selfieAsset, x);
  const kp1 = must(await d.from('kyc_profiles').select('*').eq('rider_id', rA))[0];
  check('kyc_profiles: the Aadhaar photo is gone after the match; scores and masked values kept', kp1.aadhaar_photo_enc === null && kp1.aadhaar_photo_at === null && Number(kp1.face_match_score) === 0.91 && kp1.aadhaar_last4 === '9012' && kp1.pan_masked === 'ABXXXXX34F', kp1);
  const fmCall = calls.filter(c => c.path === '/face-match').at(-1)!;
  check('selfie: the uploaded picture itself went to Cashfree (not a stand-in)', fmCall.body.first_image === `file:image/jpeg:${JPEG.length}`, fmCall.body);

  freshRateWindow();
  const dlAsset = await up('a', 'dl');
  x = await post('a', route.docs, 'rider/kyc/documents', { kind: 'dl', number: 'MH14 20110012345', source: 'upload', asset_id: dlAsset });
  check('documents: licence number + photo: verified by Cashfree, masked, the photo kept', x.status === 200 && x.body.status === 'verified' && x.body.number_masked === 'MH14•••••••2345' && x.body.asset_id === dlAsset && x.body.expires_on === '2040-01-01', x);
  x = await post('a', route.rc, 'rider/kyc/vehicle-rc', { number: 'MH 24 AB 1234' });
  check('kyc/vehicle-rc: verified, expiry kept', x.status === 200 && x.body.kind === 'rc' && x.body.status === 'verified' && x.body.number_masked === 'MH24AB1234', x);
  await d.from('riders').update({ vehicle_registration_no: 'MH24AB1234' }).eq('id', rA);
  freshRateWindow();
  x = await post('a', route.rc, 'rider/kyc/vehicle-rc', {});
  check('kyc/vehicle-rc: with no number the vehicle on the application is checked', x.status === 200 && x.body.status === 'verified' && calls.filter(c => c.path === '/vehicle-rc').at(-1)!.body.vehicle_number === 'MH24AB1234', x);

  const allA = await docsOf(rA);
  const live = new Map<string, any>(); for (const r of [...allA].reverse()) live.set(r.kind, r);
  check('rider_documents: aadhaar, pan, selfie, licence and RC are all verified', ['aadhaar', 'pan', 'selfie', 'driving_licence', 'vehicle_rc'].every(k => live.get(k)?.status === 'verified'), [...live.entries()].map(([k, v]) => `${k}:${v.status}`));
  check('rider_documents: machine-verified rows carry a verification id', allA.filter(r => r.status === 'verified').every(r => !!r.verification_id));
  const everything = JSON.stringify([allA, must(await d.from('kyc_profiles').select('*').eq('rider_id', rA)), must(await d.from('kyc_checks').select('*').eq('rider_id', rA)), must(await d.from('riders').select('*').eq('id', rA))]);
  check('privacy: no full Aadhaar, PAN or licence number in rider_documents, kyc_profiles, kyc_checks or riders', ![FULL.aadhaar, FULL.pan, FULL.dl, 'MH1420110012345'].some(n => everything.includes(n)));
  Object.assign(console, saved);
  check('privacy: no full number, secret or picture in any log line', !logged.some(l => [FULL.aadhaar, FULL.pan, FULL.dl, SECRET, JPEG_B64].some(n => l.includes(n))), logged.filter(l => l.includes(FULL.pan)).slice(0, 2));
  const checksA = must(await d.from('kyc_checks').select('kind, status').eq('rider_id', rA)) as any[];
  check('kyc_checks: one audit row per Cashfree check, none for waiting', checksA.filter(c => c.kind === 'aadhaar' && c.status === 'verified').length === 1 && checksA.filter(c => c.kind === 'pan').length === 2 && checksA.some(c => c.kind === 'selfie' && c.status === 'verified'), checksA);

  // ---- rider B: not verified ----
  freshRateWindow(); reset();
  x = await post('b', route.start, 'rider/kyc/digilocker/start', {});
  const vidB = x.body.verification_id;
  fake.digilocker = 'CONSENT_DENIED';
  x = await post('b', route.docs, 'rider/kyc/documents', { kind: 'aadhaar', source: 'digilocker', verification_id: vidB });
  check('consent denied: rejected document with the plain reason, stored (a refused session is not resumed)', x.status === 200 && x.body.status === 'rejected' && /not given/.test(x.body.rejection_reason) && (await docsOf(rB, 'aadhaar'))[0].status === 'rejected', x);
  x = await post('b', route.start, 'rider/kyc/digilocker/start', {});
  const vidB2 = x.body.verification_id;
  check('consent denied: the rider can start a new session', x.status === 200 && vidB2 !== vidB, x);
  fake.digilocker = 'EXPIRED';
  x = await post('b', route.docs, 'rider/kyc/documents', { kind: 'aadhaar', source: 'digilocker', verification_id: vidB2 });
  check('expired session: rejected "start again"', x.status === 200 && x.body.status === 'rejected' && /expired/.test(x.body.rejection_reason), x);
  fake.digilocker = 'AUTHENTICATED'; fake.aadhaarName = 'Ramesh Kumar';
  x = await post('b', route.start, 'rider/kyc/digilocker/start', {}); const vidB3 = x.body.verification_id;
  x = await post('b', route.docs, 'rider/kyc/documents', { kind: 'aadhaar', source: 'digilocker', verification_id: vidB3 });
  check('wrong name on the Aadhaar: rejected', x.status === 200 && x.body.status === 'rejected' && /does not match/.test(x.body.rejection_reason), x);
  freshRateWindow();
  fake.aadhaarName = 'Asha Patil'; fake.dob = '05-05-2015';
  x = await post('b', route.start, 'rider/kyc/digilocker/start', {}); const vidB4 = x.body.verification_id;
  x = await post('b', route.docs, 'rider/kyc/documents', { kind: 'aadhaar', source: 'digilocker', verification_id: vidB4 });
  check('an Aadhaar that makes the rider under 18: rejected "between 18 and 80", masked number withheld', x.status === 200 && x.body.status === 'rejected' && /between 18 and 80/.test(x.body.rejection_reason) && x.body.number_masked === null, x);
  check('riders: the under-age date of birth was not copied to the rider, and the Aadhaar is not marked verified', must(await d.from('riders').select('dob').eq('id', rB))[0].dob === null && must(await d.from('kyc_profiles').select('aadhaar_verified_at, aadhaar_last4, dob').eq('rider_id', rB))[0].aadhaar_verified_at === null);
  x = await post('b', route.docs, 'rider/kyc/documents', { kind: 'aadhaar', source: 'digilocker', verification_id: vidB4 });
  check('under 18: asking again gives the same rejection, still one row for the session', x.status === 200 && x.body.status === 'rejected' && (await docsOf(rB, 'aadhaar')).filter(r => r.verification_id === vidB4).length === 1, x);
  x = await post('b', route.docs, 'rider/kyc/documents', { kind: 'pan', source: 'digilocker', verification_id: 'v' });
  check('digilocker for a PAN: 422 (DigiLocker gives the Aadhaar; enter the number)', x.status === 422 && x.body.code === 'validation', x);
  x = await go(route.status.GET, as(users.b, 'rider/kyc/digilocker/status?verification_id=bad%20id!'));
  check('status: a malformed verification id: 400', x.status === 400 && x.body.code === 'validation', x);
  x = await go(route.status.GET, as(users.b, `rider/kyc/digilocker/status?verification_id=${vidA2}`));
  check('status: another rider\'s session id: 404, nothing of theirs is shown', x.status === 404 && !JSON.stringify(x.body).includes('9012'), x);

  freshRateWindow(); reset();
  fake.panName = 'SOMEONE ELSEWHERE'; fake.panMatch = 'NO_MATCH';
  x = await post('b', route.docs, 'rider/kyc/documents', { kind: 'pan', number: FULL.pan, source: 'upload' });
  check('PAN of someone else: rejected, and the holder\'s name is in no answer', x.status === 200 && x.body.status === 'rejected' && !JSON.stringify(x.body).includes('SOMEONE'), x);
  reset();
  x = await post('e', route.dl, 'rider/kyc/driving-licence', { number: FULL.dl });
  check('licence: no Aadhaar and no date of birth: 400, Cashfree not called', x.status === 400 && x.body.code === 'validation' && callsTo('/driving-license') === 0, x);
  x = await post('b', route.dl, 'rider/kyc/driving-licence', { number: FULL.dl, dob: '1994-03-12' });
  check('licence: a typed date of birth works, and is kept on the rider', x.status === 200 && x.body.status === 'verified' && must(await d.from('riders').select('dob').eq('id', rB))[0].dob === '1994-03-12', x);
  x = await post('b', route.dl, 'rider/kyc/driving-licence', { number: FULL.dl, dob: '2015-01-01' });
  check('licence: a typed date of birth under 18: 400', x.status === 400 && /18 and 80/.test(x.body.detail), x);
  fake.dlTo = '2019-01-01';
  freshRateWindow();
  x = await post('b', route.docs, 'rider/kyc/documents', { kind: 'dl', number: FULL.dl, dob: '1994-03-12', source: 'upload' });
  check('licence expired: rejected with the date', x.status === 200 && x.body.status === 'rejected' && /expired on 2019-01-01/.test(x.body.rejection_reason), x);
  reset();

  // Cashfree down: a photo is kept for a person; without one the rider is told to try again
  fake.down = 503; freshRateWindow();
  const selfieB = await up('b', 'selfie');
  x = await post('b', route.docs, 'rider/kyc/documents', { kind: 'selfie', source: 'upload', asset_id: selfieB });
  check('Cashfree down: the selfie is saved as a pending upload for a person (fallback), not lost', x.status === 200 && x.body.status === 'pending' && x.body.asset_id === selfieB, x);
  check('Cashfree down: that row has no verification id (it is not software-verified)', (await docsOf(rB, 'selfie')).every(r => r.verification_id === null));
  x = await post('b', route.docs, 'rider/kyc/documents', { kind: 'pan', number: FULL.pan, source: 'upload' });
  check('Cashfree down: a PAN with no file: 502 provider_error, try again later', x.status === 502 && x.body.code === 'provider_error', x);
  x = await post('b', route.start, 'rider/kyc/digilocker/start', {});
  check('Cashfree down: DigiLocker start: 502 provider_error', x.status === 502 && x.body.code === 'provider_error', x);
  reset();

  // liveness fails / face mismatch / no Aadhaar photo
  freshRateWindow();
  const selfieB2 = await up('b', 'selfie');
  fake.liveness = false;
  x = await post('b', route.selfie, 'rider/kyc/selfie', { asset_id: selfieB2 });
  check('selfie liveness failed: rejected with a reason', x.status === 200 && x.body.status === 'rejected' && /live selfie/.test(x.body.rejection_reason), x);
  fake.liveness = true;
  x = await post('b', route.selfie, 'rider/kyc/selfie', { asset_id: selfieB2 });
  check('selfie with no verified Aadhaar yet: pending for a person (liveness passed)', x.status === 200 && x.body.status === 'pending', x);
  x = await post('b', route.selfie, 'rider/kyc/selfie', { asset_id: crypto.randomUUID() });
  check('selfie: a file that is not the rider\'s own: 404', x.status === 404, x);
  x = await post('a', route.selfie, 'rider/kyc/selfie', { asset_id: selfieB2 });
  check('selfie: another rider\'s file cannot be used: 404', x.status === 404, x);
  x = await post('b', route.selfie, 'rider/kyc/selfie', {});
  check('selfie: no asset_id: 400', x.status === 400, x);
  const docAssetB = await up('b', 'dl');
  x = await post('b', route.selfie, 'rider/kyc/selfie', { asset_id: docAssetB });
  check('selfie: a file made for another purpose: 400', x.status === 400 && x.body.code === 'validation', x);

  // ---- limits: per day (database) and per hour (server) ----
  freshRateWindow(); reset();
  keys(true, { KYC_ATTEMPTS_PER_DAY: '2' });
  for (let i = 0; i < 2; i++) { x = await post('c', route.pan, 'rider/kyc/pan', { number: FULL.pan }); check(`daily limit: PAN attempt ${i + 1} of 2 goes to Cashfree`, x.status === 200, x); }
  x = await post('c', route.pan, 'rider/kyc/pan', { number: FULL.pan });
  check('daily limit: the third PAN attempt today: 429 rate_limited', x.status === 429 && x.body.code === 'rate_limited', x);
  x = await post('c', route.dl, 'rider/kyc/driving-licence', { number: FULL.dl, dob: '1994-03-12' });
  check('daily limit: it is per check (the licence is still open)', x.status === 200, x);
  keys(true, { KYC_ATTEMPTS_PER_DAY: '100' }); freshRateWindow(); reset();
  fake.panValid = false; let lastOk = 0, firstBlocked = 0;
  for (let i = 1; i <= 22; i++) { if (i === 11) freshRateWindow(); x = await post('d', route.pan, 'rider/kyc/pan', { number: FULL.pan }); if (x.status === 200) lastOk = i; else if (!firstBlocked) firstBlocked = i; }
  check('hourly limit: 20 Cashfree checks an hour per rider, the 21st is refused with 429 and Retry-After', lastOk === 20 && firstBlocked === 21 && x.status === 429 && !!x.headers.get('retry-after'), { lastOk, firstBlocked, status: x.status });
  reset();

  // ---- the public DigiLocker return address ----
  keys(true);
  const back = (q: string) => go(route.back.GET, new Request(`http://localhost/api/rider/kyc/digilocker/return${q}`, { redirect: 'manual' } as any));
  x = await back(`?v=${vidA}`);
  check('return: 302 back into the app with the session id, no sign-in needed, no store', x.status === 302 && x.headers.get('location') === `onelocalrider://onboarding/kyc?digilocker=${vidA}` && x.headers.get('cache-control') === 'no-store', { status: x.status, loc: x.headers.get('location') });
  x = await back('?v=%3Cscript%3E');
  check('return: a malformed id is dropped, the redirect still goes to the app', x.status === 302 && x.headers.get('location') === 'onelocalrider://onboarding/kyc', x.headers.get('location'));
  x = await back('?v=a&next=https://evil.example');
  check('return: no other parameter can change where it goes', x.status === 302 && x.headers.get('location') === 'onelocalrider://onboarding/kyc?digilocker=a', x.headers.get('location'));
  keys(true, { KYC_APP_RETURN_URL: 'exp://192.168.1.5:8081/--/onboarding/kyc' });
  x = await back('?v=abc');
  check('return: KYC_APP_RETURN_URL sets the app address (Expo development)', x.headers.get('location') === 'exp://192.168.1.5:8081/--/onboarding/kyc?digilocker=abc', x.headers.get('location'));
  keys(true, { KYC_APP_RETURN_URL: 'javascript://x' });
  x = await post('a', route.pan, 'rider/kyc/pan', { number: FULL.pan });
  check('config: a script address as the app return address: 503 kyc_misconfigured', x.status === 503 && x.body.code === 'kyc_misconfigured', x);
  keys(true, { KYC_PUBLIC_BASE_URL: 'https://api.proviyaa.example' }); freshRateWindow(); reset();
  x = await post('e', route.start, 'rider/kyc/digilocker/start', {});
  check('config: KYC_PUBLIC_BASE_URL sets the address DigiLocker returns to', x.status === 200 && calls.find(c => c.path === '/digilocker')!.body.redirect_url.startsWith('https://api.proviyaa.example/api/rider/kyc/digilocker/return?v='), calls[0]?.body);

  // ---- a rider whose application is already sent in cannot change documents ----
  await d.from('riders').update({ status: 'submitted' }).eq('id', rE);
  keys(true); freshRateWindow();
  x = await post('e', route.start, 'rider/kyc/digilocker/start', {});
  check('locked application: DigiLocker start: 409 locked', x.status === 409 && x.body.code === 'locked', x);
  x = await post('e', route.pan, 'rider/kyc/pan', { number: FULL.pan });
  check('locked application: PAN check: 409 locked', x.status === 409 && x.body.code === 'locked', x);
  keys(false);
  x = await post('e', route.start, 'rider/kyc/digilocker/start', {});
  check('locked application, no keys: still 501 (unchanged)', x.status === 501, x);
  x = await post('e', route.start, 'rider/kyc/digilocker/start', {}); void x;
  const signedOut = await go(route.start.POST, as(null, 'rider/kyc/digilocker/start', 'POST', {}));
  check('no sign-in: 401', signedOut.status === 401, signedOut);

  await cleanup();
  for (const id of Object.values(users)) await d.auth.admin.deleteUser(id);
  Date.now = realNow;
  console.log(`\n${passed} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
}

main().catch(e => { originalError(e); process.exit(1); });
