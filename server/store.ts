// Write side: checkouts and their store orders, booking enquiries and support requests.
// Backed by Postgres (ol_checkouts / ol_orders / ol_booking_enquiries / ol_support_requests) when
// Supabase is configured; falls back to in-process memory otherwise (e.g. `expo start` with no .env),
// so local UI work never needs a database. See db.ts / dbConfigured().
//
// A checkout is what the customer pays for in one go. Each store in it gets its own order, so a
// store only ever sees its own items: a food checkout is one restaurant, so one order; a shopping
// checkout can span several stores (pricing.ts works out each store's bill). Payment belongs to the
// checkout — one Razorpay order for its total, and every order in it is paid together (payments.ts).
import { getCatalog } from './catalog';
import { caller } from './auth';
import { db, dbConfigured, fromDbError } from './db';
import { customerKey, HttpError, readBody } from './http';
import { limitCaller } from './limits';
import { holdCheckout, holdReasons } from './order-risk';
import { cancelUnfulfillable } from './refunds';
import { CartKind, cartKindOf, quote } from './pricing';
import { features } from './features';
import { codRule } from './payment-provider';
import { placeById } from './geo';
import { adoptOrders, assertFulfillable, deliveryOtp, dispatchConfigured, dispatchOrders, listingMenuItemId } from './dispatch';

// What the customer picks at checkout. 'cod' goes through POST /api/checkouts; every other choice
// goes through POST /api/payments/order and is only a preference — the method Razorpay reports
// for the actual payment (which can also be 'emi' or 'cardless_emi') is what gets stored.
export const ONLINE_METHODS = ['upi', 'card', 'netbanking', 'wallet', 'paylater'] as const;
export type PaymentMethod = 'cod' | (typeof ONLINE_METHODS)[number] | 'emi' | 'cardless_emi';
export type PaymentStatus = 'not_charged' | 'pending' | 'paid' | 'failed' | 'refunded';

export type OrderItem = { id: string; name: string; weight: string; price: number; mrp: number; image: string; qty: number };
// Where the order goes: the address as the customer chose it, the map point when known, and notes
// for the rider. Saved in ol_orders.delivery_address (a column since migration 0021).
export type DeliveryAddress = { label: string; text: string; lat: number | null; lng: number | null; notes: string };
export type Order = {
  id: string; checkout_id: string | null; store_id: string | null; store_name: string;
  items: OrderItem[]; subtotal: number; discount: number; delivery_fee: number; gst: number; total: number;
  coupon_code: string | null; payment_method: PaymentMethod; payment_status: PaymentStatus; status: string;
  rider_name: string; rider_phone: string; eta_minutes: number; created_at: string; address: DeliveryAddress | null;
  // The 4-digit code the customer tells the rider at the door (SRV-1). Only ever present on what the order's own customer reads, and only
  // while a rider has the delivery; never on an order that is not theirs, not yet with a rider, delivered or cancelled.
  delivery_code?: string | null;
};
export type Checkout = {
  id: string; kind: CartKind; item_total: number; discount: number; delivery_fee: number; total: number; coupon_code: string | null;
  payment_method: PaymentMethod; payment_status: PaymentStatus; created_at: string; orders: Order[];
};
// Gateway references live on the stored checkout only; the app never needs them. Razorpay ids as before; Cashfree's ids and the
// provider that took the payment were added by migration 0238 (payment_provider, provider_order_id = the order id WE sent to Cashfree).
export type PaymentProviderName = 'razorpay' | 'cashfree';
export type FailureCode = 'dropped' | 'declined' | 'expired' | 'unknown';
type GatewayRefs = {
  razorpay_order_id: string | null; razorpay_payment_id: string | null; paid_at: string | null; payment_error: string | null;
  payment_provider: PaymentProviderName | null; provider_order_id: string | null; cf_order_id: string | null; cf_payment_id: string | null;
  payment_group: string | null; payment_reference_masked: string | null; payment_failure_code: FailureCode | null; payment_attempts: number; payment_checked_at: string | null;
};
const NO_GATEWAY: GatewayRefs = {
  razorpay_order_id: null, razorpay_payment_id: null, paid_at: null, payment_error: null,
  payment_provider: null, provider_order_id: null, cf_order_id: null, cf_payment_id: null, payment_group: null, payment_reference_masked: null,
  payment_failure_code: null, payment_attempts: 0, payment_checked_at: null,
};
type Owner = { city_id: string; customer: string; user_id: string | null };
type StoredOrder = Order & Owner & { paid_at: string | null; payment_error: string | null };
type StoredCheckout = Omit<Checkout, 'orders'> & GatewayRefs & Owner & { refunds: { id: string; amount: number }[] };
const publicOrder = ({ city_id, customer, user_id, paid_at, payment_error, ...order }: StoredOrder): Order => order;
const publicCheckout = ({ city_id, customer, user_id, razorpay_order_id, razorpay_payment_id, paid_at, payment_error, payment_provider, provider_order_id, cf_order_id, cf_payment_id, payment_group, payment_reference_masked, payment_failure_code, payment_attempts, payment_checked_at, refunds, ...checkout }: StoredCheckout, orders: Order[]): Checkout => ({ ...checkout, orders });

