// In-memory KycStore for checks and for local runs without a database.
import type { KycCheck, KycProfile, KycStore } from './types';
import { emptyProfile } from './types';

export interface MemoryKycStore extends KycStore {
  readonly profiles: Map<string, KycProfile>;
  readonly checks: KycCheck[];
}

export const createMemoryKycStore = (): MemoryKycStore => {
  const profiles = new Map<string, KycProfile>();
  const checks: KycCheck[] = [];
  return {
    profiles, checks,
    async getProfile(riderId) { const p = profiles.get(riderId); return p ? { ...p } : null; },
    async patchProfile(riderId, patch) { profiles.set(riderId, { ...(profiles.get(riderId) ?? emptyProfile(riderId, new Date().toISOString())), ...patch }); },
    async insertCheck(c) { checks.push({ ...c }); },
    async countChecks(riderId, kind, sinceIso, statuses) {
      return checks.filter(c => c.riderId === riderId && c.kind === kind && c.createdAt >= sinceIso && (!statuses?.length || statuses.includes(c.status))).length;
    },
    async purgeAadhaarPhotos(beforeIso) {
      for (const [id, p] of profiles) if (p.aadhaarPhotoEnc && p.aadhaarPhotoAt && p.aadhaarPhotoAt < beforeIso) profiles.set(id, { ...p, aadhaarPhotoEnc: null, aadhaarPhotoAt: null });
    },
  };
};
