import { useTranslation } from 'react-i18next';
import { useEffect, useCallback, useState } from 'react';
import { ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useAuth } from '@/contexts/AuthContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { formasAceitasKiosk, type KioskPaymentMethodLite } from '@/lib/kioskFormasAceitas';

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

  // Sem await: em WebView sem fullscreen a promessa pode nunca resolver (ou rejeitar);
  // o toque tem que avançar de qualquer jeito.
  const enter = useCallback(() => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        const r = document.documentElement.requestFullscreen();
        if (r && typeof r.catch === 'function') r.catch(() => { /* ignore */ });
      }
    } catch { /* ignore */ }
  }, []);

  return { isFullscreen, toggle, enter };
}

export default function WelcomeScreen({ onIniciar }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const { settings } = useSystemSettings();
  const { user } = useAuth();
  const { kioskSession } = useKioskAuth();
  const { isFullscreen, toggle, enter } = useFullscreen();
  const tenantId = kioskSession?.tenantId ?? user?.tenantId ?? '';

  // "Aceito: ..." com as formas realmente oferecidas no totem (mesma fonte do PagamentoKiosk).
  const [metodos, setMetodos] = useState<KioskPaymentMethodLite[] | null>(null);
  const [pixDisponivel, setPixDisponivel] = useState<boolean | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let ativo = true;
    setMetodos(null);
    setPixDisponivel(null);
    supabase
      .from('payment_methods')
      .select('id, type')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .then(({ data }) => { if (ativo) setMetodos((data as KioskPaymentMethodLite[] | null) ?? []); });
    const cacheKey = `erpos_kiosk_pix:${tenantId}`;
    try { const c = sessionStorage.getItem(cacheKey); if (c !== null) setPixDisponivel(c === '1'); } catch { /* sem storage */ }
    invokeWithAuth<{ provider: string | null }>('pix-payment', { body: { action: 'kiosk_provider', tenant_id: tenantId } })
      .then(({ data, error }) => {
        if (!ativo) return;
        if (error) { setPixDisponivel((prev) => prev ?? false); return; }
        const v = Boolean(data?.provider);
        setPixDisponivel(v);
        try { sessionStorage.setItem(cacheKey, v ? '1' : '0'); } catch { /* sem storage */ }
      })
      .catch(() => { if (ativo) setPixDisponivel((prev) => prev ?? false); });
    return () => { ativo = false; };
  }, [tenantId]);
  const formasAceitas = metodos && pixDisponivel !== null
    ? formasAceitasKiosk(metodos, settings.self_service_payment_methods ?? null, pixDisponivel)
    : [];

  const nomeLoja = user?.loja || 'Nosso Restaurante';
  // A mensagem de boas-vindas e CONFIGURAVEL pela loja (welcome_message_new) e
  // vem escrita em portugues. So o texto padrao tem traducao; a mensagem
  // personalizada aparece como o dono escreveu, em qualquer idioma.
  const mensagemPrincipal = settings.welcome_message_new || t('cliente.bemVindoPedido');

  const linhas = mensagemPrincipal.split('\n').filter(Boolean);
  const titulo = linhas.length > 1 ? linhas[0] : t('cliente.facaPedidoAqui');
  const subtitulo = linhas.length > 1 ? linhas.slice(1).join(' ') : mensagemPrincipal;

  const handleIniciar = () => {
    onIniciar('Visitante');
    enter();
  };

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-between p-10 [@media(max-height:820px)]:p-6 overflow-hidden">
      {/* Fundo decorativo */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-amber-500/8 rounded-full blur-3xl" />
      </div>

      {/* Logo + Nome da loja */}
      <div className="flex flex-col items-center gap-3 [@media(max-height:820px)]:gap-2 mt-8 [@media(max-height:820px)]:mt-2 relative z-10">
        <div className="w-32 h-32 [@media(max-height:820px)]:w-20 [@media(max-height:820px)]:h-20 flex items-center justify-center bg-amber-500 rounded-3xl">
          <span className="text-7xl [@media(max-height:820px)]:text-5xl">🍔</span>
        </div>
        <p className="text-white font-black text-4xl [@media(max-height:820px)]:text-3xl tracking-wide text-center">{nomeLoja}</p>
        <p className="text-white/40 text-lg [@media(max-height:820px)]:text-base font-semibold tracking-widest uppercase">{t('cliente.terminalAuto')}</p>
      </div>

      {/* Central */}
      <div className="flex flex-col items-center text-center relative z-10">
        <h1 className="text-8xl [@media(max-height:820px)]:text-6xl font-black text-white leading-tight mb-4 [@media(max-height:820px)]:mb-2">
          {titulo.includes(' ') ? (
            <>
              {titulo.split(' ').slice(0, Math.ceil(titulo.split(' ').length / 2)).join(' ')}<br />
              <span className="text-amber-400">{titulo.split(' ').slice(Math.ceil(titulo.split(' ').length / 2)).join(' ')}</span>
            </>
          ) : (
            <span className="text-amber-400">{titulo}</span>
          )}
        </h1>
        <p className="text-zinc-400 text-3xl [@media(max-height:820px)]:text-2xl mb-16 [@media(max-height:820px)]:mb-8">{subtitulo}</p>

        {/* Botão principal */}
        <button
          onClick={handleIniciar}
          className="group flex items-center gap-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 px-16 py-8 [@media(max-height:820px)]:px-12 [@media(max-height:820px)]:py-5 rounded-3xl transition-all active:scale-95 cursor-pointer"
        >
          <span className="text-4xl [@media(max-height:820px)]:text-3xl font-black">{t('cliente.toqueComecar')}</span>
          <div className="w-14 h-14 flex items-center justify-center bg-zinc-950/10 rounded-2xl group-hover:bg-zinc-950/20 transition-colors">
            <ChevronRight size={30} />
          </div>
        </button>
      </div>

      {/* Footer */}
      <div className="flex flex-col items-center gap-2 [@media(max-height:820px)]:gap-1 mt-4 relative z-10 px-20">
        <p className="min-h-[1.75rem] text-center text-zinc-600 text-lg [@media(max-height:820px)]:text-base font-medium">
          {formasAceitas.length > 0 && <>{t('cliente.aceito')}: {formasAceitas.join(' • ')}</>}
        </p>
        <p className="text-zinc-700 text-base [@media(max-height:820px)]:text-sm">ERPOS</p>
      </div>

      {/* Botão Fullscreen — canto inferior direito */}
      <button
        onClick={toggle}
        title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        className="absolute bottom-5 right-5 z-20 w-14 h-14 flex items-center justify-center bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-500 hover:text-zinc-300 rounded-xl transition-all cursor-pointer"
      >
        {isFullscreen ? <Minimize2 size={22} /> : <Maximize2 size={22} />}
      </button>
    </div>
  );
}
