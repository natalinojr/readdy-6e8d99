// Telas do módulo Gestão que podem ser liberadas por papel (Configurações › Permissões).
// Antes elas não tinham chave nenhuma: quem entrava em Gestão via todas, e o card "Gestão"
// em /modulos era fixo em Admin/Gerente. Com estas chaves o dono libera tela a tela — é
// assim que um Caixa passa a ver, por exemplo, só Pedidos e Mesas.
// A chave é gravada em `permissions.permission_key`; não renomear sem migrar as linhas salvas.
import { FIN_KEYS, REL_KEYS } from './permissoesAbas';

export const GESTAO_TELAS = [
  { key: 'gestao_dashboard', label: 'Dashboard', rota: '/dashboard' },
  { key: 'gestao_pedidos', label: 'Pedidos', rota: '/pedidos' },
  { key: 'gestao_mesas', label: 'Mesas', rota: '/mesas' },
  { key: 'gestao_aprovacoes', label: 'Aprovações', rota: '/aprovacoes' },
  { key: 'gestao_promocoes', label: 'Promoções', rota: '/promocoes' },
  { key: 'gestao_vouchers', label: 'Vouchers & Gift Cards', rota: '/vouchers' },
  { key: 'gestao_delivery', label: 'Delivery (configuração)', rota: '/config-delivery' },
] as const;

export type GestaoPermissaoKey = (typeof GESTAO_TELAS)[number]['key'];

export const GESTAO_KEYS: GestaoPermissaoKey[] = GESTAO_TELAS.map((t) => t.key);

/** Ter qualquer uma delas já dá direito ao card "Gestão" em /modulos — o menu de
 *  dentro continua filtrado permissão a permissão pela Sidebar. */
export const GESTAO_ENTRADA_KEYS: readonly string[] = [
  ...GESTAO_KEYS,
  'cardapio_editar',
  'estoque_movimentar',
  'relatorio_estoque',
  'clientes_ver',
  'usuarios_gerenciar',
  'configuracoes_editar',
  'auditoria_ver',
  'relatorio_financeiro',
  ...REL_KEYS,
  ...FIN_KEYS,
];

/** Ordem das telas do módulo Gestão, com as chaves que dão acesso a cada uma.
 *  Serve para abrir o módulo na primeira tela que o papel realmente pode ver —
 *  o card Gestão apontava fixo para /dashboard, que nem todo papel tem. */
const GESTAO_ROTAS: { rota: string; keys: readonly string[] }[] = [
  { rota: '/dashboard', keys: ['gestao_dashboard'] },
  { rota: '/pedidos', keys: ['gestao_pedidos'] },
  { rota: '/mesas', keys: ['gestao_mesas'] },
  { rota: '/relatorios', keys: REL_KEYS },
  { rota: '/cardapio', keys: ['cardapio_editar'] },
  { rota: '/estoque', keys: ['estoque_movimentar'] },
  { rota: '/clientes', keys: ['clientes_ver'] },
  { rota: '/promocoes', keys: ['gestao_promocoes'] },
  { rota: '/vouchers', keys: ['gestao_vouchers'] },
  { rota: '/config-delivery', keys: ['gestao_delivery'] },
  { rota: '/aprovacoes', keys: ['gestao_aprovacoes'] },
  { rota: '/trafego-pago', keys: ['relatorio_financeiro'] },
  { rota: '/financeiro', keys: FIN_KEYS },
  { rota: '/usuarios', keys: ['usuarios_gerenciar'] },
  { rota: '/auditoria', keys: ['auditoria_ver'] },
  { rota: '/configuracoes', keys: ['configuracoes_editar'] },
];

export function primeiraRotaGestao(has: (key: string) => boolean): string {
  return GESTAO_ROTAS.find((r) => r.keys.some((k) => has(k)))?.rota ?? '/ajuda';
}
