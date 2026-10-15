// Restaurant pickup location (specs/restaurant-pickup-location, database migration 0341), through the real routes against the LOCAL
// Supabase: real staff logins, real role gate, the database function, history, the channel mirror, idempotent retries, tenancy,
// the checkout reason codes, the outlet banner status, and the maps routes (Google simulated). Refuses anything but localhost and
// removes the organizations, stores and logins it creates.
//   Run from frontend/:  npx tsx scripts/pickup-location-integration.ts
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
for (const line of readFileSync(`${process.cwd()}/.env.localdb.off`, 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.SUPABASE_URL ?? '')) throw new Error('refusing to run: not a local database');
process.env.GOOGLE_MAPS_API_KEY = 'it-maps-key'; // Google is simulated below; the real key is never used by this script

let passed = 0;
const check = (what: string, ok: boolean, detail?: unknown) => { if (!ok) { console.error('FAIL ', what, JSON.stringify(detail ?? '')); process.exitCode = 1; } else { passed++; console.log('ok   ', what); } };

const google = { search: 0, map: 0, down: false };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://places.googleapis.com/v1/places:searchText')) {
    google.search++;
    if (google.down) return new Response('{}', { status: 500 });
    return Response.json({ places: [
      { id: 'it-place-shop', displayName: { text: 'IT Spice Kitchen' }, formattedAddress: 'Gandhi Chowk, Latur', location: { latitude: 18.4061, longitude: 76.5772 }, types: ['restaurant', 'establishment'] },
      { id: 'it-place-area', displayName: { text: 'Latur' }, formattedAddress: 'Latur, Maharashtra', location: { latitude: 18.4088, longitude: 76.5604 }, types: ['locality', 'political'] },
      { id: 'it-place-pune', displayName: { text: 'IT Spice Pune' }, formattedAddress: 'Pune', location: { latitude: 18.52, longitude: 73.85 }, types: ['restaurant'] },
    ] });
  }
  if (url.startsWith('https://maps.googleapis.com/maps/api/staticmap')) {
    google.map++;
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'Content-Type': 'image/png' } });
  }
  if (url.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
    return Response.json({ status: 'OK', results: [{ formatted_address: 'Gandhi Chowk, Latur, Maharashtra 413512', address_components: [] }] });
  }
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  const { db } = await import('../server/db');
  const { createClient } = await import('@supabase/supabase-js');
  const index = await import('../app/api/partner/pickup-location/index+api');
  const search = await import('../app/api/partner/pickup-location/search+api');
  const reverse = await import('../app/api/partner/pickup-location/reverse+api');
  const map = await import('../app/api/partner/pickup-location/map+api');
  const me = await import('../app/api/partner/me+api');
  const { adoptOrders, assertFulfillable } = await import('../server/dispatch');
  const d = db();
  const must = (r: { data: any; error: any }): any => { if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
  const RUN = randomBytes(4).toString('hex');
  const made = { users: [] as string[], orgs: [] as string[], stores: [] as string[], olOrders: [] as string[] };
  const anon = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)!, { auth: { persistSession: false } });

  const roleId = async (slug: string) => must(await d.from('roles').select('id').eq('slug', slug).single()).id as string;
  const person = async (label: string, org: string, role: string) => {
    const email = `pickup.${label}.${RUN}@proviyaa.test`, password = randomBytes(18).toString('base64url');
    const { data, error } = await d.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
    made.users.push(data.user.id);
    must(await d.from('org_users').insert({ organization_id: org, user_id: data.user.id, role_id: await roleId(role), email, full_name: label, status: 'active' }));
    const s = await anon.auth.signInWithPassword({ email, password });
    if (s.error || !s.data.session) throw new Error(`sign in ${label}: ${s.error?.message}`);
    return { id: data.user.id, token: s.data.session.access_token };
  };
  const org = async (label: string) => {
    const id = randomUUID();
    must(await d.from('organizations').insert({ id, name: `Pickup ${label} ${RUN}`, slug: `pickup-${label}-${RUN}`, type: 'franchise' }));
    made.orgs.push(id);
    must(await d.from('organizations').update({ status: 'active' }).eq('id', id));
    must(await d.from('ol_merchant_channels').insert({ organization_id: id, city_id: 'latur', accepting: true }));
    return id;
  };
  const call = async (handler: any, method: string, path: string, token: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r: Response = await handler(new Request(`http://localhost${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    }), {});
    const type = r.headers.get('content-type') ?? '';
    return { status: r.status, type, json: type.includes('json') ? await r.json() : null };
  };
  const history = async (o: string) => must(await d.from('ol_merchant_location_history').select('change').eq('organization_id', o)).length as number;

  // The strict rule is what this script checks: Latur is strict while it runs, then gets back whatever it was (rollout mode in dev).
  const latur = must(await d.from('ol_service_areas').select('pickup_enforcement').eq('city_id', 'latur').single()).pickup_enforcement as string;
  must(await d.from('ol_service_areas').update({ pickup_enforcement: 'verified' }).eq('city_id', 'latur'));
  try {
    const A = await org('a'), B = await org('b');
    const owner = await person('owner-a', A, 'org_owner'), biller = await person('biller-a', A, 'biller'), manager = await person('manager-a', A, 'manager');
    const ownerB = await person('owner-b', B, 'org_owner');

    // read
    let r = await call(index.GET, 'GET', '/api/partner/pickup-location', owner.token);
    check('GET: a new restaurant has no pickup point; the owner may edit; the city is Latur', r.status === 200 && r.json.status === 'missing' && r.json.location === null && r.json.can_edit === true && r.json.city?.id === 'latur' && r.json.maps.search === true, r);
    r = await call(me.GET, 'GET', '/api/partner/me', biller.token);
    check('/me carries pickup_location.status = missing (banner)', r.status === 200 && r.json.restaurant.pickup_location?.status === 'missing', r.json?.restaurant);

    // role gate and validation
    const point = { lat: 18.4061, lng: 76.5772, formatted_address: 'Gandhi Chowk, Latur', source: 'map_pin', accuracy_m: null, confirm: true };
    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', biller.token, point);
    check('PUT by a biller: 403 forbidden', r.status === 403 && r.json.code === 'forbidden', r);
    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', owner.token, { ...point, lat: 18.52, lng: 73.85 });
    check('PUT outside the city: 422 outside_delivery_area', r.status === 422 && r.json.code === 'outside_delivery_area', r);
    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', owner.token, { ...point, source: 'merchant_edit', accuracy_m: 250 });
    check('PUT confirm with 250 m GPS: 422 accuracy_too_low', r.status === 422 && r.json.code === 'accuracy_too_low', r);
    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', owner.token, { ...point, source: 'admin' });
    check('PUT claiming source admin: 400', r.status === 400 && r.json.code === 'invalid_request', r);
    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', owner.token, { ...point, lat: 'north' });
    check('PUT with a bad latitude: 400', r.status === 400, r);
    check('nothing was written by the refused calls', (await history(A)) === 0);

    // confirm, retry, conflict
    const key = `pickup-it-${RUN}-1`;
    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', owner.token, point, { 'Idempotency-Key': key });
    check('PUT by the owner: verified, changed', r.status === 200 && r.json.status === 'verified' && r.json.changed === true && r.json.location.verified_by_me === true && r.json.location.source === 'map_pin', r);
    const ch = must(await d.from('ol_merchant_channels').select('lat, lng, address').eq('organization_id', A).single());
    check('channel mirrors the confirmed point (what dispatch reads)', ch.lat === 18.4061 && ch.lng === 76.5772 && ch.address === 'Gandhi Chowk, Latur', ch);
    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', owner.token, point, { 'Idempotency-Key': key });
    check('same key again: replayed, one history entry', r.status === 200 && r.json.replayed === true && (await history(A)) === 1, r.json);
    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', owner.token, { ...point, lat: 18.407 }, { 'Idempotency-Key': key });
    check('same key, other point: 422 idempotency_mismatch', r.status === 422 && r.json.code === 'idempotency_mismatch', r);
    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', manager.token, { ...point, lat: 18.4063 }, { 'Idempotency-Key': `pickup-it-${RUN}-2` });
    check('manager moves the pin: history moved, version 2', r.status === 200 && r.json.location.version === 2 && r.json.history[0]?.change === 'moved' && r.json.history[0]?.by_me === true, r.json);

    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', owner.token, { ...point, lat: 18.4064, version: 1 });
    check('a write based on an old version is refused (409 version_conflict)', r.status === 409 && r.json.code === 'version_conflict', r);
    r = await call(index.PUT, 'PUT', '/api/partner/pickup-location', owner.token, { ...point, source: 'geocoder', accuracy_m: null });
    check('a search point confirmed without an accuracy is refused (422 accuracy_too_low)', r.status === 422 && r.json.code === 'accuracy_too_low', r);
    r = await call(index.GET, 'GET', '/api/partner/pickup-location', owner.token);
    check('GET names the organization (the app checks it is the one it shows)', r.json?.organization_id === A, r.json?.organization_id);

    // tenancy
    r = await call(index.GET, 'GET', '/api/partner/pickup-location', ownerB.token);
    check('owner of B sees only B (missing), never A', r.status === 200 && r.json.status === 'missing' && r.json.location === null && r.json.history.length === 0, r.json);
    r = await call(index.GET, 'GET', '/api/partner/pickup-location', biller.token);
    check('biller of A reads A, cannot edit', r.status === 200 && r.json.status === 'verified' && r.json.can_edit === false, r.json);
    r = await call(index.GET, 'GET', '/api/partner/pickup-location', 'not-a-real-token-but-long-enough');
    check('no valid login: 401', r.status === 401, r);

    // checkout reason codes
    must(await d.from('ol_stores').insert([{ id: `pickup-a-${RUN}`, name: 'Pickup A', organization_id: A, is_demo: false }, { id: `pickup-b-${RUN}`, name: 'Pickup B', organization_id: B, is_demo: false }]));
    made.stores.push(`pickup-a-${RUN}`, `pickup-b-${RUN}`);
    const drop = { lat: 18.40, lng: 76.57 };
    const refusal = async (store: string) => { try { await assertFulfillable([{ store_id: store, store_name: 'Store', items: [{ id: 'no-such-item' }] }], drop, false); return 'passed'; } catch (e: any) { return e?.code ?? String(e); } };
    check('checkout, restaurant without a point: pickup_location_missing', (await refusal(`pickup-b-${RUN}`)) === 'pickup_location_missing');
    must(await d.from('ol_merchant_channels').update({ lat: 18.405, lng: 76.565, address: 'Admin typed' }).eq('organization_id', B));
    const legacy = must(await d.from('ol_merchant_locations').select('source, verification_status').eq('organization_id', B).single());
    check('a direct channel write (Master Admin listing) is captured as admin / unverified', legacy.source === 'admin' && legacy.verification_status === 'unverified', legacy);
    check('checkout, point not confirmed: pickup_location_unverified', (await refusal(`pickup-b-${RUN}`)) === 'pickup_location_unverified');
    r = await call(me.GET, 'GET', '/api/partner/me', ownerB.token);
    check('/me for B: pickup_location.status = unverified (banner stays)', r.json.restaurant.pickup_location?.status === 'unverified', r.json?.restaurant);
    must(await d.from('ol_service_areas').update({ pickup_enforcement: 'coordinates' }).eq('city_id', 'latur'));
    try {
      check('rollout city (coordinates): the unconfirmed point passes the location check', (await refusal(`pickup-b-${RUN}`)) === 'merchant_unavailable');
      must(await d.from('ol_merchant_channels').update({ lat: 18.4051 }).eq('organization_id', B));
      const olOrder = randomUUID();
      must(await d.from('ol_orders').insert({ id: olOrder, customer_hash: `pickup-it-${RUN}`, items: [], subtotal: 100, total: 100, store_id: `pickup-b-${RUN}`, payment_method: 'cod' }));
      // no organization_id on the order: adoption finds the restaurant through the store, and the cancellation record does not pin the
      // throwaway organization (so it can be removed afterwards)
      made.olOrders.push(olOrder);
      must(await d.from('ol_merchant_channels').update({ lat: null, lng: null }).eq('organization_id', B));
      await adoptOrders([olOrder]);
      const after = must(await d.from('ol_orders').select('status, pos_order_id').eq('id', olOrder).single());
      check('point cleared between checkout and adoption: the order is cancelled, never sent to the restaurant', after.status === 'cancelled' && after.pos_order_id === null, after);
    } finally {
      must(await d.from('ol_service_areas').update({ pickup_enforcement: 'verified' }).eq('city_id', 'latur'));
    }
    check('checkout, confirmed point: passes the location check (stops later at the unmapped item)', (await refusal(`pickup-a-${RUN}`)) === 'merchant_unavailable');

    // maps routes (Google simulated)
    r = await call(search.GET, 'GET', '/api/partner/pickup-location/search?q=it%20spice', owner.token);
    const hits = r.json?.results ?? [];
    check('search: shop is a 25 m point and serviceable; city is 1000 m; Pune is not serviceable', r.status === 200 && hits.length === 3
      && hits[0].accuracy_m === 25 && hits[0].serviceable === true && hits[1].accuracy_m === 1000 && hits[2].serviceable === false, hits);
    r = await call(search.GET, 'GET', '/api/partner/pickup-location/search?q=a', owner.token);
    check('search: one character is refused', r.status === 400, r);
    r = await call(reverse.GET, 'GET', '/api/partner/pickup-location/reverse?lat=18.4061&lng=76.5772', owner.token);
    check('reverse: address under the pin, serviceable', r.status === 200 && /Gandhi Chowk/.test(r.json.formatted_address) && r.json.serviceable === true, r);
    r = await call(map.GET, 'GET', '/api/partner/pickup-location/map?lat=18.4061&lng=76.5772&zoom=17&w=400&h=300', owner.token);
    check('map: a PNG image', r.status === 200 && r.type.startsWith('image/png') && google.map === 1, r);
    r = await call(map.GET, 'GET', '/api/partner/pickup-location/map?lat=18.4061&lng=76.5772&zoom=25', owner.token);
    check('map: zoom out of range refused', r.status === 400, r);
    google.down = true;
    r = await call(search.GET, 'GET', '/api/partner/pickup-location/search?q=it%20spice', owner.token);
    check('search while Google fails: 502 (the app falls back to GPS)', r.status === 502, r);
    delete process.env.GOOGLE_MAPS_API_KEY;
    r = await call(search.GET, 'GET', '/api/partner/pickup-location/search?q=it%20spice', owner.token);
    check('search with no maps key: 503 maps_unavailable', r.status === 503 && r.json.code === 'maps_unavailable', r);
    r = await call(index.GET, 'GET', '/api/partner/pickup-location', owner.token);
    check('GET with no maps key: maps.search and maps.map are false', r.json?.maps?.search === false && r.json?.maps?.map === false, r.json?.maps);
  } finally {
    await d.from('ol_service_areas').update({ pickup_enforcement: latur }).eq('city_id', 'latur');
    // ol_orders rows are kept as the record of the cancelled test order (tagged customer_hash pickup-it-*): append-only like all orders
    for (const s of made.stores) await d.from('ol_stores').delete().eq('id', s);
    for (const o of made.orgs) {
      await d.from('ol_merchant_channels').delete().eq('organization_id', o);
      await d.from('org_users').delete().eq('organization_id', o);
      const del = await d.from('organizations').delete().eq('id', o);
      if (del.error) console.warn('cleanup: organization', o, del.error.message);
    }
    for (const u of made.users) await d.auth.admin.deleteUser(u);
  }
  console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
}

main().catch(e => { console.error(e); process.exit(1); });
