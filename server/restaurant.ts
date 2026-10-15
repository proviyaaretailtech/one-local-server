// Restaurant side of One Local orders (VINII Partner). All state changes go through the
// atomic database functions in db/migrations/0023; this file only reads and shapes data.
import { db, fromDbError, rpc } from './db';
import { pickupStatus } from './pickup-location';
import { HttpError } from './http';
import { pushToRestaurant } from './push';
import { onRestaurantAccepted, onRestaurantRejected } from './dispatch';
import type { Staff } from './partner';

export type Tab = 'new' | 'preparing' | 'ready' | 'past';
const TAB_STATUSES: Record<Tab, string[]> = {
  new: ['placed'], preparing: ['accepted'], ready: ['packed', 'out'], past: ['delivered', 'cancelled'],
};

const ORDER_FIELDS =
  'id, status, total, subtotal, gst, delivery_fee, prep_minutes, eta_minutes, restaurant_deadline, cancel_reason, created_at, items, delivery_address, payment_method, payment_status, ' +
  'orders!inner(id, display_no, status, updated_at, customer_name, customer_phone, notes, total, created_at, order_items(name, qty, unit_price, notes, status))';

type Row = Record<string, any>;

// How the customer pays, as staff should read it (SRV-4). This used to say "Cash on delivery" for every order, online ones too, which
// sent staff to collect cash that had already been paid.
const METHOD_NAME: Record<string, string> = { upi: 'UPI', card: 'card', netbanking: 'net banking', wallet: 'wallet', paylater: 'Pay Later', emi: 'EMI', cardless_emi: 'cardless EMI' };
function paymentLabel(row: Row): string {
  if (row.payment_method === 'cod') return row.payment_status === 'paid' ? 'Cash collected' : 'Cash on delivery';
  if (row.payment_status === 'paid') return `Paid online${METHOD_NAME[row.payment_method] ? ` (${METHOD_NAME[row.payment_method]})` : ''}`;
  if (row.payment_status === 'refunded') return 'Refunded';
  return 'Online payment not completed';
}

// What staff see. Customer phone and full address only while the order is active (PRD §6).
function shape(row: Row) {
  const pos = row.orders;
  const active = ['accepted', 'packed', 'out'].includes(row.status);
  const address = row.delivery_address ?? null;
  return {
    id: pos.id,
    one_local_id: row.id,
    display_no: pos.display_no,
    status: row.status,
    pos_status: pos.status,
    version: pos.updated_at,
    placed_at: row.created_at,
    deadline: row.restaurant_deadline,
    seconds_left: row.restaurant_deadline ? Math.max(0, Math.round((Date.parse(row.restaurant_deadline) - Date.now()) / 1000)) : null,
    customer_name: (pos.customer_name ?? 'Customer').split(' ')[0],
    customer_phone: active ? pos.customer_phone : null,
    address: active ? address : address ? { area: address.area ?? address.locality ?? null } : null,
    notes: pos.notes,
    items: (pos.order_items ?? []).map((i: Row) => ({ name: i.name, qty: i.qty, price: Number(i.unit_price), notes: i.notes })),
    item_count: (pos.order_items ?? []).reduce((n: number, i: Row) => n + i.qty, 0),
    subtotal: Number(row.subtotal), gst: Number(row.gst), delivery_fee: Number(row.delivery_fee), total: Number(row.total),
    payment: paymentLabel(row),
    payment_method: row.payment_method ?? 'cod', payment_status: row.payment_status ?? 'not_charged',
    collect_cash: (row.payment_method ?? 'cod') === 'cod' && row.payment_status !== 'paid', // false for an order already paid online: no cash is taken at the door
    prep_minutes: row.prep_minutes,
    cancel_reason: row.cancel_reason,
  };
}

