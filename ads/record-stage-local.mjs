// Record the board STAGE (execs at desks, speech bubbles) from the LOCAL port — no auth.
import { chromium } from 'playwright';
const QUESTION = process.argv[2] || 'Should we raise our prices 20%?';
const OUTDIR = process.argv[3] || '/tmp/stage-rec';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  viewport: { width: 1300, height: 900 },
  recordVideo: { dir: OUTDIR, size: { width: 1300, height: 900 } },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 100)); });
await page.goto('http://localhost:4242/stage.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// stage is the default view — just strip the chrome we don't want in the reel
await page.evaluate(() => {
  const s = document.createElement('style');
  s.textContent = `
    #topbar{display:none!important}
    body,.app,.main{background:#07080c!important}
    .main{max-width:none!important;padding:14px 26px!important}
    .askrow,#usagebar,#exq,#ready,.askhead,.asksub{display:none!important}
  `;
  document.head.appendChild(s);
});
await page.waitForTimeout(1000);
await page.evaluate((q) => {
  const i = document.getElementById('q'); if (i) i.value = q;
  const g = document.getElementById('go'); if (g) g.click();
}, QUESTION);
console.log('meeting convened on stage…');
const t0 = Date.now();
while (Date.now() - t0 < 55000) { await page.waitForTimeout(2000); }
await page.waitForTimeout(2000);
await ctx.close(); await browser.close();
const fs = await import('node:fs');
const f = fs.readdirSync(OUTDIR).filter(x => x.endsWith('.webm')).map(x => `${OUTDIR}/${x}`).sort().pop();
console.log('VIDEO', f);
