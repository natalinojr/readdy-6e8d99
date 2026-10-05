import { createContext, useContext } from 'react';
import type { InsumoSituacao, SituacaoEstoque } from '@/lib/estoqueRegras';

// "Controle" da tela do Estoque (layout novo, 2026-10-04): qualquer aba abre a ficha do insumo, o
// "+ Registrar", o "Arrumar a lista", a contagem passo a passo e as janelas de entrada/saída/compra
// pelo mesmo lugar (renderizados uma vez em page.tsx). A situação (regra única de estoque baixo) também
// vem daqui, para nenhuma aba recalcular.

export type AbaEstoque =
  | 'inicio' | 'insumos' | 'fornecedores' | 'validade'
  | 'movimentacoes' | 'producao'
  | 'inventario' | 'teorico'
  | 'cmv' | 'consumo';

/** O que o "Arrumar a lista" percorre (sem filtro = tudo que falta). */
export type FiltroArrumar = 'fornecedor' | 'minimo' | 'preco' | 'negativo';

export interface EstoqueTelaApi {
  /** Regra única (fn_estoque_situacao). null enquanto carrega. */
  situacao: SituacaoEstoque | null;
  recarregarSituacao: () => Promise<void> | void;
  irPara: (aba: AbaEstoque) => void;
  abrirFicha: (insumoId: string) => void;
  abrirRegistrar: () => void;
  abrirArrumar: (opcoes?: { filtro?: FiltroArrumar; insumoId?: string }) => void;
  /** Contagem passo a passo (a do Início): grava só os contados. */
  contar: (itens: InsumoSituacao[], titulo: string) => void;
  abrirEntrada: (insumoId: string) => void;
  abrirSaida: (insumoId?: string) => void;
  abrirPerda: (insumoId?: string) => void;
  abrirTransferir: () => void;
  /** Janela "Programar o estoque": quanto pedir e as contagens programadas (só quem configura). */
  abrirProgramar: () => void;
  abrirCompra: (insumoId?: string) => void;
  abrirNovoInsumo: () => void;
  editarInsumo: (insumoId: string) => void;
  /** Quem configura o estoque (admin, Supervisor ou chave estoque_inventario): arrumar, mínimo, fornecedor. */
  podeConfigurar: boolean;
  /** Pode contar (chave estoque_inventario). */
  podeContar: boolean;
}

export const EstoqueTelaContext = createContext<EstoqueTelaApi | null>(null);

/** Dentro da tela do Estoque. */
export function useEstoqueTela(): EstoqueTelaApi {
  const v = useContext(EstoqueTelaContext);
  if (!v) throw new Error('useEstoqueTela fora da tela do Estoque');
  return v;
}

/** Para peças usadas também fora do Estoque (ex.: Consumo dentro de Relatórios): null fora. */
export function useEstoqueTelaOpcional(): EstoqueTelaApi | null {
  return useContext(EstoqueTelaContext);
}
