// KYC demo for LemonSqueezy — clean landscape screen recording of the REAL product
// (runboardroom.com) running a real board meeting end-to-end: debate → verdict → red team.
// Uses the logged-in pw-debug Chrome profile so it records the actual paid account.
import { chromium } from 'playwright';
import os from 'node:os';

const PROFILE = `${os.homedir()}/.chrome-pw-debug`;
const OUTDIR = process.argv[2] || '/tmp/kyc-rec';
const QUESTION = process.argv[3] || 'Should I raise my prices 20%?';

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  channel: 'chrome',
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUTDIR, size: { width: 1280, height: 800 } },
  deviceScaleFactor: 2,
  args: ['--no-first-run', '--no-default-browser-check'],
});
const page = await ctx.newPage();
for (const p of ctx.pages()) { if (p !== page) { try { await p.close(); } catch {} } }

await page.goto('https://runboardroom.com/board.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(4000);

// dismiss the "How it works" helper if present, so the demo is clean
await page.evaluate(() => {
  const got = [...document.querySelectorAll('button')].find(b => /Got it/i.test(b.textContent || ''));
  if (got) got.click();
});
await page.waitForTimeout(1500);

// type a real decision and convene the board
await page.evaluate((q) => {
  const i = document.getElementById('q');
  if (i) { i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); }
}, QUESTION);
await page.waitForTimeout(1200);
await page.evaluate(() => { const g = document.getElementById('go'); if (g) g.click(); });
console.log('meeting convened, recording the debate…');

// record until the verdict + red team land (or ~150s cap)
const t0 = Date.now();
let done = false;
while (Date.now() - t0 < 150000) {
  done = await page.evaluate(() => /CONFIRMED|DOWNGRADED|SURVIVES|Red team|레드팀|Attack the verdict/i.test(document.body.innerText)
    && !!document.querySelector('.verdictcard, .bub.chair, [class*="verdict"]'));
  if (done) break;
  await page.waitForTimeout(2000);
}
// let the final verdict sit on screen, then gently scroll to show full transcript
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await page.waitForTimeout(4000);

console.log('done?', done);
await ctx.close();
console.log('saved to', OUTDIR);
