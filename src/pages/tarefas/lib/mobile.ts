import { useState, useEffect } from 'react';

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

// O "voltar fecha o overlay" virou helper compartilhado (src/lib/voltarAndroid.ts) quando o chat
// do assistente precisou do mesmo comportamento. Reexportado aqui para não mexer em quem já usa.
export { useVoltarFecha } from '@/lib/voltarAndroid';
