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
  /** Jogos são só do clube: loja sem clube ligado não mostra os jogos */
  clube_ativo: boolean;
  slug: string | null;
}

export interface LinhaRanking { posicao: number; nome: string; final: string; pontos: number; eu: boolean }

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

export function comecarPartida(tenantId: string, jogo: string, clubeToken: string, credencial: CredencialJogo) {
  return chamar<{ sessao: string; semente: number }>({
    action: 'start', tenant_id: tenantId, jogo, clube_token: clubeToken, credencial,
  });
}

export function enviarPartida(tenantId: string, sessao: string, entradas: number[]) {
  return chamar<{ pontos: number; melhor: number; posicao: number | null; jogadores: number; top: LinhaRanking[] }>({
    action: 'submit', tenant_id: tenantId, sessao, entradas,
  });
}

export function rankingJogo(tenantId: string, jogo: string, clubeToken: string | null) {
  return chamar<{ ranking_ativo: boolean; top: LinhaRanking[]; eu: { posicao: number; pontos: number } | null; jogadores: number; termina_em: string }>({
    action: 'ranking', tenant_id: tenantId, jogo, clube_token: clubeToken,
  });
}

export function soDigitos(v: string): string {
  return String(v || '').replace(/\D/g, '');
}

/** Ainda pode jogar? Só membro do clube com pedido em andamento; entregou, o jogo para. */
export function direitoJogar(tenantId: string, credencial: CredencialJogo, clubeToken: string | null) {
  return chamar<{ pode_jogar: boolean; motivo?: 'sem_pedido' | 'entregue' | 'sem_clube'; mensagem?: string }>({
    action: 'direito', tenant_id: tenantId, credencial, clube_token: clubeToken,
  });
}
