/* Shared helpers for the OneCity UI audit suite.
 *
 * Everything here reads the running app; nothing writes to app source. Results are
 * written as JSON under e2e/results/ so e2e/summarize.mjs can build a findings table.
 */
import { Page, TestInfo, expect, Locator, APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export const BASE = 'http://localhost:8081';
export const E2E_DIR = __dirname;
export const SHOTS = path.join(E2E_DIR, 'screenshots');
export const RESULTS = path.join(E2E_DIR, 'results');
export const VIEW = { width: 390, height: 844 };
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RESULTS, { recursive: true });

export const slugify = (s: string) => s.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';

// ---------------------------------------------------------------------------
// Monitoring: console errors, page errors, /api/* responses that are not 2xx.
// ---------------------------------------------------------------------------
export type ApiHit = { method: string; url: string; status: number; kind: 'blocked-ai' | 'blocked-maps' | 'failure' };
export type Monitor = { console: string[]; warnings: string[]; pageErrors: string[]; api: ApiHit[]; requestFailed: string[]; reset: () => void };

export function classifyApi(url: string, status: number): ApiHit['kind'] {
  const p = new URL(url).pathname;
  if (status === 503 && /^\/api\/(search|assistant)\//.test(p)) return 'blocked-ai';
  if (status === 503 && /^\/api\/(geocode|places)\//.test(p)) return 'blocked-maps';
  return 'failure';
}

export function monitor(page: Page): Monitor {
  const m: Monitor = {
    console: [], warnings: [], pageErrors: [], api: [], requestFailed: [],
    reset() { m.console.length = 0; m.warnings.length = 0; m.pageErrors.length = 0; m.api.length = 0; m.requestFailed.length = 0; },
  };
  page.on('console', msg => {
    const text = msg.text().replace(/\s+/g, ' ').slice(0, 400);
    if (msg.type() === 'error') m.console.push(text);
    else if (msg.type() === 'warning') m.warnings.push(text);
  });
  page.on('pageerror', err => m.pageErrors.push(`${err.name}: ${err.message}`.slice(0, 400)));
  page.on('response', r => {
    const url = r.url();
    if (!url.startsWith(BASE + '/api/')) return;
    const status = r.status();
    if ((status >= 200 && status < 300) || status === 304) return;
    m.api.push({ method: r.request().method(), url: url.replace(BASE, ''), status, kind: classifyApi(url, status) });
  });
  page.on('requestfailed', req => {
    const url = req.url();
    const failure = req.failure()?.errorText || '';
    // Aborted media/video requests are normal when a screen unmounts.
    if (failure.includes('ERR_ABORTED')) return;
    if (url.startsWith(BASE)) m.requestFailed.push(`${req.method()} ${url.replace(BASE, '')} ${failure}`);
  });
  return m;
}

export const unique = <T>(xs: T[]) => [...new Set(xs)];
export const unexpectedApi = (m: Monitor) => m.api.filter(a => a.kind === 'failure');
export const blockedApi = (m: Monitor) => m.api.filter(a => a.kind !== 'failure');
// Browser "Failed to load resource" lines duplicate the API list; keep only real JS errors.
export const realConsoleErrors = (m: Monitor) => unique(m.console.filter(c => !/Failed to load resource: the server responded with a status of 503/.test(c)));

// ---------------------------------------------------------------------------
// Navigation and waiting.
// ---------------------------------------------------------------------------
export async function waitForApp(page: Page, readySelector?: string) {
  // Rendered = the root has content (sparse screens such as "not found" have very few testIDs).
  await page.waitForFunction(() => { const r = document.getElementById('root'); return !!r && (r.innerText || '').trim().length > 0 && document.querySelectorAll('[data-testid]').length > 0; }, null, { timeout: 150_000 });
  // The launch intro (src/components/intro-splash.tsx) covers the screen for ~2 s on every page load.
  await page.waitForFunction(() => !document.querySelector('[data-testid="intro-splash"]'), null, { timeout: 15_000 }).catch(() => {});
  if (readySelector) await page.locator(readySelector).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 60_000 });
  // Loading spinners from the shared catalogue hook.
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="catalog-loading"]')].some(e => (e as HTMLElement).offsetParent !== null), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(1_000);
}

