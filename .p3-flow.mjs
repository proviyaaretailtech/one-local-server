import { chromium } from 'playwright';
import fs from 'node:fs';
const S = '/private/tmp/claude-501/-Users-lohit-agentic-os-coder/0a21f521-2fcb-48eb-8ade-e0aff5dc2a36/scratchpad';
const OUT = `${S}/shots`;
const src = fs.readFileSync('/Users/lohit/agentic-os-coder/One Local Delivery app /vinii_partner/tool/local_db/seed_test_logins.py', 'utf8');
const pw = (src.match(/TEST_PASSWORD\s*=\s*["']([^"']+)["']/) || [])[1];
const ctx = await chromium.launchPersistentContext(`${S}/pwprofile`, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = ctx.pages()[0] || await ctx.newPage();
p.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.request().method(), r.url().replace(/[?].*/, '')); });
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (n) => { await wait(1500); await p.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
const sem = async () => { await p.evaluate(() => document.querySelector('flt-semantics-placeholder')?.click()); await wait(800); };
const role = (r, name) => p.getByRole(r, { name }).first();
const click = async (r, name) => { await role(r, name).click(); await wait(1500); };
const has = async (r, name) => (await p.getByRole(r, { name }).count()) > 0;
const dump = async () => console.log((await p.evaluate(() => [...document.querySelectorAll('flt-semantics [aria-label], flt-semantics [role]')].map(e => `${e.getAttribute('role')||''}:${e.getAttribute('aria-label')||e.textContent.trim().slice(0,40)}`).slice(0, 80).join(' | '))));
const steps = process.argv.slice(2);
await p.goto('http://127.0.0.1:8098/');
await p.waitForSelector('flutter-view, flt-glass-pane', { timeout: 120000 });
await wait(9000);
await sem();
for (const st of steps) {
  const [cmd, ...rest] = st.split(':'); const arg = rest.join(':');
  if (cmd === 'dump') await dump();
  else if (cmd === 'shot') await shot(arg);
  else if (cmd === 'btn') await click('button', new RegExp(arg, 'i'));
  else if (cmd === 'text') { await p.getByText(new RegExp(arg, 'i')).first().click(); await wait(1500); }
  else if (cmd === 'xy') { const [x, y] = arg.split(',').map(Number); await p.mouse.click(x, y); await wait(1500); }
  else if (cmd === 'wheel') { await p.mouse.move(195, 400); await p.mouse.wheel(0, Number(arg)); await wait(1200); }
  else if (cmd === 'wait') await wait(Number(arg));
  else if (cmd === 'login') {
    if (await has('button', /skip/i)) await click('button', /skip/i);
    await sem();
    await p.locator('[aria-label="Email"]').first().click(); await wait(600); await p.keyboard.type('owner@pilot.local');
    await p.locator('[aria-label="Password"]').first().click(); await wait(600); await p.keyboard.type(pw);
    await p.keyboard.press('Enter'); await wait(7000); await sem();
  } else if (cmd === 'type') { await p.keyboard.type(arg); await wait(1200); }
  else if (cmd === 'sem') await sem();
}
await ctx.close();
