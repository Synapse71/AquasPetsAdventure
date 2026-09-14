import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GameState } from '../domain/types';
import { downloadSaveBackup } from '../persistence/saveBackup';
import type { DesktopState } from './desktopBridge';
import { PET_MENUS, menuIcon } from './PetDesktop';
import { PetPortrait } from './CodexPanel';
import { useUIState } from './uiState';
import './simplePanels.css';
import { petMetrics, MIN_PET_CANVAS, MAX_PET_CANVAS } from '../../desktop/geometry.mjs';

export function SettingsPanel({ game, onReset, onClose, active, activity }: {
  game: GameState; onReset: () => void; onClose: () => void; active: boolean; activity: ReactNode;
}) {
  const [tab,setTab] = useUIState<'settings'|'log'|'about'>('settings-tab','settings',(v): v is 'settings'|'log'|'about' => v === 'settings' || v === 'log' || v === 'about');
  const [desktop,setDesktop] = useState<DesktopState>();
  const [resetting,setResetting] = useState(false), [confirmation,setConfirmation] = useState('');
  const [message,setMessage] = useState('');
  const modal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bridge = window.desktopPet;
    let disposed = false;
    void bridge?.getState().then(state => { if (!disposed) setDesktop(state); }).catch(() => setMessage('无法读取桌宠设置。'));
    const off = bridge?.onLayout(setDesktop);
    return () => { disposed = true; off?.(); };
  },[]);
  useEffect(() => { if (active && resetting) modal.current?.querySelector('input')?.focus({preventScroll:true}); },[active,resetting]);
  const resizing = useRef(false);
  const apply = (value: {canvas?:number;alwaysOnTop?:boolean;resizing?:boolean}) => {
    void window.desktopPet?.settings(value).then(setDesktop).catch(() => setMessage('设置未保存，请重试。'));
  };
  const endResize = () => {
    if (!resizing.current) return;
    resizing.current = false;
    apply({resizing:false});
  };
  useEffect(() => {
    const end = () => {
      if (!resizing.current) return;
      resizing.current = false;
      void window.desktopPet?.settings({resizing:false}).then(setDesktop).catch(() => setMessage('设置未保存，请重试。'));
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      end();
    };
  }, []);
  const exportSave = () => { try { downloadSaveBackup(game);setMessage('已发起存档导出，请查看下载文件。'); } catch { setMessage('导出失败，请重试。'); } };
  const size = desktop?.canvas ?? 300;
  const { menuWidth, bubble, gap } = petMetrics(size);
  return <div className="simple-panel settings-panel">
    <header className="sp-header"><h1 id="window-title-settings">设置</h1><nav className="sp-tabs" aria-label="设置分类"><button aria-pressed={tab==='settings'} onClick={() => setTab('settings')}>设置</button><button aria-pressed={tab==='log'} onClick={() => setTab('log')}>行动记录</button><button aria-pressed={tab==='about'} onClick={() => setTab('about')}>关于</button></nav><span className="st-version">v0.1.0 · Demo</span><button className="sp-close" aria-label="关闭设置" onClick={onClose}>×</button></header>
    <div className="sp-content st-content">{tab === 'log' ? activity : tab === 'about' ? <div className="st-about">
      <section className="st-section"><h2>版本信息</h2>
        <img className="st-game-logo" src={`${import.meta.env.BASE_URL}icons/aquamarine-1024.png`} alt="游戏图标" draggable={false} />
        <p className="st-game-name">咕嘎搜撤没有打 v0.1.0 Demo</p>
      </section>
      <section className="st-section"><h2>开发者信息</h2><p>Aquamarine Studio</p></section>
    </div> : <>
      <section className="st-section"><h2>桌宠</h2>
        <label className="st-row"><span className="st-label">桌宠大小</span><span className="st-description">拖动时锁定面板，松开后重新定位</span><input aria-label="桌宠大小" type="range" min={MIN_PET_CANVAS} max={MAX_PET_CANVAS} step={10} disabled={!desktop} value={size}
          onPointerDown={e => { if(e.button!==0)return; resizing.current=true; apply({resizing:true}); if(e.isTrusted)e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize}
          onChange={e => apply({canvas:Number(e.target.value)})} /><output>{size}px</output></label>
        <div className="st-preview"><PetPortrait /><div className="st-preview-info"><span className="st-ruler" style={{width:menuWidth}}>菜单宽 {menuWidth.toFixed(1)}px</span>
          <div className="st-menu-preview" aria-label="真实像素气泡预览" style={{width:menuWidth,gap}}>{PET_MENUS.map(menu => <span key={menu.id} style={{width:bubble,height:bubble}}><img src={menuIcon(menu.icon)} alt={menu.label} /></span>)}</div>
          <span className="sp-muted">气泡直径 {bubble}px · 悬停气泡可查看功能名称</span>
          {!desktop && <span className="sp-muted">大小与置顶设置仅在桌面客户端可用。</span>}
        </div></div>
        <label className="st-row"><span className="st-label">始终置顶</span><span className="st-description">让桌宠保持在其他窗口上方</span><input className="st-switch" aria-label="始终置顶" type="checkbox" checked={desktop?.alwaysOnTop ?? true} disabled={!desktop} onChange={e => apply({alwaysOnTop:e.target.checked})} /></label>
        <div className="st-row"><span className="st-label">开机自启</span><span className="st-description">正式应用打包后接入</span><span className="st-unavailable">暂未开放</span></div>
        <div className="st-row"><span className="st-label">音量</span><span className="st-description">当前版本尚未接入音频</span><span className="st-unavailable">暂未开放</span></div>
        <div className="st-row"><span className="st-label">桌面操作</span><span className="st-description">隐藏后仍会继续挂机</span><button disabled={!desktop} onClick={() => window.desktopPet?.hide()}>隐藏宠物</button><button disabled={!desktop} onClick={() => window.desktopPet?.quit()}>退出游戏</button></div>
      </section>
      <section className="st-section"><h2>存档</h2><div className="st-save-summary"><span>伙伴 <b>{Object.keys(game.pets).length}</b></span><span>通用货币 <b>{game.currency.toLocaleString('zh-CN')}</b></span><span>存档版本 <b>{game.version}</b></span></div>
        <div className="st-save-actions"><button onClick={exportSave}>导出存档</button><button disabled title="存档结构校验与迁移接入后开放">导入存档（暂未开放）</button><button className="st-danger" onClick={() => {setResetting(true);setConfirmation('');}}>清空本地存档</button></div>
        <p className="st-save-note">游戏进度自动保存到本机。导出备份只包含游戏进度，不包含桌宠位置及未确认操作。</p>
      </section>

    </>}</div>
    <footer className="sp-footer" role="status">{message || '关闭面板不会退出游戏；主动退出后，行进时间仍按现实时间计算。'}</footer>
    {resetting && <div className="st-mask" onKeyDown={e => {
      if(e.key==='Escape'){e.stopPropagation();setResetting(false);}
      if(e.key==='Tab'){
        const controls=[...(modal.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled)')??[])], first=controls[0],last=controls[controls.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    }}><div className="st-reset-dialog" ref={modal} role="dialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">清空本地存档？</h2>
      <p>所有宠物成长、库存、冒险和任务进度都会被清空，无法找回。建议先导出备份；当前版本尚未开放导入。</p>
      <label>输入「重新开始」以确认<input aria-label="清档确认文字" value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off" /></label>
      <div className="st-reset-actions"><button onClick={exportSave}>先导出备份</button><button onClick={()=>setResetting(false)}>取消</button><button className="st-danger" disabled={confirmation!=='重新开始'} onClick={()=>{if(confirmation==='重新开始'){setResetting(false);onReset();}}}>确认清空</button></div>
    </div></div>}
  </div>;
}