// ---------- In-memory fallback (no database configured) ----------
// Enquiries and help requests carry their owner like orders do, so a person's data can be found
// for a download or an erasure (server/privacy.ts), exactly as the database columns allow.
type Owned = { customer: string | null; user_id: string | null };
export type MemoryEnquiry = Owned & { id: string; event_id: string; name: string; phone: string; date: string; slot: string; guests: number; status: string; created_at: string };
export type MemorySupport = Owned & { id: string; topic: string; message: string; reference: string; status: string; created_at: string };
type Memory = { checkouts: StoredCheckout[]; orders: StoredOrder[]; replies: Map<string, { fingerprint: string; checkout: Checkout; at: number }>; enquiries: MemoryEnquiry[]; support: MemorySupport[] };
const g = globalThis as unknown as { __onecityStore?: Memory };
const mem: Memory = (g.__onecityStore ??= { checkouts: [], orders: [], replies: new Map(), enquiries: [], support: [] } as Memory);
mem.checkouts ??= []; // a dev server whose memory dates from before checkouts

// For server/privacy.ts only (download and erasure in memory mode). The database path uses the
// tables directly; nothing else should reach into memory.
export const memoryRecords = () => mem;
export type { StoredCheckout, StoredOrder };

const r2 = (n: number) => Math.round(n * 100) / 100;
const UUID = /^[0-9a-f-]{36}$/i;

// Keeps item images and store names current, and names the store of an older order (from before
// checkouts) when all its items come from one store.
async function decorate(order: Order): Promise<Order> {
  const catalog = await getCatalog();
  const product = (id: string) => catalog.products.find(p => p.id === id);
  const stores = new Set(order.items.map(i => product(i.id)?.store_id).filter(Boolean));
  const store_id = order.store_id ?? (stores.size === 1 ? [...stores][0] ?? null : null);
  return {
    ...order, store_id, store_name: catalog.stores.find(s => s.id === store_id)?.name ?? order.store_name ?? '',
    items: order.items.map(i => ({ ...i, image: product(i.id)?.image ?? i.image })),
  };
}

const rowToOrder = (row: Record<string, unknown>): Order => ({
  id: row.id as string, checkout_id: (row.checkout_id as string) ?? null, store_id: (row.store_id as string) ?? null, store_name: '',
  items: row.items as OrderItem[], subtotal: Number(row.subtotal), discount: Number(row.discount),
  delivery_fee: Number(row.delivery_fee), gst: Number(row.gst ?? 0), total: Number(row.total), coupon_code: (row.coupon_code as string) ?? null,
  payment_method: row.payment_method as PaymentMethod, payment_status: (row.payment_status as PaymentStatus) ?? 'not_charged', status: row.status as string,
  rider_name: (row.rider_name as string) ?? 'Sample rider', rider_phone: (row.rider_phone as string) ?? '',
  eta_minutes: (row.eta_minutes as number) ?? 10, created_at: row.created_at as string, address: (row.delivery_address as DeliveryAddress) ?? null,
});

const rowToCheckout = (row: Record<string, unknown>, orders: Order[]): Checkout => ({
  id: row.id as string, kind: row.kind as CartKind, item_total: Number(row.item_total), discount: Number(row.discount),
  delivery_fee: Number(row.delivery_fee), total: Number(row.total), coupon_code: (row.coupon_code as string) ?? null,
  payment_method: row.payment_method as PaymentMethod, payment_status: row.payment_status as PaymentStatus, created_at: row.created_at as string, orders,
});

// Before migration 0026 there is no checkout row; the checkout is put together from its orders.
async function fromOrders(id: string, orders: Order[]): Promise<Checkout> {
  const sum = (pick: (o: Order) => number) => r2(orders.reduce((s, o) => s + pick(o), 0));
  const catalog = await getCatalog();
  return {
    id, kind: cartKindOf(catalog.products.find(p => p.id === orders[0]?.items[0]?.id)?.department), orders,
    item_total: sum(o => o.subtotal), discount: sum(o => o.discount), delivery_fee: sum(o => o.delivery_fee), total: sum(o => o.total),
    coupon_code: orders.find(o => o.coupon_code)?.coupon_code ?? null, payment_method: orders[0].payment_method,
    payment_status: orders[0].payment_status, created_at: orders[0].created_at,
  };
}

// Migration 0026 (checkouts) is a draft until the founder approves it. Until it is applied, a server
// on the database keeps taking orders as before: each store order is saved on its own, with no
// checkout row, and only cash on delivery. Looked for again once a minute until it appears.
let checkoutTable: { ready: boolean; at: number } | null = null;
async function checkoutsReady(): Promise<boolean> {
  if (checkoutTable && (checkoutTable.ready || Date.now() - checkoutTable.at < 60_000)) return checkoutTable.ready;
  const { error } = await db().from('ol_checkouts').select('id').limit(1);
  // PostgREST answers PGRST205 (Postgres 42P01) when the table does not exist.
  if (error && !['PGRST205', '42P01'].includes(error.code ?? '')) fromDbError(error);
  checkoutTable = { ready: !error, at: Date.now() };
  return !error;
}

async function requireCustomer(request: Request) {
  const who = await caller(request);
  if (!who.owner) throw new HttpError(401, 'Please update the app and try again.');
  return { hash: who.owner, userId: who.userId };
}

