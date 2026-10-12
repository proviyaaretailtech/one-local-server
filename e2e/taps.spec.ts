/* Dead-tap sweep: on each screen, tap every distinct tappable element and check that
 * *something* happened: navigation, visible text, a selected/expanded state, colour,
 * scroll position, or saved state. A tap that changes nothing is a "dead tap".
 * A tap that the browser refuses because another element sits on top is "blocked".
 * Shared chrome (header, department strip, bottom tabs) is only tapped on Home. */
import { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { catalog, newCustomerKey, openRoute, scrollMain, signature, writeResult } from './helpers';
import { SCREENS, prepare, readySelector } from './routes';

// Taps with side effects outside the app, or destructive ones covered by journeys instead.
const SKIP = /google|sign-out|checkout-btn|delete|remove|confirm|ai-take-photo|ai-choose-photo|voice-record|intro-splash/;
const SHARED = /^(tab-|header-|department-|location-button|global-back-button|compact-|page-back-button|page-search-button|floating-cart)/;

type Candidate = { id: string; label: string; phase: 'top' | 'bottom'; pattern: string; selected: boolean };
type Outcome = Candidate & { result: 'changed' | 'dead' | 'blocked' | 'skipped' | 'already-selected'; changed?: string[]; error?: string; urlAfter?: string };

async function candidates(page: Page, phase: 'top' | 'bottom', normalise: (id: string) => string): Promise<Candidate[]> {
  const raw = await page.evaluate(() => {
    const sel = '[tabindex="0"], button, a[href], input, textarea, [role="button"], [role="tab"], [role="link"], [role="switch"], [role="checkbox"]';
    return [...document.querySelectorAll(sel)].map(el => {
      const r = el.getBoundingClientRect();
      let vis = r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      for (let n: Element | null = el; vis && n; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') vis = false; }
      const selected = ['aria-selected', 'aria-checked', 'aria-pressed'].some(a => el.getAttribute(a) === 'true');
      return { selected, id: el.getAttribute('data-testid') || '', label: (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50), vis, tag: el.tagName };
    }).filter(c => c.vis && c.id && !['INPUT', 'TEXTAREA'].includes(c.tag));
  });
  return raw.map(c => ({ id: c.id, label: c.label, phase, pattern: normalise(c.id), selected: c.selected }));
}

test.describe.configure({ mode: 'parallel', retries: 0 });

for (const screen of SCREENS.filter(s => !s.expectMissing)) {
  test(`taps ${screen.name}`, async ({ page, request }) => {
    test.setTimeout(420_000);
    const c = await catalog(request);
    const ids = [...c.products.map(p => p.id), ...c.brands.map(b => b.id), ...c.categories.map(x => x.id), ...c.events.map(e => e.id), ...c.themed_stores.map(t => t.id), 's1', 's2', 's3']
      .sort((a, b) => b.length - a.length).map(x => x.replace(/[-]/g, '\\-'));
    const idRe = new RegExp(`(^|-)(${ids.join('|')})(?=-|$)`, 'g');
    const normalise = (id: string) => id.replace(idRe, '$1*').replace(/[0-9a-f]{8,}/g, '#').replace(/\d+/g, 'N');

    const key = newCustomerKey();
    const route = await prepare(screen, { page, request, key });
    await openRoute(page, route, readySelector(screen));
    const landed = page.url();

    // Collect candidates at the top and at the end of the main scroll.
    const seen = new Set<string>();
    const list: Candidate[] = [];
    for (const phase of ['top', 'bottom'] as const) {
      if (phase === 'bottom') await scrollMain(page, 'bottom');
      for (const cand of await candidates(page, phase, normalise)) {
        if (seen.has(cand.pattern)) continue;
        seen.add(cand.pattern);
        if (screen.name !== 'home' && SHARED.test(cand.id)) continue;
        list.push(cand);
      }
    }
    const capped = list.slice(0, 24);
    const outcomes: Outcome[] = [];
    let dirty = true;
    const dialogs: string[] = [];
    page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });

    for (const cand of capped) {
      if (SKIP.test(cand.id)) { outcomes.push({ ...cand, result: 'skipped' }); continue; }
      if (dirty) {
        await openRoute(page, landed, readySelector(screen)).catch(() => {});
        if (cand.phase === 'bottom') await scrollMain(page, 'bottom');
        dirty = false;
      } else if (cand.phase === 'bottom') await scrollMain(page, 'bottom');
      const el = page.locator(`[data-testid="${cand.id}"]`).filter({ visible: true }).first();
      if (!(await el.count())) { outcomes.push({ ...cand, result: 'skipped', error: 'not visible after reload' }); continue; }
      const before = await signature(page);
      const dialogCount = dialogs.length;
      try {
        await el.tap({ timeout: 4_000 });
      } catch (e) {
        const msg = (e as Error).message;
        const intercept = msg.match(/<[^>]*data-testid="([^"]+)"[^>]*> (?:from <[^>]*> subtree )?intercepts pointer events/);
        const reason = [...new Set(msg.split('\n').map(l => l.trim()).filter(l => /intercepts pointer events|outside of the viewport|not stable|not visible|not enabled/.test(l)))].slice(-1)[0];
        outcomes.push({ ...cand, result: 'blocked', error: intercept ? `covered by ${intercept[1]}` : (reason || msg.split('\n')[0]).slice(0, 220) });
        dirty = true;
        continue;
      }
      await page.waitForTimeout(900);
      let after = await signature(page);
      const diff = (a: typeof before, b: typeof before): string[] => (Object.keys(a) as (keyof typeof a)[]).filter(k => a[k] !== b[k]);
      let changed: string[] = diff(before, after);
      if (!changed.length && dialogs.length === dialogCount) { await page.waitForTimeout(1_200); after = await signature(page); changed = diff(before, after); }
      if (dialogs.length > dialogCount) changed.push('dialog');
      // Re-tapping the option that is already selected is allowed to do nothing. React Native Web
      // does not always expose "selected" as aria-selected, so confirm a dead tap: tap a sibling
      // option in the same row, then this one again. If that changes something, it was selected.
      let result: Outcome['result'] = changed.length ? 'changed' : cand.selected ? 'already-selected' : 'dead';
      if (result === 'dead') {
        const sibling = await el.evaluate(node => {
          const row = node.parentElement?.closest('div:has(> [data-testid] ~ [data-testid])') || node.parentElement;
          const others = [...(row?.querySelectorAll('[tabindex="0"][data-testid], button[data-testid]') || [])].filter(o => o !== node && !o.contains(node) && !node.contains(o));
          return others.length ? others[0].getAttribute('data-testid') : null;
        }).catch(() => null);
        if (sibling) {
          const sib = page.locator(`[data-testid="${sibling}"]`).filter({ visible: true }).first();
          const here = () => { const u = new URL(page.url()); return u.pathname + u.search; };
          if (await sib.tap({ timeout: 3_000 }).then(() => true).catch(() => false) && here() === before.url) {
            await page.waitForTimeout(700);
            const mid = await signature(page);
            if (await el.tap({ timeout: 3_000 }).then(() => true).catch(() => false)) {
              await page.waitForTimeout(900);
              if (diff(mid, await signature(page)).length) result = 'already-selected';
            }
          }
          dirty = true;
        }
      }
      outcomes.push({ ...cand, result, changed, urlAfter: after.url });
      if (changed.length) dirty = true;
    }

    writeResult('taps', screen.name, { screen: screen.name, route, candidates: list.length, tested: capped.length, outcomes });
    const dead = outcomes.filter(o => o.result === 'dead');
    const blocked = outcomes.filter(o => o.result === 'blocked');
    test.info().annotations.push({ type: 'taps', description: `${outcomes.length} tapped, ${dead.length} dead, ${blocked.length} blocked` });
    expect.soft(dead.map(d => `${d.id} (${d.label})`), 'taps with no visible effect').toEqual([]);
    expect.soft(blocked.map(d => `${d.id}: ${d.error}`), 'taps blocked by another element').toEqual([]);
  });
}
