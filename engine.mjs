// boardroom engine — the meeting protocol, UI-agnostic.
// runMeeting() emits events via onEvent(type, payload) so any UI (CLI, web, SSE) can render live.
import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, writeFileSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const HOME = join(homedir(), '.boardroom');
mkdirSync(HOME, { recursive: true });
const CONFIG_PATH = join(HOME, 'config.json');
const STAFF_PATH = join(HOME, 'staff.json');

export const DEFAULT_STAFF = [
  { id: 'analyst', name: 'Nori', emoji: '🦊', lens: 'Numbers, evidence, unit economics. Distrust narratives without data.' },
  { id: 'operator', name: 'Mochi', emoji: '🐻', lens: 'Execution reality. What breaks in practice, hidden costs, time.' },
  { id: 'skeptic', name: 'Pico', emoji: '🦉', lens: 'Risk and downside. What kills this. Always hunt the failure mode.' },
];

export function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
export function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}
export function loadStaff() {
  try { return JSON.parse(readFileSync(STAFF_PATH, 'utf8')); } catch { return DEFAULT_STAFF; }
}
export function saveStaff(staff) {
  writeFileSync(STAFF_PATH, JSON.stringify(staff, null, 2));
  return staff;
}

// ── model catalog — per-seat model selection ────────────────────────────
export const MODEL_CATALOG = [
  { id: 'claude-fable-5',   label: 'Fable 5',     provider: 'anthropic', note: 'highest judgment — chair material' },
  { id: 'claude-opus-4-8',  label: 'Opus 4.8',    provider: 'anthropic', note: 'most capable all-round' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'anthropic', note: 'fast + smart — great seats' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5',   provider: 'anthropic', note: 'cheapest, quick takes' },
  { id: 'gpt-5',            label: 'GPT-5',       provider: 'openai',    note: 'strong generalist' },
  { id: 'gpt-5-mini',       label: 'GPT-5 mini',  provider: 'openai',    note: 'fast + cheap' },
  { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   provider: 'gemini', note: 'huge context' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', note: 'fast + frugal' },
];
export const DEFAULT_ROLES = { chair: 'claude-opus-4-8', seat: 'claude-sonnet-4-6', redteam: 'claude-opus-4-8' };
const providerOf = id => (MODEL_CATALOG.find(m => m.id === id) || {}).provider
  || (id.startsWith('claude') ? 'anthropic' : id.startsWith('gpt') ? 'openai' : 'gemini');

// ── model adapters — ask(prompt) -> text ────────────────────────────────
// zero-dependency by design (npx-able product) → raw HTTP, no SDK.
function anthropicApi(model, key) {
  return async prompt => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json();
    return j.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  };
}

function claudeCli(model) {
  return prompt => new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', model], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.slice(0, 200) || `claude exit ${code}`)));
    p.stdin.write(prompt); p.stdin.end();
  });
}

function openaiApi(model, key) {
  return async prompt => {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error(`openai ${r.status}`);
    return (await r.json()).choices[0].message.content.trim();
  };
}

function geminiApi(model, key) {
  return async prompt => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!r.ok) throw new Error(`gemini ${r.status}`);
    return (await r.json()).candidates[0].content.parts[0].text.trim();
  };
}

function cliAvailable(cmd) {
  try {
    const r = spawn(cmd, ['--version'], { stdio: 'ignore' });
    return new Promise(res => { r.on('close', c => res(c === 0)); r.on('error', () => res(false)); });
  } catch { return Promise.resolve(false); }
}
export function claudeCliAvailable() { return cliAvailable('claude'); }
export function codexCliAvailable() { return cliAvailable('codex'); }
export function geminiCliAvailable() { return cliAvailable('gemini'); }