// The address is checked for shape and length only; the map point is optional (older saved
// addresses have none). Older app versions send no address at all, which is still accepted.
function readAddress(raw: unknown): DeliveryAddress | null {
  if (raw === undefined || raw === null) return null;
  const a = (typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const line = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const text = line(a.text), label = line(a.label), notes = typeof a.notes === 'string' ? a.notes.trim() : '';
  if (text.length < 5 || text.length > 300) throw new HttpError(400, 'Please choose where to deliver.');
  if (label.length > 40) throw new HttpError(400, 'Please give the address a shorter name.');
  if (notes.length > 300) throw new HttpError(400, 'Please keep delivery instructions under 300 characters.');
  const hasPoint = (a.lat !== undefined && a.lat !== null) || (a.lng !== undefined && a.lng !== null);
  if (hasPoint && !(typeof a.lat === 'number' && typeof a.lng === 'number' && Math.abs(a.lat) <= 90 && Math.abs(a.lng) <= 180)) {
    throw new HttpError(400, 'Please pick your address on the map again.');
  }
  return { label, text, lat: hasPoint ? (a.lat as number) : null, lng: hasPoint ? (a.lng as number) : null, notes };
}

// Order placement limits (SRV-7). A signed-in customer is counted by account; everyone is also counted by network address, which a
// caller cannot choose. A caller with no account (only a device key, which anyone can invent) gets the strict address limits on top:
// per minute and per hour. ORDERS_REQUIRE_SIGN_IN=1 closes that door altogether (answer 401 to anyone not signed in).
async function limitOrders(request: Request) {
  const who = await limitCaller(request, 'order', 5, 60_000, { anonIpMax: 8 });
  if (who.userId) return;
  if (process.env.ORDERS_REQUIRE_SIGN_IN === '1') throw new HttpError(401, 'Please sign in to place an order.');
  await limitCaller(request, 'order-hour', 12, 3_600_000, { verify: false, anonIpMax: 30 });
}

// Does a retry carry the same basket as the checkout the key already made? Compared by product and total quantity, whatever the order.
function sameBasket(raw: unknown, orders: Order[]): boolean {
  const tally = (lines: { id?: unknown; qty?: unknown }[]) => {
    const m = new Map<string, number>();
    for (const l of lines) if (typeof l?.id === 'string') m.set(l.id, (m.get(l.id) ?? 0) + (Number(l.qty) || 0));
    return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([id, q]) => `${id}:${q}`).join(',');
  };
  return Array.isArray(raw) && tally(raw) === tally(orders.flatMap(o => o.items));
}

type CheckoutBody = { items?: unknown; total?: unknown; coupon_code?: unknown; payment_method?: unknown; address?: unknown };

