/* Test fixture.
 *
 * By default every test is a *returning* visitor:
 *  - the first-launch sign-in prompt (app-shell useWelcomeGate → /sign-in?welcome=1) is
 *    marked as seen, so it does not replace the screen under test;
 *  - the launch intro (src/components/intro-splash.tsx, ~2.5 s on every page load) is
 *    marked as played, using the same in-memory flag the component sets itself.
 * The first-launch experience is audited on its own in first-launch.spec.ts with
 * `test.use({ firstLaunch: true })`, which turns both of these off. */
import { test as base, expect } from '@playwright/test';

export const WELCOME_KEY = 'onecity.welcome-seen.v1';

export const test = base.extend<{ firstLaunch: boolean; returningVisitor: void }>({
  firstLaunch: [false, { option: true }],
  returningVisitor: [async ({ page, firstLaunch }, use) => {
    if (!firstLaunch) {
      await page.addInitScript(key => {
        try { localStorage.setItem(key, '1'); } catch { /* storage blocked */ }
        (globalThis as unknown as { __onecityIntroPlayed?: boolean }).__onecityIntroPlayed = true;
      }, WELCOME_KEY);
    }
    await use();
  }, { auto: true }],
});
export { expect };
