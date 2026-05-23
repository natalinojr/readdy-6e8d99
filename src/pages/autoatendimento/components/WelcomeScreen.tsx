import { useEffect, useCallback, useState } from 'react';
import { ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useAuth } from '@/contexts/AuthContext';

interface WelcomeScreenProps {
  onIniciar: (nome: string) => void;
}

function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch { /* ignore */ }
  }, []);

  const enter = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch { /* ignore */ }
  }, []);

  return { isFullscreen, toggle, enter };
}

export default function WelcomeScreen({ onIniciar }: WelcomeScreenProps) {
  const { settings } = useSystemSettings();
  const { user } = useAuth();
  const { isFullscreen, toggle, enter } = useFullscreen();

  const nomeLoja = user?.loja || 'Nosso Restaurante';
  const mensagemPrincipal = settings.welcome_message_new || 'Bem-vindo! Faça seu pedido e aproveite!';

  const linhas = mensagemPrincipal.split('\n').filter(Boolean);
  const titulo = linhas.length > 1 ? linhas[0] : 'Faça seu pedido aqui';
  const subtitulo = linhas.length > 1 ? linhas.slice(1).join(' ') : mensagemPrincipal;

  const handleIniciar = async () => {
    await enter();
    onIniciar('Visitante');
  };

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-between p-10 overflow-hidden">
      {/* Fundo decorativo */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-amber-500/8 rounded-full blur-3xl" />
      </div>

      {/* Logo + Nome da loja */}
      <div className="flex flex-col items-center gap-3 mt-8 relative z-10">
        <div className="w-20 h-20 flex items-center justify-center bg-amber-500 rounded-3xl">
          <span className="text-4xl">🍔</span>
        </div>
        <p className="text-white font-black text-2xl tracking-wide">{nomeLoja}</p>
        <p className="text-white/40 text-xs font-semibold tracking-widest uppercase">Terminal de Autoatendimento</p>
      </div>

      {/* Central */}
      <div className="flex flex-col items-center text-center relative z-10">
        <h1 className="text-6xl font-black text-white leading-tight mb-4">
          {titulo.includes(' ') ? (
            <>
              {titulo.split(' ').slice(0, Math.ceil(titulo.split(' ').length / 2)).join(' ')}<br />
              <span className="text-amber-400">{titulo.split(' ').slice(Math.ceil(titulo.split(' ').length / 2)).join(' ')}</span>
            </>
          ) : (
            <span className="text-amber-400">{titulo}</span>
          )}
        </h1>
        <p className="text-zinc-400 text-xl mb-16">{subtitulo}</p>

        {/* Botão principal */}
        <button
          onClick={handleIniciar}
          className="group flex items-center gap-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 px-12 py-6 rounded-3xl transition-all active:scale-95 cursor-pointer"
        >
          <span className="text-2xl font-black">Toque para começar</span>
          <div className="w-10 h-10 flex items-center justify-center bg-zinc-950/10 rounded-2xl group-hover:bg-zinc-950/20 transition-colors">
            <ChevronRight size={22} />
          </div>
        </button>
      </div>

      {/* Footer */}
      <div className="flex flex-col items-center gap-2 relative z-10">
        <div className="flex gap-6 text-zinc-600 text-sm font-medium">
          <span>Aceito: Dinheiro</span>
          <span>•</span>
          <span>PIX</span>
          <span>•</span>
          <span>Cartão de Crédito / Débito</span>
        </div>
        <p className="text-zinc-700 text-xs">ERPOS</p>
      </div>

      {/* Botão Fullscreen — canto inferior direito */}
      <button
        onClick={toggle}
        title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        className="absolute bottom-5 right-5 z-20 w-10 h-10 flex items-center justify-center bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-500 hover:text-zinc-300 rounded-xl transition-all cursor-pointer"
      >
        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
    </div>
  );
}
