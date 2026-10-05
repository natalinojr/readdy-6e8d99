// Catálogo único das telas da LOJA (casca nova, 2026-10-05). Uma lista só alimenta o menu do computador,
// o "Mais" do celular, a barra de baixo e o "Ir para…". As regras de quem vê cada tela são as MESMAS de
// hoje: as do menu antigo (Sidebar.tsx) para as telas que já estavam nele; para as que ganham porta agora,
// a regra de onde elas aparecem hoje (/modulos, Hoje, ações rápidas). Nenhuma tela pode aparecer para quem
// hoje não a vê — a RotaProtegida continua conferindo a rota de qualquer jeito.
// Tarefas, Contratação e Notas de serviço são PRODUTOS à parte (PRODUTOS abaixo): não entram no menu da loja.
import type { ComponentType } from 'react';
import {
  Sun, Bell, History, Zap, LayoutDashboard, ChefHat, ClipboardList, Bike, BarChart3, LayoutGrid,
  Monitor, ShoppingCart, Coffee, Phone, Tablet, Package, Truck, UtensilsCrossed, DollarSign, LineChart,
  Heart, MapPin, Megaphone, Palette, Users, Settings, Shield, Bot, ShieldCheck, HelpCircle, Store,
  ListTodo, UserSearch, FileText, Archive, ShoppingBag,
} from 'lucide-react';
import { RECEBER_MODULO_KEYS, type PermissaoKey } from '@/hooks/usePermissoes';
import type { ModuloLivre } from '@/hooks/useModuleAccess';
import { FIN_KEYS, REL_KEYS, CFG_MAQUININHA_KEY } from '@/constants/permissoesAbas';
import { rotaForcada } from '@/lib/acessoRota';

export const ADMIN_MASTER_EMAIL = 'natalinojr.engel@gmail.com';

export type Icone = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

export type GrupoId = 'hoje' | 'loja' | 'cozinha' | 'dinheiro' | 'clientes' | 'equipe';

export interface GrupoTelas {
  id: GrupoId;
  rotulo: string;
  icone: Icone;
}

export const GRUPOS: GrupoTelas[] = [
  { id: 'hoje', rotulo: 'Hoje', icone: Sun },
  { id: 'loja', rotulo: 'Loja agora', icone: Store },
  { id: 'cozinha', rotulo: 'Cozinha e estoque', icone: Archive },
  { id: 'dinheiro', rotulo: 'Dinheiro', icone: DollarSign },
  { id: 'clientes', rotulo: 'Clientes e divulgação', icone: Megaphone },
  { id: 'equipe', rotulo: 'Equipe e ajustes', icone: Users },
];

export interface Tela {
  id: string;
  rota: string;
  rotulo: string;
  icone: Icone;
  grupo: GrupoId;
  /** Linha curta sobre a tela (Mais e Ir para…). */
  descricao: string;
  /** Recolhida dentro de "Terminais" (grupo Loja agora). */
  terminal?: boolean;
  /** Outras palavras que levam a esta tela no "Ir para…" (sem acento, minúsculas). */
  apelidos?: string[];
  /** Selo de número: 'hoje' = o número da Hoje; 'aprovacoes' = aprovações pendentes. */
  selo?: 'hoje' | 'aprovacoes';
  // ── regras de quem vê (as mesmas de hoje) ──
  /** Uma chave, ou lista (basta ter uma). */
  permissao?: PermissaoKey | readonly PermissaoKey[];
  /** Terminal que a loja liga/desliga em Configurações (pdv_config). */
  pdvTerminal?: string;
  adminMasterOnly?: boolean;
  /** Módulo por pessoa (Admin Master). */
  modulo?: ModuloLivre;
  /** Só estes papéis (regra do card em /modulos). */
  perfis?: readonly string[];
  /** Some em empresa sem PDV (tenants.kind = 'financeiro'), como em /modulos. */
  precisaPdv?: boolean;
  /** Só em loja com iFood ligado na API (alguma loja do iFood com api_sync): sem isso a área iFood ficaria vazia. */
  precisaIfood?: boolean;
  /** Comparar lojas: só quem vê o Dashboard em 2+ lojas (a faixa "Suas lojas agora" de /modulos). */
  compararLojas?: boolean;
}

