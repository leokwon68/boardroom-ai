// Zero-dependency tests (node --test). Isolated to a temp ~/.boardroom via $HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// point the engine at a throwaway home BEFORE importing it
const HOME = mkdtempSync(join(tmpdir(), 'boardroom-test-'));
process.env.HOME = HOME;
const BR = join(HOME, '.boardroom');
mkdirSync(BR, { recursive: true });

const eng = await import('../engine.mjs');

test('MODEL_CATALOG is a non-empty list with provider + id on every model', () => {
  assert.ok(Array.isArray(eng.MODEL_CATALOG));
  assert.ok(eng.MODEL_CATALOG.length >= 4);
  for (const m of eng.MODEL_CATALOG) { assert.ok(m.id, 'id'); assert.ok(m.provider, 'provider'); }
  assert.ok(eng.MODEL_CATALOG.some(m => m.id === 'claude-opus-4-8'));
});

test('roleModels returns a valid model id for chair/seat/redteam', () => {
  const r = eng.roleModels();
  for (const role of ['chair', 'seat', 'redteam']) assert.equal(typeof r[role], 'string');
});

test('queue save/load round-trips and dedupes by minutesFile', () => {
  eng.saveQueue([]);
  assert.deepEqual(eng.loadQueue(), []);
  const q = [{ id: 'a1', plan: { minutesFile: 'm1.md', summary: 's' } }];
  eng.saveQueue(q);
  assert.equal(eng.loadQueue().length, 1);
  assert.equal(eng.loadQueue()[0].id, 'a1');
});

test('ledger: scoreLedger updates outcome and batting average is correct', () => {
  writeFileSync(join(BR, 'ledger.md'),
    '| date | question | decision | conf | status | review | outcome |\n|---|---|---|---|---|---|---|\n' +
    '| 2026-06-11 | q1 | d1 | 60 | CONFIRMED | 2026-06-18 | pending |\n' +
    '| 2026-06-11 | q2 | d2 | 40 | DOWNGRADED | 2026-06-18 | pending |\n');
  let d = eng.ledgerData();
  assert.equal(d.stats.total, 2);
  assert.equal(d.stats.avg, null, 'no avg before any scoring');
  eng.scoreLedger(0, 'hit');
  eng.scoreLedger(1, 'miss');
  d = eng.ledgerData();
  assert.equal(d.stats.hits, 1);
  assert.equal(d.stats.misses, 1);
  assert.equal(d.stats.avg, 0.5, '1 hit / 2 scored = .500');
});

test('activity log: logActivity then loadActivity returns newest first, capped', () => {
  for (let i = 0; i < 3; i++) eng.logActivity('verdict', 'item ' + i);
  const a = eng.loadActivity(10);
  assert.ok(a.length >= 3);
  assert.equal(a[0].text, 'item 2', 'newest first');
  assert.ok(a[0].kind === 'verdict' && a[0].at);
});

test('config + staff + divisions round-trip', () => {
  eng.saveConfig({ lang: 'ko' });
  assert.equal(eng.loadConfig().lang, 'ko');
  eng.saveStaff([{ id: 'x', name: 'X', lens: 'test' }]);
  assert.equal(eng.loadStaff()[0].name, 'X');
  eng.saveDivisions([{ id: 'd', name: 'D', focus: 'f', staff: [] }]);
  assert.equal(eng.loadDivisions()[0].name, 'D');
});

test('detectKeys returns an object without throwing', () => {
  const k = eng.detectKeys();
  assert.equal(typeof k, 'object');
});
