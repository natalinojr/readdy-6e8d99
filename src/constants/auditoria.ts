export type SeveridadeAuditoria = 'info' | 'aviso' | 'critico';
export type TipoAcao =
  | 'desconto_aplicado' | 'desconto_negado' | 'desconto_solicitado'
  | 'item_cancelado' | 'pedido_cancelado'
  | 'sangria' | 'suprimento'
  | 'abertura_caixa' | 'fechamento_caixa'
  | 'sessao_aberta' | 'sessao_fechada'
  | 'preco_alterado' | 'item_editado'
  | 'usuario_criado' | 'usuario_editado' | 'usuario_desativado'
  | 'permissao_alterada' | 'treino_ativado' | 'treino_desativado'
  | 'estoque_ajustado' | 'perda_registrada' | 'estoque_entrada' | 'estoque_transferencia'
  | 'compra_registrada'
  | 'insumo_esgotado' | 'insumo_reposto'
  | 'acesso_login' | 'acesso_login_falhou' | 'acesso_logout'
  | 'mesa_transferida' | 'pedido_reaberto'
  | 'item_kds_editado' | 'item_kds_removido'
  | 'estorno_realizado'
  | 'voucher_emitido' | 'promocao_aplicada'
  | 'cancelamento_alto_valor' | 'multiplos_cancelamentos'
  | 'desconto_alto_valor' | 'sangria_alto_valor';

export interface EventoAuditoria {
  id: string;
  tipo: TipoAcao;
  severidade: SeveridadeAuditoria;
  usuario: string;
  perfil: string;
  descricao: string;
  entidade: string;
  entidadeId: string;
  data: string;
  hora: string;
  ip: string;
  antes?: Record<string, string | number>;
  depois?: Record<string, string | number>;
  detalhes?: string;
}

export const tipoAcaoConfig: Record<TipoAcao, { label: string; cor: string; bg: string; icone: string }> = {
  desconto_aplicado:     { label: 'Desconto aplicado',       cor: 'text-amber-700',   bg: 'bg-amber-50',   icone: 'ri-percent-line' },
  desconto_negado:       { label: 'Desconto negado',         cor: 'text-orange-600',  bg: 'bg-orange-50',  icone: 'ri-close-circle-line' },
  desconto_solicitado:   { label: 'Desconto solicitado',     cor: 'text-orange-500',  bg: 'bg-orange-50',  icone: 'ri-shield-keyhole-line' },
  item_cancelado:        { label: 'Item cancelado',          cor: 'text-orange-600',  bg: 'bg-orange-50',  icone: 'ri-delete-bin-line' },
  pedido_cancelado:      { label: 'Pedido cancelado',        cor: 'text-red-600',     bg: 'bg-red-50',     icone: 'ri-spam-2-line' },
  sangria:               { label: 'Sangria',                 cor: 'text-red-500',     bg: 'bg-red-50',     icone: 'ri-arrow-down-circle-line' },
  suprimento:            { label: 'Suprimento',              cor: 'text-emerald-600', bg: 'bg-emerald-50', icone: 'ri-arrow-up-circle-line' },
  abertura_caixa:        { label: 'Abertura de caixa',       cor: 'text-emerald-600', bg: 'bg-emerald-50', icone: 'ri-lock-unlock-line' },
  fechamento_caixa:      { label: 'Fechamento de caixa',     cor: 'text-sky-600',     bg: 'bg-sky-50',     icone: 'ri-lock-line' },
  sessao_aberta:         { label: 'Sessão aberta',           cor: 'text-emerald-600', bg: 'bg-emerald-50', icone: 'ri-play-circle-line' },
  sessao_fechada:        { label: 'Sessão fechada',          cor: 'text-zinc-500',    bg: 'bg-zinc-50',    icone: 'ri-stop-circle-line' },
  preco_alterado:        { label: 'Preço alterado',          cor: 'text-red-600',     bg: 'bg-red-50',     icone: 'ri-price-tag-3-line' },
  item_editado:          { label: 'Item editado',            cor: 'text-sky-600',     bg: 'bg-sky-50',     icone: 'ri-edit-line' },
  usuario_criado:        { label: 'Usuário criado',          cor: 'text-emerald-600', bg: 'bg-emerald-50', icone: 'ri-user-add-line' },
  usuario_editado:       { label: 'Usuário editado',         cor: 'text-sky-600',     bg: 'bg-sky-50',     icone: 'ri-user-settings-line' },
  usuario_desativado:    { label: 'Usuário desativado',      cor: 'text-red-600',     bg: 'bg-red-50',     icone: 'ri-user-unfollow-line' },
  permissao_alterada:    { label: 'Permissão alterada',      cor: 'text-violet-600',  bg: 'bg-violet-50',  icone: 'ri-shield-check-line' },
  treino_ativado:        { label: 'Modo treino ativado',     cor: 'text-amber-600',   bg: 'bg-amber-50',   icone: 'ri-graduation-cap-line' },
  treino_desativado:     { label: 'Modo treino desativado',  cor: 'text-zinc-500',    bg: 'bg-zinc-50',    icone: 'ri-graduation-cap-line' },
  estoque_ajustado:      { label: 'Estoque ajustado',        cor: 'text-amber-700',   bg: 'bg-amber-50',   icone: 'ri-stack-line' },
  perda_registrada:      { label: 'Perda registrada',        cor: 'text-orange-600',  bg: 'bg-orange-50',  icone: 'ri-alert-line' },
  estoque_entrada:       { label: 'Entrada de estoque',      cor: 'text-emerald-600', bg: 'bg-emerald-50', icone: 'ri-add-box-line' },
  compra_registrada:     { label: 'Compra registrada',       cor: 'text-sky-600',     bg: 'bg-sky-50',     icone: 'ri-shopping-cart-line' },
  estoque_transferencia: { label: 'Transferência estoque',   cor: 'text-sky-600',     bg: 'bg-sky-50',     icone: 'ri-send-plane-line' },
  insumo_esgotado:       { label: 'Insumo esgotado',         cor: 'text-red-600',     bg: 'bg-red-50',     icone: 'ri-error-warning-line' },
  insumo_reposto:        { label: 'Insumo reposto',          cor: 'text-emerald-600', bg: 'bg-emerald-50', icone: 'ri-checkbox-circle-line' },
  acesso_login:          { label: 'Login realizado',         cor: 'text-zinc-500',    bg: 'bg-zinc-50',    icone: 'ri-login-circle-line' },
  acesso_login_falhou:   { label: 'Tentativa falhou',        cor: 'text-red-600',     bg: 'bg-red-50',     icone: 'ri-shield-keyhole-line' },
  acesso_logout:         { label: 'Logout',                  cor: 'text-zinc-400',    bg: 'bg-zinc-50',    icone: 'ri-logout-circle-line' },
  mesa_transferida:      { label: 'Mesa transferida',        cor: 'text-sky-600',     bg: 'bg-sky-50',     icone: 'ri-swap-line' },
  pedido_reaberto:       { label: 'Pedido reaberto',         cor: 'text-violet-600',  bg: 'bg-violet-50',  icone: 'ri-refresh-line' },
  item_kds_editado:      { label: 'Item KDS editado',        cor: 'text-sky-600',     bg: 'bg-sky-50',     icone: 'ri-edit-box-line' },
  item_kds_removido:     { label: 'Item KDS removido',       cor: 'text-orange-600',  bg: 'bg-orange-50',  icone: 'ri-close-circle-line' },
  estorno_realizado:     { label: 'Estorno realizado',       cor: 'text-red-700',     bg: 'bg-red-50',     icone: 'ri-refund-2-line' },
  voucher_emitido:       { label: 'Voucher emitido',          cor: 'text-violet-600',  bg: 'bg-violet-50',  icone: 'ri-coupon-3-line' },
  promocao_aplicada:     { label: 'Promoção aplicada',        cor: 'text-amber-600',   bg: 'bg-amber-50',   icone: 'ri-price-tag-2-line' },
  cancelamento_alto_valor: { label: 'Cancelamento alto valor', cor: 'text-red-700',   bg: 'bg-red-50',     icone: 'ri-alarm-warning-line' },
  multiplos_cancelamentos: { label: 'Múltiplos cancelamentos', cor: 'text-red-700',   bg: 'bg-red-50',     icone: 'ri-spam-3-line' },
  desconto_alto_valor:   { label: 'Desconto alto valor',      cor: 'text-orange-700', bg: 'bg-orange-50',  icone: 'ri-alarm-warning-line' },
  sangria_alto_valor:    { label: 'Sangria alto valor',       cor: 'text-red-700',    bg: 'bg-red-50',     icone: 'ri-alarm-warning-line' },
};

