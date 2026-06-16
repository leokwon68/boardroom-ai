// KYC demo — clean landscape recording of the product running a real board meeting.
// Local server (same UI as runboardroom.com), claude-CLI brain, no login. recordVideo
// captures only page content (no URL bar), so it reads as the product in action.
import { chromium } from 'playwright';
const OUTDIR = process.argv[2] || '/tmp/kyc-local';
const QUESTION = process.argv[3] || 'Should I raise my prices 20%?';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUTDIR, size: { width: 1280, height: 800 } },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto('http://localhost:4242/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// clean: dismiss helper, go to the board meeting view
await page.evaluate(() => {
  const got = [...document.querySelectorAll('button')].find(b => /Got it/i.test(b.textContent || ''));
  if (got) got.click();
  const nav = [...document.querySelectorAll('nav button')].find(x => x.dataset && x.dataset.v === 'meeting');
  if (nav) nav.click();
});
await page.waitForTimeout(1500);

await page.evaluate((q) => {
  const i = document.getElementById('q');
  if (i) { i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); }
}, QUESTION);
await page.waitForTimeout(1000);
await page.evaluate(() => { const g = document.getElementById('go'); if (g) g.click(); });
console.log('meeting convened…');

const t0 = Date.now();
let done = false;
while (Date.now() - t0 < 200000) {
  done = await page.evaluate(() => /SURVIVES|CONFIRMED|DOWNGRADED|Red Team|Red team/i.test(document.body.innerText)
    && !!document.querySelector('.verdictcard, .bub.chair, [class*="verdict"]'));
  if (done) break;
  await page.waitForTimeout(2500);
}
await page.waitForTimeout(3500);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await page.waitForTimeout(4500);
console.log('done?', done);
await ctx.close();
await browser.close();
console.log('saved', OUTDIR);
