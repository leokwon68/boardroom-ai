#!/usr/bin/env node
// boardroom web app — cute local UI over the engine. Zero deps.
//   node server.mjs  →  http://localhost:4242
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMeeting, runAutopilot, listMinutes, readMinutes, planExecution, runExecution, loadQueue, saveQueue, enqueuePlan, loadDivisions, loadOwner, saveOwner, loadConfig, saveConfig, loadStaff, saveStaff, claudeCliAvailable, detectKeys, MODEL_CATALOG, DEFAULT_ROLES, roleModels, ledgerData, scoreLedger, loadActivity, logActivity, HOME, triageQuestion, runDirect, runFollowUp, CONNECTIONS, loadConnections, saveConnections } from './engine.mjs';
import { vapidPublicKey, addSub, pushNotify, pushEnabled } from './push.mjs';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';

// ── phone access: LAN by default, public tunnel with --share (token-gated) ──
// SHARE_TOKEN is set only in --share mode; when set, every non-loopback
// request must carry the token (?t= once, then a cookie). Protects the
// shell + logged-in browser the executor drives. LAN-only mode = no token.
const SHARE = process.env.BOARDROOM_SHARE === '1';
const SHARE_TOKEN = SHARE ? (process.env.BOARDROOM_TOKEN || randomBytes(12).toString('hex')) : null;
const isLoopback = req => { const a = req.socket.remoteAddress || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; };
function tokenOK(req, url) {
  if (!SHARE_TOKEN) return true;            // LAN-only mode — trust the local network
  if (isLoopback(req)) return true;          // the desktop browser we opened ourselves
  if (url.searchParams.get('t') === SHARE_TOKEN) return true;
  const cookie = (req.headers.cookie || '').match(/br_token=([^;]+)/);
  return !!cookie && cookie[1] === SHARE_TOKEN;
}

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4242;

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}
async function body(req) {
  let b = '';
  for await (const c of req) b += c;
  return b ? JSON.parse(b) : {};
}

