// Live/coming-soon switches from GET /api/features (server/features.ts). Until the answer arrives
// every optional feature counts as off, so nothing half-works while the app is starting.
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Features = { ai_search: boolean; assistant: boolean; maps: boolean; online_payments: boolean; wallet: boolean; coins: boolean; google_sign_in: boolean };
const OFF: Features = { ai_search: false, assistant: false, maps: false, online_payments: false, wallet: false, coins: false, google_sign_in: false };

export function useFeatures(): Features {
  const { data } = useQuery({ queryKey: ['features'], queryFn: () => api<Features>('/features'), staleTime: 60_000 });
  return data ?? OFF;
}
