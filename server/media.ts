/// <reference types="node" />
// /api/media/<key>: catalogue images and videos.
// 1. Published (data/media.json, key -> public Supabase Storage URL): redirect there.
// 2. Development only: serve the file rebuilt by backend/scripts/rebuild_media.py.
import fs from 'node:fs';
import path from 'node:path';
import published from './data/media.json';
import { fail } from './http';

const PUBLISHED = published as Record<string, string>;
const LOCAL_DIR = path.resolve(process.cwd(), '../backend/.media_build');

let manifest: Record<string, { storage_path?: string; content_type?: string }> | null = null;
function localManifest() {
  if (manifest) return manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(LOCAL_DIR, 'manifest.json'), 'utf8')); } catch { manifest = {}; }
  return manifest!;
}

const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };

export function serveMedia(request: Request, key: string): Response {
  if (!/^[\w.-]{1,120}$/.test(key)) return fail(404, 'Image not found');
  if (PUBLISHED[key]) return new Response(null, { status: 302, headers: { Location: PUBLISHED[key], 'Cache-Control': 'public, max-age=3600' } });
  if (process.env.NODE_ENV === 'production') return fail(404, 'Image not found');

  const entry = localManifest()[key];
  if (!entry?.storage_path) return fail(404, 'Image not found');
  const file = path.join(LOCAL_DIR, entry.storage_path);
  if (!file.startsWith(LOCAL_DIR + path.sep) || !fs.existsSync(file)) return fail(404, 'Image not found');
  const data = fs.readFileSync(file);
  const type = entry.content_type || TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'Accept-Ranges': 'bytes' };

  // Video players (and Safari) request byte ranges.
  const range = request.headers.get('range');
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match) {
    let start = match[1] ? Number(match[1]) : data.length - Number(match[2]);
    let end = match[1] && match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
    start = Math.max(0, start);
    if (start > end || start >= data.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${data.length}` } });
    return new Response(data.subarray(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}` } });
  }
  return new Response(data, { headers });
}
