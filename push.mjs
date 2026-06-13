// ── web push — phone lock-screen notifications, no telegram, no API key ──
// "the AI that works while you sleep" needs a way to tap you on the shoulder.
// Standard Web Push (VAPID + service worker): the browser delivers to the
// phone's lock screen even with the app closed. iOS works once the user adds
// the app to their home screen (standalone PWA). VAPID keypair is generated
// once and stored locally; subscriptions live in ~/.boardroom/push-subs.json.
import webpush from 'web-push';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = join(homedir(), '.boardroom');
const VAPID_PATH = join(HOME, 'vapid.json');
const SUBS_PATH = join(HOME, 'push-subs.json');

function vapid() {
  if (existsSync(VAPID_PATH)) { try { return JSON.parse(readFileSync(VAPID_PATH, 'utf8')); } catch {} }
  const keys = webpush.generateVAPIDKeys();
  try { writeFileSync(VAPID_PATH, JSON.stringify(keys, null, 2)); } catch {}
  return keys;
}
const KEYS = vapid();
webpush.setVapidDetails('mailto:boardroom@localhost', KEYS.publicKey, KEYS.privateKey);

export function vapidPublicKey() { return KEYS.publicKey; }

function loadSubs() { try { return JSON.parse(readFileSync(SUBS_PATH, 'utf8')); } catch { return []; } }
function saveSubs(s) { try { writeFileSync(SUBS_PATH, JSON.stringify(s, null, 2)); } catch {} }

export function pushEnabled() { return loadSubs().length > 0; }

// store a browser's subscription (idempotent by endpoint)
export function addSub(sub) {
  if (!sub || !sub.endpoint) return false;
  const subs = loadSubs();
  if (!subs.find(s => s.endpoint === sub.endpoint)) { subs.push(sub); saveSubs(subs); }
  return true;
}

// fan a notification out to every subscribed device; prune dead subscriptions
export async function pushNotify(title, body, url = '/') {
  const subs = loadSubs();
  if (!subs.length) return 0;
  const payload = JSON.stringify({ title, body: String(body || '').slice(0, 240), url });
  const alive = [];
  await Promise.all(subs.map(async s => {
    try { await webpush.sendNotification(s, payload); alive.push(s); }
    catch (e) { if (!(e.statusCode === 404 || e.statusCode === 410)) alive.push(s); } // prune only expired
  }));
  if (alive.length !== subs.length) saveSubs(alive);
  return alive.length;
}
