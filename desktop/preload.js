// Ponte entre o site do ERPOS e o app Windows. O site testa `window.erposDesktop`
// para saber se está dentro do app (no navegador comum ela não existe).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('erposDesktop', {
  isDesktop: true,
  /** esta janela é o painel da bolinha (quem conta o número e manda os avisos) */
  isPanel: process.argv.includes('--erpos-painel'),
  /** número na bolinha e na bandeja */
  setBadge: (n) => ipcRenderer.send('erpos:badge', n),
  /** notificação do Windows; clicar abre `path` na janela principal (ou o painel) */
  notify: (n) => ipcRenderer.send('erpos:notify', n),
  /** abre um caminho do ERPOS na janela principal (ex.: '/tarefas?task=…') */
  openInMain: (path) => ipcRenderer.send('erpos:open', path),
  closePanel: () => ipcRenderer.send('erpos:close-panel'),
  info: () => ipcRenderer.invoke('erpos:info'),
  onPanelShown: (cb) => {
    const h = () => cb();
    ipcRenderer.on('panel:shown', h);
    return () => ipcRenderer.removeListener('panel:shown', h);
  },
});
