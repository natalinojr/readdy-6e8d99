// Ponte com o app "ERPOS para Windows" (pasta desktop/, Electron). Dentro do app o preload expõe
// `window.erposDesktop`; no navegador comum ela não existe e tudo aqui vira no-op.

export interface NotificacaoDesktop {
  title: string;
  body?: string;
  /** caminho do ERPOS aberto na janela principal ao clicar (sem = abre o painel) */
  path?: string;
}

export interface ErposDesktop {
  isDesktop: true;
  isPanel: boolean;
  setBadge: (n: number) => void;
  notify: (n: NotificacaoDesktop) => void;
  openInMain: (path: string) => void;
  closePanel: () => void;
  info: () => Promise<{ version: string; autoStart: boolean }>;
  onPanelShown: (cb: () => void) => () => void;
}

export function desktop(): ErposDesktop | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { erposDesktop?: ErposDesktop }).erposDesktop ?? null;
}