const SRV = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!tokenOK(req, url)) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<body style="font-family:system-ui;background:#111;color:#eee;text-align:center;padding:18vh 8vw"><h2>🔒 Boardroom</h2><p>Open the link with its access token (the <code>?t=…</code> from the QR code on your laptop).</p></body>');
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const headers = { 'content-type': 'text/html; charset=utf-8' };
      // first valid ?t= visit → remember it in a cookie so deep links stay clean
      if (SHARE_TOKEN && !isLoopback(req) && url.searchParams.get('t') === SHARE_TOKEN)
        headers['set-cookie'] = `br_token=${SHARE_TOKEN}; Path=/; Max-Age=2592000; SameSite=Lax`;
      res.writeHead(200, headers);
      return res.end(readFileSync(join(ROOT, 'public', 'index.html')));
    }
    // PWA static — service worker, manifest, icon (needed for lock-screen push)
    const STATIC = { '/sw.js': 'application/javascript', '/manifest.json': 'application/manifest+json', '/icon.png': 'image/png' };
    if (STATIC[url.pathname]) {
      try {
        res.writeHead(200, { 'content-type': STATIC[url.pathname], 'cache-control': 'no-cache' });
        return res.end(readFileSync(join(ROOT, 'public', url.pathname.slice(1))));
      } catch { return json(res, 404, { error: 'not found' }); }
    }
    // web push: hand the page the VAPID public key, and store device subscriptions
    if (url.pathname === '/api/push/key') return json(res, 200, { key: vapidPublicKey() });
    if (url.pathname === '/api/push/subscribe' && req.method === 'POST') {
      const b = await body(req);
      return json(res, 200, { ok: addSub(b.sub || b) });
    }
    // ── Today — the daily operator surface: what to do + what's prepared ──
    if (url.pathname === '/api/owner' && req.method === 'POST') {
      const b = await body(req);
      return json(res, 200, { owner: saveOwner(b.text) });
    }
    // connections — the tools the owner plugged in (plain "연결", never "MCP")
    if (url.pathname === '/api/connections') {
      const on = loadConnections();
      return json(res, 200, { catalog: CONNECTIONS.map(c => ({ id: c.id, emoji: c.emoji, name: c.name, name_en: c.name_en, blurb: c.blurb, blurb_en: c.blurb_en, examples: c.examples, on: on.includes(c.id) })) });
    }
    if (url.pathname === '/api/connections/toggle' && req.method === 'POST') {
      const b = await body(req);
      let on = loadConnections();
      on = b.on ? [...new Set([...on, b.id])] : on.filter(x => x !== b.id);
      return json(res, 200, { on: saveConnections(on) });
    }
    if (url.pathname === '/api/today') {
      const q = loadQueue();
      const pending = q[0] || null;
      const acts = loadActivity(12);
      const notice = acts.find(a => a.kind === 'notice');
      const { stats } = ledgerData();
      const ap = loadConfig().autopilot || {};
      return json(res, 200, {
        owner: loadOwner(),
        pendingCount: q.length,
        pending: pending && { id: pending.id, title: pending.plan.title, headline: pending.plan.headline, deliverable: pending.plan.deliverable, risk: pending.plan.risk, summary: pending.plan.summary, minutesFile: pending.plan.minutesFile, steps: (pending.plan.steps || []).map(s => ({ do: s.do, approval: !!s.approval })) },
        notice: notice ? notice.text : '',
        recent: acts.filter(a => ['verdict', 'queued', 'executed', 'agenda'].includes(a.kind)).slice(0, 4),
        battingAvg: stats.avg, decisions: stats.total,
        autopilot: { enabled: !!ap.enabled, intervalMin: ap.intervalMin || 0 },
      });
    }
    if (url.pathname === '/api/today/run' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      try { await autopilotOnce(send); } catch (e) { send('error', { message: e.message }); }
      return res.end();
    }
    if (url.pathname === '/api/state') {
      const cfg = loadConfig();
      const keys = detectKeys();
      return json(res, 200, {
        hasAnthropicKey: !!keys.anthropicKey,
        hasOpenaiKey: !!keys.openaiKey,
        hasGeminiKey: !!keys.geminiKey,
        anthropicSource: keys.anthropicSource,
        openaiSource: keys.openaiSource,
        geminiSource: keys.geminiSource,
        claudeCli: await claudeCliAvailable(),
        catalog: MODEL_CATALOG,
        roles: roleModels(),
        staff: loadStaff(),
        autopilot: cfg.autopilot || { enabled: false, intervalMin: 60 },
        queueCount: loadQueue().length,
        divisions: loadDivisions(),
        owner: loadOwner(),
      });
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const b = await body(req);
      const patch = {};
      if (b.roles) patch.roles = { ...DEFAULT_ROLES, ...b.roles };
      if (b.anthropicKey) patch.anthropicKey = b.anthropicKey;  // ~/.boardroom/config.json (0600), never echoed back
      if (b.openaiKey) patch.openaiKey = b.openaiKey;
      if (b.geminiKey) patch.geminiKey = b.geminiKey;
      if (b.lang) patch.lang = b.lang === 'ko' ? 'ko' : 'en';   // telegram pushes follow this
      saveConfig(patch);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/staff' && req.method === 'POST') {
      const b = await body(req);
      saveStaff(b.staff);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/ledger') {
      let md = '';
      try { md = readFileSync(join(HOME, 'ledger.md'), 'utf8'); } catch {}
      return json(res, 200, { md, ...ledgerData() });
    }
    if (url.pathname === '/api/ledger/score' && req.method === 'POST') {
      const b = await body(req);
      return json(res, 200, scoreLedger(Number(b.row), b.outcome));
    }
    if (url.pathname === '/api/activity') {
      return json(res, 200, { activity: loadActivity(30) });
    }
    if (url.pathname === '/api/minutes') {
      const f = url.searchParams.get('f');
      return json(res, 200, f ? { md: readMinutes(f) } : { list: listMinutes() });
    }
    if (url.pathname === '/api/autopilot' && req.method === 'POST') {
      const b = await body(req);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      try {
        await runAutopilot((type, payload) => send(type, payload), Math.min(Number(b.rounds) || 1, 5));
      } catch (e) {
        send('error', { message: e.message });
      }
      return res.end();
    }
    if (url.pathname === '/api/queue') {
      return json(res, 200, { queue: loadQueue() });
    }
    if (url.pathname === '/api/queue/add' && req.method === 'POST') {
      const b = await body(req);
      return json(res, 200, { queue: await enqueuePlan(b.file) });
    }
    if (url.pathname === '/api/queue/decline' && req.method === 'POST') {
      const b = await body(req);
      return json(res, 200, { queue: saveQueue(loadQueue().filter(it => it.id !== b.id)) });
    }
    if (url.pathname === '/api/queue/execute' && req.method === 'POST') {
      const b = await body(req);
      const item = loadQueue().find(it => it.id === b.id);
      if (!item) return json(res, 404, { error: 'gone' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      try {
        await runExecution(item.plan, send, { approved: true });
        saveQueue(loadQueue().filter(it => it.id !== b.id));
      } catch (e) { send('error', { message: e.message }); }
      return res.end();
    }
    if (url.pathname === '/api/autopilot-config' && req.method === 'POST') {
      const b = await body(req);
      saveConfig({ autopilot: { enabled: !!b.enabled, intervalMin: Number(b.intervalMin) || 60 } });
      armAutopilot();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/plan' && req.method === 'POST') {
      const b = await body(req);
      return json(res, 200, await planExecution(b.file));
    }
    if (url.pathname === '/api/execute' && req.method === 'POST') {
      const b = await body(req);   // b.plan = 승인된 계획 (approval gate는 UI에서 통과)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      try { await runExecution(b.plan, send, { approved: true }); } catch (e) { send('error', { message: e.message }); }
      return res.end();
    }
    if (url.pathname === '/api/meeting' && req.method === 'POST') {
      const b = await body(req);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      try {
        if (b.history && String(b.history).trim()) {
          // keep talking to the board — same seats, prior transcript in context
          await runFollowUp(b.history, b.question, send);
        } else {
          // chief-of-staff triage: decisions get the board, tasks get one specialist
          const t = await triageQuestion(b.question);
          if (t.mode === 'direct') await runDirect(b.question, t.title, send);
          else await runMeeting(b.question, (type, payload) => send(type, payload));
        }
      } catch (e) {
        send('error', { message: e.message });
      }
      return res.end();
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

// start with graceful port fallback — if 4242 is taken, try the next ports instead of crashing
function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref(); } catch {}
}
function start(port, triesLeft = 12) {
  SRV.once('error', err => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) {
      console.log(`  port ${port} busy — trying ${port + 1}…`);
      start(port + 1, triesLeft - 1);
    } else {
      console.error(`Could not start: ${err.message}`);
      process.exit(1);
    }
  });
  SRV.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\nboardroom → ${url}`);
    console.log('  no API key needed — uses your `claude` CLI subscription.');
    // phone on the same wifi: type this, no telegram, no setup
    const ips = lanIPs();
    if (ips.length) {
      console.log('\n  📱 phone (same wifi):');
      for (const ip of ips) console.log(`     http://${ip}:${port}`);
      showQR(`http://${ips[0]}:${port}`);
    }
    armAutopilot();
    if (!process.env.BOARDROOM_NO_OPEN) openBrowser(url);
    if (SHARE) startTunnel(port);
  });
}