export const tiposParaFiltro = [
  { id: 'todos',    label: 'Todos os tipos' },
  { id: 'caixa',   label: 'Caixa / Sessão',  tipos: ['abertura_caixa','fechamento_caixa','sangria','suprimento','sessao_aberta','sessao_fechada'] },
  { id: 'pedidos', label: 'Pedidos',          tipos: ['desconto_aplicado','desconto_negado','desconto_solicitado','item_cancelado','pedido_cancelado','pedido_reaberto','estorno_realizado','item_kds_editado','item_kds_removido'] },
  { id: 'cardapio',label: 'Cardápio',         tipos: ['preco_alterado','item_editado'] },
  { id: 'estoque', label: 'Estoque',          tipos: ['estoque_ajustado','perda_registrada','estoque_entrada','estoque_transferencia','insumo_esgotado','insumo_reposto','compra_registrada'] },
  { id: 'usuarios',label: 'Usuários',         tipos: ['usuario_criado','usuario_editado','usuario_desativado','permissao_alterada','treino_ativado','treino_desativado'] },
  { id: 'acesso',  label: 'Acesso',           tipos: ['acesso_login','acesso_login_falhou','acesso_logout'] },
  { id: 'mesas',   label: 'Mesas',            tipos: ['mesa_transferida'] },
  { id: 'alertas', label: 'Alertas',          tipos: ['cancelamento_alto_valor','multiplos_cancelamentos','desconto_alto_valor','sangria_alto_valor','acesso_login_falhou'] },
  { id: 'vouchers',label: 'Vouchers/Promoções', tipos: ['voucher_emitido','promocao_aplicada'] },
];

// Thresholds para alertas automáticos
export const ALERT_THRESHOLDS = {
  cancelamentoAltoValor: 100,   // R$ 100 ou mais
  descontoAltoValor: 50,        // R$ 50 ou mais
  sangriaAltoValor: 500,        // R$ 500 ou mais
  multiploCancelamentosMin: 3,  // 3+ cancelamentos em 30 min
};
