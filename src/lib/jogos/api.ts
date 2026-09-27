// Chamadas públicas da Edge Function `jogos` (ranking semanal). Sem login.
export type CredencialJogo =
  | { tipo: 'mesa'; participant_id: string; access_token: string }
  | { tipo: 'delivery'; order_number: string };

export interface ConfigJogos {
  ranking_ativo: boolean;
  jogos: string[];
  premios: { posicao: number; descricao: string }[];
  regras: string;
  termina_em: string;
}

export interface LinhaRanking { posicao: number; nome: string; final: string; pontos: number; eu: boolean }

export interface Jogador { nome: string; telefone: string }

function url(): string {
  return String(import.meta.env.VITE_PUBLIC_SUPABASE_URL || '') + '/functions/v1/jogos';
}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const r = await fetch(url(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const data = await r.json().catch(function () { return {}; });
  if (!r.ok || data.error) throw new Error(data.message || 'Não foi possível falar com o ranking.');
  return data as T;
}

export function configJogos(tenantId: string) {
  return chamar<ConfigJogos>({ action: 'config', tenant_id: tenantId });
}

export function comecarPartida(tenantId: string, jogo: string, jogador: Jogador, credencial: CredencialJogo) {
  return chamar<{ sessao: string; semente: number }>({
    action: 'start', tenant_id: tenantId, jogo, nome: jogador.nome, telefone: jogador.telefone, credencial,
  });
}

export function enviarPartida(tenantId: string, sessao: string, entradas: number[]) {
  return chamar<{ pontos: number; melhor: number; posicao: number | null; jogadores: number; top: LinhaRanking[] }>({
    action: 'submit', tenant_id: tenantId, sessao, entradas,
  });
}

export function rankingJogo(tenantId: string, jogo: string, telefone: string) {
  return chamar<{ ranking_ativo: boolean; top: LinhaRanking[]; eu: { posicao: number; pontos: number } | null; jogadores: number; termina_em: string }>({
    action: 'ranking', tenant_id: tenantId, jogo, telefone,
  });
}

const CHAVE = 'erpos_jogo_jogador';
export function lerJogador(): Jogador | null {
  try {
    const j = JSON.parse(window.localStorage.getItem(CHAVE) || 'null');
    return j && j.nome && j.telefone ? j : null;
  } catch { return null; }
}
export function gravarJogador(j: Jogador | null) {
  try {
    if (j) window.localStorage.setItem(CHAVE, JSON.stringify(j));
    else window.localStorage.removeItem(CHAVE);
  } catch { /* sem armazenamento: pergunta de novo na próxima vez */ }
}

export function soDigitos(v: string): string {
  return String(v || '').replace(/\D/g, '');
}

/** Ainda pode jogar? Só com pedido em andamento; quando é entregue, o jogo para. */
export function direitoJogar(tenantId: string, credencial: CredencialJogo) {
  return chamar<{ pode_jogar: boolean; motivo?: 'sem_pedido' | 'entregue'; mensagem?: string }>({
    action: 'direito', tenant_id: tenantId, credencial,
  });
}
