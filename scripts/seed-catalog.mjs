#!/usr/bin/env node
// One-off: load the sample catalogue (server/data/catalog.json) into the ol_* Postgres
// tables, so catalog.ts can read from the database instead of the JSON file.
//
// Safe to re-run: every table is upserted on its primary key, and this script only ever
// touches rows where is_demo = true, so real catalogue rows added later are never disturbed.
//
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from frontend/.env.local (falls back to
// frontend/.env). Run against the LOCAL database only — .env.local is what
// `scripts/db.py local-env` writes, and this script refuses to run without it. Any project that is not
// on this machine (including --production) also needs ALLOW_REMOTE=1, and SUPABASE_ACCESS_TOKEN is never read.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(ROOT, '..');

function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const name = t.slice(0, i).trim();
    // SEC-1: a Supabase management token (can read every project's keys and run SQL) has no use here. It is never copied out of the file.
    if (name === 'SUPABASE_ACCESS_TOKEN') continue;
    out[name] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

// SEC-1: only a local Supabase (loopback) unless ALLOW_REMOTE=1 is set on purpose. Names the host, never a key.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/i;
function refuseRemote(url) {
  let host = '';
  try { host = new URL(String(url)).hostname; } catch { /* not a URL at all: refused below */ }
  if (host && LOCAL_HOST.test(host)) return;
  if (process.env.ALLOW_REMOTE === '1') return;
  console.error(`❌ Refusing to use the Supabase project at ${host || '(no valid SUPABASE_URL)'}: it is not a local database. Set ALLOW_REMOTE=1 to allow it.`);
  process.exit(1);
}

const envLocalPath = path.join(FRONTEND, '.env.local');
// --production seeds the online database from frontend/.env (founder-approved 2026-09-26, after a
// `scripts/db.py snapshot`). Without the flag it only ever touches the LOCAL database.
const PRODUCTION = process.argv.includes('--production');
const env = PRODUCTION
  ? loadEnv(path.join(FRONTEND, '.env'))
  : { ...loadEnv(path.join(FRONTEND, '..', '.env')), ...loadEnv(envLocalPath) };

if (PRODUCTION) {
  refuseRemote(env.SUPABASE_URL); // before anything is announced or touched
  console.log(`⚠️  Seeding PRODUCTION (${env.SUPABASE_URL}). Demo rows only (is_demo = true), upserted.`);
} else {
  if (!existsSync(envLocalPath)) {
    console.error('❌ frontend/.env.local not found. Without --production this script only seeds the LOCAL database.');
    console.error('   Run: python3 scripts/db.py local-env');
    process.exit(1);
  }
  if (env.ONELOCAL_DB_TARGET !== 'local') {
    console.error('❌ frontend/.env.local does not point at the local database (ONELOCAL_DB_TARGET != local). Refusing to run.');
    process.exit(1);
  }
}

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }
refuseRemote(url);

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const catalog = JSON.parse(readFileSync(path.join(FRONTEND, 'server', 'data', 'catalog.json'), 'utf8'));

async function upsert(table, rows, conflict = 'id') {
  if (!rows.length) return;
  const { error } = await db.from(table).upsert(rows, { onConflict: conflict });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`✅ ${table}: ${rows.length} rows`);
}

async function main() {
  // Order matters: categories/brands/stores before products/reels (foreign keys).
  await upsert('ol_categories', catalog.categories.map((c, i) => ({
    id: c.id, name: c.name, emoji: c.emoji ?? '', color: c.color ?? null,
    department: c.department, image: c.image ?? '', sort_order: i, is_demo: true,
  })));

  await upsert('ol_brands', catalog.brands.map(b => ({
    id: b.id, name: b.name, department: b.department ?? null, logo: b.logo ?? '',
    image: b.image ?? '', tagline: b.tagline ?? '', city_id: 'latur', is_demo: true,
  })));

  await upsert('ol_stores', catalog.stores.map((s, i) => ({
    id: s.id, name: s.name, logo: s.logo ?? null, tagline: s.tagline ?? null,
    delivery_time: s.delivery_time ?? null, rating: s.rating ?? 4.5, tags: s.tags ?? [],
    department: s.department ?? null, media: s.media ?? [], city_id: 'latur',
    is_demo: true, sort_order: i,
  })));

  await upsert('ol_products', catalog.products.map((p, i) => ({
    id: p.id, name: p.name, weight: p.weight ?? '', price: p.price, mrp: p.mrp,
    image: p.image ?? '', category_id: p.category_id ?? null, store_id: p.store_id ?? null,
    brand_id: p.brand_id || null, department: p.department, delivery_min: p.delivery_min ?? 15,
    discount_pct: p.discount_pct ?? null, rating: p.rating ?? 4.5, is_available: true,
    city_id: 'latur', is_demo: true, sort_order: i,
  })));

  await upsert('ol_banners', catalog.banners.map((b, i) => ({
    id: b.id, title: b.title, subtitle: b.subtitle ?? null, image: b.image ?? null,
    bg: b.bg ?? null, city_id: 'latur', is_demo: true, sort_order: i,
  })));

  await upsert('ol_discover_chips', catalog.discover_chips.map((c, i) => ({
    id: c.id, label: c.label, emoji: c.emoji ?? null, color: c.color ?? null, sort_order: i,
  })), 'id');

  await upsert('ol_coupons', catalog.coupons.map(c => ({
    code: c.code, label: c.label, kind: c.kind, value: c.value, min_order: c.min_order ?? 0,
    description: c.description ?? '', active: true, city_id: 'latur', is_demo: true,
  })), 'code');

  await upsert('ol_events', catalog.events.map((e, i) => ({
    id: e.id, title: e.title, kind: e.kind, subtitle: e.subtitle ?? null, venue: e.venue ?? null,
    price: e.price ?? null, image: e.image ?? null, tag: e.tag ?? null, slots: e.slots ?? [],
    city_id: 'latur', is_demo: true, sort_order: i,
  })));

  await upsert('ol_themed_stores', catalog.themed_stores.map((t, i) => ({
    id: t.id, data: t, city_id: 'latur', is_demo: true, sort_order: i,
  })));

  await upsert('ol_reels', catalog.reels.map((r, i) => ({
    id: r.id, product_id: r.product_id ?? null, brand_id: r.brand_id ?? null, video: r.video,
    caption: r.caption ?? null, creator: r.creator ?? null, likes: r.likes ?? 0, tag: r.tag ?? null,
    city_id: 'latur', is_demo: true, sort_order: i,
  })));

  console.log(`\n✅ ${PRODUCTION ? 'Production' : 'Local'} catalogue seeded from server/data/catalog.json`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
