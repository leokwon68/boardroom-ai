#!/usr/bin/env node
// boardroom web app — cute local UI over the engine. Zero deps.
//   node server.mjs  →  http://localhost:4242
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMeeting, runAutopilot, listMinutes, readMinutes, planExecution, runExecution, loadQueue, saveQueue, enqueuePlan, loadDivisions, loadOwner, loadConfig, saveConfig, loadStaff, saveStaff, claudeCliAvailable, detectKeys, MODEL_CATALOG, DEFAULT_ROLES, roleModels, ledgerData, scoreLedger, loadActivity, logActivity, HOME, triageQuestion, runDirect, runFollowUp } from './engine.mjs';
import { tgSend, tgPoll, tgEnabled, tgCanPoll, tgReply } from './telegram.mjs';
import { spawn } from 'node:child_process';

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
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(join(ROOT, 'public', 'index.html')));
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
        await runExecution(item.plan, send);
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
      try { await runExecution(b.plan, send); } catch (e) { send('error', { message: e.message }); }
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
    console.log(`boardroom → ${url}`);
    armAutopilot(); armTelegram();
    if (!process.env.BOARDROOM_NO_OPEN) openBrowser(url);
  });
}
start(PORT);

// ── telegram bridge — run the company from your phone (JARVIS parity) ────
// all messages follow the configured language (config.lang), short, conclusion-first.
const L = (ko, en) => (loadConfig().lang === 'ko' ? ko : en);

async function handleTg(text, m) {
  // strip a leading slash so "/회의 주제" works too (slash commands bypass group privacy)
  text = text.replace(/^\/(meet|회의)\s*/i, '').trim();
  const low = text.toLowerCase().trim();
  const reply = (s) => tgReply(m, s);
  if (['help', '/start', '/help', '도움', '명령'].includes(low))
    return reply(L('명령:\n• 결정 입력 → 회의\n• status → 승인목록\n• go <id> → 실행\n• no <id> → 거절',
                   'Commands:\n• type a decision → meeting\n• status → approvals\n• go <id> → execute\n• no <id> → decline'));
  if (['status', '큐', '상태', '/status'].includes(low)) {
    const q = loadQueue();
    if (!q.length) return reply(L('✅ 승인 대기 없음.', '✅ Nothing pending.'));
    return reply(L('📥 승인대기:\n', '📥 Pending:\n') + q.map(it => `\`${it.id}\` ${it.plan.summary.slice(0, 70)}`).join('\n'));
  }
  let mm;
  if ((mm = low.match(/^(go|ok|approve|승인|실행)\s+(\w+)/))) {
    const it = loadQueue().find(x => x.id.startsWith(mm[2]));
    if (!it) return reply(L(`❓ \`${mm[2]}\` 없음. status 확인.`, `❓ No \`${mm[2]}\`. Send status.`));
    await reply(L(`▶️ 실행 중 \`${it.id}\`…`, `▶️ Executing \`${it.id}\`…`));
    let last = '';
    try { await runExecution(it.plan, (_t, p) => { if (p.kind === 'say') last = p.text; if (p.kind === 'done') last = p.result; }); }
    catch (e) { return reply(L(`⚠️ 실행 오류: ${e.message}`, `⚠️ Error: ${e.message}`)); }
    saveQueue(loadQueue().filter(x => x.id !== it.id));
    return reply(L(`✅ 완료 \`${it.id}\`\n${(last || '').slice(0, 220)}`, `✅ Done \`${it.id}\`\n${(last || '').slice(0, 220)}`));
  }
  if ((mm = low.match(/^(no|decline|거절|취소)\s+(\w+)/))) {
    const q = loadQueue(); const it = q.find(x => x.id.startsWith(mm[2]));
    if (!it) return reply(L(`❓ \`${mm[2]}\` 없음.`, `❓ No \`${mm[2]}\`.`));
    saveQueue(q.filter(x => x.id !== it.id));
    return reply(L(`🗑 거절 \`${it.id}\`.`, `🗑 Declined \`${it.id}\`.`));
  }
  if (!text) return;
  // anything else → a decision for the board
  await reply(L(`🏛 회의 중…`, `🏛 Convening…`));
  try {
    const res = await runMeeting(text, () => {}, {});
    const d = (res.verdict.match(/DECISION:\s*(.*)/i) || [])[1] || res.verdict.slice(0, 160);
    return reply(`👉 ${d.slice(0, 180)}\n_(${res.confidence}% · ${res.status})_`);
  } catch (e) { return reply(L(`⚠️ 회의 오류: ${e.message}`, `⚠️ Error: ${e.message}`)); }
}

