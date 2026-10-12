// Switches the rider KYC engine on from the server's environment. Nothing here ever reaches the app, and no value is ever logged: only names.
//
//   off     one of CASHFREE_SECURE_ID_CLIENT_ID / CASHFREE_SECURE_ID_CLIENT_SECRET / KYC_PAYLOAD_KEY is missing: every route behaves as before
//           (DigiLocker answers 501 provider_not_configured, documents are uploads that a person checks).
//   broken  all three are set but something is wrong with them (the payload key is not 32 bytes in base64, the environment does not match the
//           secret): the routes answer 503 and the log names the variable.
//   ready   the engine runs.
//
// Optional: CASHFREE_SECURE_ID_PUBLIC_KEY (2FA public key, PEM, needed when the server's IP is not whitelisted at Cashfree), CASHFREE_SECURE_ID_ENV
// (sandbox | production; a cfsk_ma_test_/cfsk_ma_prod_ secret decides it by itself), CASHFREE_SECURE_ID_API_VERSION, KYC_ATTEMPTS_PER_DAY (5),
// KYC_FACE_MATCH_THRESHOLD (0.75), KYC_APP_RETURN_URL (onelocalrider://onboarding/kyc), KYC_PUBLIC_BASE_URL (else PUBLIC_BASE_URL; the address DigiLocker
// sends the rider back to).
import { isProduction } from '../env';
import { HttpError } from '../http';
import { isPayloadKey } from './crypto';
import { createSecureIdClient, environmentOfSecretKey } from './secure-id';
import type { SecureIdEnvironment } from './secure-id';
import { createKycService } from './service';
import type { KycService } from './service';
import { createDbKycStore } from './store';

export interface KycConfig {
  environment: SecureIdEnvironment;
  signed: boolean;
  // Where DigiLocker returns the rider (the app's KYC screen).
  appReturnUrl: string;
}

export type KycEngine = { state: 'off' } | { state: 'broken'; problem: string } | { state: 'ready'; config: KycConfig; service: KycService };

type Env = Record<string, string | undefined>;
const REQUIRED = ['CASHFREE_SECURE_ID_CLIENT_ID', 'CASHFREE_SECURE_ID_CLIENT_SECRET', 'KYC_PAYLOAD_KEY'] as const;
const OPTIONAL = ['CASHFREE_SECURE_ID_PUBLIC_KEY', 'CASHFREE_SECURE_ID_ENV', 'CASHFREE_SECURE_ID_API_VERSION', 'KYC_ATTEMPTS_PER_DAY', 'KYC_FACE_MATCH_THRESHOLD', 'KYC_APP_RETURN_URL'] as const;

const told = new Set<string>();
const tell = (key: string, line: string) => { if (!told.has(key)) { told.add(key); console.warn(`[kyc] ${line}`); } };

let cached: { key: string; engine: KycEngine } | null = null;

export function kycEngine(env: Env = process.env): KycEngine {
  const get = (k: string) => env[k]?.trim() || undefined;
  const key = [...REQUIRED, ...OPTIONAL].map(k => get(k) ?? '').join('\u0001');
  if (cached?.key === key) return cached.engine;
  const engine = build(get);
  cached = { key, engine };
  return engine;
}

function build(get: (k: string) => string | undefined): KycEngine {
  const missing = REQUIRED.filter(k => !get(k));
  if (missing.length === REQUIRED.length) return { state: 'off' };
  if (missing.length) {
    tell(`partial:${missing.join()}`, `rider KYC is OFF: ${missing.join(', ')} not set (all of ${REQUIRED.join(', ')} are needed).`);
    return { state: 'off' };
  }
  const clientId = get('CASHFREE_SECURE_ID_CLIENT_ID')!, clientSecret = get('CASHFREE_SECURE_ID_CLIENT_SECRET')!, payloadKey = get('KYC_PAYLOAD_KEY')!;
  const broken = (problem: string): KycEngine => { tell(`broken:${problem}`, `rider KYC is BROKEN: ${problem}`); return { state: 'broken', problem }; };
  if (!isPayloadKey(payloadKey)) return broken('KYC_PAYLOAD_KEY must be 32 random bytes, base64 encoded (openssl rand -base64 32)');
  const fromKey = environmentOfSecretKey(clientSecret);
  const declared = get('CASHFREE_SECURE_ID_ENV')?.toLowerCase();
  if (declared && declared !== 'sandbox' && declared !== 'production') return broken('CASHFREE_SECURE_ID_ENV must be sandbox or production');
  if (fromKey && declared && fromKey !== declared) return broken(`CASHFREE_SECURE_ID_ENV=${declared} but CASHFREE_SECURE_ID_CLIENT_SECRET is a ${fromKey} key`);
  const environment: SecureIdEnvironment = fromKey ?? (declared as SecureIdEnvironment | undefined) ?? 'sandbox';
  if (isProduction() && environment === 'sandbox' && !declared && !fromKey) tell('sandbox-default', 'CASHFREE_SECURE_ID_ENV is not set and the secret does not say: using the Cashfree SANDBOX.');
  const appReturnUrl = get('KYC_APP_RETURN_URL') ?? 'onelocalrider://onboarding/kyc';
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^\s]*$/i.test(appReturnUrl) || /^(javascript|data|file):/i.test(appReturnUrl)) return broken('KYC_APP_RETURN_URL must be an app or web address such as onelocalrider://onboarding/kyc');

  const attempts = Number(get('KYC_ATTEMPTS_PER_DAY') ?? 5);
  const threshold = Number(get('KYC_FACE_MATCH_THRESHOLD') ?? 0.75);
  const publicKeyPem = get('CASHFREE_SECURE_ID_PUBLIC_KEY');
  const service = createKycService({
    store: createDbKycStore(),
    secureId: createSecureIdClient({ environment, clientId, clientSecret, publicKeyPem, apiVersion: get('CASHFREE_SECURE_ID_API_VERSION') }),
    payloadKey,
    attemptsPerDay: Number.isFinite(attempts) && attempts >= 1 ? Math.floor(attempts) : 5,
    faceMatchThreshold: Number.isFinite(threshold) && threshold > 0 && threshold < 1 ? threshold : 0.75,
    log: (event, data) => console.log(JSON.stringify({ event, ...data })),
  });
  return { state: 'ready', config: { environment, signed: !!publicKeyPem, appReturnUrl }, service };
}

// The ready engine, or the error the route should answer with. `off` is the unchanged 501.
export function readyEngine(offMessage = 'DigiLocker verification is not available yet. Please upload your documents instead.'): { service: KycService; config: KycConfig } {
  const e = kycEngine();
  if (e.state === 'ready') return e;
  if (e.state === 'broken') throw new HttpError(503, 'Verification is not set up correctly. Please upload your documents instead.', undefined, 'kyc_misconfigured');
  throw new HttpError(501, offMessage, undefined, 'provider_not_configured');
}

// The server's public address, where DigiLocker sends the rider back: /api/rider/kyc/digilocker/return lives here.
// In production it must be configured (a Host header is not a trustworthy address to send people to); elsewhere the request's own origin does.
export function kycPublicBase(request: Request, env: Env = process.env): string {
  const configured = (env.KYC_PUBLIC_BASE_URL ?? env.PUBLIC_BASE_URL)?.trim();
  let base: string | undefined;
  if (configured) { try { base = new URL(configured).origin; } catch { /* handled below */ } }
  if (!base && !isProduction()) base = new URL(request.url).origin;
  if (!base) throw new HttpError(503, 'Verification is not set up correctly. Please upload your documents instead.', undefined, 'kyc_misconfigured');
  return `${base}/api/rider/kyc`;
}
