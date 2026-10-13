// Publishes the catalogue images and videos to the HOSTED Supabase Storage and records where they went in server/data/media.json,
// so /api/media/<key> redirects to a public address instead of answering 404 in production.
//
//   node scripts/publish-media.mjs                 dry run: lists what would be uploaded, changes nothing
//   node scripts/publish-media.mjs --publish       uploads, then writes server/data/media.json
//
// Reads the files rebuilt by backend/scripts/rebuild_media.py (backend/.media_build, git-ignored) from MEDIA_BUILD_DIR, or from ../backend/.media_build.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY of the project the apps use. The key is read from the environment only: it is never written,
// printed or sent anywhere except to that project. Safe to run again: keys already in media.json are skipped (--force uploads them again), the manifest is merged.
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PUBLISH = process.argv.includes('--publish');
const BUCKET = 'onecity-catalog'; // the bucket the Master Admin uploads use too (server/admin.ts)
const DIR = path.resolve(process.env.MEDIA_BUILD_DIR || path.join(process.cwd(), '../backend/.media_build'));
const OUT = path.resolve(process.cwd(), 'server/data/media.json');

if (!existsSync(path.join(DIR, 'manifest.json'))) { console.error(`No manifest.json in ${DIR}. Set MEDIA_BUILD_DIR to the backend/.media_build folder.`); process.exit(1); }
const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const entries = Object.entries(manifest).filter(([, e]) => e.storage_path);
const missing = entries.filter(([, e]) => !existsSync(path.join(DIR, e.storage_path)));
const bytes = entries.reduce((n, [, e]) => n + (existsSync(path.join(DIR, e.storage_path)) ? readFileSync(path.join(DIR, e.storage_path)).length : 0), 0);
console.log(`${entries.length} files in the manifest, ${(bytes / 1e6).toFixed(1)} MB, ${missing.length} missing on disk${missing.length ? ': ' + missing.map(([k]) => k).slice(0, 5).join(', ') : ''}`);
if (!PUBLISH) { console.log('Dry run: nothing uploaded. Add --publish to upload.'); process.exit(missing.length ? 1 : 0); }

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (of the hosted project) in this terminal first.'); process.exit(1); }
if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) { console.error('That is the local database. Use the hosted project URL.'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const b = await sb.storage.getBucket(BUCKET);
if (b.error) {
  const made = await sb.storage.createBucket(BUCKET, { public: true });
  if (made.error) { console.error('Could not create the bucket:', made.error.message); process.exit(1); }
  console.log(`Created public bucket ${BUCKET}`);
} else if (!b.data.public) { console.error(`Bucket ${BUCKET} exists but is not public: customers could not load the images. Make it public in the Supabase dashboard (Storage) and run again.`); process.exit(1); }

const published = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
let done = 0, failed = 0, skipped = 0;
for (const [k, e] of entries) {
  if (missing.some(([mk]) => mk === k)) continue;
  if (published[k] && !process.argv.includes('--force')) { skipped++; continue; } // already uploaded on an earlier run
  const objectPath = e.storage_path;
  const up = await sb.storage.from(BUCKET).upload(objectPath, readFileSync(path.join(DIR, objectPath)), { contentType: e.content_type || TYPES[path.extname(objectPath).toLowerCase()] || 'application/octet-stream', upsert: true, cacheControl: '31536000' });
  if (up.error) { failed++; console.error(`  failed ${k}: ${up.error.message}`); continue; }
  published[k] = sb.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
  if (++done % 25 === 0) console.log(`  ${done}/${entries.length}`);
}
writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.entries(published).sort()), null, 1) + '\n');
console.log(`Uploaded ${done}, already done ${skipped}, failed ${failed}. Wrote ${Object.keys(published).length} keys to server/data/media.json. Now commit that file and deploy.`);
process.exit(failed ? 1 : 0);