// Prices, fees and discounts are always recomputed here; what the app sends is only a check.
// `online` is set by POST /api/payments/order: the checkout is saved with payment 'pending' and only
// becomes real (its orders shown in the customer's list) once Razorpay confirms the money.
export async function createCheckout(request: Request, city: string, online = false): Promise<Checkout> {
  const customer = await requireCustomer(request);
  await limitOrders(request);
  const body = await readBody<CheckoutBody>(request);

  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey && !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new HttpError(400, 'Please update the app and try again.');
  // Retrying a payment with a different method (UPI failed, now card) is the same checkout, so the
  // online fingerprint covers only what was bought.
  const fingerprint = JSON.stringify(online ? { items: body.items, total: body.total, coupon_code: body.coupon_code } : body);

  if (!dbConfigured()) {
    const replyKey = idempotencyKey ? `${customer.hash}:${idempotencyKey}` : null;
    const prior = replyKey ? mem.replies.get(replyKey) : undefined;
    if (prior?.checkout && Date.now() - prior.at < 86_400_000) {
      if (prior.fingerprint !== fingerprint) throw new HttpError(409, 'This checkout was already used for a different order.');
      return prior.checkout;
    }
    const checkout = await buildCheckout(body, city, online);
    const { orders, ...head } = checkout;
    const owner = { city_id: city, customer: customer.hash, user_id: customer.userId };
    mem.checkouts.push({ ...head, ...owner, ...NO_GATEWAY, refunds: [] });
    mem.orders.push(...orders.map(o => ({ ...o, ...owner, paid_at: null, payment_error: null })));
    if (replyKey) mem.replies.set(replyKey, { fingerprint, checkout, at: Date.now() });
    return checkout;
  }

  const ready = await checkoutsReady();
  if (online && !ready) throw new HttpError(503, 'Online payment is not available right now. Please choose Pay on delivery.');
  // With a database, unique indexes on (customer_hash, idempotency_key) do the deduplication: a
  // retry with the same key returns what the first attempt created.
  const earlier = async () => (!idempotencyKey ? null : ready ? checkoutByKey(customer.hash, idempotencyKey) : legacyByKey(customer.hash, idempotencyKey));
  const prior = await earlier();
  if (prior) {
    // The same key must mean the same basket (SRV-9 P3-12); the memory path above compares the whole request.
    if (!sameBasket(body.items, prior.orders)) throw new HttpError(409, 'This checkout was already used for a different order.');
    return prior;
  }

  const checkout = await buildCheckout(body, city, online);
  // Nothing is charged, and no order is created, for a basket no restaurant can take (SRV-2).
  await assertFulfillable(checkout.orders, checkout.orders[0]?.address ?? null, online);
  const { orders, ...head } = checkout;
  if (ready) {
    const { error } = await db().from('ol_checkouts').insert({
      id: head.id, customer_hash: customer.hash, user_id: customer.userId, kind: head.kind, item_total: head.item_total, discount: head.discount,
      delivery_fee: head.delivery_fee, total: head.total, coupon_code: head.coupon_code, payment_method: head.payment_method,
      payment_status: head.payment_status, idempotency_key: idempotencyKey || null, city_id: city, created_at: head.created_at,
    });
    if (error) {
      // A concurrent retry can lose the race on the unique index; return what the winner wrote.
      const won = idempotencyKey && error.code === '23505' ? await earlier() : null;
      if (won) return won;
      fromDbError(error);
    }
  }
  const { error } = await db().from('ol_orders').insert(orders.map((o, i) => ({
    id: o.id, customer_hash: customer.hash, user_id: customer.userId, items: o.items,
    subtotal: o.subtotal, discount: o.discount, delivery_fee: o.delivery_fee, gst: o.gst, total: o.total,
    coupon_code: o.coupon_code, payment_method: o.payment_method, payment_status: o.payment_status,
    status: 'placed', rider_name: o.rider_name, rider_phone: o.rider_phone, eta_minutes: o.eta_minutes,
    delivery_address: o.address, city_id: city, created_at: o.created_at,
    // Before 0026 there is no checkout to hold the key, so each order carries it (key, key:2, …).
    ...(ready ? { checkout_id: head.id, store_id: o.store_id } : { idempotency_key: idempotencyKey ? (i ? `${idempotencyKey}:${i + 1}` : idempotencyKey) : null }),
  })));
  if (error) {
    // Nothing half-made is left behind, so a retry starts clean.
    if (ready) await db().from('ol_checkouts').delete().eq('id', head.id);
    const won = !ready && idempotencyKey && error.code === '23505' ? await earlier() : null;
    if (won) return won;
    fromDbError(error);
  }

  // Normalized lines alongside the jsonb cache on ol_orders.items — the source for refunds,
  // per-item analytics and reconciliation. Best-effort: the orders themselves are already committed
  // above, so a failure here is logged, not surfaced to the customer.
  // A line sold under an Item Master listing has no ol_products row (its id is made up from the store and the menu item), so it is stored by the
  // menu item instead: that is what lets the restaurant's side adopt the order, and ol_order_items.product_id would refuse a product that is not there.
  const { error: lineError } = await db().from('ol_order_items').insert(orders.flatMap(o =>
    o.items.map(i => {
      const menuItem = listingMenuItemId(o.store_id, i.id);
      return { order_id: o.id, product_id: menuItem ? null : i.id, menu_item_id: menuItem, name: i.name, weight: i.weight, image: i.image, price: i.price, mrp: i.mrp, qty: i.qty };
    })));
  if (lineError) console.error('[store] ol_order_items insert failed for checkout', head.id, lineError.message);

  // An unusual basket (order-risk.ts) is held for a person before any restaurant sees it; the database refuses to adopt a held
  // order (0331), so a paid online order stays held after its payment too. Holds need the checkouts table (always there since 0026).
  const reasons = ready ? await holdReasons({ kind: head.kind, customerHash: customer.hash, userId: customer.userId, checkoutId: head.id, paymentMethod: head.payment_method, total: head.total, orders }) : [];
  if (reasons.length) {
    // If the hold cannot be recorded the orders must not slip through to a restaurant (the dispatch sweep adopts unadopted cash
    // orders): cancel them, then tell the customer to try again.
    try { await holdCheckout(head.id, orders.map(o => o.id), reasons); }
    catch (error) { for (const o of orders) await cancelUnfulfillable(o.id, 'Could not be confirmed').catch(() => {}); throw error; }
  }

  // A cash order is successful the moment it is placed: ping the rider pool. An online order waits for
  // its payment (payments.ts markPaid). A retried request returned above, so this runs once per checkout.
  if (!online && !reasons.length) { await dispatchOrders(await adoptOrders(orders.map(o => o.id))); }

  return ready ? checkout : fromOrders(orders[0].id, orders.map(o => ({ ...o, checkout_id: null })));
}

// POST /api/orders, kept for older app versions: the same checkout, answered with its first order
// (the others are in the customer's order list).
export async function createOrder(request: Request, city: string): Promise<Order> {
  return (await createCheckout(request, city)).orders[0];
}

async function checkoutByKey(hash: string, key: string): Promise<Checkout | null> {
  const { data } = await db().from('ol_checkouts').select('*').eq('customer_hash', hash).eq('idempotency_key', key).maybeSingle();
  return data ? rowToCheckout(data, await ordersOf(data.id as string)) : null;
}

