// Quem vê cada AÇÃO RÁPIDA (2026-09-23). O chat do assistente é só do dono, mas as ações rápidas
// ficaram para todos os usuários: o menu mostra só o que a pessoa já pode fazer pela tela.
// Regra: a mesma permissão que libera a TELA de onde a ação copia o caminho (RotaProtegida,
// Sidebar, abas do Financeiro, módulos por usuário). A gravação continua conferida no servidor
// (edge/RLS) — isto aqui só evita botão que daria "sem permissão".
// Ação nova sem linha aqui NÃO aparece para ninguém (nem para o dono): acrescente a regra junto.
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes, RECEBER_MODULO_KEYS, type PermissaoKey } from '@/hooks/usePermissoes';
import { useModuleAccess, type ModuloLivre } from '@/hooks/useModuleAccess';
import { rotaForcada } from '@/lib/acessoRota';
import { FIN_ABAS, REL_KEYS } from '@/constants/permissoesAbas';

export interface ContextoAcesso {
  perfil: string | null;
  pode: (k: PermissaoKey) => boolean;
  modulo: (m: ModuloLivre) => boolean;
}

// O Financeiro (tela e edges financial-write/purchase-write) é só Admin/Gerente/Financeiro; as
// abas limitam dentro disso.
const PAPEIS_FINANCEIRO = ['admin', 'gerente', 'financeiro'];
const fin = (c: ContextoAcesso, ...abas: PermissaoKey[]) =>
  !!c.perfil && PAPEIS_FINANCEIRO.includes(c.perfil) && abas.some((k) => c.pode(k));
const algum = (c: ContextoAcesso, ...ks: PermissaoKey[]) => ks.some((k) => c.pode(k));

/** Rota → quem entra. Espelha RotaProtegida/Sidebar para os atalhos "Ir para uma tela". */
export function rotaLiberada(rota: string, c: ContextoAcesso): boolean {
  const caminho = rota.split('?')[0];
  // Papéis presos (Tarefas, Financeiro, Gestor de Entregas) não saem da área deles.
  if (rotaForcada(c.perfil, caminho)) return false;
  if (caminho.startsWith('/financeiro')) {
    const aba = new URLSearchParams(rota.split('?')[1] ?? '').get('tab');
    const chave = FIN_ABAS.find((a) => a.aba === aba)?.key;
    return chave ? fin(c, chave) : fin(c, 'fin_visao');
  }
  if (caminho.startsWith('/notas-servico')) return c.modulo('nfse');
  if (caminho.startsWith('/tarefas')) return c.modulo('tarefas');
  if (caminho.startsWith('/contratacao')) return c.modulo('contratacao');
  // /receber = Recebimentos e pagamentos: quem recebe mercadoria (estoque_receber abre só ele;
  // quem movimenta estoque também entra) ou quem faz/aprova pedido de pagamento.
  if (caminho.startsWith('/receber')) return algum(c, ...RECEBER_MODULO_KEYS);
  if (caminho.startsWith('/estoque')) return c.pode('estoque_movimentar');
  if (caminho.startsWith('/cardapio')) return c.pode('cardapio_editar');
  if (caminho.startsWith('/pedidos')) return c.pode('gestao_pedidos');
  if (caminho.startsWith('/relatorios')) return algum(c, ...REL_KEYS);
  if (caminho.startsWith('/trafego-pago')) return c.pode('relatorio_financeiro');
  // Pendências da loja: mesma turma do Financeiro.
  if (caminho.startsWith('/pendencias')) return !!c.perfil && PAPEIS_FINANCEIRO.includes(c.perfil);
  return false;
}

