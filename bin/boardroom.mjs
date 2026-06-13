#!/usr/bin/env node
// boardroom — one command, a full board meeting for any decision.
//
//   boardroom "Should I raise my prices?"
//
// Five AI seats debate your question, a red team attacks the verdict,
// and the decision lands in a ledger that gets scored later.
// Zero setup: uses the `claude` CLI you already have. No API key, no config.
import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARGV = process.argv.slice(2);
const QUESTION = ARGV.join(' ').trim();

const WORKER_MODEL = process.env.BOARDROOM_WORKER_MODEL || 'sonnet';
const CHAIR_MODEL = process.env.BOARDROOM_CHAIR_MODEL || 'opus';
const HOME = join(homedir(), '.boardroom');
mkdirSync(HOME, { recursive: true });

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`, red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m`,
};

const SEATS = [
  { id: 'analyst', lens: 'Numbers, evidence, unit economics. Distrust narratives without data.' },
  { id: 'operator', lens: 'Execution reality. What breaks in practice, hidden costs, time.' },
  { id: 'skeptic', lens: 'Risk and downside. What kills this. Always hunt the failure mode.' },
];

function claude(model, prompt) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', model], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err || `claude exit ${code}`)));
    p.stdin.write(prompt);
    p.stdin.end();
  });
}

const ts = () => new Date().toTimeString().slice(0, 8);
const say = (who, color, msg) => console.log(`${C.dim(ts())} ${color(C.bold(who.padEnd(9)))} ${msg}`);

