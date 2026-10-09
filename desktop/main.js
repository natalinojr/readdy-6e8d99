// ERPOS para Windows — casca Electron.
// O conteúdo é o próprio site (Vercel): a janela principal abre o sistema inteiro e
// o painel da bolinha abre a rota /widget. Mudou o site, o app já mostra; o instalador
// só precisa ser refeito quando ESTE arquivo (a casca) mudar.
const {
  app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen, shell, globalShortcut, nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');

const BASE_URL = (process.env.ERPOS_URL || 'https://erpos.vercel.app').replace(/\/$/, '');
const PARTITION = 'persist:erpos'; // mesma sessão (login) em todas as janelas
const ICON = path.join(__dirname, 'icon.png');
const BUBBLE = 64;
const PANEL_W = 400;
const PANEL_H = 640;
const ATALHO = 'CommandOrControl+Shift+E';

app.setAppUserModelId('com.erpos.desktop');
// Teste local (npm run dev): perfil separado, para a sessão de teste não ficar no app de verdade.
if (process.env.ERPOS_USERDATA) app.setPath('userData', process.env.ERPOS_USERDATA);
const ABRIR_PRIMEIRO = process.env.ERPOS_ABRIR || '/';

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWin = null;
let bubbleWin = null;
let panelWin = null;
let tray = null;
let quitting = false;
let badge = 0;

// ── preferências (posição da bolinha, bolinha visível) ──────────────────────
const prefsPath = () => path.join(app.getPath('userData'), 'prefs.json');
function lerPrefs() {
  try { return JSON.parse(fs.readFileSync(prefsPath(), 'utf8')); } catch { return {}; }
}
function salvarPrefs(patch) {
  const p = { ...lerPrefs(), ...patch };
  try { fs.writeFileSync(prefsPath(), JSON.stringify(p)); } catch { /* sem prefs não quebra */ }
  return p;
}

function mesmoSite(url) {
  try { return new URL(url).origin === new URL(BASE_URL).origin; } catch { return false; }
}

function urlDe(caminho) {
  if (!caminho) return BASE_URL + '/';
  if (/^https?:\/\//.test(caminho)) return caminho;
  return BASE_URL + (caminho.startsWith('/') ? caminho : '/' + caminho);
}

// Links de fora do ERPOS abrem no navegador; do ERPOS, numa janela do app.
function tratarLinks(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (mesmoSite(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          icon: ICON, autoHideMenuBar: true,
          webPreferences: { partition: PARTITION, preload: path.join(__dirname, 'preload.js') },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!mesmoSite(url) && !url.startsWith('file:')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

// Sem internet / site fora: mostra aviso e tenta de novo sozinho.
function tratarFalha(win, urlAlvo) {
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navegação abortada (normal)
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { volta: url || urlAlvo } });
  });
}

// ── janela principal: o sistema inteiro ─────────────────────────────────────
function criarMain(mostrar) {
  const prefs = lerPrefs();
  mainWin = new BrowserWindow({
    width: prefs.mainW || 1366,
    height: prefs.mainH || 820,
    minWidth: 360,
    minHeight: 500,
    show: false,
    icon: ICON,
    title: 'ERPOS',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { partition: PARTITION, preload: path.join(__dirname, 'preload.js') },
  });
  if (prefs.mainMax) mainWin.maximize();
  tratarLinks(mainWin);
  // Entrou ou saiu na janela principal: o painel (outra janela, mesma sessão) acompanha.
  const acompanhar = (_e, url) => {
    if (!panelWin) return;
    const noLogin = (u) => { try { return new URL(u).pathname.startsWith('/login'); } catch { return false; } };
    const painel = panelWin.webContents.getURL();
    if (!painel || noLogin(url) === noLogin(painel)) return;
    panelWin.loadURL(BASE_URL + '/widget');
  };
  mainWin.webContents.on('did-navigate', acompanhar);
  mainWin.webContents.on('did-navigate-in-page', acompanhar);
  tratarFalha(mainWin, BASE_URL + '/');
  mainWin.loadURL(urlDe(ABRIR_PRIMEIRO));
  if (mostrar) mainWin.once('ready-to-show', () => mainWin.show());

  mainWin.on('close', (e) => {
    if (quitting) return;
    const [w, h] = mainWin.getSize();
    salvarPrefs({ mainMax: mainWin.isMaximized(), ...(mainWin.isMaximized() ? {} : { mainW: w, mainH: h }) });
    e.preventDefault(); // fechar = esconder; o app segue na bandeja com a bolinha
    mainWin.hide();
  });
}

function abrirNoMain(caminho) {
  if (!mainWin) criarMain(false);
  const alvo = urlDe(caminho);
  if (caminho) mainWin.loadURL(alvo);
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

// ── bolinha flutuante ───────────────────────────────────────────────────────
function posicaoInicialBolinha() {
  const { pos } = lerPrefs();
  const area = screen.getPrimaryDisplay().workArea;
  const padrao = { x: area.x + area.width - BUBBLE - 24, y: area.y + Math.round(area.height * 0.6) };
  if (!pos) return padrao;
  // monitor desligado/trocado: volta para um lugar visível
  const visivel = screen.getAllDisplays().some(({ workArea: a }) =>
    pos.x >= a.x - BUBBLE / 2 && pos.x <= a.x + a.width - BUBBLE / 2 &&
    pos.y >= a.y - BUBBLE / 2 && pos.y <= a.y + a.height - BUBBLE / 2);
  return visivel ? pos : padrao;
}

function criarBolinha() {
  const { x, y } = posicaoInicialBolinha();
  bubbleWin = new BrowserWindow({
    x, y, width: BUBBLE, height: BUBBLE,
    frame: false, transparent: true, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: true, hasShadow: false,
    show: false, icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'bubble-preload.js') },
  });
  bubbleWin.setAlwaysOnTop(true, 'screen-saver'); // por cima até de janela em tela cheia
  bubbleWin.setVisibleOnAllWorkspaces(true);
  bubbleWin.loadFile(path.join(__dirname, 'bubble.html'));
  bubbleWin.once('ready-to-show', () => {
    if (lerPrefs().bolinhaOculta !== true) bubbleWin.showInactive();
    bubbleWin.webContents.send('badge', badge);
  });
}

