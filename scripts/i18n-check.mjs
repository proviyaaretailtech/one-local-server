#!/usr/bin/env node
// i18n health check for the customer app.   npm run i18n:check
//
//  1. Catalogues (src/i18n/locales/en.json + hi.json): same keys in both, no empty values, same {{placeholders}},
//     no Latin digits swapped for Devanagari ones, every t('literal.key') exists, Hindi copied from English flagged.
//  2. Hard-coded text: finds user-visible strings still written inside screens/components:
//       definite  = JSX text, text props (placeholder, title, label, accessibilityLabel/Hint, alt, …), Alert/Share/announce calls
//       possible  = object properties like { label: 'Food' }, new Error('…'), setError('…'), arrays of sentences
//     A line (or the line above it) with `// i18n-ignore` is skipped; `// i18n-ignore-file` skips a file.
//  3. Layout risks for Hindi (warnings): tight lineHeight next to a fontSize; fixed `height` on button-like styles.
//  4. Writes docs/I18N_STATUS_customer-app.md (counts per file and the full remaining list).
//
// Exit code 1 when a catalogue check fails (parity/empty/placeholder/missing key). `--strict` also fails while any
// definite hard-coded string remains. `--files a,b` limits the report to paths containing those fragments (no doc is written).
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const strict = flag('--strict');
const onlyFiles = opt('--files')?.split(',').filter(Boolean);
const outPath = opt('--out') ?? resolve(root, '../../../docs/I18N_STATUS_customer-app.md');
const writeDoc = !flag('--no-write') && !onlyFiles;

// ── catalogues ──────────────────────────────────────────────────────────────────────────────────────────────
const localeDir = join(root, 'src/i18n/locales');
const load = n => JSON.parse(readFileSync(join(localeDir, `${n}.json`), 'utf8'));
const flatten = (o, p = '', out = {}) => { for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object') flatten(v, key, out); else out[key] = v; } return out; };
const en = flatten(load('en')); const hi = flatten(load('hi'));
const tokens = s => [...String(s).matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}|\$t\(([^)]+)\)/g)].map(m => m[1] ?? `$t(${m[2]})`).sort().join(', ');
const catalogueErrors = []; const catalogueWarnings = [];
for (const k of Object.keys(en)) if (!(k in hi)) catalogueErrors.push(`missing in hi: ${k}`);
for (const k of Object.keys(hi)) if (!(k in en)) catalogueErrors.push(`missing in en: ${k}`);
for (const [lng, cat] of [['en', en], ['hi', hi]]) for (const [k, v] of Object.entries(cat)) {
  if (typeof v !== 'string' || !v.trim()) catalogueErrors.push(`empty value: ${lng}.${k}`);
}
for (const k of Object.keys(en)) if (k in hi && typeof en[k] === 'string' && typeof hi[k] === 'string' && tokens(en[k]) !== tokens(hi[k])) {
  catalogueErrors.push(`placeholder mismatch at ${k}: en {${tokens(en[k])}} vs hi {${tokens(hi[k])}}`);
}
for (const [lng, cat] of [['en', en], ['hi', hi]]) for (const [k, v] of Object.entries(cat)) if (typeof v === 'string' && v !== v.normalize('NFC')) catalogueErrors.push(`not Unicode NFC (mixed forms of the same Hindi letter): ${lng}.${k}`);
const ACRONYM_ONLY = /^[A-Z0-9 .·+&/-]+$/;
for (const k of Object.keys(en)) if (hi[k] !== undefined && hi[k] === en[k] && /\p{L}/u.test(en[k]) && !ACRONYM_ONLY.test(en[k]) && !/^\{\{[^}]+\}\}$/.test(en[k])) catalogueWarnings.push(`hi equals en (not translated?): ${k}`);
for (const [k, v] of Object.entries(hi)) if (/[०-९]/.test(String(v))) catalogueWarnings.push(`Devanagari digits in hi (Latin digits are the default): ${k}`);

// ── source scan ─────────────────────────────────────────────────────────────────────────────────────────────
const SCAN_DIRS = ['app', 'src', 'constants', 'components', 'hooks'];
const SKIP = [/^app\/api\//, /^src\/i18n\//, /\.d\.ts$/, /node_modules/];
const walk = d => !existsSync(d) ? [] : readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : []; });
const files = SCAN_DIRS.flatMap(d => walk(join(root, d))).map(p => relative(root, p)).filter(f => !SKIP.some(r => r.test(f))).sort();