/** Small stopwatch used to keep the suite fast enough to run often. */
export function stopwatch() {
  const t0 = Date.now(); const marks: string[] = [];
  return { mark: (label: string) => marks.push(`${label}:${((Date.now() - t0) / 1000).toFixed(1)}s`), toString: () => marks.join(' ') };
}

/** Opens a route, retrying once because Metro may hot-reload mid-load. */
export async function openRoute(page: Page, route: string, readySelector?: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await waitForApp(page, readySelector);
      return;
    } catch (e) {
      lastError = e;
      await page.waitForTimeout(3_000);
    }
  }
  throw lastError;
}

/** Visible element by testID (the app keeps inactive tab screens mounted but hidden). */
export const byId = (page: Page, id: string): Locator => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).first();

export async function tapId(page: Page, id: string, timeout = 15_000) {
  const el = byId(page, id);
  await el.waitFor({ state: 'visible', timeout });
  await el.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
  await el.tap({ timeout });
}

/** Scroll the main vertical scroller (React Native ScrollView renders as an overflow div). */
export async function scrollMain(page: Page, where: 'top' | 'bottom' | number) {
  await page.evaluate(where => {
    const cands = [...document.querySelectorAll('div')].filter(d => {
      const s = getComputedStyle(d); const r = d.getBoundingClientRect();
      return /(auto|scroll)/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 4 && d.clientHeight > 200 && r.width > 250 && r.bottom > 0 && r.top < innerHeight;
    }).sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    const s = cands[0]; if (!s) return;
    s.scrollTop = where === 'top' ? 0 : where === 'bottom' ? s.scrollHeight : (where as number);
  }, where);
  await page.waitForTimeout(700);
  if (where === 'bottom') {
    // Lists may grow as they reach the end; settle a couple of times.
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const cands = [...document.querySelectorAll('div')].filter(d => { const s = getComputedStyle(d); const r = d.getBoundingClientRect(); return /(auto|scroll)/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 4 && d.clientHeight > 200 && r.width > 250 && r.bottom > 0 && r.top < innerHeight; }).sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
        if (cands[0]) cands[0].scrollTop = cands[0].scrollHeight;
      });
      await page.waitForTimeout(400);
    }
  }
}

export async function scrollerInfo(page: Page) {
  return page.evaluate(() => {
    const cands = [...document.querySelectorAll('div')].filter(d => { const s = getComputedStyle(d); const r = d.getBoundingClientRect(); return /(auto|scroll)/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 4 && d.clientHeight > 200 && r.width > 250 && r.bottom > 0 && r.top < innerHeight; }).sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    const s = cands[0];
    return s ? { id: s.getAttribute('data-testid'), scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, scrollTop: s.scrollTop } : null;
  });
}

// ---------------------------------------------------------------------------
// Screenshots. Viewport shots at native DPR 3; a tall "full" capture at CSS scale.
// ---------------------------------------------------------------------------
export async function snap(page: Page, name: string) {
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(SHOTS, file) });
  return file;
}

export async function snapFull(page: Page, name: string) {
  const info = await scrollerInfo(page);
  const extra = info ? info.scrollHeight - info.clientHeight : 0;
  const height = Math.min(VIEW.height + Math.max(0, extra), 7_000);
  const file = `${name}-full.png`;
  if (height > VIEW.height + 10) {
    await page.setViewportSize({ width: VIEW.width, height });
    await page.waitForTimeout(1_200);
  }
  await page.screenshot({ path: path.join(SHOTS, file), scale: 'css' });
  if (height > VIEW.height + 10) {
    await page.setViewportSize(VIEW);
    await page.waitForTimeout(900);
  }
  return file;
}

