// Catálogo das permissões (descrição e categoria) — o que aparece em Configurações › Permissões e no
// "Avançado" da tela Usuários › Acesso (2026-10-03). Movido de PermissoesTab para as duas telas usarem
// a mesma lista. A chave é gravada em permissions/user_permissions; não renomear sem migrar.
import { FIN_ABAS, REL_ABAS, CFG_ABAS, CFG_MAQUININHA_KEY } from './permissoesAbas';
import { GESTAO_TELAS } from './permissoesGestao';

export interface Permissao {
  id: string;
  categoria: string;
  descricao: string;
  /** Financeiro: a página e as edges são só Admin/Gerente — nos outros papéis a caixa fica travada. */
  somenteGerente?: boolean;
  /** Só o Admin pode ter: quem edita a matriz de permissões se dá qualquer outra. */
  somenteAdmin?: boolean;
}

export const PERMISSOES_CATALOGO: Permissao[] = [
  { id: 'pdv_abrir_caixa', categoria: 'Caixa', descricao: 'Abrir caixa' },
  { id: 'pdv_fechar_caixa', categoria: 'Caixa', descricao: 'Fechar caixa' },
  { id: 'pdv_sangria', categoria: 'Caixa', descricao: 'Realizar sangria / suprimento' },
  { id: 'pdv_desconto', categoria: 'Caixa', descricao: 'Aplicar desconto em pedidos' },
  { id: 'pdv_cancelar_pedido', categoria: 'Pedidos', descricao: 'Cancelar pedido completo' },
  { id: 'pdv_cancelar_item', categoria: 'Pedidos', descricao: 'Cancelar item de pedido' },
  { id: 'pdv_editar_item_pos_kds', categoria: 'Pedidos', descricao: 'Editar item após envio ao KDS' },
  { id: 'pdv_estornar_pagamento', categoria: 'Pedidos', descricao: 'Estornar pagamento' },
  { id: 'garcom_fechar_mesa', categoria: 'Mesas', descricao: 'Fechar mesa e cobrar' },
  { id: 'garcom_transferir_mesa', categoria: 'Mesas', descricao: 'Transferir pedido entre mesas' },
  { id: 'cardapio_editar', categoria: 'Cardápio', descricao: 'Editar itens do cardápio' },
  { id: 'cardapio_alterar_preco', categoria: 'Cardápio', descricao: 'Alterar preços' },
  { id: 'estoque_movimentar', categoria: 'Estoque', descricao: 'Registrar movimentação de estoque' },
  { id: 'estoque_inventario', categoria: 'Estoque', descricao: 'Realizar inventário' },
  // Qualquer papel pode ter (dono, 2026-09-22): abre só a tela Receber mercadoria (/receber),
  // sem dar a página de Estoque — é o que o Caixa da loja precisa para receber fornecedor.
  { id: 'estoque_receber', categoria: 'Estoque', descricao: 'Receber mercadoria (tela do celular da loja)' },
  // Módulo Recebimentos e pagamentos (2026-09-24): qualquer papel pode pedir; o pedido só vira
  // conta a pagar quando quem tem "Aprovar" aprova (padrão: só o Admin).
  { id: 'pag_reembolso', categoria: 'Pedidos de pagamento', descricao: 'Pedir reembolso (gastou do próprio bolso)' },
  { id: 'pag_freelancer', categoria: 'Pedidos de pagamento', descricao: 'Pedir pagamento de freelancer' },
  { id: 'pag_fornecedor', categoria: 'Pedidos de pagamento', descricao: 'Pedir pagamento de fornecedor sem nota' },
  // 2026-09-28: link do produto (Mercado Livre etc.) → o dono autoriza e compra na conta da loja
  { id: 'pag_compra_online', categoria: 'Pedidos de pagamento', descricao: 'Pedir compra online (link do Mercado Livre, Shopee…)' },
  // 2026-09-30: boleto da VR/VA → dividir por funcionário (vai para RH › Benefícios ao aprovar)
  { id: 'pag_beneficio', categoria: 'Pedidos de pagamento', descricao: 'Pedir pagamento de benefício (boleto VR/VA dividido por funcionário)' },
  { id: 'pag_aprovar', categoria: 'Pedidos de pagamento', descricao: 'Aprovar pedidos de pagamento (vira conta a pagar)', somenteGerente: true },
  { id: 'kds_acessar', categoria: 'Cozinha', descricao: 'Acessar KDS (Display de Cozinha)' },
  { id: 'gestor_pedidos_acessar', categoria: 'Cozinha', descricao: 'Acessar Gestor de Pedidos' },
  { id: 'gestor_pedidos_entregar', categoria: 'Cozinha', descricao: 'Marcar pedidos como entregues no Gestor' },
  { id: 'relatorio_estoque', categoria: 'Estoque', descricao: 'Ver relatórios de estoque' },
  ...GESTAO_TELAS.map((t) => ({ id: t.key, categoria: 'Gestão', descricao: `Tela ${t.label}` })),
  ...FIN_ABAS.map((a) => ({ id: a.key, categoria: 'Financeiro', descricao: `Aba ${a.label}`, somenteGerente: true })),
  ...REL_ABAS.map((a) => ({ id: a.key, categoria: 'Relatórios', descricao: `Aba ${a.label}` })),
  { id: 'relatorio_financeiro', categoria: 'Marketing', descricao: 'Acessar Tráfego Pago' },
  { id: 'marketing_estudio', categoria: 'Marketing', descricao: 'Acessar Estúdio de Criação (artes)' },
  { id: 'clientes_ver', categoria: 'Clientes', descricao: 'Ver base de clientes (CRM)' },
  { id: 'usuarios_gerenciar', categoria: 'Usuários', descricao: 'Gerenciar usuários' },
  { id: 'configuracoes_editar', categoria: 'Configurações', descricao: 'Abrir a tela de Configurações' },
  // Aba a aba: sem `configuracoes_editar` nada disso aparece (a tela nem abre).
  // Qualquer papel pode receber (pedido do dono, 2026-09-21) — só a matriz de
  // Permissões continua sendo do Admin: quem a tem se dá qualquer outra permissão.
  ...CFG_ABAS.map((a) => ({
    id: a.key,
    categoria: 'Configurações',
    descricao: `Aba ${a.label}`,
    somenteAdmin: a.key === 'cfg_permissoes',
  })),
  // Fora das abas e sem trava de papel: dá acesso direto à configuração da
  // maquininha, sem abrir o resto de Estações & Pagamentos.
  { id: CFG_MAQUININHA_KEY, categoria: 'Configurações', descricao: 'Maquininha do balcão (Mercado Pago Point)' },
  { id: 'auditoria_ver', categoria: 'Auditoria', descricao: 'Ver log de auditoria' },
];