export const TELAS: Tela[] = [
  // 1 · Hoje
  { id: 'hoje', rota: '/hoje', rotulo: 'Hoje', icone: Sun, grupo: 'hoje', selo: 'hoje',
    descricao: 'o que precisa de você agora, em ordem', apelidos: ['inicio', 'agora', 'pendente'] },
  { id: 'aprovacoes', rota: '/aprovacoes', rotulo: 'Aprovações', icone: Bell, grupo: 'hoje', selo: 'aprovacoes',
    permissao: 'gestao_aprovacoes', descricao: 'descontos e cancelamentos esperando o seu OK', apelidos: ['aprovar', 'desconto', 'cancelamento'] },
  // Pendências: todos (2026-09-28, mesma regra das ações rápidas); a caixa filtra o que cada papel vê.
  { id: 'pendencias', rota: '/pendencias', rotulo: 'Pendências · histórico', icone: History, grupo: 'hoje',
    descricao: 'o que já foi resolvido (o histórico da Hoje)', apelidos: ['historico', 'resolvido'] },
  // Lançar: o atalho da Hoje aparece para todo mundo que abre a Hoje; a tela mostra só o que o papel pode.
  { id: 'lancar', rota: '/lancar', rotulo: 'Lançar', icone: Zap, grupo: 'hoje',
    descricao: '“O que aconteceu?”: paguei, chegou mercadoria, tirei do caixa',
    apelidos: ['o que aconteceu', 'paguei', 'despesa', 'sangria', 'tirei do caixa'] },

  // 2 · Loja agora
  { id: 'dashboard', rota: '/dashboard', rotulo: 'Dashboard', icone: LayoutDashboard, grupo: 'loja',
    permissao: 'gestao_dashboard', descricao: 'como a loja está indo hoje e na semana', apelidos: ['vendas hoje', 'faturamento', 'meta'] },
  // Sem pdvTerminal: quem liga/desliga é a "Visão da Cozinha" (kitchen_view).
  { id: 'gestor-pedidos', rota: '/gestor-pedidos', rotulo: 'Gestor de Pedidos', icone: ChefHat, grupo: 'loja',
    permissao: 'gestor_pedidos_acessar', descricao: 'a fila da cozinha', apelidos: ['fila', 'kanban', 'cozinha'] },
  { id: 'pedidos', rota: '/pedidos', rotulo: 'Pedidos', icone: ClipboardList, grupo: 'loja',
    permissao: 'gestao_pedidos', descricao: 'todos os pedidos: achar, conferir e cancelar', apelidos: ['pedido', 'senha', 'cancelar pedido'] },
  { id: 'gestor-entregas', rota: '/gestor-entregas', rotulo: 'Gestor de Entregas', icone: Bike, grupo: 'loja',
    perfis: ['admin', 'gerente', 'supervisao', 'caixa'], precisaPdv: true,
    descricao: 'as entregas em andamento, fase por fase', apelidos: ['entrega', 'motoboy', 'entregador'] },
  { id: 'config-delivery', rota: '/config-delivery', rotulo: 'Delivery próprio', icone: MapPin, grupo: 'loja',
    permissao: 'gestao_delivery', descricao: 'taxa por distância, horário e regras da entrega',
    apelidos: ['taxa de entrega', 'horario', 'delivery', 'delivery proprio'] },
  { id: 'ifood', rota: '/ifood', rotulo: 'iFood', icone: ShoppingBag, grupo: 'loja',
    permissao: ['rel_ifood', 'fin_ifood', 'gestao_pedidos', 'gestao_delivery'], precisaPdv: true, precisaIfood: true,
    descricao: 'pedidos, itens, dinheiro e a loja no iFood', apelidos: ['ifood', 'repasse', 'cmv ifood', 'avaliacao'] },
  { id: 'lojas', rota: '/lojas', rotulo: 'Comparar lojas', icone: BarChart3, grupo: 'loja', compararLojas: true,
    descricao: 'uma loja ao lado da outra, no mesmo dia', apelidos: ['lojas', 'comparar'] },
  { id: 'mesas', rota: '/mesas', rotulo: 'Mesas', icone: LayoutGrid, grupo: 'loja',
    permissao: 'gestao_mesas', descricao: 'o mapa do salão e a conta de cada mesa', apelidos: ['mesa', 'salao', 'qr'] },
  { id: 'pdv-caixa', rota: '/pdv/caixa', rotulo: 'PDV Caixa', icone: ShoppingCart, grupo: 'loja', terminal: true,
    pdvTerminal: 'caixa', descricao: 'vender e cobrar no balcão', apelidos: ['caixa', 'vender', 'pdv', 'balcao', 'abrir caixa', 'fechar caixa'] },
  { id: 'pdv-garcom', rota: '/pdv/garcom', rotulo: 'PDV Garçom', icone: Coffee, grupo: 'loja', terminal: true,
    pdvTerminal: 'garcom', descricao: 'pedidos no salão, direto da mesa', apelidos: ['garcom', 'comanda'] },
  { id: 'pdv-delivery', rota: '/pdv/delivery', rotulo: 'Delivery por telefone', icone: Phone, grupo: 'loja', terminal: true,
    pdvTerminal: 'delivery', descricao: 'pedido de entrega e retirada por telefone', apelidos: ['pdv delivery', 'telefone', 'retirada'] },
  { id: 'autoatendimento', rota: '/autoatendimento', rotulo: 'Autoatendimento', icone: Tablet, grupo: 'loja', terminal: true,
    pdvTerminal: 'autoatendimento', descricao: 'o tablet em que o cliente pede sozinho', apelidos: ['totem', 'tablet'] },
  { id: 'kds', rota: '/kds', rotulo: 'KDS', icone: Monitor, grupo: 'loja', terminal: true,
    permissao: 'kds_acessar', descricao: 'a tela da cozinha, com o tempo de cada pedido', apelidos: ['cozinha', 'tela da cozinha'] },

  // 3 · Cozinha e estoque
  { id: 'estoque', rota: '/estoque', rotulo: 'Estoque', icone: Package, grupo: 'cozinha',
    permissao: 'estoque_movimentar', descricao: 'o que tem, o que está acabando, contar e registrar',
    apelidos: ['contar', 'contagem', 'inventario', 'insumo', 'perda', 'producao', 'ficha'] },
  { id: 'receber', rota: '/receber', rotulo: 'Recebimentos e pagamentos', icone: Truck, grupo: 'cozinha',
    permissao: RECEBER_MODULO_KEYS, descricao: 'mercadoria que chegou, reembolso, freelancer e fornecedor sem nota',
    apelidos: ['receber', 'mercadoria', 'chegou', 'reembolso', 'freelancer', 'pedido de pagamento'] },
  { id: 'cardapio', rota: '/cardapio', rotulo: 'Cardápio', icone: UtensilsCrossed, grupo: 'cozinha',
    permissao: 'cardapio_editar', descricao: 'itens, preços, fichas técnicas e fotos',
    apelidos: ['item', 'preco', 'produto', 'pausar', 'acabou', 'publicar'] },

  // 4 · Dinheiro
  { id: 'financeiro', rota: '/financeiro', rotulo: 'Financeiro', icone: DollarSign, grupo: 'dinheiro',
    permissao: FIN_KEYS, descricao: 'contas, bancos, notas, folha e DRE',
    apelidos: ['boleto', 'vencidas', 'contas a pagar', 'pagar', 'conta', 'dre', 'cmv', 'banco', 'pix', 'nota fiscal', 'folha', 'conciliacao', 'extrato'] },
  { id: 'relatorios', rota: '/relatorios', rotulo: 'Relatórios', icone: LineChart, grupo: 'dinheiro',
    permissao: REL_KEYS, descricao: 'vendas, lucro e caixa por período', apelidos: ['relatorio', 'vendas', 'fechamento'] },

  // 5 · Clientes e divulgação
  { id: 'clientes', rota: '/clientes', rotulo: 'Clientes & Marketing', icone: Heart, grupo: 'clientes',
    permissao: ['clientes_ver', 'gestao_promocoes', 'gestao_vouchers'],
    descricao: 'clube de fidelidade, vouchers e mensagens para clientes',
    apelidos: ['cliente', 'voucher', 'cupom', 'promocao', 'fidelidade', 'funil', 'marketing'] },
  { id: 'trafego-pago', rota: '/trafego-pago', rotulo: 'Tráfego Pago', icone: Megaphone, grupo: 'clientes',
    permissao: 'relatorio_financeiro', descricao: 'anúncios no Instagram e no Facebook', apelidos: ['anuncio', 'meta', 'instagram', 'facebook'] },
  { id: 'estudio', rota: '/estudio', rotulo: 'Estúdio de Criação', icone: Palette, grupo: 'clientes',
    permissao: 'marketing_estudio', descricao: 'criar artes e textos para divulgar', apelidos: ['arte', 'post', 'criativo'] },

  // 6 · Equipe e ajustes
  { id: 'usuarios', rota: '/usuarios', rotulo: 'Usuários', icone: Users, grupo: 'equipe',
    permissao: 'usuarios_gerenciar', descricao: 'pessoas, cargos e o que cada uma pode abrir',
    apelidos: ['pessoa', 'funcionario', 'equipe', 'cargo', 'acesso', 'senha'] },
  { id: 'configuracoes', rota: '/configuracoes', rotulo: 'Configurações', icone: Settings, grupo: 'equipe',
    permissao: ['configuracoes_editar', CFG_MAQUININHA_KEY], descricao: 'a loja, pagamentos, impressão e regras',
    apelidos: ['impressora', 'maquininha', 'fiscal', 'nfc-e', 'ajustes'] },
  { id: 'auditoria', rota: '/auditoria', rotulo: 'Auditoria', icone: Shield, grupo: 'equipe',
    permissao: 'auditoria_ver', descricao: 'quem fez o quê, e quando', apelidos: ['quem fez', 'log'] },
  { id: 'assistente', rota: '/assistente', rotulo: 'Assistente', icone: Bot, grupo: 'equipe', adminMasterOnly: true,
    descricao: 'o seu assistente no WhatsApp e no app', apelidos: ['whatsapp', 'ia'] },
  { id: 'admin-master', rota: '/admin-master', rotulo: 'Admin Master', icone: ShieldCheck, grupo: 'equipe', adminMasterOnly: true,
    descricao: 'lojas e acessos entre lojas (só o dono)', apelidos: ['admin'] },
  { id: 'ajuda', rota: '/ajuda', rotulo: 'Ajuda', icone: HelpCircle, grupo: 'equipe',
    descricao: 'como fazer cada coisa, passo a passo', apelidos: ['tutorial', 'como faco', 'duvida'] },
];