// Codex CLI (ChatGPT subscription) — non-interactive exec; the final message lands in a temp file.
function codexCli(model) {
  return prompt => new Promise((resolve, reject) => {
    const tmp = join(tmpdir(), `br-codex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`);
    // run on the CLI's own default model (whatever the user's ChatGPT plan provides);
    // explicit -m is unreliable across codex versions
    const p = spawn('codex', ['exec', '--skip-git-repo-check', '--output-last-message', tmp, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    p.stdin.write(prompt); p.stdin.end();
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => {
      let msg = '';
      try { msg = readFileSync(tmp, 'utf8').trim(); } catch {}
      try { unlinkSync(tmp); } catch {}
      if (msg) return resolve(msg);
      if (code === 0 && out.trim()) return resolve(out.trim());
      reject(new Error(err.slice(0, 200) || `codex exit ${code}`));
    });
  });
}

// Gemini CLI (Google account) — plain prompt mode.
function geminiCli(model) {
  return prompt => new Promise((resolve, reject) => {
    const p = spawn('gemini', ['-m', model, '-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => code === 0 && out.trim() ? resolve(out.trim()) : reject(new Error(err.slice(0, 200) || `gemini exit ${code}`)));
  });
}

// auto-detect credentials — users should never hunt for keys.
// order: saved config → environment → provider config files on disk.
export function detectKeys() {
  const cfg = loadConfig();
  const env = process.env;
  let openaiKey = cfg.openaiKey || env.OPENAI_API_KEY || null;
  let geminiKey = cfg.geminiKey || env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null;
  if (!openaiKey) {
    try {
      const j = JSON.parse(readFileSync(join(homedir(), '.codex', 'auth.json'), 'utf8'));
      openaiKey = j.OPENAI_API_KEY || j.openai_api_key || null;
    } catch {}
  }
  const anthropicKey = cfg.anthropicKey || env.ANTHROPIC_API_KEY || null;
  return {
    openaiKey, geminiKey, anthropicKey,
    anthropicSource: cfg.anthropicKey ? 'saved' : env.ANTHROPIC_API_KEY ? 'environment' : null,
    openaiSource: cfg.openaiKey ? 'saved' : env.OPENAI_API_KEY ? 'environment' : openaiKey ? 'codex config' : null,
    geminiSource: cfg.geminiKey ? 'saved' : (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) ? 'environment' : null,
  };
}

// 모델 ID 1개 → ask 함수. 키 있으면 API 직접, 없으면 그 회사 CLI(구독)로 폴백.
// claude CLI = Claude 구독, codex CLI = ChatGPT 구독, gemini CLI = Google 계정.
let _cliOk = null, _codexOk = null, _geminiOk = null;
export async function askWith(modelId) {
  const keys = detectKeys();
  const provider = providerOf(modelId);
  if (provider === 'anthropic') {
    if (keys.anthropicKey) return anthropicApi(modelId, keys.anthropicKey);
    if (_cliOk === null) _cliOk = await claudeCliAvailable();
    if (_cliOk) return claudeCli(modelId);
    throw new Error(`No Anthropic access for ${modelId} — set ANTHROPIC_API_KEY or install Claude Code`);
  }
  if (provider === 'openai') {
    if (keys.openaiKey) return openaiApi(modelId, keys.openaiKey);
    if (_codexOk === null) _codexOk = await codexCliAvailable();
    if (_codexOk) return codexCli(modelId);
    throw new Error(`No OpenAI access for ${modelId} — set OPENAI_API_KEY or install Codex CLI (npm i -g @openai/codex)`);
  }
  if (keys.geminiKey) return geminiApi(modelId, keys.geminiKey);
  if (_geminiOk === null) _geminiOk = await geminiCliAvailable();
  if (_geminiOk) return geminiCli(modelId);
  throw new Error(`No Gemini access for ${modelId} — set GEMINI_API_KEY or install Gemini CLI (npm i -g @google/gemini-cli)`);
}

export function roleModels() {
  const cfg = loadConfig();
  return { ...DEFAULT_ROLES, ...(cfg.roles || {}) };
}

// ── the protocol — a real conversation, not a form ──────────────────────
// opening (parallel, short) → live discussion (sequential turns, each reacts
// to the transcript) → chair probe → closing stances (what changed your mind)
// → verdict → red team. Spoken language throughout; positions must MOVE.
const ISOLATE = `IMPORTANT: Base your reasoning ONLY on this prompt's contents. Ignore any memory, project files, or prior context about specific people, companies, or products — none of it belongs to this meeting's client.`;
const VOICE = `${ISOLATE}
You are speaking OUT LOUD in a live board meeting. Hard rules:
- LANGUAGE: speak 100% in the language the agenda is written in. Korean agenda → every word in Korean (no English sentences mixed in; product names may stay).
- Max 55 words. One thought, said well.
- Talk like a sharp colleague: contractions, direct address ("Mochi, that's backwards"), plain words.
- NO headers, NO bullet points, NO markdown, NO "POSITION:" labels. Just speech.
- React to what was actually said. Agree when persuaded — changing your mind under good arguments is strength.
- Answer the agenda IN ITS OWN FRAME: a reading (saju/tarot/astrology) stays a reading, a review stays a review — never refuse, lecture, or demand a different question.`;

// forceful, model-agnostic language lock derived from the agenda text.
// every seat prompt gets this prepended — a GPT/Sonnet seat that ignores a
// mid-prompt bullet still obeys a loud first line. Korean board → 0 English seats.
function langLock(text) {
  if (/[가-힣]/.test(String(text))) return `LANGUAGE LOCK: Respond ENTIRELY in Korean (한국어). Not one English sentence. Product/brand names may stay in English; everything else — every sentence — is Korean. This overrides any English in your role description.\n\n`;
  return '';
}
// wrap an ask fn so the lock is always prepended
const withLock = (fn, lock) => (prompt => fn(lock + prompt));

export async function runMeeting(question, onEvent, opts = {}) {
  const staff = opts.staff || loadStaff();
  const divTag = opts.division ? `[${opts.division}] ` : '';
  const roles = roleModels();
  const LOCK = langLock(question);
  // per-seat models: staff[].model overrides the seat default (chief=fable, seats=sonnet, gpt mix — all valid)
  const seatAskMap = {};
  for (const st of staff) seatAskMap[st.id] = withLock(await askWith(st.model || roles.seat), LOCK);
  const askSeat = st => seatAskMap[st.id];
  const askChair = withLock(await askWith(roles.chair), LOCK);
  const askRed = withLock(await askWith(roles.redteam), LOCK);
  // 축1 — what a SINGLE model (no debate) would answer, captured in parallel with the
  // whole meeting (no added wall-clock). Compared at the end so the owner SEES whether
  // the board earned its keep instead of being slower theater. Honest: may end "same".
  const soloPromise = askChair(`${ISOLATE}
Answer like a single AI assistant with no board and no debate — exactly what a normal person gets from one chatbot reply.
Agenda: "${question}"
Reply in the agenda's language, one line:
SOLO: your direct recommendation or answer in one sentence.`).catch(() => '');
  const t0 = Date.now();
  onEvent('start', { question, staff });
  const transcript = [];
  const log = (seat, text) => transcript.push(`${seat.name} (${seat.id}): ${text}`);
  const tjoin = () => transcript.join('\n\n');
  const CHAIR = { id: 'chair', name: 'Chair', emoji: '👑' };
  const RED = { id: 'redteam', name: 'Red Team', emoji: '🐺' };

  onEvent('round', { round: 'OPENING', label: 'First takes' });
  const openings = await Promise.all(staff.map(s => askSeat(s)(`${VOICE}
You are ${s.name}, the ${s.id} seat. Your lens: ${s.lens}

The chair just asked the board: "${question}"

Give your gut take and the one thing everyone else is probably missing.`)));
  openings.forEach((text, i) => { log(staff[i], text); onEvent('msg', { round: 'OPENING', seat: staff[i], text }); });

  // live discussion — two cycles of sequential turns, chair probes in between
  onEvent('round', { round: 'DISCUSSION', label: 'Open floor' });
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const s of staff) {
      onEvent('speaking', { seat: s });
      const text = await askSeat(s)(`${VOICE}
You are ${s.name}, the ${s.id} seat. Your lens: ${s.lens}

Board agenda: "${question}"

The meeting so far:
${tjoin()}

It's your turn. Respond directly to the last thing said — push back, build on it, or concede the point. Move the discussion forward, don't repeat yourself.`);
      log(s, text);
      onEvent('msg', { round: 'DISCUSSION', seat: s, text });
    }
    if (cycle === 0) {
      onEvent('speaking', { seat: CHAIR });
      const probe = await askChair(`${VOICE}
You chair this board meeting. Agenda: "${question}"

The meeting so far:
${tjoin()}

In max 30 words: name the real disagreement under the surface, and put one hard question to a specific seat by name.`);
      log(CHAIR, probe);
      onEvent('msg', { round: 'DISCUSSION', seat: CHAIR, text: probe });
    }
  }

  onEvent('round', { round: 'CLOSING', label: 'Final stances — what moved' });
  const closings = await Promise.all(staff.map(s => askSeat(s)(`${VOICE}
You are ${s.name}, the ${s.id} seat. Lens: ${s.lens}

Board agenda: "${question}"

Full meeting:
${tjoin()}

Final stance, max 35 words: what do you now recommend, and what in this discussion changed or sharpened your view? If you held firm, say what almost moved you.`)));
  closings.forEach((text, i) => { log(staff[i], text); onEvent('msg', { round: 'CLOSING', seat: staff[i], text }); });

  onEvent('round', { round: 'VERDICT', label: 'Chair rules' });
  onEvent('speaking', { seat: CHAIR });
  const verdict = await askChair(`${ISOLATE}
You chair this board. The discussion is over — now rule. Write like a decisive human chair, not a report.

Agenda: "${question}"

Full meeting transcript:
${tjoin()}

Output exactly this shape (plain language, no markdown). Keep the labels in English, but write the content after each label in the same language as the agenda (Korean agenda → Korean content):
DECISION: one sentence, actionable.
WHY: max 2 sentences — which argument from the floor carried, and what you overruled.
FALSIFIER: the observable signal + date that proves this wrong.
EXPERIMENT: one cheap test runnable within 14 days.
CONFIDENCE: integer 0-100 on its own line.`);
  const conf = parseInt((verdict.match(/CONFIDENCE:\s*(\d+)/i) || [])[1] || '50', 10);
  log(CHAIR, verdict);
  onEvent('msg', { round: 'VERDICT', seat: CHAIR, text: verdict });

  onEvent('round', { round: 'RED TEAM', label: 'Kill the verdict' });
  onEvent('speaking', { seat: RED });
  const red = await askRed(`${ISOLATE}
You are the red team, called in to BREAK this verdict. Speak plainly and hit hard, max 60 words before the two final lines.

Agenda: "${question}"

VERDICT:
${verdict}

Speak in the same language as the agenda (Korean agenda → Korean). Give your strongest realistic failure scenario as natural speech, then exactly these two lines (labels in English):
SURVIVES: YES or NO
ADJUSTED_CONFIDENCE: integer 0-100`);
  const survives = /SURVIVES:\s*YES/i.test(red);
  const adjConf = parseInt((red.match(/ADJUSTED_CONFIDENCE:\s*(\d+)/i) || [])[1] || String(conf), 10);
  log(RED, red);
  onEvent('msg', { round: 'RED TEAM', seat: RED, text: red });

  // 축1 diff — did the board change/catch anything the solo answer missed? honest 3-state.
  const ko = /[가-힣]/.test(String(question));
  onEvent('round', { round: 'SOLO vs BOARD', label: ko ? '혼자였다면 vs 보드' : 'Solo vs the board' });
  const solo = (await soloPromise || '').replace(/^SOLO:\s*/i, '').trim();
  const boardDecision = (verdict.match(/DECISION:\s*(.*)/i) || [])[1] || verdict.slice(0, 160);
  let delta = '';
  if (solo) {
    delta = await askChair(`${ISOLATE}
A single AI assistant, with no debate, answered this agenda:
SOLO: "${solo}"

This board then debated it, and a red team attacked the verdict. The board ruled:
"${boardDecision}" (${status}, confidence ${adjConf}%)

In ONE plain line, in the agenda's language, tell the owner exactly what the board added over the solo answer. Begin with EXACTLY one tag:
- "CHANGED: " — the board reached a materially different answer than solo; say what flipped and why.
- "SHARPENED: " — same direction, but the board surfaced a real risk, caveat, or condition the solo missed; name it concretely.
- "CONFIRMED: " — the board reached essentially the SAME answer; say so honestly. Do NOT invent a difference.
Be specific and honest. No flattery, no padding.`).catch(() => '');
  }
  const DELTA = { id: 'delta', name: ko ? '단일 모델 대비' : 'vs a single model', emoji: '⚖️' };
  if (delta) { log(DELTA, delta); onEvent('msg', { round: 'SOLO vs BOARD', seat: DELTA, text: delta }); }

  const packet = tjoin();

  // ledger + minutes
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const review = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const status = survives ? 'CONFIRMED' : 'DOWNGRADED';
  const minutesPath = join(HOME, `${stamp}.md`);
  writeFileSync(minutesPath, `# Boardroom — ${divTag}${question}\n\n## Transcript\n${packet}\n\n_status: ${status} · confidence: ${adjConf} · review: ${review}_\n`);
  const ledgerPath = join(HOME, 'ledger.md');
  if (!existsSync(ledgerPath)) appendFileSync(ledgerPath, '| date | question | decision | conf | status | review | outcome |\n|---|---|---|---|---|---|---|\n');
  appendFileSync(ledgerPath, `| ${new Date().toISOString().slice(0, 10)} | ${(divTag + question).slice(0, 60)} | ${(verdict.match(/DECISION:\s*(.*)/i) || [])[1]?.slice(0, 80) || ''} | ${adjConf} | ${status} | ${review} | pending |\n`);

  const result = { verdict, red, survives, confidence: adjConf, review, status, minutesPath, secs: Math.round((Date.now() - t0) / 1000), solo, delta };
  onEvent('done', result);
  return result;
}

// ── chief-of-staff triage — board debate vs single-specialist task ──────
// BOARD = genuine decision with tradeoffs. DIRECT = lookup, interpretation
// (saju/astrology), summary, writing, review — one right deliverable, no debate needed.
export async function triageQuestion(question) {
  try {
    const ask = await askWith(roleModels().chair);
    const out = await ask(`Classify this request for a decision-support product.\nREQUEST: ${String(question).slice(0, 500)}\n\nDecide between two paths:\n- DIRECT = there is one obvious right deliverable and nothing to weigh: a lookup, an interpretation (saju/fortune/astrology/tarot), an explanation, a summary, a writing task, or a review. These ALWAYS go DIRECT even if phrased as a question.\n- BOARD = a genuine decision or judgment call with real tradeoffs where hearing opposing arguments helps: which new business / product to start, what to build next, strategy, prioritization, go/no-go, pricing, hiring, or any "what should I do / which option" where reasonable people would disagree.\n\nReply with EXACTLY one line:\n- "DIRECT|<specialist title, 2-3 words, in the request's language>" for the DIRECT case.\n- "BOARD" for the BOARD case. If a request is a decision about what to do and you are unsure which path, choose BOARD.`);
    const m = out.trim().match(/^DIRECT\|(.+)$/im);
    if (m) return { mode: 'direct', title: m[1].trim().slice(0, 40) };
    return { mode: 'board', title: '' };
  } catch { return { mode: 'board', title: '' }; }
}

// single-specialist path: no debate theater — one agent just does the task
export async function runDirect(question, title, onEvent) {
  const t0 = Date.now();
  const ask = withLock(await askWith(roleModels().chair), langLock(question));
  const name = title || 'Specialist';
  const seat = { id: 'specialist', name, emoji: '🎯' };
  onEvent('start', { question, staff: [seat] });
  onEvent('round', { round: 'TASK', label: `Chief of staff: no debate needed — handled by ${name}` });
  onEvent('speaking', { seat });
  const text = await ask(`${ISOLATE}\nYou are "${name}" — the single specialist assigned to this task.\nTASK: ${question}\nDeliver the complete answer in the task's own frame (a reading stays a reading, a summary stays a summary). Match the request's language. Be thorough but tight; no meta-commentary, no refusals, at most one brief caveat if genuinely needed.`);
  onEvent('msg', { round: 'TASK', seat, text });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const minutesPath = join(HOME, `${stamp}.md`);
  writeFileSync(minutesPath, `# Boardroom — ${question}\n\n## ${name}\n\n${text}\n\n_status: ANSWERED_\n`);
  const result = { verdict: text, red: '', survives: true, confidence: 0, review: '', status: 'ANSWERED', minutesPath, secs: Math.round((Date.now() - t0) / 1000), direct: true };
  onEvent('done', result);
  return result;
}

// follow-up: the owner pushes back after a verdict; the same board reacts and the chair re-rules
export async function runFollowUp(history, userMsg, onEvent, opts = {}) {
  const t0 = Date.now();
  const staff = opts.staff || loadStaff();
  const roles = roleModels();
  const FU_LOCK = langLock(userMsg);
  const askChair = withLock(await askWith(roles.chair), FU_LOCK);
  const CHAIR = { id: 'chair', name: 'Chair', emoji: '👑' };
  onEvent('start', { question: userMsg, staff });
  onEvent('round', { round: 'FOLLOW-UP', label: 'The board responds' });
  const ctx = `Earlier, this board met and ruled. Transcript + verdict:\n${String(history).slice(0, 4500)}\n\nThe owner now responds / asks:\n"${userMsg}"`;
  const reactions = [];
  for (const s of staff) {
    onEvent('speaking', { seat: s });
    const ask = withLock(await askWith(s.model || roles.seat), FU_LOCK);
    const text = await ask(`${VOICE}\nAnswer IN THE FRAME the owner is using. If they want a reading (saju/fortune/astrology/tarot), an interpretation, or a creative piece — deliver exactly that, never refuse, never redirect to "a better question", at most one short caveat.\nYou are ${s.name}, the ${s.id} seat. Lens: ${s.lens}\n${ctx}\nReact to what the owner just said. Does it change your earlier view? If the owner is pushing for a more definitive answer, GIVE one — commit harder, don't hedge or refuse. Be specific and direct.`);
    reactions.push(`${s.name}: ${text}`);
    onEvent('msg', { round: 'FOLLOW-UP', seat: s, text });
  }
  onEvent('round', { round: 'VERDICT', label: 'Chair updates the ruling' });
  onEvent('speaking', { seat: CHAIR });
  const verdict = await askChair(`${ISOLATE}\nAnswer IN THE FRAME the owner is using. If they want a reading (saju/fortune/astrology/tarot), an interpretation, or a creative piece — deliver exactly that, never refuse, never redirect to "a better question", at most one short caveat.\nYou chair the board.\n${ctx}\n\nThe board just reacted:\n${reactions.join('\n')}\n\nGive the UPDATED ruling — rule ON their request as they framed it; if they demand a more definitive answer, deliver one. Output exactly:\nDECISION: one sentence, actionable.\nWHY: max 2 sentences.\nFALSIFIER: observable signal + date.\nCONFIDENCE: integer 0-100 on its own line.`);
  onEvent('msg', { round: 'VERDICT', seat: CHAIR, text: verdict });
  const conf = parseInt((verdict.match(/CONFIDENCE:\s*(\d+)/i) || [])[1] || '50', 10);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const review = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const minutesPath = join(HOME, `${stamp}.md`);
  writeFileSync(minutesPath, `# Boardroom — follow-up: ${userMsg}\n\n${reactions.join('\n\n')}\n\n## Updated verdict\n${verdict}\n`);
  const result = { verdict, red: '', survives: true, confidence: conf, review, status: 'UPDATED', minutesPath, secs: Math.round((Date.now() - t0) / 1000) };
  onEvent('done', result);
  return result;
}
// ── autopilot — a company that grows itself ─────────────────────────────
// learns the owner, founds divisions around their interests, convenes the
// right board, and files execution plans. Org changes are visible evolution.
const OWNER_PATH = join(HOME, 'owner.md');
const DIVISIONS_PATH = join(HOME, 'divisions.json');
export function loadDivisions() {
  try { return JSON.parse(readFileSync(DIVISIONS_PATH, 'utf8')); } catch { return []; }
}
export function saveDivisions(d) { writeFileSync(DIVISIONS_PATH, JSON.stringify(d, null, 2)); return d; }
export function loadOwner() {
  try { return readFileSync(OWNER_PATH, 'utf8'); } catch { return ''; }
}
// one-line onboarding — the owner tells the daily operator what business it runs
export function saveOwner(text) {
  const t = String(text || '').trim().slice(0, 600);
  if (t) writeFileSync(OWNER_PATH, t + '\n');
  return t;
}

async function learnOwner(question, decision) {
  try {
    const ask = await askWith(roleModels().seat);
    const updated = await ask(`${ISOLATE}
You maintain a short profile of "the owner" — the human this AI company serves. Update it from the latest board meeting.

CURRENT PROFILE:
${loadOwner() || '(empty)'}

LATEST MEETING — question: "${question}" / decision: "${(decision || '').slice(0, 300)}"

Rewrite the full profile. STRICT rules:
- Record ONLY facts the owner actually revealed in their own words (interests, role, what they're building). Plain language.
- NEVER invent or extrapolate: no fictional products, company structures, metrics, gateways, deadlines, named sub-agents, or process tasks they did not explicitly state. A hypothetical or test question is NOT a real fact about them.
- Use [task] ONLY for a concrete obligation the owner explicitly named with a real deadline. When in doubt, do NOT add a [task]. Most meetings should add zero tasks.
- Max 8 short bullets, no jargon/acronyms. Merge, dedupe, and DELETE anything that looks fabricated, over-specific, or invented by a previous meeting.
- Same language as the questions. Output the profile only.`);
    writeFileSync(OWNER_PATH, updated.trim() + '\n');
  } catch {}
}

export async function runAutopilot(onEvent, rounds = 1) {
  const ask = await askWith(roleModels().chair);
  for (let i = 0; i < rounds; i++) {
    let history = '';
    try { history = readFileSync(join(HOME, 'ledger.md'), 'utf8').split('\n').slice(-15).join('\n'); } catch {}
    const divisions = loadDivisions();
    onEvent('autopilot', { status: 'scanning the company' });
    const raw = await ask(`${ISOLATE}
You are the chief of staff of a self-running AI company serving one human owner. You PROACTIVELY watch the company and decide what deserves the board's attention right now — before the owner asks. Scan everything below, notice what matters most, and decide the next move.

OWNER PROFILE:
${loadOwner() || '(unknown yet — infer from ledger)'}

DIVISIONS (subsidiary boards): ${divisions.length ? divisions.map(d => `${d.name} — ${d.focus}`).join(' / ') : '(none yet — HQ only)'}

RECENT DECISIONS (ledger):
${history || '(none)'}

Pick the SINGLE most useful thing to put to the board now. STRICT rules:
- PLAIN LANGUAGE ONLY. A normal person must understand the topic instantly. NO jargon, NO acronyms (UTM, p99, KPI), NO invented process terms (dry-run, tiebreaker, circuit-breaker, baseline, matrix, carve-out). If you'd use a term the owner never said, don't.
- REAL decisions only. Convene about things the owner actually faces — pricing, what to build next, a real deadline they mentioned, a marketing move, a concrete errand. Do NOT fabricate company scenarios, products, metrics, or process scaffolding the owner never asked for. If the profile/ledger looks like invented internal machinery, IGNORE it.
- If you have nothing genuinely useful and plain to propose, pick a simple, broadly-useful topic (e.g. "what's the one thing most worth the owner's time this week?") rather than manufacturing busywork.
- TWO kinds: (a) STRATEGY — a real decision the owner must make; (b) ACTION — a concrete real-world errand an agent could do with a browser+shell. Prefer whichever is genuinely useful.
- ANTI-RABBITHOLE: never re-open or sub-spec a decision already in the ledger. If recent topics cluster on one theme, switch domains. Breadth over depth.
- Topic ≤ 20 words, plain. Same language as the ledger.

First state, in ONE short sentence each, what you NOTICED and WHY it deserves attention NOW — this is shown to the owner as your heads-up before the meeting.

Output strict JSON only, one of:
{"noticed":"what you spotted (1 sentence)","why_now":"why it matters now (1 sentence)","action":"meeting","division":"HQ or exact division name","topic":"..."}
{"noticed":"...","why_now":"...","action":"found_division","name":"...","focus":"one line","seats":[{"id":"role","name":"Name","lens":"how this seat thinks"},{...},{...}],"first_topic":"..."}`);
    const plan = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    let division = null, topic = plan.topic;
    // chief-of-staff heads-up FIRST — the secretary tells you what it found before convening
    onEvent('notice', { noticed: plan.noticed || '', why_now: plan.why_now || '', action: plan.action });
    if (plan.action === 'found_division') {
      division = { id: plan.name.toLowerCase().replace(/\s+/g, '-'), name: plan.name, focus: plan.focus, staff: plan.seats, founded: new Date().toISOString().slice(0, 10) };
      saveDivisions([...divisions, division]);
      topic = plan.first_topic;
      onEvent('autopilot', { status: 'founded a new division', topic: `🏢 ${plan.name} — ${plan.focus}` });
    } else if (plan.division && plan.division !== 'HQ') {
      division = divisions.find(d => d.name === plan.division || d.id === plan.division) || null;
    }
    onEvent('autopilot', { status: 'agenda set', topic: `${division ? division.name + ' · ' : 'HQ · '}${topic}`, noticed: plan.noticed, why_now: plan.why_now });
    const result = await runMeeting(topic, onEvent, division ? { staff: division.staff, division: division.name } : {});
    await learnOwner(topic, (result.verdict.match(/DECISION:\s*(.*)/i) || [])[1] || '');
  }
}

export function listMinutes() {
  const files = readdirSync(HOME).filter(f => f.endsWith('.md') && f !== 'ledger.md').sort().reverse();
  return files.map(f => {
    const txt = readFileSync(join(HOME, f), 'utf8');
    const q = (txt.match(/^# Boardroom — (.*)/m) || [])[1] || f;
    const meta = (txt.match(/_status: (.*)_/) || [])[1] || '';
    return { file: f, question: q, meta };
  });
}
export function readMinutes(file) {
  if (!/^[\w.-]+\.md$/.test(file) || file === 'ledger.md') throw new Error('bad file');
  return readFileSync(join(HOME, file), 'utf8');
}

// ── executor — the board's verdicts get carried out ─────────────────────
// plan (chair model, human-readable) → approval gate (UI) → execution
// (headless Claude Code with real tools: shell, files, web, browser-via-node).
// Workspace is isolated at ~/.boardroom/workspace.
const WORKSPACE = join(HOME, 'workspace');
mkdirSync(WORKSPACE, { recursive: true });

// curated MCP for the executor — Playwright MCP with a PERSISTENT browser profile.
// You log into X / Instagram / Naver once in this profile; sessions persist, so the
// executor can post/act on those sites via browser tools — no API tokens. Add more
// MCP servers to ~/.boardroom/mcp.json to grant more powers (this is the extensibility).
const MCP_PATH = join(HOME, 'mcp.json');
const BROWSER_PROFILE = join(HOME, 'browser-profile');
function ensureMcpConfig() {
  if (existsSync(MCP_PATH)) return;
  mkdirSync(BROWSER_PROFILE, { recursive: true });
  writeFileSync(MCP_PATH, JSON.stringify({
    mcpServers: {
      playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--user-data-dir', BROWSER_PROFILE, '--browser', 'chrome'] },
    },
  }, null, 2));
}

export async function planExecution(minutesFile) {
  const md = readMinutes(minutesFile);
  const planKo = /[가-힣]/.test(md);
  const ask = await askWith(roleModels().chair);
  const raw = await ask(`${ISOLATE}
You are the executive officer of a board. A meeting just concluded. Turn its verdict into a concrete execution plan.

MEETING MINUTES:
${md.slice(0, 9000)}

Rules:
- DELIVER FINISHED THINGS, NOT DEVELOPER HOMEWORK. The owner is a busy non-technical founder. The deliverable must be something they USE directly with zero setup — a written message/email ready to send, a designed image, a filled-in document, a posted/published thing, completed research with a clear answer, a ready-to-copy table. NEVER make the deliverable a script, code file (.mjs/.py), .env, config, webhook setup, runbook, or "install/connect X" — those are chores the owner can't do and won't want. If the only way to satisfy the verdict is building software or asking the owner to configure a service, the plan is WRONG: reframe to the actual outcome the owner wants done-for-them, or mark it a human-approval step in one plain sentence. Zero-setup is the rule.
- PREFER VISUAL/CONCRETE over walls of text. If a graphic, image, or simple visual would serve better than a long document, plan to create that.
- Plan ONLY what the verdict + experiment call for. No scope creep.
- Steps must be executable by an autonomous agent with: shell, file read/write, web search/fetch, node (drives a REAL browser via playwright), and common CLIs.
- If the verdict is about doing something in the real world (an admin procedure, an application, a lookup on an official site, monitoring), the steps should USE THE BROWSER to actually do or prepare it — navigate, fill what can be filled, save evidence screenshots — stopping at any login/identity/payment wall, which becomes an "approval": true step describing exactly what the human must do.
- Anything irreversible or outward-facing (sending messages, payments, posting publicly, buying assets) must be tagged "approval": true — it will NOT run, it gets queued for the human.
- OUTPUT LANGUAGE: ${planKo ? 'Korean' : 'the language of the minutes'}. EVERY field — headline, summary, context, every steps[].do, deliverable, risk — must be written in that language, in plain everyday words. Never mix English sentences into Korean output (file names and product names may stay as-is).
- "approval": true steps are read by the owner as their to-do list. Write each one as a short, self-contained instruction a non-technical person instantly understands: what to send/do, to whom, when, and where the prepared content lives (file name). No parenthetical rule systems, no variant logic dumps — if a choice rule exists, say it in one plain sentence.

- In "context", pre-state every fact the executor should treat as GIVEN so it does not waste tool calls re-deriving them: concrete URLs the verdict named, file/repo paths, counts, prior decisions, and — critically — anything that does NOT exist yet (e.g. "no waitlist site is deployed; do not search for one"). This is the single biggest lever on execution speed.

- "headline" is the MOST IMPORTANT field for the human: one short plain-language sentence, like you're telling a busy non-technical friend what you'll do for them and why it helps. NO jargon, NO acronyms (no "UTM", "falsifier", "carve-out", "p99", "matrix"), NO internal codenames. If you can't say it plainly, the plan is too in-the-weeds. Example good: "I'll write the customer shutdown emails and refund steps for your 8 products, ready for you to send." Example bad: "Build sunset-package notice templates with prorated refund matrix and dispute carve-out."

Output strict JSON only:
{"headline": "plain-language one sentence for the owner — what you'll do and why it helps, no jargon",
 "summary": "one line — what will be done (may be technical)",
 "context": "facts to treat as given (paths, known/absent URLs, counts, prior decisions) — so the executor does not hunt for them",
 "steps": [{"n": 1, "do": "...", "approval": false}, ...],
 "deliverable": "what artifact exists when done",
 "risk": "the one thing most likely to go wrong"}`);
  const jsonStr = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  return { minutesFile, ...JSON.parse(jsonStr) };
}

export function runExecution(plan, onEvent, opts = {}) {
  return new Promise(resolve => {
    // opts.approved = the owner explicitly approved this plan (Approve & run / queue 승인 / telegram 승인)
    // → approval-tagged steps run for real too. Without it they stay held (legacy safety).
    const approvedAll = !!opts.approved;
    const safe = approvedAll ? plan.steps : plan.steps.filter(st => !st.approval);
    const held = approvedAll ? [] : plan.steps.filter(st => st.approval);
    const hadOutward = plan.steps.some(st => st.approval);
    const isKo = /[가-힣]/.test((plan.headline || '') + (plan.summary || '') + (plan.context || '') + safe.map(s => s.do).join(''));
    const lang = isKo ? 'Korean' : 'English';
    const task = `You are an autonomous executor working in ${WORKSPACE} (your working directory — keep ALL files in it).
Execute this approved plan, step by step. Be pragmatic, verify your own work, stop when the deliverable exists.

NARRATE LIKE A CALM ASSISTANT — in ${lang}. Before each action, write ONE short first-person sentence saying what you're about to do and why, in plain ${lang} (e.g. "${isKo ? '결제 게이트웨이 해지 절차를 확인하려고 공식 페이지를 열어보겠습니다.' : 'Opening the official page to check the cancellation terms.'}"). Keep it human and brief — no raw command dumps in your prose. These sentences are shown live to the owner as your voice.${isKo ? ' 모든 내레이션은 100% 한국어 — 영어 문장 금지.' : ''}

DELIVERABLE LANGUAGE: every file you create for the owner to read, send, or use (messages, drafts, reports, trackers, checklists) must be written in ${lang}. Code, commands, and config stay as code.

YOU HAVE A REAL BROWSER via the Playwright MCP tools (mcp__playwright__browser_navigate / _click / _type / _snapshot / _take_screenshot etc.). It runs on a PERSISTENT profile where the owner is already logged into their sites (X, Instagram, Naver, etc.). Use these tools to ACT for real — navigate, fill, click, publish, post — like a person. Save screenshots as proof. (You can also write node Playwright scripts for headless scraping, but for posting/acting on logged-in sites use the MCP browser.)

KNOWN CONTEXT — treat as given, do NOT re-derive or hunt for these:
${plan.context || '(none provided)'}

HARD LIMITS — violating these is failure:
- Work ONLY inside your working directory. Never read or touch files outside it.
- NEVER INVENT IDENTITY OR FACTS. Do not make up the owner's name, the company/brand name, a signature, email, phone, address, price, date, count, or any personal/account detail. If a deliverable needs one and it is not in KNOWN CONTEXT, write a clearly-labeled placeholder ([내 이름] / [회사명] / [금액]) and list every placeholder in ./HANDOFF.md for the owner to fill. A wrong name on something sent to a customer is worse than a blank — when unsure, leave it blank, never guess.
- DON'T HUNT. If a step needs a fact you don't already have (a URL, a path, a count), spend AT MOST one tool call to get it. If that one call fails, write the missing fact into ./HANDOFF.md, use a clearly-labeled placeholder, and move on. Burning many calls searching is failure.
- No schedulers, cron, cloud agents, or background daemons. If a step needs recurring runs, write the script + a README line saying how to schedule it, and stop.
- POSTING/PUBLISHING IS ALLOWED — this plan was already approved by the owner. Use the browser to post on sites they're logged into (X, Instagram, Naver, etc.). BUT: if a site is NOT logged in (you hit a login/2FA screen), do NOT attempt to log in or enter credentials — screenshot it, write what the owner must do in ./HANDOFF.md, and move on. Never create new accounts. Never make a payment unless a step explicitly says so.
- Finish within your budget: do the core deliverable first, skip nice-to-haves.

PLAN: ${plan.summary}
STEPS:
${safe.map(st => `${st.n}. ${st.do}${st.approval ? ' [owner-approved outward action — actually do it]' : ''}`).join('\n')}
${held.length ? `\nDO NOT do these (queued for human approval): ${held.map(st => st.do).join(' / ')}` : ''}
${approvedAll && hadOutward ? `\nThe owner EXPLICITLY APPROVED this whole plan, including the outward-facing steps (sending, posting, publishing). Execute them for real via the logged-in MCP browser. Only stop at a login/2FA/payment wall you cannot pass — then write what's left into ./HANDOFF.md.` : ''}
DELIVERABLE: ${plan.deliverable}

When finished, print exactly one final line: RESULT: <one sentence in ${lang} — what now exists and where>.`;
    ensureMcpConfig();
    const p = spawn('claude', [
      '-p', '--output-format', 'stream-json', '--verbose',
      // curated tools: files/shell/web + the Playwright MCP (browser automation = post/deploy anywhere)
      '--allowedTools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'mcp__playwright',
      // controlled isolation: no user CLAUDE.md/memory, ONLY the curated MCP config (no ambient MCPs), no meta-tools
      '--setting-sources', 'project',
      '--mcp-config', join(HOME, 'mcp.json'),
      '--strict-mcp-config',
      '--disallowedTools', 'Task', 'Agent', 'Skill', 'ToolSearch', 'CronCreate', 'CronDelete', 'CronList',
      'RemoteTrigger', 'SendMessage', 'PushNotification', 'TeamCreate', 'TeamDelete', 'NotebookEdit',
      'TaskCreate', 'TaskUpdate', 'Workflow', 'EnterPlanMode', 'ExitPlanMode',
      '--model', 'sonnet',
    ], { cwd: WORKSPACE, stdio: ['pipe', 'pipe', 'pipe'] });
    // runaway/hang guard — kill after 12 min
    const killer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} onEvent('exec', { kind: 'say', text: isKo ? '⏱ 실행이 12분을 넘겨 중단했습니다' : '⏱ execution timed out (12 min) — killed' }); }, 12 * 60 * 1000);
    let finalText = '', buf = '';
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'assistant' && ev.message?.content) {
            for (const b of ev.message.content) {
              if (b.type === 'tool_use') onEvent('exec', { kind: 'tool', tool: b.name, detail: (b.input?.command || b.input?.file_path || b.input?.url || b.input?.query || '').toString().slice(0, 140) });
              if (b.type === 'text' && b.text.trim()) { finalText = b.text.trim(); onEvent('exec', { kind: 'say', text: b.text.trim().slice(0, 400) }); }
            }
          }
          if (ev.type === 'result') finalText = ev.result || finalText;
        } catch {}
      }
    });
    p.on('close', code => {
      clearTimeout(killer);
      const result = (finalText.match(/RESULT:\s*(.*)/) || [])[1] || finalText.slice(-300) || `exit ${code}`;
      // execution report → minutes
      try {
        const path = join(HOME, plan.minutesFile);
        appendFileSync(path, `\n\n## Execution\n${plan.summary}\n\n**Result:** ${result}\n${held.length ? `\n**Held for approval:** ${held.map(st => st.do).join(' / ')}\n` : ''}_workspace: ${WORKSPACE}_\n`);
      } catch {}
      onEvent('exec', { kind: 'done', result, held: held.map(st => st.do) });
      resolve({ result, code });
    });
    p.stdin.write(task); p.stdin.end();
  });
}

