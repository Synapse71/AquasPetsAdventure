// OS owns this setting; never restore it from a game save or register on launch.
const { win32: winPath } = require('node:path');
const { statSync } = require('node:fs');
function createLoginItemController(app, platform = process.platform, runtime = {}) {
  const portablePath = runtime.portablePath ?? process.env.PORTABLE_EXECUTABLE_FILE;
  const isFile = runtime.isFile ?? (file => statSync(file).isFile());
  const loginName = 'AquasPetsAdventure';
  function windowsOptions() {
    // electron-builder's portable launcher supplies the ORIGINAL EXE path.
    // Never fall back to process.execPath: it points inside the temporary unpack.
    if (typeof portablePath !== 'string' || !winPath.isAbsolute(portablePath)
        || !/\.exe$/i.test(portablePath) || /["\r\n\0]/.test(portablePath)) return null;
    try { return isFile(portablePath) ? { path: portablePath, args: [] } : null; }
    catch { return null; }
  }
  function read() {
    if (!app.isPackaged) return { supported: false, enabled: false, message: '开发模式不可用，请使用安装后的游戏应用。' };
    if (!['darwin', 'win32'].includes(platform)) return { supported: false, enabled: false, message: '此系统暂不支持开机自启。' };
    const options = platform === 'win32' ? windowsOptions() : undefined;
    if (platform === 'win32' && !options) return { supported: false, enabled: false, message: '无法确认原始便携 EXE，请从保存在固定位置的游戏 EXE 启动。' };
    try {
      const value = options ? app.getLoginItemSettings(options) : app.getLoginItemSettings();
      const pending = value.status === 'requires-approval';
      const ownEntry = value.launchItems?.find(item => item.name === loginName && item.scope === 'user');
      const enabled = !pending && value.status !== 'not-found' && value.openAtLogin
        && (platform !== 'win32' || (value.executableWillLaunchAtLogin === true && ownEntry?.enabled !== false));
      return { supported: true, enabled: Boolean(enabled), message: pending
        ? '请在系统设置 → 通用 → 登录项中允许此应用。'
        : value.status === 'not-found' ? '系统未找到应用，请将游戏安装到固定位置后重试。'
          : platform === 'win32' ? '登录后自动启动；移动或删除便携 EXE 会失效，移动后请重新开启。'
            : '登录电脑后自动启动游戏；不会自动开启此选项。' };
    } catch {
      return { supported: false, enabled: false, message: '无法读取系统登录项，请稍后重试。' };
    }
  }
  function set(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Expected boolean');
    const current = read();
    if (!current.supported) return current;
    try {
      const options = platform === 'win32' ? windowsOptions() : undefined;
      if (platform === 'win32' && !options) return read();
      app.setLoginItemSettings({ openAtLogin: enabled, ...(options
        ? { ...options, name: loginName, enabled } : {}) });
      const actual = read();
      if (actual.supported && actual.enabled !== enabled && !actual.message.includes('允许')) {
        actual.message = '系统未应用更改，请检查系统登录项权限及应用安装位置。';
      }
      return actual;
    } catch {
      return { ...read(), message: '修改开机自启失败，请检查系统登录项权限后重试。' };
    }
  }
  return { read, set };
}
module.exports = { createLoginItemController };
