// GET /api/rider/me: the rider's own profile for the app's start-up screen (the app's MeDto, src/api/dto.ts).
// Reads only the rider's own rows. Money is real: earnings from rider_earnings and cash in hand from the cash ledger
// (rider_cash_in_hand_minor), both kept in minor units (paise) and sent as rupees.
import { db, fromDbError, rpc } from './db';
import type { Rider } from './rider';

type Row = Record<string, any>;

// India runs on one time zone, so "today" is the IST day.
const IST_MS = 5.5 * 3_600_000;
const startOfDay = (offsetDays: number) => new Date(Math.floor((Date.now() + IST_MS) / 86_400_000 + offsetDays) * 86_400_000 - IST_MS).toISOString();

const VEHICLE_CLASS: Record<string, string> = { bike: '2w', scooter: '2w', cycle: '2w', car: '4w' };

export async function getMe(rider: Rider) {
  const [riderRow, availability, links, hub, docs] = await Promise.all([
    db().from('riders').select('*').eq('id', rider.id).single(),
    db().from('rider_availability').select('online').eq('rider_id', rider.id).maybeSingle(),
    db().from('rider_store_links').select('store_id, priority, status, ol_stores(name)').eq('rider_id', rider.id).order('priority'),
    db().from('rider_hubs').select('*').eq('rider_id', rider.id).maybeSingle(),
    db().from('rider_documents').select('id, kind, status, number_masked, asset_id, source, expires_at').eq('rider_id', rider.id),
  ]);
  for (const r of [riderRow, availability, links, hub, docs]) if (r.error) fromDbError(r.error);
  const r = riderRow.data as Row;

  const t0 = startOfDay(0), t1 = startOfDay(1), y0 = startOfDay(-1);
  const sumEarnings = async (from: string, to: string) => {
    const { data, error } = await db().from('rider_earnings').select('amount_minor').eq('rider_id', rider.id).neq('kind', 'cash_adjustment').gte('created_at', from).lt('created_at', to);
    if (error) fromDbError(error);
    return (data ?? []).reduce((n: number, e: Row) => n + Number(e.amount_minor), 0) / 100;
  };
  const deliveredBetween = async (from: string, to: string) => {
    const { count, error } = await db().from('delivery_jobs').select('id', { count: 'exact', head: true })
      .eq('rider_id', rider.id).eq('status', 'delivered').gte('delivered_at', from).lt('delivered_at', to);
    if (error) fromDbError(error);
    return count ?? 0;
  };
  const [cashMinor, todayPay, yesterdayPay, todayJobs, yesterdayJobs] = await Promise.all([
    rpc<number | null>('rider_cash_in_hand_minor', { p_rider: rider.id }),
    sumEarnings(t0, t1), sumEarnings(y0, t0), deliveredBetween(t0, t1), deliveredBetween(y0, t0),
  ]);
  const storeLinks = (links.data ?? []) as Row[];
  const h = hub.data as Row | null;

  return {
    rider: {
      id: r.id, user_id: r.user_id, phone: r.phone ?? '', full_name: r.full_name, type: r.type, status: r.status,
      photo_asset_id: r.photo_asset_id ?? undefined, email: r.email ?? undefined, language: r.language ?? undefined,
      status_reason: r.review_reason ?? undefined, city_id: r.city_id ?? undefined, zone_id: r.zone_id ?? undefined,
      organization_id: r.organization_id ?? undefined, acceptance: r.acceptance,
      categories: (r.categories ?? []) as string[], multi_store: r.multi_store ?? storeLinks.length > 1,
      store_ids: (r.store_ids as string[] | null) ?? storeLinks.map(s => s.store_id), cash_limit: r.cash_limit == null ? undefined : Number(r.cash_limit),
      created_at: r.created_at, updated_at: r.updated_at,
    },
    hub: h ? { id: `hub-${rider.id}`, zone_id: h.zone_id ?? '', kind: 'rider_start', name: 'Start hub', lat: h.lat, lng: h.lng, address: h.address ?? '', landmark: h.landmark ?? undefined } : undefined,
    vehicle: r.vehicle_registration_no ? { class: VEHICLE_CLASS[r.vehicle] ?? '2w', ownership: r.vehicle_ownership === 'rented' ? 'rent' : 'own', registration_no: r.vehicle_registration_no, rc_document_id: r.rc_asset_id ?? undefined } : undefined,
    documents: ((docs.data ?? []) as Row[]).map(d => ({ id: d.id, kind: d.kind, status: d.status, number_masked: d.number_masked, asset_id: d.asset_id, source: d.source, expires_on: d.expires_at })),
    store_links: storeLinks.map(s => ({ store_id: s.store_id, store_name: s.ol_stores?.name ?? '', organization: '', priority: s.priority, status: s.status })),
    cash_in_hand: Number(cashMinor ?? 0) / 100,
    cash_limit: Number(r.cash_limit ?? 0),
    online: availability.data?.online === true,
    today: { earnings: todayPay, jobs: todayJobs },
    yesterday: { earnings: yesterdayPay, jobs: yesterdayJobs },
  };
}
