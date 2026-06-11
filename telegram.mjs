// telegram.mjs — phone bridge. Push verdicts/approvals out; take commands in.
// Zero-dependency. Credentials resolved in order:
//   1. ~/.boardroom/config.json  → { telegram: { botToken, chatId, threadId } }
//   2. env: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / TELEGRAM_MAIN_THREAD
//   3. ~/VANTA LABS/.env.telegram  (owner's existing JARVIS bot — dogfooding fallback)
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = join(homedir(), '.boardroom');

function parseEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
    }
  } catch {}
  return out;
}

export function tgConfig() {
  // 1. boardroom config — a dedicated bot. safe to poll for commands.
  try {
    const c = JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8')).telegram;
    if (c && c.botToken && c.chatId) return { token: c.botToken, chat: c.chatId, thread: c.threadId, source: 'config', dedicated: true };
  } catch {}
  // 2. env — treat as dedicated unless told otherwise
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
    return { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID, thread: process.env.TELEGRAM_MAIN_THREAD, source: 'env', dedicated: true };
  // 3. the owner's old JARVIS bot — JARVIS was retired 2026-06-11, so this bot is
  //    free and Boardroom now owns it (push + commands). Swap to a branded bot any
  //    time by adding a `telegram` block to ~/.boardroom/config.json.
  const ef = join(homedir(), 'VANTA LABS', '.env.telegram');
  if (existsSync(ef)) {
    const e = parseEnvFile(ef);
    if (e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID) return { token: e.TELEGRAM_BOT_TOKEN, chat: e.TELEGRAM_CHAT_ID, thread: e.TELEGRAM_MAIN_THREAD, source: 'inherited', dedicated: true };
  }
  return null;
}

export function tgEnabled() { return !!tgConfig(); }
export function tgCanPoll() { const c = tgConfig(); return !!(c && c.dedicated); }

export async function tgSend(text, opts = {}) {
  const c = tgConfig(); if (!c) return false;
  const chat = opts.chatId || c.chat;
  const body = { chat_id: chat, text: text.slice(0, 3900), parse_mode: 'Markdown', disable_web_page_preview: true };
  // only use the configured forum thread when sending to the configured group, not to a DM
  if (!opts.chatId && c.thread && Number(c.thread)) body.message_thread_id = Number(c.thread);
  if (opts.thread && Number(opts.thread)) body.message_thread_id = Number(opts.thread);
  try {
    const r = await fetch(`https://api.telegram.org/bot${c.token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return r.ok;
  } catch { return false; }
}

// reply to the chat a command came from (works for DMs even with group privacy on)
export function tgReply(m, text) {
  return tgSend(text, { chatId: m.chat.id, thread: m.message_thread_id });
}

// long-poll getUpdates; call onText(text) for each new message from the owner's chat.
// Returns a stop() function.
export function tgPoll(onText) {
  const c = tgConfig(); if (!c) return () => {};
  let offset = 0, stopped = false;
  (async () => {
    // skip backlog: seed offset to the latest update so we don't replay old messages
    try {
      const r = await fetch(`https://api.telegram.org/bot${c.token}/getUpdates?offset=-1`);
      const j = await r.json();
      if (j.ok && j.result.length) offset = j.result[j.result.length - 1].update_id + 1;
    } catch {}
    while (!stopped) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${c.token}/getUpdates?timeout=25&offset=${offset}`, { signal: AbortSignal.timeout(30000) });
        const j = await r.json();
        if (j.ok) for (const u of j.result) {
          offset = u.update_id + 1;
          const m = u.message || u.edited_message;
          if (!m || !m.text) continue;
          // accept the configured group OR any private DM (DMs bypass group privacy mode)
          if (m.chat.type !== 'private' && String(m.chat.id) !== String(c.chat)) continue;
          try { await onText(m.text.trim(), m); } catch (e) { /* swallow */ }
        }
      } catch { await new Promise(r => setTimeout(r, 3000)); }
    }
  })();
  return () => { stopped = true; };
}
