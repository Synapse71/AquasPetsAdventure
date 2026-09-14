import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const { createLoginItemController } = createRequire(import.meta.url)('../../desktop/login-item.cjs');

function fixture(platform = 'darwin', packaged = true, runtime = {}) {
  let value = { openAtLogin: false, status: 'not-registered', executableWillLaunchAtLogin: true };
  const app = { isPackaged: packaged, getLoginItemSettings: vi.fn(() => value),
    setLoginItemSettings: vi.fn(({ openAtLogin }: { openAtLogin: boolean }) => {
      value = { ...value, openAtLogin, status: openAtLogin ? 'enabled' : 'not-registered' };
    }) };
  return { app, controller: createLoginItemController(app, platform, runtime) };
}

describe('OS-owned login item', () => {
  it('reads without registering and toggles both ways with readback', () => {
    const {app,controller} = fixture();
    expect(controller.read().enabled).toBe(false);
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    expect(controller.set(true).enabled).toBe(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({openAtLogin:true});
    expect(controller.set(false).enabled).toBe(false);
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({openAtLogin:false});
  });
  it('never registers development Electron or unsupported platforms', () => {
    for (const {app,controller} of [fixture('darwin',false),fixture('linux')]) {
      expect(controller.set(true).supported).toBe(false);
      expect(app.setLoginItemSettings).not.toHaveBeenCalled();
      expect(app.getLoginItemSettings).not.toHaveBeenCalled();
    }
  });
  it('rejects malformed renderer input', () => {
    const {app,controller} = fixture();
    for (const input of [null,'true',{},1]) expect(() => controller.set(input)).toThrow();
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
  it('reports approval required without pretending it is enabled', () => {
    const {app,controller} = fixture();
    app.getLoginItemSettings.mockReturnValue({openAtLogin:true,status:'requires-approval',executableWillLaunchAtLogin:true});
    expect(controller.set(true)).toMatchObject({enabled:false,message:expect.stringContaining('允许')});
  });
  it('detects silent failure and reports actual state after an exception', () => {
    const {app,controller} = fixture();
    app.setLoginItemSettings.mockImplementation(() => {});
    expect(controller.set(true)).toMatchObject({enabled:false,message:expect.stringContaining('未应用')});
    app.setLoginItemSettings.mockImplementation(() => {throw new Error('denied');});
    expect(controller.set(true)).toMatchObject({enabled:false,message:expect.stringContaining('失败')});
  });
  it('honors external changes to system login items', () => {
    const {app,controller} = fixture();
    controller.set(true);
    app.getLoginItemSettings.mockReturnValue({openAtLogin:false,status:'not-registered',executableWillLaunchAtLogin:false});
    expect(controller.read().enabled).toBe(false);
  });
  it('handles OS read failures safely', () => {
    const {app,controller} = fixture();
    app.getLoginItemSettings.mockImplementation(() => {throw new Error('unavailable');});
    expect(controller.set(true).supported).toBe(false);
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
  it('registers the original portable EXE with identical read/write path and args', () => {
    const path = 'C:\\Games\\咕嘎 搜撤\\Adventure.exe';
    const {app,controller} = fixture('win32',true,{portablePath:path,isFile:()=>true});
    expect(controller.set(true).enabled).toBe(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({openAtLogin:true,path,args:[],name:'AquasPetsAdventure',enabled:true});
    expect(app.getLoginItemSettings).toHaveBeenLastCalledWith({path,args:[]});
    expect(controller.set(false).enabled).toBe(false);
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({openAtLogin:false,path,args:[],name:'AquasPetsAdventure',enabled:false});
  });
  it('never falls back to the unpacked EXE when the portable path is invalid or missing', () => {
    for (const path of ['', 'game.exe', 'C:\\Games\\game.txt', '"C:\\Games\\game.exe"', 'C:\\Games\\bad\n.exe']) {
      const {app,controller} = fixture('win32',true,{portablePath:path,isFile:()=>true});
      expect(controller.set(true).supported).toBe(false);
      expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    }
    for (const isFile of [()=>false,()=>{throw new Error('missing');}]) {
      const {app,controller} = fixture('win32',true,{portablePath:'C:\\Games\\game.exe',isFile});
      expect(controller.set(true).supported).toBe(false);
      expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    }
  });
  it('reflects Windows task-manager disabled state instead of only the Run entry', () => {
    const {app,controller} = fixture('win32',true,{portablePath:'D:\\Games\\game.exe',isFile:()=>true});
    app.getLoginItemSettings.mockReturnValue({openAtLogin:true,status:'enabled',executableWillLaunchAtLogin:false});
    expect(controller.read().enabled).toBe(false);
  });
  it('does not register a Windows development process even with portable metadata', () => {
    const {app,controller} = fixture('win32',false,{portablePath:'D:\\Games\\game.exe',isFile:()=>true});
    expect(controller.set(true).supported).toBe(false);
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
});
