/* Screen sweep: visit every screen, record errors, detect blank screens, run the
 * interaction-quality audit (tap targets, clipped/truncated/broken text, overlaps,
 * letterboxing, back navigation) and save screenshots to e2e/screenshots/.
 *
 * Hard errors are soft assertions (the test goes red but keeps collecting).
 * Quality findings are written to e2e/results/sweep/*.json and summarised by
 * `node e2e/summarize.mjs` into e2e/results/summary.md.
 */
import { test, expect } from './fixtures';
import { annotate, audit, stopwatch, blockedApi, monitor, newCustomerKey, openRoute, realConsoleErrors, scrollMain, scrollerInfo, snap, snapFull, unexpectedApi, writeResult } from './helpers';
import { SCREENS, prepare, readySelector } from './routes';

test.describe.configure({ mode: 'parallel', retries: 0 });

for (const screen of SCREENS) {
  test(`sweep ${screen.name}`, async ({ page, request }, testInfo) => {
    const m = monitor(page); const sw = stopwatch();
    const key = newCustomerKey();
    const route = await prepare(screen, { page, request, key });
    let readyError = '';
    try {
      await openRoute(page, route, readySelector(screen));
    } catch (e) {
      readyError = `ready marker "${screen.ready}" not shown: ${(e as Error).message.split('\n')[0]}`;
    }
    sw.mark('open');
    if (screen.expectMissing) await page.waitForTimeout(6_000); // give the fetch time to fail

    const top = await audit(page, 'top');
    sw.mark('audit');
    const shotTop = await snap(page, screen.name);
    sw.mark('shot');
    const info = await scrollerInfo(page);
    let bottom = top; let shotBottom = '';
    if (info) {
      await scrollMain(page, 'bottom');
      bottom = await audit(page, 'bottom');
      shotBottom = await snap(page, `${screen.name}-bottom`);
      await scrollMain(page, 'top');
    }
    sw.mark('bottom');
    const shotFull = await snapFull(page, screen.name);
    sw.mark('full');
    if (process.env.E2E_TIMING) console.log(screen.name, sw.toString());

    const nearBlank = top.stats.visibleTextChars < 40 && top.stats.visibleImages < 1;
    const stuckLoading = top.stats.loadingText || /^(Loading|Loading store)\.*$/i.test(top.stats.bodyText.replace(/(Home|Categories|Discover|Food|Book It)/g, '').trim());
    const needsBack = !screen.tab && screen.name !== 'home';
    const backMissing = needsBack && top.backButtons.length === 0;

    const result = {
      screen: screen.name, route, finalUrl: page.url().replace('http://localhost:8081', ''), blocked: screen.blocked || null,
      readyError, nearBlank, stuckLoading, backMissing, backButtons: top.backButtons,
      screenshots: [shotTop, shotBottom, shotFull].filter(Boolean),
      consoleErrors: realConsoleErrors(m), pageErrors: m.pageErrors, apiFailures: unexpectedApi(m), apiBlocked: blockedApi(m), requestFailed: m.requestFailed,
      scroller: info, top, bottom,
    };
    writeResult('sweep', screen.name, result);

    for (const a of result.apiBlocked) annotate(testInfo, 'blocked', `${a.method} ${a.url} → ${a.status} (${a.kind})`);
    if (top.smallTargets.length) annotate(testInfo, 'small-targets', top.smallTargets.map(s => `${s.id} ${s.w}x${s.h}`).join('; '));
    if (top.brokenWords.length) annotate(testInfo, 'broken-words', top.brokenWords.map(s => `${s.id}: ${s.split}`).join('; '));

    if (screen.expectMissing) {
      // The screen must not hang on a spinner/"Loading..." and must offer a way out.
      expect.soft(stuckLoading, `${route} is stuck on a loading message (${top.stats.bodyText.slice(0, 80)})`).toBe(false);
      const wayOut = await page.locator('[tabindex="0"], button, [role="button"]').filter({ visible: true }).filter({ hasText: /go back|back to|home|explore|browse|try again|keep exploring/i }).count();
      expect.soft(top.backButtons.length + wayOut, `${route} offers no way back`).toBeGreaterThan(0);
      return;
    }
    expect.soft(readyError, 'screen rendered its ready marker').toBe('');
    expect.soft(m.pageErrors, 'uncaught page errors').toEqual([]);
    expect.soft(result.apiFailures, 'unexpected non-2xx /api responses').toEqual([]);
    expect.soft(top.stats.errorFallback, 'error boundary shown').toBe(false);
    expect.soft(nearBlank, 'screen is blank or near-blank').toBe(false);
    expect.soft(stuckLoading, 'screen stuck on loading').toBe(false);
    expect.soft(backMissing, 'non-tab screen has a back/close control in the top band').toBe(false);
  });
}
