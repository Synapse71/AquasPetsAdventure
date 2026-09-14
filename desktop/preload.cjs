const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopPet', {
  getState: () => ipcRenderer.invoke('pet:state'),
  loginItem: enabled => ipcRenderer.invoke('pet:login-item', enabled),
  setPanel: panel => ipcRenderer.invoke('pet:panel', panel),
  setIgnoreMouse: ignore => ipcRenderer.send('pet:ignore', ignore),
  startDrag: point => ipcRenderer.send('pet:drag-start', point),
  dragTo: point => ipcRenderer.send('pet:drag-to', point),
  endDrag: () => ipcRenderer.send('pet:drag-end'),
  settings: value => ipcRenderer.invoke('pet:settings', value),
  hide: () => ipcRenderer.send('pet:hide'),
  quit: () => ipcRenderer.send('pet:quit'),
  onLayout: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pet:layout', listener);
    return () => ipcRenderer.removeListener('pet:layout', listener);
  },
  onClosePanels: callback => {
    const listener = () => callback();
    ipcRenderer.on('pet:close-panels', listener);
    return () => ipcRenderer.removeListener('pet:close-panels', listener);
  },
});