const TEXT_PROPS = new Set(['placeholder', 'title', 'label', 'alt', 'accessibilityLabel', 'accessibilityHint', 'aria-label', 'headerTitle', 'tabBarLabel', 'subtitle', 'description', 'message', 'hint', 'caption', 'heading', 'cta', 'emptyText', 'helperText']);
const DISPLAY_KEYS = new Set(['label', 'title', 'subtitle', 'sub', 'text', 'message', 'description', 'hint', 'placeholder', 'caption', 'heading', 'tagline', 'eyebrow', 'cta', 'body', 'note', 'error', 'headline', 'copy', 'blurb', 'q', 'a', 'question', 'answer', 'name']);
const SETTERS = /^set(Error|Message|Notice|Msg|Feedback|Status|Hint|Toast|Text|Warning|Info|Result|CouponMsg|CheckoutError)$/;
const ALLOW = new Set(['OneCity', 'neCity', 'One Local', 'OneLocal', 'OneLocal Coins', 'One Saver', 'UPI', 'COD', 'OTP', 'GST', 'QR', 'PIN', 'KYC', 'SOS', 'EMI', 'FAQ', 'Latur', 'Google', 'G', 'Razorpay', 'PhonePe', 'Paytm', 'BHIM', 'WhatsApp', 'Google Pay', 'OneCity Wallet', 'OneCity ·']);
const hasLetters = s => /\p{L}/u.test(s);
const looksLikeProse = s => { const t = s.trim(); return hasLetters(t) && !ALLOW.has(t) && (/\s/.test(t) || /^[A-Zऀ-ॿ]/.test(t)) && !/^(https?:|\/|[#.@])/.test(t) && !/^[A-Z0-9_]+$/.test(t); };

const LETTERS = (s) => hasLetters(s) && !ALLOW.has(s.trim());
function userStrings(node, acc = []) {
  if (!node) return acc;
  switch (node.kind) {
    case ts.SyntaxKind.StringLiteral: case ts.SyntaxKind.NoSubstitutionTemplateLiteral: if (LETTERS(node.text)) acc.push(node); break;
    case ts.SyntaxKind.TemplateExpression: { const parts = [node.head.text, ...node.templateSpans.map(s => s.literal.text)]; if (parts.some(LETTERS)) acc.push(node); node.templateSpans.forEach(s => userStrings(s.expression, acc)); break; }
    case ts.SyntaxKind.ParenthesizedExpression: case ts.SyntaxKind.AsExpression: case ts.SyntaxKind.NonNullExpression: case ts.SyntaxKind.SatisfiesExpression: userStrings(node.expression, acc); break;
    case ts.SyntaxKind.ConditionalExpression: userStrings(node.whenTrue, acc); userStrings(node.whenFalse, acc); break;
    case ts.SyntaxKind.BinaryExpression: if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind)) { userStrings(node.left, acc); userStrings(node.right, acc); } break;
    default: break;
  }
  return acc;
}

const results = []; // { file, line, kind: 'definite'|'possible', what, text }
const layout = []; // { file, line, what }
const usedKeys = new Set(); const dynamicPrefixes = new Set(); const missingKeyUses = [];
const converted = new Set();
const enKeys = new Set(Object.keys(en));
const keyExists = k => enKeys.has(k) || [...enKeys].some(x => x.startsWith(`${k}_`)) || [...enKeys].some(x => x.startsWith(`${k}.`));

for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8');
  if (/\/\/\s*i18n-ignore-file/.test(text)) continue;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split('\n');
  const ignored = line => /i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '');
  const lineOf = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
  const add = (kind, node, what, str) => {
    const line = lineOf(node); if (ignored(line)) return;
    const s = (str ?? node.getText(sf)).replace(/\s+/g, ' ').trim();
    results.push({ file, line: line + 1, kind, what, text: s.length > 90 ? `${s.slice(0, 87)}…` : s });
  };
  if (/useTranslation|from ['"]@\/src\/i18n|from ['"]\.\.?\/(\.\.\/)?i18n|i18n\.t\(/.test(text)) converted.add(file);

  const visit = node => {
    // t('key') / i18n.t('key') — remember which keys the code uses
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isT = (ts.isIdentifier(callee) && callee.text === 't') || (ts.isPropertyAccessExpression(callee) && callee.name.text === 't');
      const arg = node.arguments[0];
      if (isT && arg) {
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) { usedKeys.add(arg.text); if (!keyExists(arg.text)) missingKeyUses.push(`${file}:${lineOf(node) + 1} t('${arg.text}')`); }
        else if (ts.isTemplateExpression(arg)) dynamicPrefixes.add(arg.head.text);
      }
      // Alert.alert / alert / Share.share / announce
      const name = ts.isPropertyAccessExpression(callee) ? `${callee.expression.getText(sf)}.${callee.name.text}` : callee.getText(sf);
      if (['Alert.alert', 'alert', 'ToastAndroid.show', 'AccessibilityInfo.announceForAccessibility', 'Alert.prompt'].includes(name)) node.arguments.forEach(a => { userStrings(a).forEach(n => add('definite', n, name)); if (ts.isObjectLiteralExpression(a) || ts.isArrayLiteralExpression(a)) visitDisplay(a, name); });
      if (name === 'Share.share' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) node.arguments[0].properties.forEach(p => { if (ts.isPropertyAssignment(p)) userStrings(p.initializer).forEach(n => add('definite', n, 'Share.share')); });
      if (ts.isIdentifier(callee) && SETTERS.test(callee.text) && node.arguments[0]) userStrings(node.arguments[0]).forEach(n => add('possible', n, callee.text));
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /Error$/.test(node.expression.text) && node.arguments?.[0]) userStrings(node.arguments[0]).forEach(n => add('possible', n, `new ${node.expression.text}`));
    // JSX text and expression children
    if (ts.isJsxText(node)) { const t = node.text.replace(/\s+/g, ' ').trim(); if (t && LETTERS(t)) add('definite', node, 'JSX text', t); }
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) userStrings(node.expression).forEach(n => add('definite', n, 'JSX expression'));
    // JSX attributes
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (TEXT_PROPS.has(name)) {
        if (ts.isStringLiteral(node.initializer)) { if (LETTERS(node.initializer.text)) add('definite', node.initializer, `${name}=`); }
        else if (ts.isJsxExpression(node.initializer)) userStrings(node.initializer.expression).forEach(n => add('definite', n, `${name}=`));
      }
    }
    // object literals: display-ish properties, and style objects for layout hints
    if (ts.isObjectLiteralExpression(node)) { visitDisplay(node, 'object'); layoutHints(node); }
    // arrays of sentences
    if (ts.isArrayLiteralExpression(node) && node.elements.length >= 2 && node.elements.every(e => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && node.elements.every(e => looksLikeProse(e.text) && /\s/.test(e.text.trim()))) node.elements.forEach(e => add('possible', e, 'array of sentences'));
    ts.forEachChild(node, visit);
  };
  const seenObj = new WeakSet();
  function visitDisplay(obj) {
    if (seenObj.has(obj)) return; seenObj.add(obj);
    if (!ts.isObjectLiteralExpression(obj)) return;
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : '';
      if (!DISPLAY_KEYS.has(key)) continue;
      userStrings(p.initializer).forEach(n => { const s = ts.isTemplateExpression(n) ? n.head.text + n.templateSpans.map(x => x.literal.text).join('') : n.text; if (ts.isTemplateExpression(n) || looksLikeProse(s)) add('possible', n, `{ ${key}: … }`); });
    }
  }
  function layoutHints(obj) {
    const props = new Map(); for (const p of obj.properties) if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name))) props.set(p.name.text, p.initializer);
    const num = k => { const v = props.get(k); return v && ts.isNumericLiteral(v) ? Number(v.text) : null; };
    const fs = num('fontSize'), lh = num('lineHeight');
    if (fs && lh && lh / fs < 1.3 && fs >= 11) { const line = lineOf(obj); if (!ignored(line)) layout.push({ file, line: line + 1, what: `lineHeight ${lh} for fontSize ${fs} (${(lh / fs).toFixed(2)}) may clip Devanagari — use ≥ ${Math.ceil(fs * 1.35)}` }); }
    const h = num('height');
    const parent = obj.parent; const nm = parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name) ? parent.name.text : '';
    if (h && /button|btn|cta|pill|chip|primary|action|link|field|input|segment|tab\b|row/i.test(nm) && !props.has('minHeight') && !props.has('width') ) { const line = lineOf(obj); if (!ignored(line)) layout.push({ file, line: line + 1, what: `fixed height ${h} on "${nm}": use minHeight so longer Hindi text can grow` }); }
  }
  visit(sf);
}