let arrasto = null;
ipcMain.on('bubble:drag-start', () => {
  if (!bubbleWin) return;
  const cursor = screen.getCursorScreenPoint();
  const [bx, by] = bubbleWin.getPosition();
  arrasto = { dx: cursor.x - bx, dy: cursor.y - by };
});
ipcMain.on('bubble:drag-move', () => {
  if (!bubbleWin || !arrasto) return;
  const c = screen.getCursorScreenPoint();
  bubbleWin.setBounds({ x: c.x - arrasto.dx, y: c.y - arrasto.dy, width: BUBBLE, height: BUBBLE });
  if (panelWin && panelWin.isVisible()) posicionarPainel();
});
ipcMain.on('bubble:drag-end', () => {
  if (!bubbleWin || !arrasto) return;
  arrasto = null;
  const [x, y] = bubbleWin.getPosition();
  salvarPrefs({ pos: { x, y } });
});
ipcMain.on('bubble:click', () => alternarPainel());
ipcMain.on('bubble:menu', () => menuBandeja().popup({ window: bubbleWin }));

function mostrarBolinha(sim) {
  salvarPrefs({ bolinhaOculta: !sim });
  if (!bubbleWin) return;
  if (sim) bubbleWin.showInactive(); else { bubbleWin.hide(); panelWin?.hide(); }
  atualizarBandeja();
}

// ── painel (rota /widget) ───────────────────────────────────────────────────
function criarPainel() {
  panelWin = new BrowserWindow({
    width: PANEL_W, height: PANEL_H,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    show: false, icon: ICON, backgroundColor: '#ffffff', roundedCorners: true,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // escondido continua contando tarefas e avisando
      additionalArguments: ['--erpos-painel'], // só o painel conta e avisa (a janela principal pode abrir /widget também)
    },
  });
  panelWin.setAlwaysOnTop(true, 'screen-saver');
  tratarLinks(panelWin);
  tratarFalha(panelWin, BASE_URL + '/widget');
  panelWin.loadURL(BASE_URL + '/widget');
  panelWin.on('blur', () => {
    // clicou fora: some (a não ser durante o arrasto da bolinha)
    if (!arrasto && panelWin.isVisible()) { panelWin.hide(); escondidoPorBlurEm = Date.now(); }
  });
  panelWin.on('close', (e) => { if (!quitting) { e.preventDefault(); panelWin.hide(); } });
}

