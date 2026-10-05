// Regra do acerto dos entregadores (delivery_config.acerto_motoboy) — tipos e leitura/normalização.
// O valor de cada entrega é calculado e congelado pelo banco (gatilho trg_delivery_driver_ledger).

// diaria_mais_faixa_km (2026-10-05, pedido do dono): diária por dia trabalhado + valor da entrega pela faixa de km.
export type ModoAcerto = 'por_entrega' | 'faixa_km' | 'diaria_mais_entrega' | 'diaria_mais_faixa_km' | 'percentual_taxa';
/** Modos que pagam a entrega pela faixa de km / que pagam diária. */
export const MODOS_FAIXA_KM: ModoAcerto[] = ['faixa_km', 'diaria_mais_faixa_km'];
export const MODOS_COM_DIARIA: ModoAcerto[] = ['diaria_mais_entrega', 'diaria_mais_faixa_km'];

export interface AcertoCfg {
  ativo: boolean;
  modo: ModoAcerto;
  valor_entrega: number;
  faixas: { ate_km: number; valor: number }[];
  diaria: number;
  percentual: number;
}

export const ACERTO_PADRAO: AcertoCfg = { ativo: false, modo: 'por_entrega', valor_entrega: 0, faixas: [], diaria: 0, percentual: 0 };

const num = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0; };

/** Lê o que está salvo (tolerante a campos faltando/strings). */
export function lerAcertoCfg(raw: unknown): AcertoCfg {
  if (!raw || typeof raw !== 'object') return { ...ACERTO_PADRAO };
  const r = raw as Record<string, unknown>;
  const modos: ModoAcerto[] = ['por_entrega', 'faixa_km', 'diaria_mais_entrega', 'diaria_mais_faixa_km', 'percentual_taxa'];
  return {
    ativo: r.ativo === true,
    modo: modos.includes(r.modo as ModoAcerto) ? (r.modo as ModoAcerto) : 'por_entrega',
    valor_entrega: num(r.valor_entrega),
    faixas: Array.isArray(r.faixas) ? (r.faixas as { ate_km: unknown; valor: unknown }[]).map((f) => ({ ate_km: num(f?.ate_km), valor: num(f?.valor) })) : [],
    diaria: num(r.diaria),
    percentual: Math.min(100, num(r.percentual)),
  };
}

/** Normaliza para salvar (faixas válidas e ordenadas por km). */
export function acertoParaSalvar(c: AcertoCfg): AcertoCfg {
  return {
    ...c,
    valor_entrega: Math.round(num(c.valor_entrega) * 100) / 100,
    diaria: Math.round(num(c.diaria) * 100) / 100,
    percentual: Math.min(100, num(c.percentual)),
    faixas: c.faixas.filter((f) => f.ate_km > 0).map((f) => ({ ate_km: num(f.ate_km), valor: Math.round(num(f.valor) * 100) / 100 }))
      .sort((a, b) => a.ate_km - b.ate_km),
  };
}
