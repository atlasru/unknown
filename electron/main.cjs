const { app, BrowserWindow, ipcMain, dialog, protocol, net, session, clipboard } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'atlas', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('Atlas');
const isTest = process.env.ATLAS_TEST === '1';
if (!isTest && !app.requestSingleInstanceLock()) app.quit();
let window, engine, endpoint, stopping = false, engineReady = false;
const token = randomBytes(32).toString('hex');
const root = path.join(__dirname, '..');

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('atlas://app/')) {
    throw new Error('Untrusted IPC sender');
  }
}

async function api(resource, method = 'GET', body) {
  if (!engineReady) throw new Error('Analysis engine is unavailable. Restart Atlas.');
  const result = await fetch(endpoint + resource, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || `Engine returned ${result.status}`);
  return data;
}

function startEngine() {
  return new Promise((resolve, reject) => {
    const data = process.env.ATLAS_DATA_DIR || path.join(app.getPath('userData'), 'workspace');
    let command, args;
    if (app.isPackaged) {
      command = path.join(process.resourcesPath, 'engine', process.platform === 'win32' ? 'atlas-engine.exe' : 'atlas-engine');
      args = ['--data', data];
    } else {
      command = process.env.ATLAS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
      args = [path.join(root, 'engine', 'launch.py'), '--data', data];
    }
    const logDir = app.getPath('logs');
    fs.mkdirSync(logDir, { recursive: true });
    const log = fs.createWriteStream(path.join(logDir, 'engine.log'), { flags: 'a' });
    engine = spawn(command, args, { env: { ...process.env, ATLAS_API_TOKEN: token, PYTHONUNBUFFERED: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const timeout = setTimeout(() => reject(new Error('Analysis engine did not start within 60 seconds')), 60000);
    let output = '';
    engine.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.length > 100000) output = output.slice(-10000);
      for (let end; (end = output.indexOf('\n')) !== -1;) {
        const line = output.slice(0, end); output = output.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (message.ready && Number.isInteger(message.port) && message.port > 0 && message.port < 65536) {
            endpoint = `http://127.0.0.1:${message.port}`;
            engineReady = true;
            clearTimeout(timeout);
            resolve();
          }
        } catch { log.write(line + '\n'); }
      }
    });
    engine.stderr.on('data', chunk => log.write(chunk));
    engine.on('error', error => { clearTimeout(timeout); reject(error); });
    engine.on('exit', code => {
      clearTimeout(timeout); engineReady = false; log.end();
      if (!stopping) {
        reject(new Error(`Analysis engine exited (${code}). Log: ${path.join(logDir, 'engine.log')}`));
        if (window && !window.isDestroyed()) window.webContents.send('atlas:engine-stopped');
      }
    });
  });
}

function registerIPC() {
  ipcMain.handle('atlas:api', async (event, resource, method, body) => {
    trusted(event);
    if (typeof resource !== 'string' || resource.length > 8192 || !['GET', 'POST'].includes(method)) throw new Error('Invalid request');
    const allowedGet = /^\/(?:health|cases|jobs|cases\/[a-f0-9]{32}\/(?:summary|artifacts|entities|graph|path|events|findings|notes|history)(?:\/[a-f0-9]{32})?)(?:\?[^#]*)?$/;
    const allowedPost = /^\/(?:cases|jobs\/[a-f0-9]{32}\/cancel|cases\/[a-f0-9]{32}\/(?:notes|verify|findings\/[a-f0-9]{32}))$/;
    if (!(method === 'GET' ? allowedGet : allowedPost).test(resource)) throw new Error('Request is not allowed');
    if (JSON.stringify(body || {}).length > 100000) throw new Error('Request too large');
    return api(resource, method, body);
  });
  ipcMain.handle('atlas:import', async (event, caseId, folder) => {
    trusted(event);
    if (!/^[a-f0-9]{32}$/.test(caseId)) throw new Error('Invalid case');
    const selected = isTest && process.env.ATLAS_TEST_IMPORT ? { canceled: false, filePaths: [process.env.ATLAS_TEST_IMPORT] } : await dialog.showOpenDialog(window, {
      title: folder ? 'Import evidence folder' : 'Import evidence files', properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
    });
    if (selected.canceled) return null;
    return api(`/cases/${caseId}/import`, 'POST', { paths: selected.filePaths });
  });
  ipcMain.handle('atlas:drop', async (event, caseId, paths) => {
    trusted(event);
    if (!/^[a-f0-9]{32}$/.test(caseId) || !Array.isArray(paths) || paths.length > 3000 || !paths.every(p => typeof p === 'string' && path.isAbsolute(p))) throw new Error('Invalid dropped files');
    return api(`/cases/${caseId}/import`, 'POST', { paths });
  });
  ipcMain.handle('atlas:export', async (event, caseId) => {
    trusted(event);
    if (!/^[a-f0-9]{32}$/.test(caseId)) throw new Error('Invalid case');
    const destination = isTest && process.env.ATLAS_TEST_EXPORT ? { canceled: false, filePath: process.env.ATLAS_TEST_EXPORT } : await dialog.showSaveDialog(window, {
      title: 'Export evidence bundle', defaultPath: `Atlas-${caseId.slice(0, 8)}.zip`, filters: [{ name: 'Atlas evidence bundle', extensions: ['zip'] }],
    });
    if (destination.canceled || !destination.filePath) return null;
    return api(`/cases/${caseId}/export`, 'POST', { destination: destination.filePath });
  });
  ipcMain.handle('atlas:copy', (event, text) => {
    trusted(event);
    if (typeof text !== 'string' || text.length > 1000000) throw new Error('Invalid clipboard value');
    clipboard.writeText(text);
  });
  ipcMain.handle('atlas:window', (event, action) => {
    trusted(event);
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
}

app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
app.whenReady().then(async () => {
  const ui = path.resolve(root, 'dist');
  protocol.handle('atlas', request => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Forbidden', { status: 403 });
    let relative;
    try { relative = decodeURIComponent(url.pathname); } catch { return new Response('Invalid path', { status: 400 }); }
    const file = path.resolve(ui, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(ui + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('atlas://app/') && !details.url.startsWith('devtools://') }));
  registerIPC();
  try {
    await startEngine();
    window = new BrowserWindow({
      width: 1480, height: 960, minWidth: 1050, minHeight: 700, backgroundColor: '#10151f', frame: false, show: false,
      icon: path.join(root, 'build', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.once('ready-to-show', () => window.show());
    await window.loadURL('atlas://app/');
  } catch (error) {
    dialog.showErrorBox('Atlas could not start', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (stopping || !engine || engine.exitCode !== null) return;
  event.preventDefault(); stopping = true;
  engine.stdin.end();
  const timer = setTimeout(() => { if (engine.exitCode === null) engine.kill(); app.exit(0); }, 35000);
  engine.once('exit', () => { clearTimeout(timer); app.exit(0); });
});