// ── approval queue — every execution waits here for a human ─────────────
const QUEUE_PATH = join(HOME, 'queue.json');
export function loadQueue() {
  try { return JSON.parse(readFileSync(QUEUE_PATH, 'utf8')); } catch { return []; }
}
export function saveQueue(q) { writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2)); return q; }
export async function enqueuePlan(minutesFile) {
  const q = loadQueue();
  if (q.some(it => it.plan.minutesFile === minutesFile)) return q;  // no dupes per meeting
  const plan = await planExecution(minutesFile);
  q.unshift({ id: Math.random().toString(36).slice(2, 10), created: new Date().toISOString(), plan });
  return saveQueue(q);
}

// ── activity log — what the company did on its own, so the owner can SEE it ──
const ACTIVITY_PATH = join(HOME, 'activity.json');
export function loadActivity(n = 40) {
  try { return JSON.parse(readFileSync(ACTIVITY_PATH, 'utf8')).slice(0, n); } catch { return []; }
}
export function logActivity(kind, text) {
  const a = loadActivity(200);
  a.unshift({ at: new Date().toISOString(), kind, text: String(text).slice(0, 200) });
  writeFileSync(ACTIVITY_PATH, JSON.stringify(a.slice(0, 80), null, 2));
  return a;
}

// ── ledger scoring — the board grades its own judgment against reality ──
const LEDGER_PATH = join(HOME, 'ledger.md');
function ledgerLines() {
  let txt = ''; try { txt = readFileSync(LEDGER_PATH, 'utf8'); } catch { return { all: [], dataIdx: [] }; }
  const all = txt.split('\n');
  const dataIdx = all.map((l, i) => ({ l, i })).filter(x => x.l.startsWith('|') && !x.l.includes('---') && !x.l.startsWith('| date')).map(x => x.i);
  return { all, dataIdx };
}
// parsed rows (newest first, as stored) + running batting average
export function ledgerData() {
  const { all, dataIdx } = ledgerLines();
  const rows = dataIdx.map((i, idx) => {
    const c = all[i].split('|').map(s => s.trim());
    return { row: idx, date: c[1], question: c[2], decision: c[3], conf: +c[4] || 0, status: c[5], review: c[6], outcome: (c[7] || 'pending').toLowerCase() };
  });
  const hits = rows.filter(r => r.outcome === 'hit').length;
  const misses = rows.filter(r => r.outcome === 'miss').length;
  const scored = hits + misses;
  const avg = scored ? Math.round((hits / scored) * 1000) / 1000 : null;  // batting average .000–1.000
  return { rows, stats: { hits, misses, pending: rows.length - scored, scored, total: rows.length, avg } };
}
// mark a decision hit/miss/pending by its row index (0 = newest)
export function scoreLedger(rowIndex, outcome) {
  if (!['hit', 'miss', 'pending'].includes(outcome)) throw new Error('bad outcome');
  const { all, dataIdx } = ledgerLines();
  const lineNo = dataIdx[rowIndex];
  if (lineNo == null) throw new Error('no such row');
  const c = all[lineNo].split('|');
  // c = ['', date, question, decision, conf, status, review, outcome, '']
  c[7] = ` ${outcome} `;
  all[lineNo] = c.join('|');
  writeFileSync(LEDGER_PATH, all.join('\n'));
  return ledgerData();
}