/** Produtos à parte (regra do dono): o seletor no topo do menu, só para quem tem 2 ou mais. */
export interface Produto {
  id: 'loja' | ModuloLivre;
  rotulo: string;
  curto: string;
  rota: string;
  icone: Icone;
  modulo?: ModuloLivre;
}

export const PRODUTOS: Produto[] = [
  { id: 'loja', rotulo: 'Loja', curto: 'Loja', rota: '/hoje', icone: Store },
  { id: 'tarefas', rotulo: 'Tarefas', curto: 'Tarefas', rota: '/tarefas', icone: ListTodo, modulo: 'tarefas' },
  { id: 'contratacao', rotulo: 'Contratação', curto: 'Contratação', rota: '/contratacao', icone: UserSearch, modulo: 'contratacao' },
  { id: 'nfse', rotulo: 'Notas de serviço', curto: 'Notas', rota: '/notas-servico', icone: FileText, modulo: 'nfse' },
];

export interface ContextoTelas {
  email?: string | null;
  perfil?: string | null;
  pode: (k: PermissaoKey) => boolean;
  modulo: (m: ModuloLivre) => boolean;
  /** settings.pdv_config da loja (terminal ausente = ligado). */
  pdvConfig?: Record<string, boolean | undefined> | null;
  /** settings.kitchen_view: 'kds' | 'gestor' | 'ambos' (padrão 'ambos'). */
  kitchenView?: string | null;
  /** A empresa tem PDV (tenants.kind ≠ 'financeiro')? Ausente = tem. */
  temPdv?: boolean;
  /** Vê o Dashboard em 2+ lojas (fn_lojas_comparar)? */
  veCompararLojas?: boolean;
  /** A loja ativa tem iFood ligado na API (useLojaTemIfood)? Ausente = não tem. */
  temIfood?: boolean;
}

