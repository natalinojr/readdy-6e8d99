// Constantes e tipos compartilhados pelas peças da Trilha (Financeiro › Trilha).
import type { BoletoInfo } from './api';
import type { Atalho, CasoTrilha, EstadoEtapa, EtapaId, GrupoTarefa, TarefaTrilha, TipoCaso, TrExtrato } from '@/lib/trilhaDespesas';

export const ETAPAS_ORDEM: EtapaId[] = ['documento', 'lancamento', 'estoque', 'conta', 'pagamento', 'banco'];
/** O funil do topo não tem "Nota fiscal" (hoje sempre 100%). */
export const ETAPAS_FUNIL: EtapaId[] = ['lancamento', 'estoque', 'conta', 'pagamento', 'banco'];

export const ICONE_ETAPA: Record<EtapaId, string> = {
  documento: 'ri-file-text-line', lancamento: 'ri-edit-box-line', estoque: 'ri-archive-2-line',
  conta: 'ri-bill-line', pagamento: 'ri-money-dollar-circle-line', banco: 'ri-bank-line',
};

export const EST: Record<EstadoEtapa, { cor: string; txt: string; rot: string; ic: string }> = {
  ok: { cor: 'bg-emerald-500', txt: 'text-emerald-700', rot: 'Feito', ic: 'ri-check-line' },
  prazo: { cor: 'bg-sky-400', txt: 'text-sky-700', rot: 'No prazo', ic: 'ri-calendar-check-line' },
  pendente: { cor: 'bg-amber-400', txt: 'text-amber-700', rot: 'A fazer', ic: 'ri-time-line' },
  atrasado: { cor: 'bg-red-500', txt: 'text-red-700', rot: 'Atrasado', ic: 'ri-alarm-warning-line' },
  problema: { cor: 'bg-red-500', txt: 'text-red-700', rot: 'Tem problema', ic: 'ri-error-warning-line' },
  espera: { cor: 'bg-zinc-200', txt: 'text-zinc-400', rot: 'Esperando', ic: 'ri-more-line' },
  na: { cor: 'bg-zinc-100', txt: 'text-zinc-300', rot: 'Não precisa', ic: 'ri-subtract-line' },
};
export const CHIP: Record<EstadoEtapa, string> = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200', prazo: 'bg-sky-50 text-sky-700 ring-sky-200',
  pendente: 'bg-amber-50 text-amber-700 ring-amber-200', atrasado: 'bg-red-50 text-red-600 ring-red-200',
  problema: 'bg-red-50 text-red-600 ring-red-200', espera: 'bg-zinc-50 text-zinc-400 ring-zinc-200',
  na: 'bg-zinc-50 text-zinc-400 ring-zinc-200',
};

export const ROTULO_TIPO: Record<TipoCaso, { t: string; cls: string }> = {
  compra: { t: 'Compra', cls: 'bg-blue-50 text-blue-700' },
  despesa: { t: 'Despesa', cls: 'bg-violet-50 text-violet-700' },
  nota: { t: 'Nota', cls: 'bg-zinc-100 text-zinc-700' },
  pedido: { t: 'Pedido', cls: 'bg-teal-50 text-teal-700' },
  pagamento: { t: 'Banco', cls: 'bg-orange-50 text-orange-700' },
};

export interface GrupoInfo {
  id: GrupoTarefa; icone: string; nome: string; desc: string; cor: 'red' | 'amber';
  /** tela onde a tarefa nasce (para "Abrir" em Resolvido agora) */
  origem: string;
}
export const GRUPOS: GrupoInfo[] = [
  { id: 'saida_banco', icone: 'ri-bank-line', nome: 'Dizer o que foram as saídas do banco', desc: 'Saiu dinheiro e ninguém disse se foi compra ou despesa', cor: 'red', origem: '/financeiro?tab=conciliacao' },
  { id: 'vencidas', icone: 'ri-alarm-warning-line', nome: 'Pagar contas a pagar vencidas', desc: 'Juros correndo', cor: 'red', origem: '/financeiro?tab=pagar' },
  { id: 'sem_conta', icone: 'ri-bill-line', nome: 'Criar conta a pagar', desc: 'Compra não paga e sem conta a pagar lançada', cor: 'red', origem: '/financeiro?tab=compras' },
  { id: 'estoque', icone: 'ri-archive-2-line', nome: 'Acertar estoque', desc: 'Entrega não confirmada ou mercadoria que ficou fora do estoque', cor: 'amber', origem: '/financeiro?tab=compras' },
  { id: 'notas', icone: 'ri-file-text-line', nome: 'Lançar notas que chegaram', desc: 'Notas da SEFAZ que ainda não viraram compra nem despesa', cor: 'amber', origem: '/financeiro?tab=notas-entrada' },
  { id: 'pedidos', icone: 'ri-hand-coin-line', nome: 'Aprovar pedidos de pagamento', desc: 'Pedidos esperando aprovação ou lançamento', cor: 'amber', origem: '/receber' },
  { id: 'classificar', icone: 'ri-price-tag-3-line', nome: 'Classificar no DRE', desc: 'Despesa sem categoria', cor: 'amber', origem: '/financeiro?tab=pagar' },
  { id: 'extrato', icone: 'ri-links-line', nome: 'Achar no extrato', desc: 'Marcado como pago, mas não achado no extrato', cor: 'amber', origem: '/financeiro?tab=conciliacao' },
];
export const GRUPO_POR_ID = Object.fromEntries(GRUPOS.map((g) => [g.id, g])) as Record<GrupoTarefa, GrupoInfo>;

/** O que as peças da tela podem pedir ao TrilhaTab (que é dono dos modais e da navegação). */
export interface AcoesTrilha {
  /** "Abrir ↗" de uma fase feita */
  ir: (a: Atalho) => void;
  /** navega para uma rota do sistema */
  rota: (path: string) => void;
  /** abre a linha do extrato na janela da Conciliação, aqui mesmo */
  extrato: (e: TrExtrato, rotulo: string) => void;
  /** abre o detalhe da compra (confirmar entrega, alterar data) */
  compra: (compraId: string, rotulo: string) => void;
  /** abre a escolha de categoria do DRE das contas do caso */
  classificar: (caso: CasoTrilha, rotulo: string) => void;
  // ── fase 2: botões ligados ao backend ──
  /** só o dono vê boleto/pagar (o próprio assistente-app recusa os outros) */
  dono: boolean;
  tenantId: string;
  /** hoje em Brasília (AAAA-MM-DD) */
  hoje: string;
  /** boleto/Pix guardado de cada conta vencida (só carregado para o dono) */
  boletos: Map<string, BoletoInfo>;
  /** uma ação terminou: registra em "Resolvido agora" (com desfazer, se tiver) e recarrega a trilha */
  concluir: (rotulo: string, desfazer?: () => Promise<void>) => Promise<void>;
  /** recarrega sem registrar nada em "Resolvido agora" */
  recarregar: () => Promise<void>;
}

export interface TarefaComCaso { tarefa: TarefaTrilha; caso: CasoTrilha }

export const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