async function legacyByKey(hash: string, key: string): Promise<Checkout | null> {
  const keys = Array.from({ length: 50 }, (_, i) => (i ? `${key}:${i + 1}` : key));
  const { data } = await db().from('ol_orders').select('*').eq('customer_hash', hash).in('idempotency_key', keys).order('created_at');
  if (!data?.length) return null;
  const orders = await Promise.all(data.map(row => decorate(rowToOrder(row))));
  return fromOrders(orders[0].id, orders);
}

async function ordersOf(checkoutId: string): Promise<Order[]> {
  const { data, error } = await db().from('ol_orders').select('*').eq('checkout_id', checkoutId).order('created_at');
  if (error) fromDbError(error);
  return Promise.all((data ?? []).map(row => decorate(rowToOrder(row))));
}

// Same bill the cart showed (pricing.ts); the app's total is only a check that nothing changed.
async function buildCheckout(body: CheckoutBody, city: string, online: boolean): Promise<Checkout> {
  const bill = await quote(city, body.items, body.coupon_code);
  if (bill.coupon && !bill.coupon.ok) throw new HttpError(409, bill.coupon.message || 'This coupon can no longer be used.');
  if (typeof body.total === 'number' && Math.abs(body.total - bill.total) > 0.5) throw new HttpError(409, 'Prices have changed. Please review your cart and try again.');
  const address = readAddress(body.address);

  // A plain checkout is always cash on delivery whatever the app sends; an online method is only
  // accepted on the payments path, so no order can claim 'upi' without a payment behind it.
  if (online && !(features().online_payments && (ONLINE_METHODS as readonly string[]).includes(body.payment_method as string))) {
    throw new HttpError(400, 'Choose how you want to pay.', undefined, 'choose_method');
  }
  // Cash on delivery has its own rule (payment-provider.ts codRule: FEATURE_COD, COD_MAX_TOTAL): the server decides, the app only shows it.
  if (!online) {
    const cod = codRule(bill.total);
    if (!cod.available) throw new HttpError(409, cod.reason === 'over_limit' ? 'Pay on delivery is not available for an order this size. Please pay online.' : 'Pay on delivery is not available right now.', undefined, 'cod_unavailable');
  }
  const method = online ? (body.payment_method as PaymentMethod) : 'cod';
  const payment_status: PaymentStatus = online ? 'pending' : 'not_charged';
  const id = crypto.randomUUID(), now = Date.now();
  const coupon_code = bill.discount > 0 ? bill.coupon!.code : null;
  const orders: Order[] = bill.groups.map((g, i) => ({
    id: crypto.randomUUID(), checkout_id: id, store_id: g.store_id, store_name: g.store_name,
    items: g.lines.map(l => ({ id: l.id, name: l.name, weight: l.weight, price: l.price, mrp: l.mrp, image: l.image, qty: l.qty })),
    subtotal: g.item_total, discount: g.discount, delivery_fee: g.delivery_fee, gst: g.gst_added.total, total: g.total,
    coupon_code: g.discount > 0 ? coupon_code : null, payment_method: method, payment_status, status: 'placed',
    // No real rider exists yet; the tracking screen already says so.
    rider_name: 'Sample rider', rider_phone: '', eta_minutes: parseInt(g.delivery_time, 10) || 10,
    // A millisecond apart, so the store orders keep the cart's order wherever they are listed.
    created_at: new Date(now + i).toISOString(), address,
  }));
  return {
    id, kind: bill.kind, item_total: bill.item_total, discount: bill.discount, delivery_fee: bill.delivery_fee, total: bill.total,
    coupon_code, payment_method: method, payment_status, created_at: orders[0].created_at, orders,
  };
}

// A whole-order or single-line refund. Called from support tooling, not directly by the app yet.
export async function refundOrder(orderId: string, amount: number, reason: string, actorUserId: string | null, orderItemId?: string, method: 'original' | 'wallet' | 'manual' = 'original') {
  if (!dbConfigured()) throw new HttpError(503, 'Refunds need the database to be connected.');
  const { data, error } = await db().rpc('ol_process_refund', {
    p_order: orderId, p_item: orderItemId ?? null, p_amount: amount, p_reason: reason, p_actor: actorUserId, p_method: method,
  });
  if (error) fromDbError(error);
  return data as { refund_id: string; amount: number; order_payment_status: string; refunded_so_far: number; order_total: number };
}

// ---------- Payment state (read and written by payments.ts) ----------
// Payment belongs to the checkout: `id` is the checkout id, `order_ids` its store orders.
export type PaymentRecord = GatewayRefs & { id: string; customer: string; total: number; payment_method: PaymentMethod; payment_status: PaymentStatus; order_ids: string[]; created_at: string };
const PAYMENT_COLUMNS = 'id, customer_hash, total, payment_method, payment_status, razorpay_order_id, razorpay_payment_id, paid_at, payment_error, payment_provider, provider_order_id, cf_order_id, cf_payment_id, payment_group, payment_reference_masked, payment_failure_code, payment_attempts, payment_checked_at, created_at';

