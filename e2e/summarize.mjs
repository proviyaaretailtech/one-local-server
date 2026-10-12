#!/usr/bin/env node
// Aggregates e2e/results/**.json into e2e/results/summary.md (grouped, de-duplicated).
// Run after the suite:  node e2e/summarize.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(dir, 'results');
const read = kind => (fs.existsSync(path.join(R, kind)) ? fs.readdirSync(path.join(R, kind)).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(R, kind, f), 'utf8'))) : []);
const catalogIds = (() => {
  try { const c = JSON.parse(fs.readFileSync(path.join(R, 'catalog-ids.json'), 'utf8')); return c; } catch { return []; }
})();
const idRe = catalogIds.length ? new RegExp(`(^|-)(${catalogIds.sort((a, b) => b.length - a.length).map(x => x.replace(/-/g, '\\-')).join('|')})(?=-|$| )`, 'g') : null;
// "product-image-trending-home-f5" → "product-image-*-*" (scope and id collapsed) so one issue type is one row.
const norm = id => {
  if (!id) return '(no testID)';
  let s = id.replace(/ > …$/, ' (child)');
  if (idRe) s = s.replace(idRe, '$1*');
  return s.replace(/[0-9a-f]{8,}/g, '#').replace(/\d+/g, 'N');
};
const group = (rows, keyFn) => {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, { key: k, screens: new Set(), n: 0, example: r }); const g = m.get(k); g.n++; g.screens.add(r.screen); }
  return [...m.values()].sort((a, b) => b.screens.size - a.screens.size || b.n - a.n);
};
const out = [];
const h = t => out.push(`\n## ${t}\n`);
const table = (head, rows) => { out.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(c => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`)); };

const sweep = read('sweep');
out.push(`# OneCity UI audit — machine summary\n\nGenerated ${new Date().toISOString()} from e2e/results. Screens swept: ${sweep.length}.`);

h('Hard errors per screen');
table(['screen', 'route → landed', 'blank', 'stuck loading', 'back missing', 'page errors', 'console errors', 'non-2xx /api', 'blocked (config)'],
  sweep.map(s => [s.screen, `${s.route} → ${s.finalUrl}`, s.nearBlank ? 'YES' : '', s.stuckLoading ? 'YES' : '', s.backMissing ? 'YES' : '', (s.pageErrors || []).join('; ').slice(0, 120), (s.consoleErrors || []).slice(0, 3).join('; ').slice(0, 160), (s.apiFailures || []).map(a => `${a.method} ${a.url} ${a.status}`).join('; '), (s.apiBlocked || []).map(a => `${a.url.split('?')[0]} ${a.status}`).join('; ')]));

const flat = (field, phase = 'top') => sweep.flatMap(s => (s[phase]?.[field] || []).map(x => ({ ...x, screen: s.screen })));

h('Tap targets smaller than 44×44 (grouped by testID pattern)');
table(['testID pattern', 'screens', 'count', 'example size', 'example label'], group(flat('smallTargets'), r => norm(r.id)).map(g => [g.key, g.screens.size + ': ' + [...g.screens].slice(0, 6).join(', '), g.n, `${g.example.w}×${g.example.h}`, g.example.text]));

h('Words broken across two lines');
table(['testID pattern', 'screens', 'count', 'example'], group(flat('brokenWords'), r => norm(r.id)).map(g => [g.key, [...g.screens].slice(0, 6).join(', '), g.n, `${g.example.text} → "${g.example.split}"`]));

h('Truncated text (ellipsis / line clamp)');
table(['testID pattern', 'screens', 'count', 'mid-word', 'example'], group(flat('truncated'), r => norm(r.id)).map(g => [g.key, [...g.screens].slice(0, 5).join(', '), g.n, g.example.midWord ? 'yes' : '', `${g.example.text} → ${g.example.shown || g.example.kind}`]));

h('Text clipped by a container');
table(['testID pattern', 'screens', 'count', 'example'], group(flat('clipped'), r => norm(r.id)).map(g => [g.key, [...g.screens].slice(0, 5).join(', '), g.n, `${g.example.text} (axis ${g.example.axis}, ${g.example.overflow}px past ${g.example.by})`]));

h('Text spilling outside its tappable tile');
table(['testID pattern', 'screens', 'count', 'example'], group(flat('spills'), r => norm(r.id)).map(g => [g.key, [...g.screens].slice(0, 5).join(', '), g.n, `${g.example.text} (${g.example.spill}px outside ${g.example.tile})`]));

h('Interactive elements covered by another element');
// Keep only real blockers: at the top of a screen, overlays in the upper half (content lower
// down can simply be scrolled up); at the end of scrolling, anything still covered in the lower
// half (the list cannot scroll any further, so it can never be uncovered).
const scrollable = Object.fromEntries(sweep.map(s => [s.screen, !!s.top?.scrollable]));
const cov = [
  ...flat('covered', 'top').filter(r => r.cy === undefined || r.cy < 45 || !scrollable[r.screen]).map(r => ({ ...r, phase: 'on arrival' })),
  ...flat('covered', 'bottom').filter(r => r.cy === undefined || r.cy > 55).map(r => ({ ...r, phase: 'end of scroll' })),
];
table(['element → covered by', 'phase', 'screens', 'count', 'example'], group(cov, r => `${norm(r.id)} → ${norm(r.overlayRoot || r.by)}|${r.phase}`).map(g => [g.key.split('|')[0], g.key.split('|')[1], [...g.screens].slice(0, 6).join(', '), g.n, `${g.example.text} ${g.example.points} points`]));

h('Text hidden under a floating bar at the end of scrolling');
table(['text → covered by', 'screens', 'count', 'example'], group(flat('hiddenText', 'bottom').filter(r => r.cy === undefined || (r.cy > 55 && r.positioned)), r => `${norm(r.id)} → ${norm(r.overlayRoot || r.by)}`).map(g => [g.key, [...g.screens].slice(0, 6).join(', '), g.n, g.example.text]));

h('Images not filling their frame (object-fit contain)');
table(['testID pattern', 'screens', 'count', 'example'], group(flat('letterbox'), r => norm(r.id)).map(g => [g.key, [...g.screens].slice(0, 5).join(', '), g.n, `${g.example.fill}% filled, ${g.example.bars} bars, frame ${g.example.frame}, image ${g.example.natural}`]));

h('Suspicious text on screen (literal \\n, undefined, NaN, null …)');
table(['testID', 'screens', 'match', 'text'], group(flat('suspiciousText'), r => `${norm(r.id)}|${r.match}`).map(g => [g.key.split('|')[0], [...g.screens].join(', '), g.example.match, g.example.text]));

h('Controls cut off by their container');
table(['testID pattern', 'screens', 'count', 'example'], group(flat('clippedControls'), r => norm(r.id)).map(g => [g.key, [...g.screens].slice(0, 6).join(', '), g.n, `${g.example.text} — ${g.example.cut} by ${g.example.by} (${g.example.size})`]));

h('Broken images');
table(['testID', 'screen', 'src'], flat('brokenImages').map(r => [r.id, r.screen, r.src]));

const taps = read('taps');
if (taps.length) {
  h('Dead and blocked taps');
  const rows = taps.flatMap(t => t.outcomes.filter(o => o.result === 'dead' || o.result === 'blocked').map(o => ({ ...o, screen: t.screen })));
  table(['result', 'testID pattern', 'screens', 'example label', 'detail'], group(rows, r => `${r.result}|${r.pattern}`).map(g => [g.key.split('|')[0], g.key.split('|')[1], [...g.screens].join(', '), g.example.label, g.example.error || '']));
  const totals = taps.reduce((a, t) => { for (const o of t.outcomes) a[o.result] = (a[o.result] || 0) + 1; return a; }, {});
  out.push(`\nTap totals: ${JSON.stringify(totals)} across ${taps.length} screens.`);
}

const journeys = read('journeys');
if (journeys.length) {
  h('Journeys');
  table(['journey', 'result', 'failed step', 'error'], journeys.map(j => { const f = j.steps.find(s => !s.ok); return [j.journey, j.passed ? 'PASS' : 'FAIL', f?.name || '', f?.error?.slice(0, 220) || '']; }));
}
for (const f of read('cart-feedback')) { h('Cart add feedback'); out.push('```json\n' + JSON.stringify(f, null, 1).slice(0, 3000) + '\n```'); }
for (const f of read('first-launch')) { h(`First launch (${f.route})`); table(['step', 'ok', 'note'], f.steps.map(s => [s.name, s.ok ? 'yes' : 'NO', s.note || ''])); }

fs.writeFileSync(path.join(R, 'summary.md'), out.join('\n') + '\n');
console.log(`wrote ${path.join(R, 'summary.md')} (${out.length} lines)`);
