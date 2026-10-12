/* First launch: a brand-new visitor sees the intro, then is offered sign-in once
 * (src/components/app-shell.tsx useWelcomeGate → /sign-in?welcome=1). Skipping must
 * land them where they were going, and the prompt must not come back. */
import { test, expect } from './fixtures';
import { audit, byId, monitor, snap, waitForApp, writeResult, realConsoleErrors, unexpectedApi } from './helpers';

test.use({ firstLaunch: true });

for (const target of [{ name: 'home', route: '/', ready: 'home-screen' }, { name: 'deep-link-store', route: '/store/s1', ready: 'store-screen' }]) {
  test(`first launch via ${target.route}: intro → sign-in offer → skip → ${target.name}`, async ({ page }) => {
    const m = monitor(page);
    const steps: { name: string; ok: boolean; note?: string }[] = [];
    const record = async (name: string, fn: () => Promise<string | void>) => {
      try { const note = await fn(); steps.push({ name, ok: true, note: note || undefined }); }
      catch (e) { steps.push({ name, ok: false, note: (e as Error).message.split('\n')[0] }); throw e; }
      finally { writeResult('first-launch', target.name, { route: target.route, steps, consoleErrors: realConsoleErrors(m), pageErrors: m.pageErrors, apiFailures: unexpectedApi(m) }); }
    };
    await page.goto(target.route, { waitUntil: 'domcontentloaded' });
    await record('intro splash plays', async () => {
      await expect(page.locator('[data-testid="intro-splash"]')).toBeVisible({ timeout: 60_000 });
      await snap(page, `first-launch-${target.name}-intro`);
      const t0 = Date.now();
      await expect(page.locator('[data-testid="intro-splash"]')).toHaveCount(0, { timeout: 15_000 });
      return `intro visible for ~${((Date.now() - t0) / 1000).toFixed(1)} s after first paint`;
    });
    await record('sign-in offer appears once', async () => {
      await waitForApp(page, '[data-testid="sign-in-screen"]');
      await expect(page).toHaveURL(/\/sign-in\?welcome=1/);
      await snap(page, `first-launch-${target.name}-sign-in`);
      const a = await audit(page, 'top');
      writeResult('sweep', `sign-in-welcome-${target.name}`, { screen: `sign-in-welcome-${target.name}`, route: '/sign-in?welcome=1', finalUrl: '/sign-in?welcome=1', screenshots: [`first-launch-${target.name}-sign-in.png`], consoleErrors: realConsoleErrors(m), pageErrors: m.pageErrors, apiFailures: unexpectedApi(m), apiBlocked: [], requestFailed: [], backButtons: a.backButtons, top: a, bottom: a, nearBlank: false, stuckLoading: false, backMissing: false, readyError: '' });
    });
    await record('a finger tap on the centre of “Skip for now” works', async () => {
      const box = (await byId(page, 'sign-in-skip').boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1_500);
      const stillThere = /sign-in/.test(page.url());
      expect.soft(stillThere, 'tap on the centre of "Skip for now" was swallowed (a decorative glow sits on top of it: app/sign-in.tsx s.glow)').toBe(false);
      if (stillThere) {
        // Continue through the uncovered top-right corner so the rest of the flow is still checked.
        await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height * 0.2);
        return 'BLOCKED at centre; only the top-right corner of the button responds';
      }
    });
    await record('“Skip for now” returns to the requested screen', async () => {
      await expect(byId(page, target.ready)).toBeVisible({ timeout: 20_000 });
      await expect(page).toHaveURL(new RegExp(`${target.route.replace(/\//g, '\\/')}$`));
    });
    await record('the offer does not return on the next load', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForApp(page, `[data-testid="${target.ready}"]`);
      await expect(page).not.toHaveURL(/sign-in/);
    });
  });
}