// dynamic keys (t(`status.order.${x}`)) and the typed helpers in codes.ts count as using a whole prefix
const prefixes = ['status.', 'errors.code.', ...dynamicPrefixes];
const unused = Object.keys(en).filter(k => { const base = k.replace(/_(zero|one|two|few|many|other)$/, ''); return !usedKeys.has(k) && !usedKeys.has(base) && !prefixes.some(p => p && k.startsWith(p)) && !/^(format|language)\./.test(k); });
for (const m of missingKeyUses) catalogueErrors.push(`t() uses a key that is not in en.json: ${m}`);

// ── report ──────────────────────────────────────────────────────────────────────────────────────────────────
const show = f => !onlyFiles || onlyFiles.some(s => f.includes(s));
const shown = results.filter(r => show(r.file));
const byFile = new Map();
for (const r of results) { const e = byFile.get(r.file) ?? { definite: 0, possible: 0 }; e[r.kind]++; byFile.set(r.file, e); }
const definite = results.filter(r => r.kind === 'definite').length; const possible = results.length - definite;
const doneFiles = files.filter(f => converted.has(f) && !(byFile.get(f)?.definite));
const todoFiles = files.filter(f => (byFile.get(f)?.definite ?? 0) > 0);
const noText = files.filter(f => !converted.has(f) && !byFile.has(f));

