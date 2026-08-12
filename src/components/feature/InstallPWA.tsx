import { useState, useEffect } from 'react';
import { X, Download, Share, Plus } from 'lucide-react';
import { isIOS, isStandalone } from '@/lib/pwa';

/** Evento do Chrome/Edge que permite disparar a instalação pela própria página. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISPENSADO_KEY = 'erpos_pwa_install_dispensado';

/**
 * Convite para instalar o app na tela inicial.
 *
 * Dois caminhos, porque as plataformas diferem:
 *  - Android/Chrome: `beforeinstallprompt` permite instalar com 1 toque.
 *  - iPhone/Safari: não existe API de instalação — só dá para ensinar o
 *    caminho manual. E no iOS a instalação é OBRIGATÓRIA para receber push.
 */
export default function InstallPWA() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [mostrarIOS, setMostrarIOS] = useState(false);
  const [fechado, setFechado] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // já instalado
    if (localStorage.getItem(DISPENSADO_KEY)) return;

    // Só faz sentido oferecer em tela de celular
    const ehCelular = window.matchMedia('(max-width: 767px)').matches;
    if (!ehCelular) return;

    if (isIOS()) {
      setMostrarIOS(true);
      return;
    }

    const aoReceber = (e: Event) => {
      e.preventDefault(); // impede o mini-infobar padrão; usamos o nosso
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', aoReceber);
    return () => window.removeEventListener('beforeinstallprompt', aoReceber);
  }, []);

  const dispensar = () => {
    localStorage.setItem(DISPENSADO_KEY, '1');
    setFechado(true);
  };

  if (fechado || (!promptEvent && !mostrarIOS)) return null;

  return (
    // --bottom-nav-h é definido pelas telas que têm barra inferior (ex.: /tarefas),
    // para o convite não cobrir a navegação.
    <div
      className="fixed inset-x-0 z-[60] md:hidden p-3"
      style={{ bottom: 'calc(var(--bottom-nav-h, 0px) + env(safe-area-inset-bottom))' }}
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-3 flex items-start gap-3">
        <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-xl shrink-0" />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">Instalar o ERPOS</p>
          {promptEvent ? (
            <p className="text-xs text-slate-500 mt-0.5">
              Acesso rápido pela tela inicial e avisos das suas tarefas.
            </p>
          ) : (
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Toque em <Share size={11} className="inline -mt-0.5 text-slate-600" />{' '}
              <strong>Compartilhar</strong> e depois em{' '}
              <Plus size={11} className="inline -mt-0.5 text-slate-600" />{' '}
              <strong>Adicionar à Tela de Início</strong>.
              <span className="block text-slate-400 mt-0.5">
                No iPhone, os avisos só funcionam com o app instalado.
              </span>
            </p>
          )}

          {promptEvent && (
            <button
              onClick={async () => {
                await promptEvent.prompt();
                const { outcome } = await promptEvent.userChoice;
                if (outcome === 'accepted') setFechado(true);
                setPromptEvent(null);
              }}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600"
            >
              <Download size={13} /> Instalar
            </button>
          )}
        </div>

        <button
          onClick={dispensar}
          className="p-1 text-slate-400 hover:text-slate-600 shrink-0"
          aria-label="Dispensar"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
