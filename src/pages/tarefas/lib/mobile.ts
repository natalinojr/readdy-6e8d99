import { useState, useEffect, useRef } from 'react';

/** Mesmo ponto de corte do `md:` do Tailwind, para o JS concordar com o CSS. */
const CONSULTA_CELULAR = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [celular, setCelular] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(CONSULTA_CELULAR).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(CONSULTA_CELULAR);
    const aoMudar = (e: MediaQueryListEvent) => setCelular(e.matches);
    mq.addEventListener('change', aoMudar);
    setCelular(mq.matches);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);

  return celular;
}

/**
 * Faz o botão "voltar" do Android fechar um overlay em vez de sair da tela.
 *
 * Empurra uma entrada no histórico ao abrir e a consome no `popstate`. Ao
 * fechar pela UI, remove a entrada que empurrou (sem disparar o callback de
 * novo) para não deixar lixo no histórico.
 */
export function useVoltarFecha(aberto: boolean, aoFechar: () => void): void {
  // O callback fica numa ref de propósito: quem chama costuma passar uma arrow
  // inline (`() => setX(null)`), que muda a cada render. Se ele entrasse nas
  // deps do efeito, cada render empilharia uma entrada nova no histórico.
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;

  useEffect(() => {
    if (!aberto) return;

    window.history.pushState({ overlayTarefas: true }, '');
    let fechadoPeloVoltar = false;

    const aoVoltar = () => {
      fechadoPeloVoltar = true;
      aoFecharRef.current();
    };
    window.addEventListener('popstate', aoVoltar);

    return () => {
      window.removeEventListener('popstate', aoVoltar);
      // Fechou pela UI (X, backdrop): desfaz a entrada que empurramos.
      if (!fechadoPeloVoltar && window.history.state?.overlayTarefas) {
        window.history.back();
      }
    };
  }, [aberto]);
}