// every non-internal IPv4 — the address a phone on the same wifi can reach
function lanIPs() {
  const out = [];
  for (const list of Object.values(networkInterfaces()))
    for (const ni of list || [])
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  return out;
}
// scannable QR in the terminal if `qrencode` is installed; harmless if not
function showQR(url) {
  try {
    const p = spawn('qrencode', ['-t', 'ANSIUTF8', url], { stdio: ['ignore', 'inherit', 'ignore'] });
    p.on('error', () => {});  // qrencode not installed → just skip, URL already printed
  } catch {}
}
// public https URL via cloudflared quick tunnel — works from cellular, token-gated
function startTunnel(port) {
  console.log('\n  🌐 opening a public tunnel (cloudflared)…');
  let cf;
  try { cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { console.log('  ⚠️  cloudflared not found — install: brew install cloudflared'); return; }
  cf.on('error', () => console.log('  ⚠️  cloudflared not found — install: brew install cloudflared'));
  let announced = false;
  const scan = d => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !announced) {
      announced = true;
      const link = `${m[0]}/?t=${SHARE_TOKEN}`;
      console.log('\n  🌐 phone (anywhere — keep this laptop on):');
      console.log(`     ${link}`);
      console.log('  🔒 this link carries your access token — only share it with yourself.');
      showQR(link);
    }
  };
  cf.stdout.on('data', scan); cf.stderr.on('data', scan);
  process.on('exit', () => { try { cf.kill(); } catch {} });
}
start(PORT);

