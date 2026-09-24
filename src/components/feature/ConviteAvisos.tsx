// Convite da primeira vez para ligar os avisos no celular (dono, 2026-09-24).
// O celular só recebe notificação depois que a pessoa aceita UMA vez naquele aparelho (trava do
// Android/navegador). Sem isso, a mensagem da equipe chegava muda: o Eduardo nunca tinha achado o
// botão "Ativar avisos". Aqui o pedido aparece sozinho, em qualquer tela com o chat, só no celular e
// só enquanto este aparelho não está inscrito. "Agora não" volta a perguntar depois de 3 dias.
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import BotaoAvisos from '@/components/feature/BotaoAvisos';

const CHAVE_ADIADO = 'erpos-convite-avisos-adiado-ate';
const ADIAR_MS = 3 * 24 * 3600_000;

function ehCelular(): boolean {
  if (typeof window === 'undefined') return false;
  const capacitor = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  return capacitor || !!window.matchMedia?.('(pointer: coarse)').matches;
}
function adiado(): boolean {
  try { return Number(localStorage.getItem(CHAVE_ADIADO) ?? 0) > Date.now(); } catch { return false; }
}

export default function ConviteAvisos() {
  const { user } = useAuth();
  const [estado, setEstado] = useState<string | null>(null);
  const [fechado, setFechado] = useState(() => adiado());

  if (!user || fechado || !ehCelular()) return null;

  const agoraNao = () => {
    try { localStorage.setItem(CHAVE_ADIADO, String(Date.now() + ADIAR_MS)); } catch { /* sem storage: só nesta sessão */ }
    setFechado(true);
  };
  // Enquanto não sabe o estado (ou já está ativo / sem suporte / bloqueado), o botão fica montado
  // escondido só para descobrir; o cartão aparece quando dá para ativar.
  const mostrar = estado === 'inativo' || estado === 'precisa-instalar';

  return (
    <div className={mostrar ? 'fixed z-[57] left-3 right-3 bottom-24 sm:left-auto sm:right-5 sm:w-[380px]' : 'hidden'} role={mostrar ? 'dialog' : undefined} aria-label="Ativar avisos no celular">
      <div className="rounded-2xl border border-violet-200 bg-white shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-violet-50 text-violet-600">
            <i className="ri-notification-3-line text-xl" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-zinc-900 leading-tight">Receba as mensagens da equipe no celular</p>
            <p className="text-xs text-zinc-500 mt-1">
              {estado === 'precisa-instalar'
                ? 'No iPhone, primeiro adicione o ERPOS à Tela de Início (Compartilhar › Adicionar à Tela de Início) e abra por lá.'
                : 'Ative os avisos para saber na hora quando alguém da loja te mandar mensagem, mesmo com o ERPOS fechado.'}
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {estado !== 'precisa-instalar' && (
            <BotaoAvisos tenantId={user.tenantId} grande titulo="Ativar avisos neste celular" onEstado={setEstado} />
          )}
          <button onClick={agoraNao} className="w-full h-9 rounded-xl text-sm font-semibold text-zinc-500 hover:bg-zinc-50 cursor-pointer">
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
}