// By 'id', the value may be the checkout's id or one of its orders' (older app versions only know
// their order).
export async function findPayment(by: 'id' | 'razorpay_order_id' | 'razorpay_payment_id' | 'provider_order_id' | 'cf_payment_id', value: string): Promise<PaymentRecord | null> {
  if (!value) return null;
  if (!dbConfigured()) {
    const viaOrder = by === 'id' ? mem.orders.find(o => o.id === value)?.checkout_id : undefined;
    const c = mem.checkouts.find(x => x[by] === value || (!!viaOrder && x.id === viaOrder));
    return c ? {
      id: c.id, customer: c.customer, total: c.total, payment_method: c.payment_method, payment_status: c.payment_status, created_at: c.created_at,
      razorpay_order_id: c.razorpay_order_id, razorpay_payment_id: c.razorpay_payment_id, paid_at: c.paid_at, payment_error: c.payment_error,
      payment_provider: c.payment_provider, provider_order_id: c.provider_order_id, cf_order_id: c.cf_order_id, cf_payment_id: c.cf_payment_id,
      payment_group: c.payment_group, payment_reference_masked: c.payment_reference_masked, payment_failure_code: c.payment_failure_code,
      payment_attempts: c.payment_attempts, payment_checked_at: c.payment_checked_at,
      order_ids: mem.orders.filter(o => o.checkout_id === c.id).map(o => o.id),
    } : null;
  }
  if ((by === 'id' && !UUID.test(value)) || !(await checkoutsReady())) return null;
  const read = (column: string, v: string) => db().from('ol_checkouts').select(PAYMENT_COLUMNS).eq(column, v).maybeSingle();
  let { data, error } = await read(by, value);
  if (!data && !error && by === 'id') {
    const { data: order } = await db().from('ol_orders').select('checkout_id').eq('id', value).maybeSingle();
    if (order?.checkout_id) ({ data, error } = await read('id', order.checkout_id as string));
  }
  if (error) fromDbError(error);
  if (!data) return null;
  const { data: orders, error: orderError } = await db().from('ol_orders').select('id').eq('checkout_id', data.id).order('created_at');
  if (orderError) fromDbError(orderError);
  const { customer_hash, total, ...rest } = data as Record<string, unknown>;
  return { ...(rest as Omit<PaymentRecord, 'customer' | 'total' | 'order_ids'>), customer: customer_hash as string, total: Number(total), order_ids: (orders ?? []).map(o => o.id as string) };
}

// Changes a checkout's payment fields, but only while its payment is in one of `from` — which is
// what makes /verify and the webhook safe to repeat or to race each other. True if it changed.
// Every order in the checkout shows the same payment state: in memory it is copied here; in the
// database a trigger copies it in the same transaction (migration 0026).
export async function updatePayment(id: string, patch: Partial<GatewayRefs & { payment_method: PaymentMethod; payment_status: PaymentStatus }>, from: PaymentStatus[]): Promise<boolean> {
  if (!dbConfigured()) {
    const c = mem.checkouts.find(x => x.id === id);
    if (!c || !from.includes(c.payment_status)) return false;
    Object.assign(c, patch);
    for (const o of mem.orders) if (o.checkout_id === id) Object.assign(o, { payment_method: c.payment_method, payment_status: c.payment_status, paid_at: c.paid_at, payment_error: c.payment_error });
    return true;
  }
  const { data, error } = await db().from('ol_checkouts').update(patch).eq('id', id).in('payment_status', from).select('id');
  if (error) fromDbError(error);
  return !!data?.length;
}

// A refund made in the Razorpay dashboard (or by a later refund API call) has already moved the
// money, so it goes straight into the ledger as processed. One payment covers the whole checkout, so
// the refund is booked against the first store order it fits (support can move it); an order is
// refunded once its refunds cover it, the checkout once they cover the checkout total. The Razorpay
// refund id is the reference, so a repeated webhook cannot record it twice.
export async function recordGatewayRefund(checkoutId: string, refundId: string, amount: number) {
  if (!dbConfigured()) {
    const c = mem.checkouts.find(x => x.id === checkoutId);
    if (!c || c.refunds.some(r => r.id === refundId)) return;
    c.refunds.push({ id: refundId, amount });
    if (c.refunds.reduce((s, r) => s + r.amount, 0) >= c.total) await updatePayment(c.id, { payment_status: 'refunded' }, [c.payment_status]);
    return;
  }
  const now = new Date().toISOString();
  const state = async () => {
    const { data: orders } = await db().from('ol_orders').select('id, total, payment_method').eq('checkout_id', checkoutId).order('created_at');
    const ids = (orders ?? []).map(o => o.id as string);
    const { data: refunds } = ids.length ? await db().from('ol_refunds').select('order_id, amount').in('order_id', ids).eq('status', 'processed') : { data: [] };
    const refunded = (id: string) => (refunds ?? []).filter(r => r.order_id === id).reduce((s, r) => s + Number(r.amount), 0);
    return (orders ?? []).map(o => ({ id: o.id as string, total: Number(o.total), refunded: refunded(o.id as string), cod: o.payment_method === 'cod' }));
  };
  const { data: known } = await db().from('ol_refunds').select('id, status').eq('reference', refundId).maybeSingle();
  if (known) {
    if (known.status !== 'processed') await db().from('ol_refunds').update({ status: 'processed', processed_at: now }).eq('id', known.id);
  } else {
    const orders = await state();
    const target = orders.find(o => o.total - o.refunded >= amount - 0.005) ?? orders.find(o => o.total > o.refunded) ?? orders[0];
    if (!target) { console.error('[store] refund for a checkout with no orders', checkoutId, refundId); return; }
    const { error } = await db().from('ol_refunds').insert({ order_id: target.id, amount, reason: 'Refunded through Razorpay', method: 'original', status: 'processed', reference: refundId, created_at: now, processed_at: now });
    if (error && error.code !== '23505') fromDbError(error);
  }
  const orders = await state();
  // A cash order that is still going ahead (the customer switched to cash and a late online payment was returned) stays a cash order:
  // the refund is in the ledger, but it is not marked "refunded", because the cash is still to be collected.
  for (const o of orders) if (o.refunded >= o.total && !o.cod) await db().from('ol_orders').update({ payment_status: 'refunded' }).eq('id', o.id);
  const { data: checkout } = await db().from('ol_checkouts').select('total, payment_method').eq('id', checkoutId).maybeSingle();
  if (checkout && checkout.payment_method !== 'cod' && orders.reduce((s, o) => s + o.refunded, 0) >= Number(checkout.total)) await db().from('ol_checkouts').update({ payment_status: 'refunded' }).eq('id', checkoutId);
}