function armTelegram() {
  if (!tgEnabled()) { console.log('[telegram] not configured — phone bridge off'); return; }
  if (tgCanPoll()) {
    tgPoll(handleTg);
    tgSend(L('🟢 Boardroom 켜짐. 결정을 보내거나 help.', '🟢 Boardroom online. Send a decision, or help.')).catch(() => {});
    console.log('[telegram] phone bridge armed (push + commands)');
  } else {
    // shared bot (another poller owns getUpdates) — push only, no command loop
    console.log('[telegram] push-only (shared bot — set a dedicated bot to enable commands)');
  }
}

// ── autopilot daemon — the company runs itself ──────────────────────────
// 켜두면: 주기마다 보드가 스스로 안건을 뽑아 회의하고, 실행계획을 승인 큐에 쌓는다.
// 실행은 절대 자동으로 하지 않는다 — Execute/Decline은 항상 사람 몫.
import { runAutopilot as _auto } from './engine.mjs';
let _apTimer = null, _apBusy = false;
function armAutopilot() {
  clearInterval(_apTimer);
  const ap = loadConfig().autopilot;
  if (!ap || !ap.enabled) return;
  const tick = async () => {
    if (_apBusy) return;
    _apBusy = true;
    try {
      let lastMinutes = null, topic = null, verdict = null;
      await _auto((type, payload) => {
        if (type === 'notice') {
          logActivity('notice', `${payload.noticed || ''}${payload.why_now ? ' — ' + payload.why_now : ''}`);
          tgSend(`🔔 ${(payload.noticed || '').slice(0, 120)}`);   // one line, core only
        }
        if (type === 'autopilot' && payload.topic) { topic = payload.topic; logActivity('agenda', payload.status === 'founded a new division' ? payload.topic : `convened — ${payload.topic}`); }
        if (type === 'done' && payload.minutesPath) lastMinutes = payload.minutesPath.split('/').pop();
        if (type === 'done' && payload.verdict) { const d = (payload.verdict.match(/DECISION:\s*(.*)/i) || [])[1] || ''; verdict = { d, conf: payload.confidence }; if (d) logActivity('verdict', `${payload.confidence ?? ''}% · ${d}`); }
      }, 1);
      if (lastMinutes) {
        const q = await enqueuePlan(lastMinutes);
        logActivity('queued', `plan queued for approval (${q.length} pending)`);
        const it = q[0];   // newest — conclusion-first, short, single language, plain words
        const dec = (it.plan.headline || (verdict ? verdict.d : topic) || '').slice(0, 140);
        tgSend(L(`📥 *승인대기* \`${it.id}\`\n${dec}\n✅ go ${it.id}   ❌ no ${it.id}`,
                 `📥 *Approve* \`${it.id}\`\n${dec}\n✅ go ${it.id}   ❌ no ${it.id}`));
      }
      console.log(`[autopilot] meeting done → queued plan (${lastMinutes})`);
    } catch (e) { logActivity('error', e.message); console.log('[autopilot] error:', e.message); }
    _apBusy = false;
  };
  _apTimer = setInterval(tick, Math.max(10, ap.intervalMin) * 60 * 1000);
  console.log(`[autopilot] armed — every ${ap.intervalMin}min`);
  // fire once immediately so toggling ON does real work now, not in an hour
  setTimeout(tick, 1500);
}
