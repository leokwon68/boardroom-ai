// Boardroom — Mac menubar app. Wraps the local server as a real desktop
// program: lives in the menu bar, runs the autonomous board 24/7, opens the
// UI in its own window. Execution needs this machine (claude CLI + your
// logged-in browser), which is exactly why this is a desktop app, not iOS.
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

// where the server + its files live: repo root in dev, bundled resources in prod
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.mjs');
const PORT = String(process.env.BOARDROOM_PORT || 4242);
const URL = `http://localhost:${PORT}/`;

let win = null, tray = null, srv = null, serverUp = false;

function startServer() {
  // ELECTRON_RUN_AS_NODE makes this Electron binary behave as plain Node, so a
  // packaged .app carries its own runtime — the user needs no separate Node.
  srv = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BOARDROOM_NO_OPEN: '1', PORT },
    stdio: 'inherit',
  });
  srv.on('exit', code => { serverUp = false; console.log('[boardroom] server exited', code); });
}

function waitForServer(cb, tries = 80) {
  const ping = () => http.get(`${URL}api/state`, res => { res.resume(); serverUp = true; cb(); })
    .on('error', () => { if (--tries <= 0) return cb(); setTimeout(ping, 250); });
  ping();
}

function openWindow() {
  if (win) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1240, height: 860, minWidth: 380, title: 'Boardroom',
    backgroundColor: '#070708', show: false, titleBarStyle: 'hiddenInset',
  });
  win.loadURL(URL);
  win.once('ready-to-show', () => win.show());
  // open external links in the real browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // closing just hides — the board keeps working in the menu bar
  win.on('close', e => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}

// Web Push doesn't work inside Electron (no FCM backend), so the desktop app
// gets NATIVE OS notifications instead — this is what makes "works while you
// sleep" real on the desktop. Poll the activity feed; ping on new agenda/approval.
let _lastNotifAt = null;
function startNotifications() {
  const poll = () => {
    http.get(`${URL}api/activity`, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => {
        try {
          const { activity } = JSON.parse(b);
          if (!activity || !activity.length) return;
          if (_lastNotifAt === null) { _lastNotifAt = activity[0].at; return; }  // skip the backlog on first poll
          const fresh = activity.filter(a => a.at > _lastNotifAt && (a.kind === 'await' || a.kind === 'notice'));
          _lastNotifAt = activity[0].at;
          for (const a of fresh.reverse()) {
            if (!Notification.isSupported()) break;
            const n = new Notification({
              title: a.kind === 'await' ? '📥 승인 대기 — 실행할까요?' : '🔔 보드가 안건을 찾았어요',
              body: (a.text || '').replace(/^approve in the app:\s*/, '').slice(0, 180),
              silent: false,
            });
            n.on('click', openWindow);
            n.show();
          }
        } catch {}
      });
    }).on('error', () => {});
  };
  poll();
  setInterval(poll, 30000);
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  icon.setTemplateImage(true);   // macOS auto-inverts for light/dark menu bar
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, 'icon.png')) : icon);
  tray.setToolTip('Boardroom');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Boardroom', click: openWindow },
    { type: 'separator' },
    { label: 'Quit Boardroom', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', openWindow);
}

// single instance — clicking the app again focuses, never double-runs the server
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', openWindow);
  app.whenReady().then(() => {
    if (app.dock) app.dock.hide();   // pure menu-bar app, no dock icon
    startServer();
    buildTray();
    waitForServer(() => { openWindow(); startNotifications(); });
  });
  app.on('window-all-closed', () => {});   // stay alive in the menu bar
  app.on('activate', openWindow);
  app.on('before-quit', () => { app.isQuitting = true; try { srv && srv.kill(); } catch {} });
}
