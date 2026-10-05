import { useEffect, useRef } from 'react';
import type { ExportadorRelatorio } from '@/lib/exportRelatorio';

/** Função que a página dos Relatórios passa às abas para o botão "Baixar" do topo. */
export type RegistrarExport = (fn: ExportadorRelatorio | null) => void;

/**
 * A aba chama isto uma vez (antes de qualquer `return` antecipado). O botão do topo passa a baixar
 * o que `gerar` devolver na hora do clique, com os dados que a aba tem na tela. Ao sair da aba, desregistra.
 */
export function useRegistrarExport(registrar: RegistrarExport | undefined, gerar: ExportadorRelatorio): void {
  const ultimo = useRef(gerar);
  ultimo.current = gerar;
  useEffect(() => {
    if (!registrar) return undefined;
    registrar(() => ultimo.current());
    return () => registrar(null);
  }, [registrar]);
}
