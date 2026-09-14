// 只给配置后台冒烟测试用的 Electron 壳：桌宠主窗口是 300x370 透明窗，
// 装不下策划后台，这里单独开一个大窗指向 dev server 的 ?config=1。
const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1440, height: 940, show: true });
  win.loadURL(process.env.IDLE_CONFIG_URL);
});
app.on('window-all-closed', () => app.quit());
