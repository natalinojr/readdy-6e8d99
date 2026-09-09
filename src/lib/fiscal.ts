// Constantes e tipos do módulo fiscal (NFC-e) compartilhados pelas telas.

export interface ItemFiscal {
  ncm?: string | null;
  cest?: string | null;
  cfop?: number | null;
  csosn?: string | null;
  origem?: number | null;
  codTributacao?: string | null;
  gtin?: string | null;
}

export interface CategoriaFiscal {
  ncm?: string | null;
  cest?: string | null;
  cfop?: number | null;
  csosn?: string | null;
  codTributacao?: string | null;
}

export interface FiscalSettingsRow {
  tenant_id: string;
  enabled: boolean;
  provider: string;
  has_token?: boolean;
  environment: number;
  razao_social: string | null;
  inscricao_estadual: string | null;
  crt: number;
  endereco_logradouro: string | null;
  endereco_numero: string | null;
  endereco_bairro: string | null;
  endereco_municipio: string | null;
  endereco_uf: string | null;
  endereco_cep: string | null;
  codigo_municipio_ibge: string | null;
  natureza_operacao: string;
  ncm_padrao: string;
  cfop_padrao: number;
  csosn_padrao: string;
  cst_icms_padrao: string | null;
  icms_aliquota_padrao: number | null;
  origem_padrao: number;
  pis_cst_padrao: string;
  cofins_cst_padrao: string;
  cod_tributacao_padrao: string | null;
  serie: number | null;
  print_danfe: boolean;
  danfe_printer_id: string | null;
  emit_on_delivery: boolean;
  emit_on_counter: boolean;
  emit_on_table_close: boolean;
}

export type FiscalDocStatus = 'pending' | 'processing' | 'authorized' | 'rejected' | 'cancelled' | 'error' | 'skipped';

export interface FiscalDocumentRow {
  id: string;
  tenant_id: string;
  model: number;
  status: FiscalDocStatus;
  source_type: 'order' | 'table_session' | 'payment_group';
  source_id: string;
  order_ids: string[];
  order_number: string | null;
  environment: number;
  total_amount: number;
  customer_cpf: string | null;
  customer_name: string | null;
  serie: number | null;
  numero: number | null;
  chave: string | null;
  protocolo: string | null;
  sefaz_status_code: number | null;
  sefaz_message: string | null;
  qr_code: string | null;
  url_chave: string | null;
  error_message: string | null;
  attempts: number;
  emitted_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  printed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABEL: Record<FiscalDocStatus, string> = {
  pending: 'Pendente',
  processing: 'Emitindo',
  authorized: 'Autorizada',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
  error: 'Erro',
  skipped: 'Ignorada',
};

export const STATUS_CLASS: Record<FiscalDocStatus, string> = {
  pending: 'bg-zinc-100 text-zinc-600',
  processing: 'bg-blue-50 text-blue-600',
  authorized: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-600',
  cancelled: 'bg-zinc-200 text-zinc-600 line-through',
  error: 'bg-amber-50 text-amber-700',
  skipped: 'bg-zinc-50 text-zinc-400',
};

/** Código fiscal da forma de pagamento (tPag da NFC-e). */
export const TPAG_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Automático (pelo tipo)' },
  { value: '01', label: '01 - Dinheiro' },
  { value: '03', label: '03 - Cartão de Crédito' },
  { value: '04', label: '04 - Cartão de Débito' },
  { value: '17', label: '17 - PIX' },
  { value: '10', label: '10 - Vale Alimentação' },
  { value: '11', label: '11 - Vale Refeição' },
  { value: '05', label: '05 - Crédito Loja / Crediário' },
  { value: '12', label: '12 - Vale Presente' },
  { value: '16', label: '16 - Depósito bancário' },
  { value: '18', label: '18 - Transferência' },
  { value: '19', label: '19 - Cashback / Crédito virtual' },
  { value: '02', label: '02 - Cheque' },
  { value: '15', label: '15 - Boleto' },
  { value: '99', label: '99 - Outros' },
];

export const TPAG_AUTO: Record<string, string> = {
  dinheiro: '01 Dinheiro', credito: '03 Crédito', debito: '04 Débito', pix: '17 PIX', vale: '11 Vale Refeição',
};

/** CSOSN (Simples Nacional) mais comuns no varejo de alimentação. */
export const CSOSN_OPTIONS: { value: string; label: string }[] = [
  { value: '102', label: '102 - Tributada pelo Simples sem permissão de crédito' },
  { value: '101', label: '101 - Tributada pelo Simples com permissão de crédito' },
  { value: '103', label: '103 - Isenção do ICMS no Simples (faixa de receita)' },
  { value: '300', label: '300 - Imune' },
  { value: '400', label: '400 - Não tributada pelo Simples' },
  { value: '500', label: '500 - ICMS cobrado anteriormente por ST (bebidas, cigarros)' },
  { value: '900', label: '900 - Outros' },
];

/** CST ICMS (regime normal). */
export const CST_ICMS_OPTIONS: { value: string; label: string }[] = [
  { value: '00', label: '00 - Tributada integralmente' },
  { value: '20', label: '20 - Com redução de base de cálculo' },
  { value: '40', label: '40 - Isenta' },
  { value: '41', label: '41 - Não tributada' },
  { value: '60', label: '60 - ICMS cobrado anteriormente por ST' },
  { value: '90', label: '90 - Outras' },
];

export const CFOP_OPTIONS: { value: number; label: string }[] = [
  { value: 5102, label: '5102 - Venda de mercadoria adquirida de terceiros' },
  { value: 5101, label: '5101 - Venda de produção do estabelecimento' },
  { value: 5405, label: '5405 - Venda de mercadoria sujeita a ST (substituído)' },
  { value: 5403, label: '5403 - Venda de mercadoria sujeita a ST (substituto)' },
];

export const ORIGEM_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '0 - Nacional' },
  { value: 1, label: '1 - Estrangeira (importação direta)' },
  { value: 2, label: '2 - Estrangeira (adquirida no mercado interno)' },
];

/** NCMs sugeridos para o varejo de alimentação. */
export const NCM_SUGESTOES: { value: string; label: string }[] = [
  { value: '21069090', label: '2106.90.90 - Preparações alimentícias (pratos, lanches)' },
  { value: '19059090', label: '1905.90.90 - Pães, salgados, pastéis, tortas' },
  { value: '22021000', label: '2202.10.00 - Refrigerantes e águas com açúcar' },
  { value: '22019000', label: '2201.90.00 - Água mineral sem gás' },
  { value: '22011000', label: '2201.10.00 - Água mineral com gás' },
  { value: '22030000', label: '2203.00.00 - Cerveja' },
  { value: '22089000', label: '2208.90.00 - Destilados e drinks (tequila, vodka etc.)' },
  { value: '22042100', label: '2204.21.00 - Vinho' },
  { value: '22029900', label: '2202.99.00 - Sucos e bebidas não alcoólicas' },
  { value: '21011110', label: '2101.11.10 - Café solúvel / bebidas de café' },
  { value: '21050010', label: '2105.00.10 - Sorvete' },
  { value: '18063100', label: '1806.31.00 - Chocolates e sobremesas de chocolate' },
];

export const formatChave = (chave: string | null) => (chave ? chave.replace(/(\d{4})(?=\d)/g, '$1 ') : '');
export const formatCpfCnpj = (d: string | null) => {
  if (!d) return '';
  const s = d.replace(/\D/g, '');
  if (s.length === 11) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  if (s.length === 14) return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
  return d;
};
export const formatBRL = (n: number | string | null | undefined) => `R$ ${Number(n ?? 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
