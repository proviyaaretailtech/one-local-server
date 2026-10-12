#!/usr/bin/env node
// Adds strings to BOTH catalogues in one step, so English and Hindi can never drift apart.
//
//   npm run i18n:add -- path/to/fragment.json [--overwrite]
//
// The fragment is nested like the catalogues; every leaf is { "en": "...", "hi": "..." }:
//
//   { "cart": { "title": { "en": "Your bag", "hi": "आपका बैग" },
//               "items_one":   { "en": "{{count}} item",  "hi": "{{count}} आइटम" },
//               "items_other": { "en": "{{count}} items", "hi": "{{count}} आइटम" } } }
//
// Existing keys with the same text are left alone; a key that already exists with DIFFERENT text is an error
// unless --overwrite is given. New keys are appended (existing order is kept, so diffs stay small). Several
// people or agents may run this at once: a lock directory makes the read-modify-write safe.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src', 'i18n', 'locales');
const lock = join(dir, '.add.lock');
const args = process.argv.slice(2);
const overwrite = args.includes('--overwrite');
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: npm run i18n:add -- fragment.json [--overwrite]'); process.exit(2); }

const isLeaf = v => v && typeof v === 'object' && !Array.isArray(v) && typeof v.en === 'string' && typeof v.hi === 'string' && Object.keys(v).every(k => k === 'en' || k === 'hi');
const placeholders = s => [...s.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}|\$t\(([^)]+)\)/g)].map(m => m[1] ?? `$t(${m[2]})`).sort().join('|');

function collect(node, path, out, errors) {
  for (const [k, v] of Object.entries(node)) {
    const p = [...path, k];
    if (isLeaf(v)) {
      if (!v.en.trim()) errors.push(`${p.join('.')}: English is empty`);
      else if (!v.hi.trim()) errors.push(`${p.join('.')}: Hindi is empty`);
      else if (placeholders(v.en) !== placeholders(v.hi)) errors.push(`${p.join('.')}: {{placeholders}} differ between en and hi`);
      out.push({ path: p, en: v.en.normalize('NFC'), hi: v.hi.normalize('NFC') }); // one Unicode form, so the same Hindi word is always the same bytes (नुक़्ता: फ़ is फ + ़)
    } else if (v && typeof v === 'object' && !Array.isArray(v)) collect(v, p, out, errors);
    else errors.push(`${p.join('.')}: expected { "en": ..., "hi": ... } or a nested object`);
  }
}

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function acquire() {
  for (let i = 0; i < 300; i++) {
    try { mkdirSync(lock); return; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 60_000) rmSync(lock, { recursive: true, force: true }); } catch { /* raced */ }
      sleep(100);
    }
  }
  throw new Error('could not get the catalogue lock');
}

let fragment;
try { fragment = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2); }
const entries = []; const errors = [];
collect(fragment, [], entries, errors);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

acquire();
try {
  const read = lng => JSON.parse(readFileSync(join(dir, `${lng}.json`), 'utf8'));
  const cat = { en: read('en'), hi: read('hi') };
  let added = 0, same = 0; const clashes = [];
  for (const { path, en, hi } of entries) {
    for (const [lng, text] of [['en', en], ['hi', hi]]) {
      let node = cat[lng];
      for (const part of path.slice(0, -1)) {
        if (node[part] === undefined) node[part] = {};
        else if (typeof node[part] !== 'object') { clashes.push(`${path.join('.')}: "${part}" is already a string`); node = null; break; }
        node = node[part];
      }
      if (!node) continue;
      const leaf = path.at(-1);
      if (node[leaf] === undefined) { node[leaf] = text; if (lng === 'en') added++; }
      else if (typeof node[leaf] === 'object') clashes.push(`${path.join('.')}: already a group of keys`);
      else if (node[leaf] === text) { if (lng === 'en') same++; }
      else if (overwrite) node[leaf] = text;
      else clashes.push(`${path.join('.')} (${lng}): already "${node[leaf]}"`);
    }
  }
  if (clashes.length) { console.error(`not written, ${clashes.length} clash(es) (use --overwrite to replace):\n  ${clashes.join('\n  ')}`); process.exit(1); }
  for (const lng of ['en', 'hi']) writeFileSync(join(dir, `${lng}.json`), JSON.stringify(cat[lng], null, 2) + '\n');
  console.log(`i18n:add  ${added} added, ${same} already there  (${entries.length} in fragment)`);
} finally {
  if (existsSync(lock)) rmSync(lock, { recursive: true, force: true });
}
