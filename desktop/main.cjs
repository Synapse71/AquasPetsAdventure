const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
let computeNativeLayout, PANEL_WIDTHS;

app.setName('咕咕嘎嘎');
const devURL = process.env.IDLE_DESKTOP_DEV_URL;
if (devURL && devURL !== 'http://127.0.0.1:5173/') throw new Error('Unsupported development origin');
const entryURL = devURL || pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
const appIconPath = path.join(__dirname, '../public/icons/aquamarine-1024.png');
let win, tray, panel = null, layout, dragOrigin, quitting = false;
let preferences = { x: 0, y: 0, canvas: 300, alwaysOnTop: true };
let preferenceFile;
const valid = event => win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === entryURL;
function persist() {
  try {
    fs.writeFileSync(preferenceFile + '.tmp', JSON.stringify(preferences));
    fs.renameSync(preferenceFile + '.tmp', preferenceFile);
  } catch (error) { console.error('Cannot save desktop preferences', error); }
}
function state() { return { layout, canvas: preferences.canvas, alwaysOnTop: preferences.alwaysOnTop }; }
function place() {
  const display = screen.getDisplayNearestPoint({ x: Math.round(preferences.x + preferences.canvas / 2), y: Math.round(preferences.y + 150) });
  const next = computeNativeLayout(preferences, display.workArea, panel, preferences.canvas);
  const unchanged = JSON.stringify(next) === JSON.stringify(layout);
  const boundsChanged = JSON.stringify(next.bounds) !== JSON.stringify(layout?.bounds);
  layout = next;
  Object.assign(preferences, layout.position);
  if (unchanged) return;
  if (boundsChanged) win.setBounds(layout.bounds, false);
  win.webContents.send('pet:layout', state());
}
function endDrag() {
  dragOrigin = undefined;
  persist();
}
function closePanels() {
  panel = null;
  win.webContents.send('pet:close-panels');
  place();
}
function showPet() { closePanels(); win.showInactive(); refreshTrayMenu(); }
function hidePet() { endDrag(); closePanels(); win.hide(); refreshTrayMenu(); }
function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const visible = win.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? '隐藏宠物' : '显示宠物', click: visible ? hidePet : showPet },
    { type: 'separator' }, { label: '退出游戏', click: () => app.quit() },
  ]));
}
function setupIPC() {
  ipcMain.handle('pet:state', event => valid(event) ? state() : null);
  ipcMain.handle('pet:panel', (event, value) => {
    if (!valid(event) || (value !== null && !Object.hasOwn(PANEL_WIDTHS, value))) return null;
    panel = value;
    place();
    return state();
  });
  ipcMain.on('pet:ignore', (event, value) => {
    if (valid(event) && typeof value === 'boolean' && !dragOrigin) win.setIgnoreMouseEvents(value, { forward: true });
  });
  const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 100000 && Math.abs(point.y) < 100000;
  ipcMain.on('pet:drag-start', (event, point) => {
    if (!valid(event) || dragOrigin || !validPoint(point)) return;
    dragOrigin = { mouse: point, x: preferences.x, y: preferences.y };
    win.setIgnoreMouseEvents(false);
  });
  ipcMain.on('pet:drag-to', (event, point) => {
    if (!valid(event) || !dragOrigin || !validPoint(point)) return;
    preferences.x = dragOrigin.x + point.x - dragOrigin.mouse.x;
    preferences.y = dragOrigin.y + point.y - dragOrigin.mouse.y;
    place();
  });
  ipcMain.on('pet:drag-end', event => { if (valid(event)) endDrag(); });
  ipcMain.handle('pet:settings', (event, value) => {
    if (!valid(event) || !value || typeof value !== 'object') return null;
    if (typeof value.canvas === 'number' && Number.isFinite(value.canvas)) preferences.canvas = Math.round(Math.max(260, Math.min(420, value.canvas)));
    if (typeof value.alwaysOnTop === 'boolean') preferences.alwaysOnTop = value.alwaysOnTop;
    win.setAlwaysOnTop(preferences.alwaysOnTop, 'floating');
    place(); persist(); return state();
  });
  ipcMain.on('pet:hide', event => { if (valid(event)) hidePet(); });
  ipcMain.on('pet:quit', event => { if (valid(event)) app.quit(); });
}
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  // 图标素材可独立交付；缺失或损坏不能中断窗口初始化。
  let appIcon = nativeImage.createFromPath(appIconPath);
  if (appIcon.isEmpty()) appIcon = nativeImage.createFromPath(path.join(__dirname, '../public/pet-sprites/standing.png'));
  if (!appIcon.isEmpty()) app.dock?.setIcon(appIcon);
  ({ computeNativeLayout, PANEL_WIDTHS } = await import('./geometry.mjs'));
  preferenceFile = path.join(app.getPath('userData'), 'desktop-preferences.json');
  const area = screen.getPrimaryDisplay().workArea;
  preferences.x = area.x + area.width - 340;
  preferences.y = area.y + area.height - 410;
  try {
    const saved = JSON.parse(fs.readFileSync(preferenceFile, 'utf8'));
    for (const key of ['x', 'y']) if (Number.isFinite(saved[key])) preferences[key] = saved[key];
    if (Number.isFinite(saved.canvas)) preferences.canvas = Math.max(260, Math.min(420, saved.canvas));
    if (typeof saved.alwaysOnTop === 'boolean') preferences.alwaysOnTop = saved.alwaysOnTop;
  } catch { /* First launch: use work-area defaults. */ }
  win = new BrowserWindow({ width: 300, height: 370, show: false, transparent: true,
    frame: false, hasShadow: false, resizable: false, maximizable: false, fullscreenable: false,
    backgroundColor: '#00000000', skipTaskbar: true, icon: appIcon,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(preferences.alwaysOnTop, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== entryURL) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.on('blur', () => { endDrag(); closePanels(); });
  win.on('close', event => { if (!quitting) { event.preventDefault(); hidePet(); } });
  // Supplement the explicit showPet/hidePet refresh for native visibility changes.
  win.on('show', () => setImmediate(refreshTrayMenu));
  win.on('hide', () => setImmediate(refreshTrayMenu));
  win.once('ready-to-show', () => { place(); win.showInactive(); refreshTrayMenu(); });
  setupIPC(); place(); win.loadURL(entryURL);
  const icon = appIcon.resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('咕咕嘎嘎');
  // macOS opens this native menu on click; clicking the icon must not toggle the pet.
  refreshTrayMenu();
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: app.name, submenu: [
    { label: '显示宠物', click: showPet }, { type: 'separator' }, { role: 'quit', label: '退出游戏' },
  ] }, { role: 'editMenu' }]));
  app.dock?.hide();
  screen.on('display-metrics-changed', () => { place(); persist(); });
  screen.on('display-removed', () => { place(); persist(); });
});
app.on('second-instance', () => { if (win) showPet(); });
app.on('activate', () => { if (win) showPet(); });
app.on('before-quit', () => { quitting = true; if (win) endDrag(); });
