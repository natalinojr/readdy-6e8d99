// "Compartilhar" do Android → chat do assistente (app Capacitor, ver android-app/README.md).
//
// Roda no início do app (main.tsx), ANTES de qualquer tela: o app abre na última rota usada
// (muitas vezes /modulos, onde o chat nem existe) e o arquivo compartilhado se perdia (2026-09-15).
// Aqui o conteúdo é guardado no sessionStorage e o app vai para /assistente; o AssistenteChat lê
// a chave e já monta a mensagem com o anexo. No navegador/PWA nada disso existe e a função sai.
export const SHARE_KEY = 'erpos_share_intent';

export type SharePayload =
  | { kind: 'texto'; texto: string }
  | { kind: 'arquivo'; nome: string; media_type: string; base64: string };

type Plugin = { [k: string]: (a?: unknown) => Promise<unknown> };
type Shared = { title?: string; description?: string; type?: string; url?: string };

const plugins = () => (window as unknown as { Capacitor?: { Plugins?: Record<string, Plugin> } }).Capacitor?.Plugins;

export function installShareIntake() {
  const si = plugins()?.SendIntent;
  if (!si) return; // navegador ou PWA: não existe compartilhamento do sistema

  const receber = async () => {
    let r: Shared | null = null;
    try { r = (await si.checkSendIntentReceived()) as Shared; } catch { return; }
    if (!r || (!r.url && !r.title && !r.description)) return;

    const tipo = String(r.type ?? '');
    let payload: SharePayload | null = null;
    const fs = plugins()?.Filesystem;
    if (r.url && fs && (tipo.startsWith('image/') || tipo === 'application/pdf')) {
      try {
        const f = (await fs.readFile({ path: decodeURIComponent(r.url) })) as { data: string };
        payload = {
          kind: 'arquivo',
          nome: r.title || (tipo === 'application/pdf' ? 'documento.pdf' : 'foto.jpg'),
          media_type: tipo,
          base64: f.data,
        };
      } catch { payload = null; }
    }
    if (!payload) {
      const texto = [r.title, r.description, r.url].filter(Boolean).join('\n').trim();
      if (!texto) return;
      payload = { kind: 'texto', texto };
    }

    try { sessionStorage.setItem(SHARE_KEY, JSON.stringify(payload)); } catch { return; }
    // Vai para a tela do assistente (o chat embutido lê o sessionStorage ao montar).
    if (!window.location.pathname.startsWith('/assistente')) window.location.assign('/assistente');
    else window.dispatchEvent(new Event('erpos-share'));
  };

  receber();
  // App já aberto: o plugin avisa por evento em vez de intent na abertura.
  window.addEventListener('sendIntentReceived', receber);
}
