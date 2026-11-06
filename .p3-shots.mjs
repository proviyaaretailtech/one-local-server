import { chromium } from 'playwright';
import fs from 'node:fs';
const src = fs.readFileSync('/Users/lohit/agentic-os-coder/One Local Delivery app /vinii_partner/tool/local_db/seed_test_logins.py', 'utf8');
const pw = (src.match(/TEST_PASSWORD\s*=\s*["']([^"']+)["']/) || [])[1];
const OUT = process.argv[2];
const step = process.argv[3] || 'all';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const shot = async (n) => { await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
const sem = async () => { const ph = p.locator('flt-semantics-placeholder'); if (await ph.count()) await ph.click({ force: true }).catch(() => {}); await p.waitForTimeout(800); };
const tap = async (name) => { const l = p.getByRole('button', { name, exact: false }).or(p.getByText(name, { exact: true })).first(); await l.click(); await p.waitForTimeout(1200); };
await p.goto('http://127.0.0.1:8098/');
await p.waitForTimeout(8000);
await sem();
const email = p.getByRole('textbox', { name: /email/i }).first();
if (await email.count()) {
  // intro skip if present
  await email.click(); await p.keyboard.type('owner@pilot.local');
  await p.getByRole('textbox', { name: /password/i }).first().click(); await p.keyboard.type(pw);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(6000);
} else {
  const skip = p.getByRole('button', { name: /skip/i }); if (await skip.count()) { await skip.click(); await p.waitForTimeout(2000); await sem();
    await p.getByRole('textbox', { name: /email/i }).first().click(); await p.keyboard.type('owner@pilot.local');
    await p.getByRole('textbox', { name: /password/i }).first().click(); await p.keyboard.type(pw);
    await p.keyboard.press('Enter'); await p.waitForTimeout(6000); }
}
await sem();
const org = p.getByText(/spice/i).first(); if (await org.count() && (await p.getByRole('button', { name: /To Hub/i }).count()) === 0) { await org.click(); await p.waitForTimeout(5000); }
await shot('p3-01-orders');
fs.writeFileSync(`${OUT}/tree.txt`, (await p.locator('flt-semantics-host, flt-glass-pane').first().innerText().catch(() => '')) || '');
await b.close();