const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // India date
const md = [];
md.push(`<!-- generated:start (npm run i18n:check, ${today}) -->`);
md.push(`## Generated status (${today})`, '');
md.push(`| | |`, `|---|---|`);
md.push(`| Catalogue keys (en / hi) | ${Object.keys(en).length} / ${Object.keys(hi).length} |`);
md.push(`| Catalogue errors (parity, empty, placeholders, missing keys) | ${catalogueErrors.length} |`);
md.push(`| Catalogue warnings | ${catalogueWarnings.length} |`);
md.push(`| Files scanned | ${files.length} |`);
md.push(`| Files using the catalogue and fully clean | ${doneFiles.length} |`);
md.push(`| Files still holding hard-coded text (definite) | ${todoFiles.length} |`);
md.push(`| Hard-coded strings: definite / possible | ${definite} / ${possible} |`);
md.push(`| Layout warnings (tight line height / fixed height) | ${layout.length} |`, '');
if (catalogueErrors.length) md.push('### Catalogue errors', '', ...catalogueErrors.map(e => `- ${e}`), '');
if (catalogueWarnings.length) md.push('### Catalogue warnings', '', ...catalogueWarnings.slice(0, 80).map(e => `- ${e}`), catalogueWarnings.length > 80 ? `- … ${catalogueWarnings.length - 80} more` : '', '');
md.push('### Converted (uses the catalogue, no definite hard-coded text left)', '', doneFiles.length ? doneFiles.map(f => `- \`${f}\``).join('\n') : '- none yet', '');
md.push('### Remaining, per file (definite / possible)', '', '| File | Definite | Possible |', '|---|---:|---:|');
for (const [f, c] of [...byFile.entries()].sort((a, b) => b[1].definite - a[1].definite || b[1].possible - a[1].possible)) md.push(`| \`${f}\` | ${c.definite} | ${c.possible} |`);
md.push('', `Files with no user-visible text found (nothing to convert): ${noText.length}.`, '');
md.push('### Remaining strings, in full', '');
for (const f of [...byFile.keys()].sort()) {
  md.push(`**\`${f}\`**`, '');
  for (const r of results.filter(x => x.file === f)) md.push(`- ${f.split('/').pop()}:${r.line} ${r.kind === 'possible' ? '(possible) ' : ''}${r.what}: ${r.text.replace(/\|/g, '\\|')}`);
  md.push('');
}
if (layout.length) { md.push('### Layout warnings for Hindi', ''); for (const l of layout) md.push(`- ${l.file}:${l.line} ${l.what}`); md.push(''); }
md.push(`### Catalogue keys not referenced by a literal t() call (informational; dynamic keys are not traced)`, '', unused.length ? unused.slice(0, 120).map(k => `- ${k}`).join('\n') : '- none', unused.length > 120 ? `- … ${unused.length - 120} more` : '', '');
md.push('<!-- generated:end -->');
const generated = md.join('\n');

// console
console.log(`i18n:check  catalogue keys en=${Object.keys(en).length} hi=${Object.keys(hi).length}  errors=${catalogueErrors.length} warnings=${catalogueWarnings.length}`);
console.log(`            files ${files.length}  clean+converted ${doneFiles.length}  with hard-coded text ${todoFiles.length}  strings definite=${definite} possible=${possible}  layout warnings=${layout.length}`);
catalogueErrors.slice(0, 40).forEach(e => console.log(`  ERROR ${e}`));
if (onlyFiles) {
  for (const r of shown) console.log(`  ${r.kind === 'definite' ? 'TEXT' : 'maybe'} ${r.file}:${r.line} ${r.what}: ${r.text}`);
  for (const l of layout.filter(x => show(x.file))) console.log(`  LAYOUT ${l.file}:${l.line} ${l.what}`);
}

if (writeDoc) {
  const marker = /<!-- generated:start[\s\S]*?<!-- generated:end -->/;
  const header = `# i18n status — customer app (One Local / OneCity)\n\nHand-written notes sit above the generated block and are kept when it is regenerated. Do not edit between the markers: run \`npm run i18n:check\` in \`One Local Mobile App /OL-ui/frontend\`.\n\n`;
  mkdirSync(dirname(outPath), { recursive: true });
  const existing = existsSync(outPath) ? readFileSync(outPath, 'utf8') : header;
  writeFileSync(outPath, marker.test(existing) ? existing.replace(marker, () => generated) : `${existing.trimEnd()}\n\n${generated}\n`);
  console.log(`            wrote ${outPath}`);
}
process.exit(catalogueErrors.length || (strict && definite) ? 1 : 0);
