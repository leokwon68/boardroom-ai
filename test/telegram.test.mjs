// telegram.mjs config resolution — zero-dep, isolated home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'boardroom-tg-'));
process.env.HOME = HOME;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
mkdirSync(join(HOME, '.boardroom'), { recursive: true });

const tg = await import('../telegram.mjs');

test('tgEnabled is false when nothing is configured', () => {
  assert.equal(tg.tgEnabled(), false);
  assert.equal(tg.tgConfig(), null);
});

test('tgConfig reads a config.json telegram block and marks it pollable (dedicated)', () => {
  writeFileSync(join(HOME, '.boardroom', 'config.json'),
    JSON.stringify({ telegram: { botToken: '123:ABC', chatId: '-100999', threadId: 4 } }));
  const c = tg.tgConfig();
  assert.equal(c.token, '123:ABC');
  assert.equal(c.chat, '-100999');
  assert.equal(tg.tgEnabled(), true);
  assert.equal(tg.tgCanPoll(), true);
});