/** A tela aparece para esta pessoa? Mesma lógica do filtro do Sidebar.tsx + a regra das telas novas no menu. */
export function telaVisivel(t: Tela, c: ContextoTelas): boolean {
  if (t.adminMasterOnly && c.email !== ADMIN_MASTER_EMAIL) return false;
  // Papel preso a uma área (Financeiro, Contabilidade, Tarefas...): link de fora dela só devolveria para lá.
  if (rotaForcada(c.perfil, t.rota)) return false;
  if (t.modulo && !c.modulo(t.modulo)) return false;
  if (t.permissao && !(typeof t.permissao === 'string' ? [t.permissao] : t.permissao).some((k) => c.pode(k as PermissaoKey))) return false;
  if (t.perfis && (!c.perfil || !t.perfis.includes(c.perfil))) return false;
  if (t.precisaPdv && c.temPdv === false) return false;
  if (t.precisaIfood && !c.temIfood) return false;
  if (t.compararLojas && !c.veCompararLojas) return false;
  if (t.pdvTerminal) {
    const terminalAtivo = c.pdvConfig?.[t.pdvTerminal] ?? true;
    if (!terminalAtivo) return false;
  }
  const kitchenView = c.kitchenView ?? 'ambos';
  if (t.rota === '/kds') return kitchenView === 'kds' || kitchenView === 'ambos';
  if (t.rota === '/gestor-pedidos') return kitchenView === 'gestor' || kitchenView === 'ambos';
  return true;
}

/** As telas da loja que a pessoa vê, na ordem do catálogo. */
export function filtrarTelas(c: ContextoTelas, telas: Tela[] = TELAS): Tela[] {
  return telas.filter((t) => telaVisivel(t, c));
}

/** Produtos que a pessoa tem: Loja (tem loja) + os módulos liberados. */
export function filtrarProdutos(c: ContextoTelas, temLoja: boolean): Produto[] {
  return PRODUTOS.filter((p) => {
    if (p.id === 'loja') return temLoja;
    if (rotaForcada(c.perfil, p.rota)) return false;
    return !!p.modulo && c.modulo(p.modulo);
  });
}