function posicionarPainel() {
  if (!panelWin || !bubbleWin) return;
  const b = bubbleWin.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  // abre para o lado que tem mais espaço
  let x = b.x + b.width / 2 > area.x + area.width / 2 ? b.x - PANEL_W - 8 : b.x + b.width + 8;
  let y = b.y + b.height / 2 - PANEL_H / 2;
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - PANEL_W - 8));
  y = Math.max(area.y + 8, Math.min(y, area.y + area.height - PANEL_H - 8));
  panelWin.setBounds({ x: Math.round(x), y: Math.round(y), width: PANEL_W, height: PANEL_H });
}

let escondidoPorBlurEm = 0;
function alternarPainel(forcar) {
  if (!panelWin) criarPainel();
  // clicar na bolinha com o painel aberto: o blur já fechou; não reabrir no mesmo clique
  if (forcar === undefined && Date.now() - escondidoPorBlurEm < 400) return;
  const abrir = forcar ?? !panelWin.isVisible();
  if (!abrir) { panelWin.hide(); return; }
  if (bubbleWin && !bubbleWin.isVisible()) mostrarBolinha(true);
  posicionarPainel();
  panelWin.show();
  panelWin.focus();
  panelWin.webContents.send('panel:shown');
}

// ── ponte com o site (preload.js) ───────────────────────────────────────────
ipcMain.on('erpos:badge', (_e, n) => {
  badge = Math.max(0, Number(n) || 0);
  if (!app.isPackaged) console.log('[número]', badge);
  bubbleWin?.webContents.send('badge', badge);
  atualizarBandeja();
});
ipcMain.on('erpos:open', (_e, caminho) => { panelWin?.hide(); abrirNoMain(caminho); });
ipcMain.on('erpos:close-panel', () => panelWin?.hide());
ipcMain.on('erpos:notify', (_e, n) => {
  if (!n || !Notification.isSupported()) return;
  if (!app.isPackaged) console.log('[aviso]', n.title, '|', n.body, '|', n.path ?? '(painel)');
  const notif = new Notification({ title: String(n.title || 'ERPOS'), body: String(n.body || ''), icon: ICON });
  notif.on('click', () => {
    if (n.path) abrirNoMain(n.path); else alternarPainel(true);
  });
  notif.show();
});
ipcMain.handle('erpos:info', () => ({ version: app.getVersion(), autoStart: app.getLoginItemSettings().openAtLogin }));

// ── bandeja (perto do relógio) ──────────────────────────────────────────────
function menuBandeja() {
  const bolinhaVisivel = lerPrefs().bolinhaOculta !== true;
  return Menu.buildFromTemplate([
    { label: 'Abrir o ERPOS', click: () => abrirNoMain() },
    { label: 'Painel rápido', accelerator: ATALHO, click: () => alternarPainel(true) },
    { type: 'separator' },
    { label: 'Mostrar a bolinha', type: 'checkbox', checked: bolinhaVisivel, click: (i) => mostrarBolinha(i.checked) },
    {
      label: 'Abrir junto com o Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--oculto'] }),
    },
    { label: 'Recarregar', click: () => { mainWin?.webContents.reload(); panelWin?.webContents.reload(); } },
    { type: 'separator' },
    { label: `ERPOS ${app.getVersion()}`, enabled: false },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]);
}

function atualizarBandeja() {
  if (!tray) return;
  tray.setToolTip(badge > 0 ? `ERPOS — ${badge} pendente(s)` : 'ERPOS');
  tray.setContextMenu(menuBandeja());
}

// ── início ──────────────────────────────────────────────────────────────────
app.on('second-instance', () => abrirNoMain());

app.whenReady().then(() => {
  const oculto = process.argv.includes('--oculto');

  // primeira vez: liga "abrir junto com o Windows"
  if (app.isPackaged && !lerPrefs().iniciado) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--oculto'] });
    salvarPrefs({ iniciado: true });
  }

  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.on('click', () => alternarPainel());
  tray.on('double-click', () => abrirNoMain());
  atualizarBandeja();

  criarMain(!oculto);
  criarBolinha();
  criarPainel(); // carrega escondido: é ele que conta e avisa as tarefas

  globalShortcut.register(ATALHO, () => alternarPainel());

  screen.on('display-removed', () => {
    if (!bubbleWin) return;
    const { x, y } = posicaoInicialBolinha();
    bubbleWin.setPosition(x, y);
  });
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* segue na bandeja */ });
