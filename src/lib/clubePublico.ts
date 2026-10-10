// Clube de fidelidade do lado do cliente (sem login no ERPOS): página /clube/<loja>,
// checkout do delivery e pedido pela mesa (QR). Fala com a Edge Function
// `clube-publico`. O "cartão do clube" é um token guardado no aparelho, por loja.
import type { ClubeResumo, ClubeReserva } from './fidelidade';

export interface ClubeProgramaPublico {
  nome: string;
  /** WhatsApp da loja para o cliente salvar nos contatos (com DDI). */
  contato?: { nome: string; whatsapp: string } | null;
  pontos: { pontos_por_real: number; pedido_minimo: number; validade_meses: number; bonus_cadastro: number; bonus_aniversario: number; canais: Record<string, boolean> } | null;
  niveis: { id: string; nome: string; emoji: string; cor: string; min_compras: number; multiplicador: number; beneficios: string }[];
  janela_dias: number;
  recompensas: { id: string; nome: string; tipo: string; valor: number; custo_pontos: number; foto: string | null; preco: number | null; nivel_minimo: string | null }[];
  roleta: { a_cada_compras: number; primeira_compra?: boolean; pedido_acima_de: number; ao_subir_nivel: boolean; aniversario: boolean; premios: string[]; fatias: { id: string; nome: string; cor: string; peso: number }[] } | null;
}

export interface ClubeExtratoLinha { tipo: string; pontos: number; texto: string; data: string; vence: string | null; reservado: boolean }

export interface ClubeDados {
  token?: string;
  resumo: ClubeResumo;
  extrato: ClubeExtratoLinha[];
  programa: ClubeProgramaPublico | null;
  loja: { nome?: string; slug?: string; tenant_id?: string };
}

export async function clubeChamar<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string; message?: string }> {
  const base = ((import.meta.env.VITE_PUBLIC_SUPABASE_URL as string) || '').replace(/\/$/, '');
  const anon = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;
  try {
    const res = await fetch(`${base}/functions/v1/clube-publico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T & { error?: string; message?: string };
  } catch {
    return { error: 'sem_conexao', message: 'Sem conexão. Tente de novo.' } as T & { error: string; message: string };
  }
}

// O cartão fica por LOJA (tenant_id): a mesma pessoa pode ser de duas lojas.
const chave = (tenantId: string) => `clube:${tenantId}`;

export function clubeTokenSalvo(tenantId: string | null | undefined): string | null {
  if (!tenantId) return null;
  try { return localStorage.getItem(chave(tenantId)); } catch { return null; }
}

export function clubeSalvarToken(tenantId: string, token: string | null) {
  try {
    if (token) localStorage.setItem(chave(tenantId), token);
    else localStorage.removeItem(chave(tenantId));
  } catch { /* modo anônimo: fica só nesta tela */ }
}

export type { ClubeResumo, ClubeReserva };
