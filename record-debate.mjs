// Record the AI board DEBATING (chat bubbles streaming in) → 9:16 for ad reels.
// Emphasis: autonomous execs argue live. Real engine, English.
import { chromium } from 'playwright';
const QUESTION = process.argv[2] || 'Should we raise our prices 20%?';
const OUTDIR = process.argv[3] || '/tmp/debate-rec';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  viewport: { width: 760, height: 1280 },
  recordVideo: { dir: OUTDIR, size: { width: 760, height: 1280 } },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto('http://localhost:4242/', { waitUntil: 'networkidle' });
// go to the "Ask the board" view + hide chrome we don't want in the reel
await page.evaluate((q) => {
  const b = [...document.querySelectorAll('nav button')].find(x => x.dataset.v === 'meeting');
  if (b) b.click();
  document.body.classList.add('fz3');                  // big, readable bubbles
  const s = document.createElement('style');
  s.textContent = `
    .sidebar{display:none!important} .app{grid-template-columns:1fr!important}
    .main{max-width:820px!important;padding:20px 22px!important}
    .card{border:0!important;background:transparent!important;box-shadow:none!important;padding:0!important}
    .askhead,.asksub,#usagebar,#exq,.askrow,#ready,#apfeed{display:none!important}
    .livebar{margin:0 0 16px!important}
    .bub{margin-bottom:16px!important} .bub .av{width:42px!important;height:42px!important;flex:0 0 42px!important;font-size:15px!important}
    .bub .who{font-size:15px!important} .bub .txt{font-size:21px!important;line-height:1.6!important;color:#dfe4ee!important}
  `;
  document.head.appendChild(s);
  const i = document.getElementById('q'); i.value = q; document.getElementById('go').click();
}, QUESTION);
console.log('debate started…');
// capture ~58s of bubbles streaming in (debate → verdict)
const t0 = Date.now();
while (Date.now() - t0 < 58000) {
  const done = await page.evaluate(() => !!document.querySelector('.verdictcard, .bub.chair'));
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(2500);
await ctx.close(); await browser.close();
const fs = await import('node:fs');
const f = fs.readdirSync(OUTDIR).filter(x => x.endsWith('.webm')).map(x => `${OUTDIR}/${x}`).sort().pop();
console.log('VIDEO', f);
