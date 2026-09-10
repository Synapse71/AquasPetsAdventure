// Exercise the real main-process startup with isolated userData and native menus.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { app, Tray } = require('electron');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'idle-tray-smoke-')));
const menus = new WeakMap();
const originalSetContextMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu) {
  menus.set(this, menu);
  return originalSetContextMenu.call(this, menu);
};
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const timeout = setTimeout(() => { console.error('Tray smoke timed out'); app.exit(1); }, 15000);
globalThis.__runTraySmoke = async (win, tray) => {
  try {
    win.showInactive();
    await pause();
    assert.equal(win.isVisible(), true);
    tray.emit('click', {}, tray.getBounds());
    assert.equal(win.isVisible(), true, 'left click must not hide a visible pet');
    console.log('✓ left click does not toggle visibility');
    assert.deepEqual(menus.get(tray).items.filter(i => i.type !== 'separator').map(i => i.label), ['隐藏宠物', '退出游戏']);
    menus.get(tray).items[0].click();
    await pause();
    assert.equal(win.isVisible(), false, 'hide menu action hides the pet');
    assert.equal(menus.get(tray).items[0].label, '显示宠物');
    tray.emit('click', {}, tray.getBounds());
    assert.equal(win.isVisible(), false, 'left click must not show a hidden pet');
    menus.get(tray).items[0].click();
    await pause();
    assert.equal(win.isVisible(), true, 'show menu action shows the pet');
    assert.equal(menus.get(tray).items[0].label, '隐藏宠物');
    console.log('✓ menu actions hide/show and refresh their label');
    win.close();
    await pause();
    assert.equal(menus.get(tray).items[0].label, '显示宠物', 'external hide also updates tray');
    app.emit('second-instance');
    await pause();
    assert.equal(menus.get(tray).items[0].label, '隐藏宠物', 'external show also updates tray');
    assert.equal(tray.listenerCount('click'), 0, 'macOS native context menu owns the click');
    assert.equal(typeof menus.get(tray).items.at(-1).click, 'function');
    console.log('✓ visibility changes outside the tray keep the menu in sync; quit remains available');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    Tray.prototype.setContextMenu = originalSetContextMenu;
    delete globalThis.__runTraySmoke;
    app.exit(process.exitCode ?? 0);
  }
};
const file = path.resolve(__dirname, '../desktop/main.cjs');
const source = fs.readFileSync(file, 'utf8');
const marker = '  app.dock?.hide();';
assert.equal(source.split(marker).length, 2, 'startup instrumentation point must be unique');
const target = new Module(file, module);
target.filename = file;
target.paths = Module._nodeModulePaths(path.dirname(file));
target._compile(source.replace(marker, marker + '\n  setTimeout(() => globalThis.__runTraySmoke(win, tray), 1000);'), file);