const REGRAS: Record<string, (c: ContextoAcesso) => boolean> = {
  // Atalhos: a lista de telas é filtrada por rotaLiberada dentro da ação.
  atalhos: (c) => ['/tarefas', '/financeiro', '/estoque', '/cardapio', '/pedidos', '/relatorios', '/trafego-pago', '/contratacao', '/notas-servico']
    .some((r) => rotaLiberada(r, c)),
  nfse: (c) => c.modulo('nfse'),
  'lancar-despesa': (c) => fin(c, 'fin_despesas', 'fin_pagar'),
  'contas-vencendo': (c) => fin(c, 'fin_pagar', 'fin_contas_vencidas'),
  'classificar-dre': (c) => fin(c, 'fin_pagar'),
  'saldo-extrato': (c) => fin(c, 'fin_bancos', 'fin_conciliacao'),
  'atualizar-conciliacao': (c) => fin(c, 'fin_conciliacao'),
  'fechamento-dia': (c) => fin(c, 'fin_conciliacao', 'fin_receitas'),
  'vendas-dia': (c) => algum(c, 'rel_geral', 'relatorio_financeiro', 'gestao_dashboard'),
  'pausar-item': (c) => c.pode('cardapio_editar'),
  // Só leitura (a mesma RPC do cardápio que o PDV usa): quem edita o cardápio e quem atende precisa saber o que está fora.
  'itens-pausados': (c) => algum(c, 'cardapio_editar', 'gestao_pedidos', 'pdv_abrir_caixa', 'kds_acessar'),
  // O botão Delivery do PDV Caixa não tem trava: quem abre caixa também pausa.
  'pausar-delivery': (c) => algum(c, 'gestao_delivery', 'pdv_abrir_caixa'),
  'pedidos-atrasados': (c) => algum(c, 'gestao_pedidos', 'gestor_pedidos_acessar', 'kds_acessar'),
  'impressora-parada': (c) => (c.pode('configuracoes_editar') && c.pode('cfg_impressoras')) || c.pode('gestao_pedidos'),
  'caixa-aberto': (c) => algum(c, 'pdv_abrir_caixa', 'pdv_fechar_caixa', 'rel_caixa'),
  // Receber mercadoria só abre o /receber: mesma regra da rota (RotaProtegida/Sidebar).
  'receber-mercadoria': (c) => rotaLiberada('/receber', c) && algum(c, 'estoque_receber', 'estoque_movimentar'),
  // Pedidos de pagamento (2026-09-24): mesma permissão da tela
  'pedir-reembolso': (c) => rotaLiberada('/receber', c) && c.pode('pag_reembolso'),
  'aprovar-pedidos': (c) => rotaLiberada('/receber', c) && c.pode('pag_aprovar'),
  'registrar-perda': (c) => c.pode('estoque_movimentar'),
  'contagem-rapida': (c) => c.pode('estoque_inventario'),
  'estoque-critico': (c) => algum(c, 'estoque_movimentar', 'relatorio_estoque'),
  'cadastrar-insumo': (c) => c.pode('estoque_movimentar'),
  'registrar-producao': (c) => c.pode('estoque_movimentar'),
  'enviar-voucher': (c) => c.pode('gestao_vouchers'),
  promocoes: (c) => c.pode('gestao_promocoes'),
  trafego: (c) => c.pode('relatorio_financeiro'),
  // Aprovar executa na Meta: só o Admin decide (mesma regra da tela).
  'trafego-sugestoes': (c) => c.perfil === 'admin',
  'entrevistas-hoje': (c) => c.modulo('contratacao'),
  'mover-candidato': (c) => c.modulo('contratacao'),
  'dias-freelancer': (c) => fin(c, 'fin_freelancers'),
  // Tarefas: quem tem o módulo. O alcance (minhas pastas, compartilhadas, comigo) já vem do fn_get_tasks.
  ...Object.fromEntries(['nova-tarefa', 'tarefa-recorrente', 'tarefas-hoje', 'cronometro-tarefa', 'adiar-tarefa', 'passar-tarefa',
    'tarefas-que-passei', 'carga-equipe', 'atrasadas-equipe', 'apontar-horas', 'comentar-tarefa', 'checklist-tarefa']
    .map((id) => [id, (c: ContextoAcesso) => c.modulo('tarefas')])),
  clima: () => true,
};

export function acaoLiberada(id: string, c: ContextoAcesso): boolean {
  return REGRAS[id]?.(c) ?? false;
}

/** Contexto de acesso do usuário logado. `carregando` = permissões/módulos ainda chegando. */
export function useAcessoAcoes(): ContextoAcesso & { carregando: boolean } {
  const { user, hasNoTenants } = useAuth();
  const { hasPermissao, loading } = usePermissoes();
  const { hasModule, loading: carregandoModulos } = useModuleAccess();
  // Sem loja (só módulo, 2026-09-24): nenhuma permissão de loja. Sem isto o usePermissoes cai no
  // padrão do papel "caixa" e mostraria ações de caixa/cozinha para quem só tem Tarefas.
  if (!user && hasNoTenants) return { perfil: null, pode: () => false, modulo: hasModule, carregando: carregandoModulos };
  return { perfil: user?.perfil ?? null, pode: hasPermissao, modulo: hasModule, carregando: loading || carregandoModulos };
}
