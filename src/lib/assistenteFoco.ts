// Foco do assistente (2026-09-16): o que a TELA está mostrando e o que o dono SELECIONOU.
//
// Antes o chat mandava só a rota ("/financeiro?tab=contas"). O assistente sabia em que tela você
// estava, mas não o que havia nela — então "paga essa" não tinha "essa". Aqui as telas registram
// dois níveis:
//
//   foco de TELA  — o que está visível (mês, filtros, totais, quantas linhas). Vale enquanto a
//                   tela estiver montada; some no unmount.
//   foco de ITEM  — o registro que o dono apontou pelo botão "Perguntar ao assistente". Vale para
//                   UMA mensagem: depois de enviada, some (senão "e essa?" continuaria grudado na
//                   conta de ontem).
//
// Nada disso vai para o servidor sozinho: quem lê e manda junto é o AssistenteChat, e só o dono
// tem o chat. Mantenha os `dados` pequenos e sem dado sensível — eles vão para o modelo.

import { useEffect } from 'react';

export interface FocoAssistente {
  /** Que tipo de coisa é: 'conta_a_pagar', 'compra', 'insumo', 'candidato', 'tela'... */
  tipo: string;
  /** Uma linha em português que já se entende sozinha. É o que o modelo lê primeiro. */
  titulo: string;
  /** Id no banco, quando existir — é com ele que o assistente age. */
  id?: string;
  /** Campos extras (valores, datas, filtros). Vira JSON curto na mensagem. */
  dados?: Record<string, unknown>;
}

export interface FocoAtual {
  tela: FocoAssistente | null;
  item: FocoAssistente | null;
}

/** Evento no window: as telas pedem para abrir o chat, o AssistenteChat escuta. */
export const EVENTO_ASSISTENTE = 'erpos-assistente-abrir';

export interface PedidoAbrir {
  item: FocoAssistente | null;
  texto?: string;
  /** true = abre a conversa inteira; padrão é a barra pequena, que não cobre a tela. */
  conversa?: boolean;
}

let focoTela: FocoAssistente | null = null;
let focoItem: FocoAssistente | null = null;

export function setFocoTela(f: FocoAssistente | null): void {
  focoTela = f;
}

export function setFocoItem(f: FocoAssistente | null): void {
  focoItem = f;
}

export function getFoco(): FocoAtual {
  return { tela: focoTela, item: focoItem };
}

/** Chamado depois que a mensagem foi enviada: o item selecionado não gruda na próxima. */
export function limparFocoItem(): void {
  focoItem = null;
}

/**
 * Registra o que ESTA tela está mostrando. `montar` roda a cada render com as dependências
 * mudadas, então filtros e totais chegam sempre atuais. No unmount o foco sai — outra tela não
 * herda o contexto da anterior.
 */
export function useFocoTela(montar: () => FocoAssistente | null, deps: unknown[]): void {
  useEffect(() => {
    setFocoTela(montar());
    return () => setFocoTela(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Abre o chat já sabendo do que se trata. `texto` entra no campo de digitação (o dono ainda
 * revisa e envia) — nunca mandamos nada sozinho.
 */
export function perguntarAoAssistente(item: FocoAssistente | null, texto?: string, conversa = false): void {
  setFocoItem(item);
  const detalhe: PedidoAbrir = { item, texto, conversa };
  window.dispatchEvent(new CustomEvent<PedidoAbrir>(EVENTO_ASSISTENTE, { detail: detalhe }));
}

/** Corta o que vai para o modelo: contexto é ajuda, não despejo de banco. */
export function resumirFoco(f: FocoAssistente | null, max = 700): { titulo: string; tipo: string; id?: string; dados?: string } | null {
  if (!f) return null;
  let dados: string | undefined;
  if (f.dados && Object.keys(f.dados).length) {
    try { dados = JSON.stringify(f.dados).slice(0, max); } catch { dados = undefined; }
  }
  return { tipo: f.tipo.slice(0, 40), titulo: f.titulo.slice(0, 200), ...(f.id ? { id: String(f.id).slice(0, 60) } : {}), ...(dados ? { dados } : {}) };
}
