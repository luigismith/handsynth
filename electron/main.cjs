// HandSynth — Electron main process.
//
// Why CJS? package.json has "type": "module", but Electron's ESM main support
// (28+) is still a sharp edge. CJS is rock-solid and gives us synchronous
// require() for the few Node modules we touch. The renderer continues to load
// Vite's ESM bundle from dist/index.html, which is a normal browser context
// and unaffected by this file.
//
// Responsibilities:
//   1. Create a single dark BrowserWindow (1280x800, resizable).
//   2. In dev, load VITE_DEV_SERVER_URL (default http://localhost:5173).
//      In prod, loadFile(dist/index.html).
//   3. Auto-grant `media` permission so getUserMedia works without a popup —
//      the user has already opted in via the in-app onboarding click.
//   4. Inject a permissive CSP for cdn.jsdelivr.net + storage.googleapis.com
//      so MediaPipe can fetch its WASM blob and .task model.
//   5. Standard Windows quit-on-close vs macOS keep-dock-icon behaviour.

const { app, BrowserWindow, session, Menu } = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

/** @type {BrowserWindow | null} */
let mainWindow = null;

function buildCspHeader() {
  // MediaPipe pulls WASM + model files from these origins. Keep things tight
  // otherwise — no inline-eval beyond what Vite/MediaPipe require, no remote
  // script besides the CDN. 'wasm-unsafe-eval' is needed for WebAssembly.
  // 'unsafe-inline' for styles is unfortunately required by p5/Tone helpers
  // and the inline <style> in index.html.
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
    "worker-src 'self' blob: https://cdn.jsdelivr.net",
    "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com data: blob:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
  ];
  return directives.join('; ');
}

function configureSession() {
  const ses = session.defaultSession;

  // Auto-grant media (camera) permission. The renderer's Onboarding flow is
  // the gate; if the user got that far, they explicitly want the camera on.
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(false);
  });

  // Some Chromium builds also route via this callback for synchronous checks.
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media';
  });

  // Inject CSP for HTML responses. Doing this via webRequest beats putting it
  // in a <meta> tag because it also covers any future redirects and can't be
  // overridden by the renderer.
  const csp = buildCspHeader();
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0c',
    title: 'HandSynth',
    autoHideMenuBar: process.platform === 'win32',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (process.platform === 'win32') {
    // Belt-and-braces: also drop the menu entirely on Windows.
    mainWindow.setMenuBarVisibility(false);
  }

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  configureSession();

  if (process.platform === 'darwin') {
    // Keep a sensible default macOS menu so the app feels native.
    Menu.setApplicationMenu(Menu.getApplicationMenu());
  } else {
    Menu.setApplicationMenu(null);
  }

  createWindow();

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and there are
    // no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Standard Windows/Linux behaviour: quit when the last window closes.
  // macOS apps stay alive in the dock until Cmd+Q.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
