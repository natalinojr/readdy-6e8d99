const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bolinha', {
  dragStart: () => ipcRenderer.send('bubble:drag-start'),
  dragMove: () => ipcRenderer.send('bubble:drag-move'),
  dragEnd: () => ipcRenderer.send('bubble:drag-end'),
  click: () => ipcRenderer.send('bubble:click'),
  menu: () => ipcRenderer.send('bubble:menu'),
  onBadge: (cb) => ipcRenderer.on('badge', (_e, n) => cb(n)),
});
