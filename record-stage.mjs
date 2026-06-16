// Record the cloud board STAGE (AI execs at desks, speech bubbles popping) → for ad reels.
// Borrows the logged-in session from the debug Chrome (CDP) so cloud auth works.
import { chromium } from 'playwright';
const QUESTION = process.argv[2] || 'Should we raise our prices 20%?';
const OUTDIR = process.argv[3] || '/tmp/stage-rec';

// 1) lift the logged-in session (cookies) out of the running debug Chrome
const cdp = await chromium.connectOverCDP('http://127.0.0.1:9222');
const state = await cdp.contexts()[0].storageState();
await cdp.close();
console.log('session lifted, cookies:', state.cookies.length);

// 2) fresh browser with that session + video recording
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  storageState: state,
  viewport: { width: 1280, height: 920 },
  recordVideo: { dir: OUTDIR, size: { width: 1280, height: 920 } },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto('https://boardroom-cloud.vercel.app/board.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// stage only — hide topbar + the ask card/feed so the office fills the frame
await page.evaluate(() => {
  const s = document.createElement('style');
  s.textContent = `
    #topbar{display:none!important}
    .main, .app, body{background:#07080c!important}
    #stage{transform:scale(1.18);transform-origin:top center;margin-top:8px}
    .askwrap, .feed, #feed, .verdictcard, #vc, .askrow, .askhead, .asksub, #usagebar, #exq, #ready, .livebar{display:none!important}
  `;
  document.head.appendChild(s);
});
await page.waitForTimeout(1500);

// type the decision + convene
await page.evaluate((q) => {
  const i = document.getElementById('q'); if (i) i.value = q;
  const g = document.getElementById('go'); if (g) g.click();
}, QUESTION);
console.log('meeting convened on stage…');

// capture ~55s of seats speaking (bubbles popping over the desks)
const t0 = Date.now();
while (Date.now() - t0 < 55000) { await page.waitForTimeout(2000); }
await page.waitForTimeout(2000);
await ctx.close(); await browser.close();
const fs = await import('node:fs');
const f = fs.readdirSync(OUTDIR).filter(x => x.endsWith('.webm')).map(x => `${OUTDIR}/${x}`).sort().pop();
console.log('VIDEO', f);
