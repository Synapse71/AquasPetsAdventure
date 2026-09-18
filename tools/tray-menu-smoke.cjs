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
globalThis.__runTraySmoke = async (win, tray, preferences, refreshTrayMenu) => {
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

    // 关掉置顶后窗口会沉到别的窗口后面，而它透明、无边框、skipTaskbar、还默认鼠标穿透。
    // 此时 isVisible() 仍然是 true，所以菜单里只有「隐藏宠物」——没有这一项就再也找不回来。
    const labels = () => menus.get(tray).items.filter(i => i.type !== 'separator').map(i => i.label);
    assert.equal(win.isVisible(), true);
    assert.deepEqual(labels(), ['隐藏宠物', '退出游戏'], '置顶开着时菜单保持原样');
    preferences.alwaysOnTop = false;
    refreshTrayMenu();
    assert.deepEqual(labels(), ['呼到最前', '隐藏宠物', '退出游戏'], '可见但不置顶时必须给出找回入口');
    // 这里**不能**用 isVisible() 验：被别的窗口盖住时它照样是 true，
    // 那正是最初让托盘菜单判断失效的假信号，拿它验等于什么都没验。
    // isFocused() 才能区分——窗口沉在后面、应用未激活时它是 false。
    win.blur();
    await pause();
    assert.equal(win.isFocused(), false, '先制造「没在最前」的状态');
    menus.get(tray).items[0].click();
    await pause();
    assert.equal(win.isFocused(), true, '呼到最前必须真的激活应用，只排序不算');
    console.log('✓ 关掉置顶后「呼到最前」真的把宠物激活到最前（验的是焦点，不是可见性）');

    // 已经隐藏时不需要这一项——「显示宠物」本身就会提到最前。
    menus.get(tray).items[1].click();
    await pause();
    assert.equal(win.isVisible(), false);
    assert.deepEqual(labels(), ['显示宠物', '退出游戏'], '隐藏时不重复给入口');
    menus.get(tray).items[0].click();
    await pause();
    assert.equal(win.isVisible(), true, '显示宠物照常可用');
    console.log('✓ 隐藏状态下菜单不重复给入口，显示宠物照常可用');
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
target._compile(source.replace(marker, marker + '\n  setTimeout(() => globalThis.__runTraySmoke(win, tray, preferences, refreshTrayMenu), 1000);'), file);