// ---------------------------------------------------------------------------
// The in-page audit. Self-contained (it is serialised into the browser).
// ---------------------------------------------------------------------------
export type AuditIssue = { id: string | null; text: string; [k: string]: unknown };
export type Audit = {
  url: string; phase: string; scrollable: boolean; scroller: string | null;
  stats: { testids: number; visibleTextChars: number; visibleImages: number; errorFallback: boolean; loadingText: boolean; bodyText: string };
  smallTargets: AuditIssue[]; truncated: AuditIssue[]; clipped: AuditIssue[]; spills: AuditIssue[]; brokenWords: AuditIssue[];
  covered: AuditIssue[]; hiddenText: AuditIssue[]; letterbox: AuditIssue[]; brokenImages: AuditIssue[]; backButtons: string[];
  suspiciousText: AuditIssue[]; clippedControls: AuditIssue[];
};

export function pageAudit(phase: string): Audit {
  const VW = window.innerWidth, VH = window.innerHeight;
  const INTERACTIVE = '[tabindex="0"], button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"]';
  const tid = (el: Element | null): string | null => {
    let n: Element | null = el; let d = 0;
    while (n && n !== document.body && d < 12) { const t = n.getAttribute('data-testid'); if (t) return d ? `${t} > …` : t; n = n.parentElement; d++; }
    return null;
  };
  const txt = (el: Element) => ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const label = (el: Element) => el.getAttribute('aria-label') || txt(el);
  const visCache = new Map<Element, boolean>();
  const visible = (el: Element): boolean => {
    if (visCache.has(el)) return visCache.get(el)!;
    const r = el.getBoundingClientRect();
    let ok = r.width >= 1 && r.height >= 1;
    if (ok) {
      let n: Element | null = el; let op = 1;
      while (n) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden') { ok = false; break; }
        op *= parseFloat(s.opacity || '1'); if (op < 0.05) { ok = false; break; }
        n = n.parentElement;
      }
    }
    visCache.set(el, ok); return ok;
  };
  const inView = (r: DOMRect) => r.bottom > 0 && r.top < VH && r.right > 0 && r.left < VW;
  const round = (n: number) => Math.round(n * 10) / 10;

  // Main scroller.
  const scrollers = [...document.querySelectorAll('div')].filter(d => { const s = getComputedStyle(d); const r = d.getBoundingClientRect(); return /(auto|scroll)/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 4 && d.clientHeight > 200 && r.width > 250 && r.bottom > 0 && r.top < VH; }).sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
  const main = scrollers[0] || null;

  const out: Audit = {
    url: location.pathname + location.search, phase, scrollable: !!main, scroller: main ? main.getAttribute('data-testid') : null,
    stats: { testids: document.querySelectorAll('[data-testid]').length, visibleTextChars: 0, visibleImages: 0, errorFallback: !!document.querySelector('[data-testid="error-fallback"]'), loadingText: false, bodyText: '' },
    smallTargets: [], truncated: [], clipped: [], spills: [], brokenWords: [], covered: [], hiddenText: [], letterbox: [], brokenImages: [], backButtons: [], suspiciousText: [], clippedControls: [],
  };

  // ---- Interactive elements: size, coverage, back buttons.
  const interactive = [...document.querySelectorAll(INTERACTIVE)].filter(el => el.getAttribute('aria-hidden') !== 'true' && visible(el));
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    const id = tid(el);
    if (phase === 'top' && (r.width < 43.5 || r.height < 43.5)) {
      out.smallTargets.push({ id, text: label(el), w: round(r.width), h: round(r.height), tag: el.tagName.toLowerCase() });
    }
    // A control cut off by a container that hides overflow (e.g. a chip row shorter than its chips).
    if (phase === 'top') {
      let a: Element | null = el.parentElement; let d = 0;
      while (a && a !== document.body && d < 10) {
        const as = getComputedStyle(a); const ar = a.getBoundingClientRect();
        const hy = /(hidden|clip)/.test(as.overflowY), hx = /(hidden|clip)/.test(as.overflowX);
        const cutY = hy && (r.bottom > ar.bottom + 1.5 || r.top < ar.top - 1.5) ? Math.max(r.bottom - ar.bottom, ar.top - r.top) : 0;
        const cutX = hx && !/(auto|scroll)/.test(as.overflowY) && (r.right > ar.right + 1.5 || r.left < ar.left - 1.5) && r.left >= 0 && r.right <= VW ? Math.max(r.right - ar.right, ar.left - r.left) : 0;
        if (cutY > 1.5 || cutX > 1.5) { out.clippedControls.push({ id, text: label(el), by: tid(a), cut: `${round(cutY || cutX)}px ${cutY ? 'vertically' : 'horizontally'}`, size: `${round(r.width)}x${round(r.height)}` }); break; }
        if (/(auto|scroll)/.test(as.overflowY) || /(auto|scroll)/.test(as.overflowX)) { if (!hy) break; }
        a = a.parentElement; d++;
      }
    }
    if (!inView(r)) continue;
    // Back / close affordance in the top band of the screen.
    if (r.top < 170 && /back|previous|close|dismiss/i.test(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-testid') || ''}`)) out.backButtons.push(id || label(el));
    // Coverage: sample 5 points; covered when the centre or 3+ points hit an unrelated element.
    const pts = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]].map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]).filter(([x, y]) => x >= 0 && y >= 0 && x < VW && y < VH);
    if (!pts.length) continue;
    let hits = 0; let centre = false; let by: Element | null = null;
    pts.forEach(([x, y], i) => {
      const h = document.elementFromPoint(x, y);
      if (!h || el.contains(h) || h.contains(el)) return;
      hits++; if (i === 0) centre = true; by = by || h;
    });
    if (centre || hits >= 3) {
      const b = by as Element | null;
      let overlay: Element | null = b; let fixed = false;
      while (overlay && overlay !== document.body) { const p = getComputedStyle(overlay).position; if (p === 'fixed' || p === 'absolute') { fixed = true; break; } overlay = overlay.parentElement; }
      out.covered.push({ id, text: label(el), by: b ? (tid(b) || b.tagName) : null, overlayRoot: overlay ? tid(overlay) : null, overlayPositioned: fixed, points: `${hits}/${pts.length}`, rect: `${round(r.left)},${round(r.top)} ${round(r.width)}x${round(r.height)}`, cy: round((r.top + r.height / 2) / VH * 100) });
    }
  }

  // ---- Text: truncation, clipping, spilling out of a tile, words broken across lines.
  const textEls = [...document.querySelectorAll('[dir="auto"]')].filter(el => el.textContent && el.textContent.trim() && visible(el) && !['INPUT', 'TEXTAREA'].includes(el.tagName));
  const outer = textEls.filter(el => !el.parentElement?.closest('[dir="auto"]'));
  let charBudget = 40_000;
  const charRect = (node: Text, i: number) => { const rg = document.createRange(); rg.setStart(node, i); rg.setEnd(node, i + 1); const rs = rg.getClientRects(); return rs.length ? rs[0] : null; };
  for (const el of outer) {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect(); const id = tid(el); const text = txt(el);
    if (inView(r)) { out.stats.visibleTextChars += text.length; if (/^loading/i.test(text)) out.stats.loadingText = true; }
    // Programming leftovers that reached the screen: a literal "\n", undefined, NaN, null, [object Object].
    const raw = el.textContent || '';
    const odd = raw.match(/\\n|\bundefined\b|\bNaN\b|\bnull\b|\[object Object\]|₹\s*NaN|\{\{|\}\}/);
    if (odd) out.suspiciousText.push({ id, text: raw.replace(/\s+/g, ' ').trim().slice(0, 90), match: odd[0] });
    // Truncation (numberOfLines).
    const clamp = (s as any).webkitLineClamp;
    if (s.textOverflow === 'ellipsis' && /nowrap/.test(s.whiteSpace) && el.scrollWidth > el.clientWidth + 1) {
      // Where does the visible part end?
      let shown = text;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let acc = ''; let done = false;
      while (!done && walker.nextNode()) {
        const node = walker.currentNode as Text; const v = node.nodeValue || '';
        for (let i = 0; i < v.length; i++) { const cr = charRect(node, i); if (cr && cr.right > r.right - 6) { done = true; break; } acc += v[i]; }
      }
      if (done) shown = acc;
      const full = el.textContent || '';
      const cut = shown.length; const midWord = cut > 0 && cut < full.length && /\S/.test(full[cut - 1] || '') && /\S/.test(full[cut] || '');
      out.truncated.push({ id, text: full.trim().slice(0, 70), shown: shown.trim() + '…', kind: 'single-line', midWord, w: round(r.width) });
    } else if (clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 2) {
      out.truncated.push({ id, text: text, kind: `clamp-${clamp}`, midWord: null, w: round(r.width) });
    }
    // Content rectangle of the text itself.
    const range = document.createRange(); range.selectNodeContents(el); const tr = range.getBoundingClientRect();
    // Clipped by an ancestor with overflow hidden.
    let n: Element | null = el.parentElement; let xOpen = true, yOpen = true; let depth = 0;
    while (n && n !== document.body && depth < 14 && (xOpen || yOpen)) {
      const ns = getComputedStyle(n); const ar = n.getBoundingClientRect();
      const clipX = /(hidden|clip)/.test(ns.overflowX), clipY = /(hidden|clip)/.test(ns.overflowY);
      if (xOpen && clipX && (tr.left < ar.left - 1.5 || tr.right > ar.right + 1.5)) { out.clipped.push({ id, text, axis: 'x', by: tid(n), overflow: round(Math.max(ar.left - tr.left, tr.right - ar.right)) }); break; }
      if (yOpen && clipY && (tr.top < ar.top - 1.5 || tr.bottom > ar.bottom + 1.5)) { out.clipped.push({ id, text, axis: 'y', by: tid(n), overflow: round(Math.max(ar.top - tr.top, tr.bottom - ar.bottom)) }); break; }
      if (/(auto|scroll)/.test(ns.overflowX)) xOpen = false;
      if (/(auto|scroll)/.test(ns.overflowY)) yOpen = false;
      n = n.parentElement; depth++;
    }
    // Text spilling out of the tappable tile that contains it.
    const tile = el.closest(INTERACTIVE);
    if (tile && tile !== el) {
      const pr = tile.getBoundingClientRect();
      const spill = Math.max(pr.left - tr.left, tr.right - pr.right);
      if (spill > 2) out.spills.push({ id, text, tile: tid(tile), spill: round(spill) });
    }
    // Words broken across two lines (e.g. "Himalay" / "a").
    if (!/nowrap/.test(s.whiteSpace) && charBudget > 0) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text; const v = node.nodeValue || ''; charBudget -= v.length;
        const re = /\S{2,}/g; let m: RegExpExecArray | null;
        while ((m = re.exec(v))) {
          // A wrap inside the word means the next character jumps back to the left and down.
          // (Checking x as well as y keeps rotated badges from looking like wraps.)
          let split = 0; let prev = charRect(node, m.index);
          for (let i = 1; prev && i < m[0].length; i++) {
            const c = charRect(node, m.index + i); if (!c) continue;
            if (c.left < prev.left - 2 && c.top > prev.top + Math.max(3, prev.height * 0.4)) { split = i; break; }
            prev = c;
          }
          if (!split) continue;
          const before = m[0][split - 1];
          if (/[-/–—,·&.:)]/.test(before)) continue; // a normal break opportunity, not a broken word
          out.brokenWords.push({ id, text, word: m[0], split: `${m[0].slice(0, split)} | ${m[0].slice(split)}`, w: round(r.width) });
        }
      }
    }
  }

  // ---- Text hidden under a floating bar at the end of scrolling.
  if (phase === 'bottom') {
    for (const el of outer) {
      const r = el.getBoundingClientRect(); if (!inView(r) || r.height < 4) continue;
      // Decorative labels (e.g. discount badges) ignore touches, so hit-testing cannot see them.
      if (getComputedStyle(el).pointerEvents === 'none' || el.closest('[style*="pointer-events: none"]')) continue;
      const cx = Math.min(VW - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(VH - 1, Math.max(0, r.top + r.height / 2));
      const h = document.elementFromPoint(cx, cy);
      if (h && !el.contains(h) && !h.contains(el)) {
        let o: Element | null = h; let positioned = false;
        while (o && o !== document.body) { const p = getComputedStyle(o).position; if (p === 'fixed' || p === 'absolute') { positioned = true; break; } o = o.parentElement; }
        out.hiddenText.push({ id: tid(el), text: txt(el), by: tid(h) || h.tagName, overlayRoot: o ? tid(o) : null, positioned, cy: Math.round(cy / VH * 100) });
      }
    }
  }

  // ---- Images: letterboxing and broken images (expo-image renders a div > img).
  for (const wrap of [...document.querySelectorAll('[data-expoimage]')]) {
    if (!visible(wrap)) continue;
    const imgs = wrap.querySelectorAll('img'); const img = imgs[imgs.length - 1] as HTMLImageElement | undefined; if (!img) continue;
    const r = wrap.getBoundingClientRect();
    if (inView(r) && img.naturalWidth) out.stats.visibleImages++;
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) { out.brokenImages.push({ id: tid(wrap), text: '', src: img.getAttribute('src') }); continue; }
    if (!img.naturalWidth || !img.naturalHeight) continue;
    const fit = getComputedStyle(img).objectFit;
    if (fit !== 'contain' && fit !== 'scale-down') continue;
    const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const cw = img.naturalWidth * k, ch = img.naturalHeight * k; const fill = (cw * ch) / (r.width * r.height);
    if (fill < 0.9) out.letterbox.push({ id: tid(wrap), text: '', fill: Math.round(fill * 100), frame: `${round(r.width)}x${round(r.height)}`, natural: `${img.naturalWidth}x${img.naturalHeight}`, bars: cw < r.width - 1 ? 'left/right' : 'top/bottom' });
  }
  out.stats.bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return out;
}

