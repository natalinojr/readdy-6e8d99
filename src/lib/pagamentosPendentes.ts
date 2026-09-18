/**
 * Reenvio do Pagamento Rápido após falha parcial: descobre quais formas ainda
 * precisam ser gravadas num pedido, pulando as que já foram gravadas numa
 * tentativa anterior (mesma forma, mesmo valor ±0,01, nos últimos 30 min).
 * Cada pagamento existente é consumido no máximo uma vez (2 formas iguais de
 * mesmo valor exigem 2 linhas já gravadas para serem puladas).
 */
export interface PagamentoPlanejado {
  formaId: string;
  valor: number;
}

export interface PagamentoExistente {
  payment_method_id: string | null;
  amount: number | string | null;
  created_at: string | null;
}

export const JANELA_REENVIO_MS = 30 * 60 * 1000;

/** Retorna os índices (em `planejados`) que ainda faltam gravar. */
export function indicesPagamentosFaltantes(
  planejados: PagamentoPlanejado[],
  existentes: PagamentoExistente[] | null | undefined,
  agoraMs: number = Date.now(),
  janelaMs: number = JANELA_REENVIO_MS,
): number[] {
  const usados = new Set<number>();
  const recentes = (existentes ?? [])
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => {
      if (!p.created_at) return false;
      const t = Date.parse(p.created_at);
      return Number.isFinite(t) && agoraMs - t <= janelaMs;
    });

  const faltantes: number[] = [];
  planejados.forEach((pag, j) => {
    const achado = recentes.find(
      ({ p, idx }) =>
        !usados.has(idx) &&
        p.payment_method_id === pag.formaId &&
        Math.abs(Number(p.amount) - pag.valor) <= 0.01 + 1e-9,
    );
    if (achado) usados.add(achado.idx);
    else faltantes.push(j);
  });
  return faltantes;
}