// The delivery code for the orders that have a rider on them, added to what the order's customer reads. Callers pass only orders
// they already matched to the caller's own account or device, so the code reaches the owner and nobody else.
const WITH_RIDER = ['assigned', 'at_pickup', 'picked_up', 'at_drop', 'exception'];
async function withDeliveryCodes(orders: Order[]): Promise<Order[]> {
  if (!orders.length || !dbConfigured() || !dispatchConfigured()) return orders;
  const { data, error } = await db().from('delivery_jobs').select('ol_order_id, status').in('ol_order_id', orders.map(o => o.id));
  if (error) fromDbError(error);
  const live = new Set((data ?? []).filter(j => WITH_RIDER.includes(j.status as string)).map(j => j.ol_order_id as string));
  return Promise.all(orders.map(async o => (live.has(o.id) ? { ...o, delivery_code: await deliveryOtp(o.id) } : o)));
}

// Only the account (or device) that placed an order can list or open it. An online attempt that
// was never paid is not an order yet, so it stays out of the list (it can still be opened by id,
// which is how the checkout checks whether a payment went through after all).
const UNPAID: PaymentStatus[] = ['pending', 'failed'];
export async function listOrders(request: Request): Promise<Order[]> {
  const { matches } = await caller(request);
  if (!matches.length) return [];

  if (!dbConfigured()) {
    return Promise.all(mem.orders.filter(o => matches.includes(o.customer) && !UNPAID.includes(o.payment_status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200).map(o => decorate(publicOrder(o))));
  }

  const { data, error } = await db().from('ol_orders').select('*').in('customer_hash', matches)
    .not('payment_status', 'in', `(${UNPAID.join(',')})`).order('created_at', { ascending: false }).limit(200);
  if (error) fromDbError(error);
  return withDeliveryCodes(await Promise.all((data ?? []).map(row => decorate(rowToOrder(row)))));
}

export async function getOrder(request: Request, id: string): Promise<Order> {
  const { matches } = await caller(request);

  if (!dbConfigured()) {
    const order = mem.orders.find(o => o.id === id && matches.includes(o.customer));
    if (!order) throw new HttpError(404, 'Order not found');
    return decorate(publicOrder(order));
  }

  if (!matches.length || !UUID.test(id)) throw new HttpError(404, 'Order not found');
  const { data, error } = await db().from('ol_orders').select('*').eq('id', id).in('customer_hash', matches).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw new HttpError(404, 'Order not found');
  return (await withDeliveryCodes([await decorate(rowToOrder(data))]))[0];
}

// The caller's own order for the live tracking read (server/tracking.ts): the same ownership rule as getOrder (404 for anyone else's),
// but the stored row, because tracking needs fields the public Order does not carry (promised_eta_at, prep_minutes). `row` is null
// when there is no database (the in-memory demo store): such an order has no delivery job, so tracking is "not live".
export async function ownOrderForTracking(request: Request, id: string): Promise<{ row: Record<string, any> | null; status: string }> {
  const { matches } = await caller(request);

  if (!dbConfigured()) {
    const order = mem.orders.find(o => o.id === id && matches.includes(o.customer));
    if (!order) throw new HttpError(404, 'Order not found');
    return { row: null, status: order.status };
  }

  if (!matches.length || !UUID.test(id)) throw new HttpError(404, 'Order not found');
  const { data, error } = await db().from('ol_orders')
    .select('id, status, created_at, eta_minutes, prep_minutes, promised_eta_at').eq('id', id).in('customer_hash', matches).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw new HttpError(404, 'Order not found');
  return { row: data, status: data.status as string };
}

// A checkout and all its store orders, for its owner only (like getOrder).
export async function getCheckout(request: Request, id: string): Promise<Checkout> {
  const { matches } = await caller(request);

  if (!dbConfigured()) {
    const c = mem.checkouts.find(x => x.id === id && matches.includes(x.customer));
    if (!c) throw new HttpError(404, 'Order not found');
    return publicCheckout(c, await Promise.all(mem.orders.filter(o => o.checkout_id === c.id).map(o => decorate(publicOrder(o)))));
  }

  if (!matches.length || !UUID.test(id) || !(await checkoutsReady())) throw new HttpError(404, 'Order not found');
  const { data, error } = await db().from('ol_checkouts').select('*').eq('id', id).in('customer_hash', matches).maybeSingle();
  if (error) fromDbError(error);
  if (!data) throw new HttpError(404, 'Order not found');
  return rowToCheckout(data, await withDeliveryCodes(await ordersOf(id)));
}

// ---------- Book It enquiries ----------
export async function createEnquiry(request: Request) {
  await limitCaller(request, 'enquiry', 5, 3_600_000, { anonIpMax: 10 });
  const b = await readBody<Record<string, unknown>>(request);
  const catalog = await getCatalog();
  const event = catalog.events.find(e => e.id === b.event_id);
  if (!event || typeof b.slot !== 'string' || !event.slots.includes(b.slot)) throw new HttpError(400, 'Choose an available event and time');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(today); last.setDate(last.getDate() + 30);
  const chosen = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? new Date(`${b.date}T00:00:00`) : null;
  if (!chosen || Number.isNaN(chosen.getTime()) || chosen < today || chosen > last) throw new HttpError(400, 'Choose a date within the next 30 days');
  if (typeof b.name !== 'string' || b.name.trim().length < 2 || b.name.length > 80) throw new HttpError(400, 'Enter your name');
  if (typeof b.phone !== 'string' || !/^[6-9][0-9]{9}$/.test(b.phone)) throw new HttpError(400, 'Enter a valid 10-digit mobile number');
  if (!Number.isInteger(b.guests) || (b.guests as number) < 1 || (b.guests as number) > 8) throw new HttpError(400, 'Choose between 1 and 8 guests');

  const { hash, userId } = await caller(request).then(c => ({ hash: c.owner, userId: c.userId }));
  const saved = { event_id: event.id, name: b.name, phone: b.phone, date: b.date as string, slot: b.slot, guests: b.guests as number, id: crypto.randomUUID(), status: 'demo_enquiry_saved', created_at: new Date().toISOString() };

  if (!dbConfigured()) { mem.enquiries.push({ ...saved, customer: hash, user_id: userId }); return saved; }
  const { error } = await db().from('ol_booking_enquiries').insert({
    id: saved.id, event_id: saved.event_id, name: saved.name, phone: saved.phone, date: saved.date,
    slot: saved.slot, guests: saved.guests, status: saved.status, customer_hash: hash, user_id: userId, created_at: saved.created_at,
  });
  if (error) fromDbError(error);
  return saved;
}

// ---------- Help & support ----------
const TOPICS = ['order', 'payment', 'profile', 'other'];

export async function createSupportRequest(request: Request) {
  await limitCaller(request, 'support', 5, 3_600_000, { anonIpMax: 10 });
  const b = await readBody<Record<string, unknown>>(request);
  if (typeof b.topic !== 'string' || !TOPICS.includes(b.topic)) throw new HttpError(400, 'Choose a topic');
  if (typeof b.message !== 'string' || b.message.trim().length < 10 || b.message.length > 2000) throw new HttpError(400, 'Please describe your question in at least 10 characters');
  const reference = typeof b.reference === 'string' ? b.reference.slice(0, 100) : '';
  const receipt = { id: crypto.randomUUID(), status: 'saved_for_review', created_at: new Date().toISOString() };

  const { hash, userId } = await caller(request).then(c => ({ hash: c.owner, userId: c.userId }));
  if (!dbConfigured()) { mem.support.push({ topic: b.topic, message: b.message, reference, ...receipt, customer: hash, user_id: userId }); return receipt; }
  const { error } = await db().from('ol_support_requests').insert({
    id: receipt.id, topic: b.topic, message: b.message, reference, status: receipt.status,
    customer_hash: hash, user_id: userId, created_at: receipt.created_at,
  });
  if (error) fromDbError(error);
  return receipt;
}

// "Launch One Local here" from a discover-only place. Kept in the help-request table (topic
// 'other', reference 'launch:<place id>') so the demand list needs no new table yet; the Master
// can count requests per place with one query.
export async function createLaunchRequest(request: Request) {
  await limitCaller(request, 'launch', 3, 86_400_000, { anonIpMax: 10 });
  const b = await readBody<Record<string, unknown>>(request);
  const place = placeById(typeof b.place_id === 'string' ? b.place_id : '');
  const where = [place.name, place.district, place.state].filter(Boolean).join(', ');
  const receipt = { id: crypto.randomUUID(), status: 'saved_for_review', created_at: new Date().toISOString(), place: where };
  const message = `Please launch One Local in ${where} (${place.lat}, ${place.lng}).`;
  const reference = `launch:${place.id}`.slice(0, 100);

  const { hash, userId } = await caller(request).then(c => ({ hash: c.owner, userId: c.userId }));
  if (!dbConfigured()) { mem.support.push({ topic: 'other', message, reference, ...receipt, customer: hash, user_id: userId }); return receipt; }
  const { error } = await db().from('ol_support_requests').insert({
    id: receipt.id, topic: 'other', message, reference, status: receipt.status,
    customer_hash: hash, user_id: userId, created_at: receipt.created_at,
  });
  if (error) fromDbError(error);
  return receipt;
}