export async function audit(page: Page, phase: 'top' | 'bottom'): Promise<Audit> {
  return page.evaluate(pageAudit, phase);
}

// ---------------------------------------------------------------------------
// State seeding (AsyncStorage on web is plain localStorage).
// ---------------------------------------------------------------------------
export const CUSTOMER_KEY_STORAGE = 'onecity.customer-key.v1';
export function newCustomerKey() { return [...Array(48)].map(() => Math.floor(Math.random() * 16).toString(16)).join(''); }

export async function seedStorage(page: Page, values: Record<string, unknown>) {
  await page.addInitScript(values => {
    try {
      if (sessionStorage.getItem('__e2e_seeded')) return;
      for (const [k, v] of Object.entries(values)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      sessionStorage.setItem('__e2e_seeded', '1');
    } catch { /* storage blocked */ }
  }, values);
}

export type CatalogProduct = { id: string; name: string; weight: string; price: number; mrp: number; image: string; category_id: string; store_id: string; department?: string; brand_id?: string; delivery_min: number; discount_pct?: number; rating: number };
export type Catalog = { products: CatalogProduct[]; brands: { id: string; name: string; department: string; logo: string }[]; categories: { id: string; name: string; department: string }[]; events: { id: string; title: string }[]; themed_stores: { id: string }[] };
let catalogCache: Catalog | null = null;
export async function catalog(request: APIRequestContext): Promise<Catalog> {
  if (catalogCache) return catalogCache;
  const r = await request.get(`${BASE}/api/catalog`);
  expect(r.ok()).toBeTruthy();
  catalogCache = await r.json();
  const c = catalogCache!;
  // Lets e2e/summarize.mjs collapse "product-image-home-f5" and "…-f6" into one row.
  const ids = [...c.products.map(p => p.id), ...c.brands.map(b => b.id), ...c.categories.map(x => x.id), ...c.events.map(e => e.id), ...c.themed_stores.map(t => t.id), 's1', 's2', 's3'];
  fs.writeFileSync(path.join(RESULTS, 'catalog-ids.json'), JSON.stringify(ids));
  return c;
}

export function cartItems(products: CatalogProduct[], qty = 1) {
  return products.map(p => ({ id: p.id, name: p.name, weight: p.weight, price: p.price, mrp: p.mrp, image: `${BASE}${p.image}`, category_id: p.category_id, store_id: p.store_id, department: p.department, brand_id: p.brand_id, qty }));
}

/** Creates a sample order through the app's own API for a given device key. */
export async function createOrder(request: APIRequestContext, key: string, products: CatalogProduct[]) {
  const items = products.map(p => ({ id: p.id, name: p.name, weight: p.weight, price: p.price, mrp: p.mrp, image: p.image, qty: 2 }));
  const subtotal = items.reduce((a, b) => a + b.price * b.qty, 0);
  const r = await request.post(`${BASE}/api/orders`, {
    headers: { 'x-customer-key': key, 'content-type': 'application/json', 'idempotency-key': newCustomerKey().slice(0, 32) },
    // No `total`: the server prices the bill itself (it adds GST) and only checks a total if one is sent.
    data: { items, subtotal, coupon_code: null, payment_method: 'cod' },
  });
  expect(r.ok(), `create order: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as { id: string };
}

// ---------------------------------------------------------------------------
// Result files.
// ---------------------------------------------------------------------------
export function writeResult(kind: string, name: string, data: unknown) {
  fs.mkdirSync(path.join(RESULTS, kind), { recursive: true });
  fs.writeFileSync(path.join(RESULTS, kind, `${slugify(name)}.json`), JSON.stringify(data, null, 2));
}

export function annotate(testInfo: TestInfo, type: string, description: string) {
  testInfo.annotations.push({ type, description: description.slice(0, 900) });
}

// ---------------------------------------------------------------------------
// A UI "state signature" used to decide whether a tap did anything visible.
// ---------------------------------------------------------------------------
export async function signature(page: Page) {
  return page.evaluate(() => {
    const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
    const inter = [...document.querySelectorAll('[tabindex="0"], button, input, textarea, [role]')];
    const states = inter.map(e => `${e.getAttribute('aria-selected')}${e.getAttribute('aria-expanded')}${e.getAttribute('aria-checked')}${e.getAttribute('aria-pressed')}${e.getAttribute('aria-label')}${(e as HTMLInputElement).value ?? ''}${getComputedStyle(e).backgroundColor}${getComputedStyle(e).borderColor}`).join('|');
    const scrollers = [...document.querySelectorAll('div')].filter(d => d.scrollHeight > d.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(d).overflowY)).map(d => Math.round(d.scrollTop)).join(',');
    let ls = ''; try { ls = Object.keys(localStorage).sort().map(k => k + '=' + localStorage.getItem(k)).join(';'); } catch { /* ignore */ }
    const visibleText = [...document.querySelectorAll('[dir="auto"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; }).map(e => e.textContent).join('|');
    return { url: location.pathname + location.search, text: hash(visibleText), nodes: document.querySelectorAll('*').length, states: hash(states), scroll: scrollers, storage: hash(ls), clipboard: (window as any).__e2eClipboard || '' };
  });
}
