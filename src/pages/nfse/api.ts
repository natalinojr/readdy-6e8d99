// Módulo "Notas de Serviço" (NFS-e pelo Emissor Nacional). Tipos, chamadas à Edge nfse-write e utilitários.
// Leitura: tabelas nfse_* direto (RLS por membro da empresa). Gravação de empresa/certificado/notas: só pela Edge.
import { supabase } from '@/lib/supabase';

export interface Empresa {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  inscricao_municipal: string | null;
  cod_municipio: string;
  municipio_nome: string | null;
  uf: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  fone: string | null;
  email: string | null;
  op_simp_nac: 1 | 2 | 3;
  reg_ap_trib_sn: 1 | 2 | 3 | null;
  reg_esp_trib: number;
  ambiente: 1 | 2;
  serie: number;
  proximo_dps_producao: number;
  proximo_dps_testes: number;
  aliquota_simples: number | null;
  cert_titular: string | null;
  cert_documento: string | null;
  cert_validade: string | null;
  cert_atualizado_em: string | null;
}
// nfse_empresas não libera select(*) (ids do Vault ficam de fora): sempre listar as colunas.
export const EMPRESA_COLS = 'id, cnpj, razao_social, nome_fantasia, inscricao_municipal, cod_municipio, municipio_nome, uf, cep, logradouro, numero, complemento, bairro, fone, email, op_simp_nac, reg_ap_trib_sn, reg_esp_trib, ambiente, serie, proximo_dps_producao, proximo_dps_testes, aliquota_simples, cert_titular, cert_documento, cert_validade, cert_atualizado_em';

export interface Tomador {
  id: string;
  empresa_id: string;
  documento: string;
  nome: string;
  inscricao_municipal: string | null;
  email: string | null;
  fone: string | null;
  cep: string | null;
  cod_municipio: string | null;
  municipio_nome: string | null;
  uf: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
}

export interface Servico {
  id: string;
  empresa_id: string;
  nome: string;
  c_trib_nac: string;
  c_trib_mun: string | null;
  c_nbs: string | null;
  descricao: string;
  aliquota_iss: number | null;
  valor_padrao: number | null;
  ativo: boolean;
}

export type StatusNota = 'processando' | 'autorizada' | 'rejeitada' | 'erro' | 'cancelada';
export interface ErroSefin { codigo: string | null; descricao: string; complemento?: string | null }

export interface Nota {
  id: string;
  empresa_id: string;
  ambiente: 1 | 2;
  status: StatusNota;
  serie: number;
  numero_dps: number;
  id_dps: string;
  competencia: string;
  dh_emissao: string;
  tomador_id: string | null;
  tomador: { documento: string; nome: string; email?: string | null; municipio?: string | null; uf?: string | null } | null;
  servico_id: string | null;
  c_trib_nac: string;
  c_trib_mun: string | null;
  c_nbs: string | null;
  descricao: string;
  cod_municipio_prestacao: string;
  valor_servico: number;
  desconto_incondicionado: number | null;
  aliquota_iss: number | null;
  iss_retido: boolean;
  info_complementar: string | null;
  chave_acesso: string | null;
  numero_nfse: string | null;
  dh_processamento: string | null;
  xml_nfse: string | null;
  alertas: unknown;
  erros: ErroSefin[] | null;
  cancelada_em: string | null;
  cancel_codigo: string | null;
  cancel_motivo: string | null;
  created_at: string;
}
export const NOTA_COLS_LISTA = 'id, empresa_id, ambiente, status, serie, numero_dps, id_dps, competencia, dh_emissao, tomador_id, tomador, servico_id, c_trib_nac, c_trib_mun, c_nbs, descricao, cod_municipio_prestacao, valor_servico, desconto_incondicionado, aliquota_iss, iss_retido, info_complementar, chave_acesso, numero_nfse, dh_processamento, alertas, erros, cancelada_em, cancel_codigo, cancel_motivo, created_at';

export interface Membro { user_id: string; papel: 'admin' | 'emissor'; nome: string | null; email: string | null; tem_modulo: boolean; eu: boolean }

export const STATUS_LABEL: Record<StatusNota, string> = {
  processando: 'Processando',
  autorizada: 'Autorizada',
  rejeitada: 'Rejeitada',
  erro: 'Sem resposta',
  cancelada: 'Cancelada',
};
export const STATUS_CLASS: Record<StatusNota, string> = {
  processando: 'bg-sky-50 text-sky-700 border-sky-200',
  autorizada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejeitada: 'bg-red-50 text-red-700 border-red-200',
  erro: 'bg-amber-50 text-amber-700 border-amber-200',
  cancelada: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

/**
 * Chama a Edge nfse-write SEM retry automático: repetir "emitir" depois de um erro de rede
 * poderia gerar duas notas. Sempre devolve o JSON da Edge (mesmo em HTTP 4xx/5xx).
 */
export async function nfseCall<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}):
  Promise<T & { success: boolean; error?: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { success: false, error: 'Sessão expirada. Entre de novo.' } as T & { success: boolean; error?: string };
  const url = `${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/nfse-write`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action, ...body }),
    });
    const j = await r.json().catch(() => null);
    if (!j) return { success: false, error: `Resposta inválida do servidor (HTTP ${r.status})` } as T & { success: boolean; error?: string };
    return j;
  } catch (e) {
    return { success: false, error: `Sem conexão com o servidor: ${(e as Error).message}`, rede: true } as unknown as T & { success: boolean; error?: string };
  }
}

// ─── Formatação ──────────────────────────────────────────────────────────────
export const soDigitos = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');
export function fmtDoc(v: string | null | undefined) {
  const d = soDigitos(v);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return v ?? '';
}
export const fmtCep = (v: string | null | undefined) => soDigitos(v).replace(/^(\d{5})(\d{3})$/, '$1-$2');
export const fmtBRL = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtData = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—';
export const fmtDataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtChave = (c: string | null | undefined) => (c ? c.replace(/(\d{5})(?=\d)/g, '$1 ') : '—');

export function cnpjValido(c: string) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const calc = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = base.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(c.slice(0, 12));
  return c.endsWith(`${d1}${calc(c.slice(0, 12) + d1)}`);
}
export function cpfValido(c: string) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (base: string, peso: number) => {
    const r = (base.split('').reduce((s, d, i) => s + Number(d) * (peso - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(c.slice(0, 9), 10);
  return c.endsWith(`${d1}${dv(c.slice(0, 9) + d1, 11)}`);
}

/** Endereço pelo CEP (ViaCEP, grátis) — traz também o código IBGE do município que a NFS-e exige. */
export async function buscarCep(cep: string): Promise<{ logradouro: string; bairro: string; municipio_nome: string; uf: string; cod_municipio: string } | null> {
  const d = soDigitos(cep);
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    const j = await r.json();
    if (!j || j.erro) return null;
    return { logradouro: j.logradouro ?? '', bairro: j.bairro ?? '', municipio_nome: j.localidade ?? '', uf: j.uf ?? '', cod_municipio: String(j.ibge ?? '') };
  } catch {
    return null;
  }
}

export const inputCls = 'w-full h-10 px-3 rounded-xl border border-zinc-200 text-sm text-zinc-800 focus:outline-none focus:border-sky-400 disabled:bg-zinc-50 disabled:text-zinc-400';
export const labelCls = 'block text-xs font-semibold text-zinc-600 mb-1';

export function lerArquivoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

export function baixarTexto(nome: string, conteudo: string, tipo = 'application/xml') {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
