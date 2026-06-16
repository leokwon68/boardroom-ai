// Record the living office + a real board meeting → 9:16 webm for ad reels.
// Headed Chromium (so color emoji + Fredoka render), portrait viewport, real engine.
import { chromium } from 'playwright';

const QUESTION = process.argv[2] || 'Should we launch in the US or Europe first?';
const OUTDIR = process.argv[3] || '/tmp/office-rec';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({
  viewport: { width: 720, height: 1280 },
  recordVideo: { dir: OUTDIR, size: { width: 720, height: 1280 } },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERR', m.text().slice(0, 120)); });

await page.goto('http://localhost:4242/office', { waitUntil: 'networkidle' });
// reel framing — the OFFICE is the star; hide the text drawer + help footer
await page.addStyleTag({ content: '#log{display:none!important} #help{display:none!important} #hint{display:none!important}' });
await page.waitForTimeout(6000);             // ambient life (typing, coffee runs, pairing)

// convene a real meeting (keep the transcript drawer shut so the office stays on screen)
await page.evaluate((q) => {
  document.getElementById('meetBtn').click();
  document.getElementById('mInput').value = q;
  document.getElementById('mSend').click();
}, QUESTION);
console.log('meeting convened…');

// keep the drawer forcibly closed while bubbles pop on the map; capture ~55s
const t0 = Date.now();
while (Date.now() - t0 < 55000) {
  await page.evaluate(() => document.getElementById('log')?.classList.remove('on'));
  await page.waitForTimeout(1500);
}
console.log('captured meeting window');

await ctx.close();                            // flushes the video file
await browser.close();
const fs = await import('node:fs');
const f = fs.readdirSync(OUTDIR).filter(x => x.endsWith('.webm')).map(x => `${OUTDIR}/${x}`).sort().pop();
console.log('VIDEO', f);