// ── autopilot daemon — the company runs itself ──────────────────────────
// 켜두면: 주기마다 보드가 스스로 안건을 뽑아 회의하고, 실행계획을 승인 큐에 쌓는다.
// 실행은 절대 자동으로 하지 않는다 — Execute/Decline은 항상 사람 몫.
import { runAutopilot as _auto } from './engine.mjs';
let _apTimer = null, _apBusy = false;
// one autopilot pass: board picks an agenda, meets, queues a plan, notifies.
// shared by the daemon timer AND the "run now" button on the Today screen.
// optional onEvent streams progress (SSE) to a watching client.
async function autopilotOnce(onEvent = () => {}) {
  if (_apBusy) { onEvent('busy', {}); return; }
  _apBusy = true;
  try {
    let lastMinutes = null, topic = null, verdict = null;
    await _auto((type, payload) => {
      onEvent(type, payload);
      if (type === 'notice') {
        logActivity('notice', `${payload.noticed || ''}${payload.why_now ? ' — ' + payload.why_now : ''}`);
        const ko = loadConfig().lang === 'ko';
        pushNotify(ko ? '🔔 보드가 안건을 찾았어요' : '🔔 Your board found an agenda', payload.noticed || '', '/').catch(() => {});
      }
      if (type === 'autopilot' && payload.topic) { topic = payload.topic; logActivity('agenda', payload.status === 'founded a new division' ? payload.topic : `convened — ${payload.topic}`); }
      if (type === 'done' && payload.minutesPath) lastMinutes = payload.minutesPath.split('/').pop();
      if (type === 'done' && payload.verdict) { const d = (payload.verdict.match(/DECISION:\s*(.*)/i) || [])[1] || ''; verdict = { d, conf: payload.confidence }; if (d) logActivity('verdict', `${payload.confidence ?? ''}% · ${d}`); }
    }, 1);
    if (lastMinutes) {
      const q = await enqueuePlan(lastMinutes);
      logActivity('queued', `plan queued for approval (${q.length} pending)`);
      const it = q[0];   // newest — surfaced in the Today screen + approval queue
      const dec = (it.plan.headline || (verdict ? verdict.d : topic) || '').slice(0, 140);
      logActivity('await', `approve in the app: ${dec}`);
      const ko = loadConfig().lang === 'ko';
      pushNotify(ko ? '📥 승인 대기 — 실행할까요?' : '📥 Approval needed', dec, '/').catch(() => {});
      onEvent('queued', { id: it.id, headline: it.plan.headline || dec });
    }
    console.log(`[autopilot] meeting done → queued plan (${lastMinutes})`);
  } catch (e) { logActivity('error', e.message); console.log('[autopilot] error:', e.message); onEvent('error', { message: e.message }); }
  _apBusy = false;
}
function armAutopilot() {
  clearInterval(_apTimer);
  const ap = loadConfig().autopilot;
  if (!ap || !ap.enabled) return;
  const tick = () => autopilotOnce();
  _apTimer = setInterval(tick, Math.max(10, ap.intervalMin) * 60 * 1000);
  console.log(`[autopilot] armed — every ${ap.intervalMin}min`);
  // fire once immediately so toggling ON does real work now, not in an hour
  setTimeout(tick, 1500);
}