async function main() {
  const t0 = Date.now();
  console.log('\n' + C.bold('  BOARDROOM') + C.dim(' — convening 3 seats + chair + red team\n'));
  console.log('  ' + C.yellow('AGENDA — ') + QUESTION + '\n');

  // R1 — independent proposals (parallel)
  say('chair', C.yellow, 'R1: independent proposals, evidence required, falsifier required');
  const r1 = await Promise.all(SEATS.map(s => claude(WORKER_MODEL, `You are the ${s.id} seat on a decision board. Lens: ${s.lens}

AGENDA: ${QUESTION}

Give your position in under 130 words, exactly this structure:
POSITION: one sentence.
EVIDENCE: 2 concrete reasons (real-world mechanisms, not vibes).
FALSIFIER: one observable signal that would prove you wrong, with a timeframe.
RISK: the single biggest risk of your own position.`)));
  r1.forEach((t, i) => say(SEATS[i].id, C.cyan, t.split('\n')[0].replace(/^POSITION:\s*/i, '').slice(0, 110)));

  // R2 — cross-attack (parallel)
  say('chair', C.yellow, 'R2: cross-examination — attack the weakest point of the others');
  const packet = r1.map((t, i) => `--- ${SEATS[i].id} ---\n${t}`).join('\n\n');
  const r2 = await Promise.all(SEATS.map(s => claude(WORKER_MODEL, `You are the ${s.id} seat. Lens: ${s.lens}

AGENDA: ${QUESTION}

All positions:
${packet}

In under 90 words: attack the single weakest claim made by another seat (name it), concede one real flaw in your own position, and state what you now believe.`)));
  r2.forEach((t, i) => say(SEATS[i].id, C.cyan, t.split('\n').find(l => l.trim()) ?.slice(0, 110) || ''));

  // R4 — chair verdict
  say('chair', C.yellow, 'R4: weighing positions → verdict');
  const verdict = await claude(CHAIR_MODEL, `You chair a decision board. Decide — do not survey options.

AGENDA: ${QUESTION}

Round 1 (positions):
${packet}

Round 2 (cross-examination):
${r2.map((t, i) => `--- ${SEATS[i].id} ---\n${t}`).join('\n\n')}

Output exactly:
DECISION: one sentence, actionable.
WHY: 2 lines, citing which seat's evidence carried.
REJECTED: what you rejected and why, 1 line.
FALSIFIER: the observable signal + date that proves this verdict wrong.
EXPERIMENT: one cheap test runnable within 14 days.
CONFIDENCE: integer 0-100 on its own line.`);
  const conf = parseInt((verdict.match(/CONFIDENCE:\s*(\d+)/i) || [])[1] || '50', 10);
  say('chair', C.yellow, verdict.match(/DECISION:.*/i)?.[0].slice(0, 120) || 'verdict ready');

  // R5 — red team gate
  say('red team', C.red, 'R5: attacking the verdict');
  const red = await claude(CHAIR_MODEL, `You are a red team. Your job is to BREAK this verdict. Be adversarial, not polite.

AGENDA: ${QUESTION}

VERDICT:
${verdict}

Output exactly:
ATTACK: strongest realistic failure scenario, 2 lines.
SURVIVES: YES or NO — does the verdict survive your attack?
ADJUSTED_CONFIDENCE: integer 0-100 on its own line.`);
  const survives = /SURVIVES:\s*YES/i.test(red);
  const adjConf = parseInt((red.match(/ADJUSTED_CONFIDENCE:\s*(\d+)/i) || [])[1] || String(conf), 10);
  say('red team', C.red, (red.match(/ATTACK:.*/i)?.[0] || '').slice(0, 120));

  // ledger
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const review = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const status = survives ? 'CONFIRMED' : 'DOWNGRADED';
  const minutesPath = join(HOME, `${stamp}.md`);
  writeFileSync(minutesPath, `# Boardroom — ${QUESTION}\n\n## R1 Positions\n${packet}\n\n## R2 Cross-examination\n${r2.map((t, i) => `--- ${SEATS[i].id} ---\n${t}`).join('\n\n')}\n\n## R4 Verdict\n${verdict}\n\n## R5 Red team\n${red}\n\n_status: ${status} · confidence: ${adjConf} · review: ${review}_\n`);
  const ledgerPath = join(HOME, 'ledger.md');
  if (!existsSync(ledgerPath)) appendFileSync(ledgerPath, '| date | question | decision | conf | status | review | outcome |\n|---|---|---|---|---|---|---|\n');
  appendFileSync(ledgerPath, `| ${new Date().toISOString().slice(0, 10)} | ${QUESTION.slice(0, 60)} | ${(verdict.match(/DECISION:\s*(.*)/i) || [])[1]?.slice(0, 80) || ''} | ${adjConf} | ${status} | ${review} | pending |\n`);

  // final card
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log('\n  ' + (survives ? C.green('■ VERDICT CONFIRMED') : C.red('■ VERDICT DOWNGRADED BY RED TEAM')) + C.dim(`  (${secs}s)`));
  console.log('\n' + verdict.split('\n').map(l => '  ' + l).join('\n'));
  console.log('\n  ' + C.red(red.match(/ATTACK:[\s\S]*?(?=SURVIVES:)/i)?.[0].trim().split('\n').join('\n  ') || ''));
  console.log('\n  ' + C.dim(`confidence ${adjConf}/100 · review ${review} · minutes ${minutesPath}`));
  console.log('  ' + C.dim(`ledger: ${ledgerPath} — verdicts get scored. This AI keeps its batting average.`) + '\n');
}

// ── dispatch (must run after all const/function declarations above) ──
// `npx boardroom` (no args) or `boardroom serve|web|app` → launch the web product
// `boardroom share` / `--share` → also open a public tunnel (token-gated) for the phone
const WANT_SHARE = ARGV.some(a => /^--?share$/i.test(a));
const REST = ARGV.filter(a => !/^--?share$/i.test(a));
if (!REST.join(' ').trim() || ['serve', 'web', 'app', 'ui', 'share'].includes(REST[0]?.toLowerCase())) {
  const here = dirname(fileURLToPath(import.meta.url));
  const server = join(here, '..', 'server.mjs');
  console.log(`\n  Boardroom — your one-person company, incorporated.\n  starting…\n`);
  // server picks a free port (graceful fallback) and opens the browser itself
  const srv = spawn(process.execPath, [server], { stdio: 'inherit', env: { ...process.env, ...(WANT_SHARE ? { BOARDROOM_SHARE: '1' } : {}) } });
  srv.on('close', code => process.exit(code || 0));
  process.on('SIGINT', () => srv.kill('SIGINT'));
} else {
  main().catch(e => { console.error(C.red('boardroom error: ') + e.message); process.exit(1); });
}
