// Nomes e caminhos da rotina do dia num lugar só. Os nomes dos papéis vêm de perfilConfig (o dono pediu,
// em 03/10, para renomear Gerente → Supervisor e Supervisão → Líder em todo o sistema: a troca é lá).
import { perfilConfig } from '@/constants/usuarios';
import type { PapelRotina, TipoRotina } from '../../../../supabase/functions/_shared/rotina';

export const rotuloPapel = (p: PapelRotina | string): string =>
  p === 'equipe' ? 'Equipe da loja' : perfilConfig[p as keyof typeof perfilConfig]?.label ?? p;

/** Como cada tipo automático se marca, e o botão que leva a fazer. */
export const TIPOS: Record<TipoRotina, { icone: string; nome: string; explica: string; acao?: string; rota?: string }> = {
  manual: { icone: 'ri-hand-coin-line', nome: 'À mão (um toque)', explica: 'a pessoa marca quando fizer' },
  abrir: { icone: 'ri-door-open-line', nome: 'Quando a loja abrir', explica: 'abre o dia e o caixa no PDV', acao: 'Abrir a loja', rota: '/pdv/caixa' },
  fechar: { icone: 'ri-door-closed-line', nome: 'Quando a loja fechar', explica: 'fecha o caixa e o dia no PDV', acao: 'Fechar a loja', rota: '/pdv/caixa' },
  contagem: { icone: 'ri-scales-3-line', nome: 'Quando a contagem terminar', explica: 'confirma a contagem do Estoque', acao: 'Contar', rota: '/estoque' },
  receber: { icone: 'ri-truck-line', nome: 'Quando receber mercadoria', explica: 'alguém registra um recebimento hoje', acao: 'Receber', rota: '/receber' },
  producao: { icone: 'ri-restaurant-2-line', nome: 'Quando registrar a produção', explica: 'alguém registra a produção dessa ficha', acao: 'Produzir' },
};

/** Botão de atalho opcional dos itens à mão. */
export const ATALHOS: Record<string, { label: string; rota: string; onde: string }> = {
  fechamento: { label: 'Ver o fechamento', rota: '/relatorios', onde: 'Relatórios (fechamento de ontem)' },
  pagamentos: { label: 'Ver os pedidos', rota: '/receber?aprovar=1', onde: 'pedidos de pagamento' },
  meta: { label: 'Ver a meta', rota: '/dashboard', onde: 'meta do dia no Dashboard' },
  validade: { label: 'Abrir a lista', rota: '/estoque?tab=validade', onde: 'Estoque › Validade' },
  receber: { label: 'Receber', rota: '/receber', onde: 'Receber mercadoria' },
  estoque: { label: 'Abrir o estoque', rota: '/estoque', onde: 'Estoque' },
  caixa: { label: 'Ir para o caixa', rota: '/pdv/caixa', onde: 'PDV Caixa' },
};

const DIAS_N = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const DIAS_LETRA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export function diasTexto(dias: number[] | null, plano = false): string {
  if (plano) return 'nos dias dos planos de contagem';
  const d = [...(dias ?? [])].sort();
  if (d.length === 7) return 'todo dia';
  if (d.length === 6 && !d.includes(0)) return 'seg a sáb';
  if (d.length === 5 && !d.includes(0) && !d.includes(6)) return 'seg a sex';
  return d.map((x) => DIAS_N[x]).join(', ');
}
