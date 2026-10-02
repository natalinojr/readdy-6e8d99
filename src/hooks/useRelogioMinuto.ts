import { useEffect, useState } from 'react';

/**
 * Minuto atual (Date.now() arredondado para o minuto) que muda na virada de cada
 * minuto e ao voltar para a aba. Serve de dependência para o cardápio reavaliar o
 * horário de exibição sem recarregar (totem e mesa ficam abertos o dia inteiro).
 */
export function useRelogioMinuto(ativo = true): number {
  const [minuto, setMinuto] = useState(() => Math.floor(Date.now() / 60000) * 60000);
  useEffect(() => {
    if (!ativo) return;
    let timer: number | undefined;
    const atualizar = () => setMinuto(Math.floor(Date.now() / 60000) * 60000);
    const agendar = () => {
      atualizar();
      timer = window.setTimeout(agendar, 60000 - (Date.now() % 60000) + 50);
    };
    agendar();
    const aoVoltar = () => { if (document.visibilityState === 'visible') atualizar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [ativo]);
  return minuto;
}