export async function listOrders(staff: Staff, tab: Tab) {
  await rpc('ol_expire_unanswered', { p_org: staff.organizationId });
  let query = db().from('ol_orders').select(ORDER_FIELDS).eq('organization_id', staff.organizationId).in('status', TAB_STATUSES[tab]);
  query = tab === 'past'
    ? query.gte('created_at', new Date(Date.now() - 3 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(50)
    : query.order('created_at', { ascending: true }).limit(100);
  const { data, error } = await query;
  if (error) fromDbError(error);
  return (data ?? []).map(shape);
}

export async function counts(staff: Staff) {
  const { data, error } = await db().from('ol_orders').select('status').eq('organization_id', staff.organizationId)
    .in('status', ['placed', 'accepted', 'packed', 'out']);
  if (error) fromDbError(error);
  const c = { new: 0, preparing: 0, ready: 0 };
  for (const r of data ?? []) {
    if (r.status === 'placed') c.new++; else if (r.status === 'accepted') c.preparing++; else c.ready++;
  }
  return c;
}

export async function getOrder(staff: Staff, posOrderId: string) {
  const { data, error } = await db().from('ol_orders').select(ORDER_FIELDS).eq('organization_id', staff.organizationId)
    .eq('pos_order_id', posOrderId).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw new HttpError(404, 'Order not found');
  const { data: events } = await db().from('order_events').select('kind, message, created_at').eq('order_id', posOrderId).order('created_at');
  return { ...shape(data), events: events ?? [] };
}

export async function act(staff: Staff, posOrderId: string, action: 'accept' | 'reject' | 'ready' | 'out' | 'delivered', body: Row) {
  // Make sure the order belongs to this restaurant before touching it.
  const { data } = await db().from('orders').select('organization_id').eq('id', posOrderId).maybeSingle();
  if (!data || data.organization_id !== staff.organizationId) throw new HttpError(404, 'Order not found');
  if (typeof body.version !== 'string') throw new HttpError(400, 'Refresh the order and try again.');
  if (action === 'delivered') {
    // Marking an order delivered books the full total as CASH collected (ol_partner_act). For an order the customer already paid online that
    // would record the same money twice and send staff to collect it again, so it is refused here until the database function learns to book
    // an online order correctly (db-requests-server.md). A delivery by a rider is closed by the rider's proof, which books it right.
    const { data: paid, error } = await db().from('ol_orders').select('payment_method, payment_status').eq('pos_order_id', posOrderId).maybeSingle();
    if (error) fromDbError(error);
    if (paid && !(paid.payment_method === 'cod' && paid.payment_status !== 'paid')) {
      throw new HttpError(409, 'This order is already paid, so there is no cash to collect and it cannot be closed from here yet. The rider closes it when they hand it over.', undefined, 'already_paid');
    }
  }
  await rpc('ol_partner_act', {
    p_order: posOrderId, p_action: action, p_actor: staff.userId, p_actor_name: staff.name, p_expected: body.version,
    p_prep: action === 'accept' ? Number(body.prep_minutes) : null,
    p_reason: action === 'reject' ? String(body.reason ?? '').slice(0, 200) : null,
  });
  // Dispatch follows the kitchen: an accept releases a job held for it, a reject withdraws the job and
  // any rider offer (a timeout is caught by the dispatch sweep). Dispatch problems never undo the action.
  if (action === 'accept') await onRestaurantAccepted(posOrderId, Number(body.prep_minutes));
  if (action === 'reject') await onRestaurantRejected(posOrderId, String(body.reason ?? ''));
  return getOrder(staff, posOrderId);
}

// ---------- Outlet (accepting One Local orders) ----------
export async function getOutlet(staff: Staff) {
  const [{ data, error }, pickup, { data: org, error: orgError }] = await Promise.all([
    db().from('ol_merchant_channels').select('*').eq('organization_id', staff.organizationId).maybeSingle(),
    pickupStatus(staff.organizationId),
    db().from('organizations').select('control_status').eq('id', staff.organizationId).maybeSingle(),
  ]);
  if (error) fromDbError(error);
  if (orgError) fromDbError(orgError);
  // pickup_location.status drives the "Set your pickup location" banner. null pickup = no 0341 table: judge by the coordinates alone.
  const pickup_location = { status: pickup ?? (data?.lat != null && data?.lng != null ? 'verified' : 'missing') };
  // A store made when the partner signed up is Pending until operations approves it (migration 0345); it cannot take orders yet.
  const approval_status = org?.control_status === 'Pending' ? 'pending' : org?.control_status === 'Rejected' ? 'rejected' : 'approved';
  return data
    ? { accepting: data.accepting, back_at: data.back_at, default_prep_minutes: data.default_prep_minutes, accept_window_seconds: data.accept_window_seconds, missed_in_a_row: data.missed_in_a_row, address: data.address, set_up: true, pickup_location, approval_status }
    : { accepting: false, back_at: null, default_prep_minutes: 20, accept_window_seconds: 60, missed_in_a_row: 0, address: null, set_up: false, pickup_location, approval_status };
}

export async function setOutlet(staff: Staff, body: Row) {
  if (typeof body.accepting !== 'boolean') throw new HttpError(400, 'Say whether you are accepting orders.');
  const back = body.accepting ? null : typeof body.back_at === 'string' ? body.back_at : null;
  const { data, error } = await db().from('ol_merchant_channels')
    .update({ accepting: body.accepting, back_at: back, missed_in_a_row: 0, updated_by: staff.userId })
    .eq('organization_id', staff.organizationId).select('organization_id');
  if (error) fromDbError(error);
  if (!data?.length) throw new HttpError(409, 'This restaurant is not set up on One Local yet.');
  return getOutlet(staff);
}

// ---------- Items (available on One Local) ----------
export async function listItems(staff: Staff) {
  const [cats, items, off] = await Promise.all([
    db().from('menu_categories').select('id, name, sort_order').eq('organization_id', staff.organizationId).order('sort_order'),
    db().from('menu_items').select('id, name, price, category_id, is_available, food_type, image_url, sort_order').eq('organization_id', staff.organizationId).order('sort_order'),
    db().from('item_channel_status').select('menu_item_id, is_available, off_until').eq('organization_id', staff.organizationId).eq('channel', 'one_local'),
  ]);
  for (const r of [cats, items, off]) if (r.error) fromDbError(r.error);
  const status = new Map((off.data ?? []).map(s => [s.menu_item_id, s]));
  const now = Date.now();
  return (cats.data ?? []).map(c => ({
    id: c.id, name: c.name,
    items: (items.data ?? []).filter(i => i.category_id === c.id).map(i => {
      const s = status.get(i.id);
      const offNow = !!s && !s.is_available && (!s.off_until || Date.parse(s.off_until) > now);
      return { id: i.id, name: i.name, price: Number(i.price), food_type: i.food_type, image: i.image_url, in_pos: i.is_available, available: i.is_available && !offNow, off_until: offNow ? s!.off_until : null };
    }),
  }));
}

export async function setItem(staff: Staff, itemId: string, body: Row) {
  if (typeof body.available !== 'boolean') throw new HttpError(400, 'Say whether the item is available.');
  const { data: item } = await db().from('menu_items').select('id').eq('id', itemId).eq('organization_id', staff.organizationId).maybeSingle();
  if (!item) throw new HttpError(404, 'Item not found');
  const offUntil = body.available ? null : typeof body.off_until === 'string' ? body.off_until : null;
  const { error } = await db().from('item_channel_status').upsert(
    { organization_id: staff.organizationId, menu_item_id: itemId, channel: 'one_local', is_available: body.available, off_until: offUntil, updated_at: new Date().toISOString() },
    { onConflict: 'organization_id,menu_item_id,channel' });
  if (error) {
    // item_channel_status has no unique key in some databases: fall back to update-then-insert.
    const upd = await db().from('item_channel_status').update({ is_available: body.available, off_until: offUntil, updated_at: new Date().toISOString() })
      .eq('organization_id', staff.organizationId).eq('menu_item_id', itemId).eq('channel', 'one_local').select('menu_item_id');
    if (upd.error) fromDbError(upd.error);
    if (!upd.data?.length) {
      const ins = await db().from('item_channel_status').insert({ organization_id: staff.organizationId, menu_item_id: itemId, channel: 'one_local', is_available: body.available, off_until: offUntil });
      if (ins.error) fromDbError(ins.error);
    }
  }
  return { id: itemId, available: body.available, off_until: offUntil };
}

// ---------- Devices and the test order ----------
export async function registerDevice(staff: Staff, body: Row) {
  const token = String(body.token ?? '');
  const platform = ['ios', 'android', 'web'].includes(body.platform) ? body.platform : null;
  if (!platform || token.length < 10 || token.length > 300) throw new HttpError(400, 'Invalid device registration.');
  const { error } = await db().from('ol_partner_devices').upsert(
    { organization_id: staff.organizationId, user_id: staff.userId, expo_push_token: token, platform, last_seen_at: new Date().toISOString() },
    { onConflict: 'expo_push_token' });
  if (error) fromDbError(error);
  return { registered: true };
}

export async function notifyNewOrder(organizationId: string, order: { pos_order_id: string; display_no: string; total: number }, itemCount: number) {
  return pushToRestaurant(organizationId, {
    title: `New order ${order.display_no}`,
    body: `${itemCount} item${itemCount === 1 ? '' : 's'} · ₹${Number(order.total).toFixed(0)} · cash on delivery — accept within 60 seconds`,
    data: { type: 'new_order', order_id: order.pos_order_id },
  });
}

export async function createTestOrder(staff: Staff) {
  const { data: items, error } = await db().from('menu_items').select('id').eq('organization_id', staff.organizationId).eq('is_available', true).limit(20);
  if (error) fromDbError(error);
  if (!items?.length) throw new HttpError(409, 'Add menu items in the POS first.');
  const picks = [...items].sort(() => Math.random() - 0.5).slice(0, Math.min(2, items.length));
  const created = await rpc<{ pos_order_id: string; display_no: string; total: number }>('ol_create_restaurant_order', {
    p: {
      organization_id: staff.organizationId, customer_hash: `partner-test:${staff.userId}`, customer_name: 'Test customer',
      notes: 'TEST ORDER from VINII Partner — do not cook', delivery_fee: 0,
      delivery_address: { label: 'Test', line: 'Test address', area: 'Latur' },
      lines: picks.map(p => ({ menu_item_id: p.id, qty: 1 })),
    },
  });
  const push = await notifyNewOrder(staff.organizationId, created, picks.length);
  return { order_id: created.pos_order_id, display_no: created.display_no, push_sent: push.sent };
}
