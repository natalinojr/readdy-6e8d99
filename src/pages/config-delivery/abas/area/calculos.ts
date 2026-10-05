// Contas puras das abas "Área e taxa" e "Mínimo e retirada" (sem tela, sem banco: dá para testar).
// Espelham o que o servidor faz em delivery-write (quoteFromTiers, freteGratis, ROAD_FACTOR) — se a regra
// de lá mudar, mude aqui junto.
import type { FaixaEntrega } from '../../config';

/** Faixas válidas (km > 0), da mais perto para a mais longe — a mesma lista que o servidor usa. */
export function faixasValidas(faixas: FaixaEntrega[]): FaixaEntrega[] {
  return faixas.filter((f) => f.ate_km > 0).slice().sort((a, b) => a.ate_km - b.ate_km);
}

export function faixasIguais(a: FaixaEntrega[], b: FaixaEntrega[]): boolean {
  return JSON.stringify(faixasValidas(a)) === JSON.stringify(faixasValidas(b));
}

/** Ponto de partida quando a loja não tem nenhuma faixa. */
export const FAIXAS_INICIAIS: FaixaEntrega[] = [
  { ate_km: 2, taxa: 6, tempo_max_min: 40 },
  { ate_km: 4, taxa: 9, tempo_max_min: 50 },
];

/** "+ Faixa": um km a mais que a última, taxa R$ 1 maior, mesmo prazo. Sem faixa nenhuma, começa em 2 km. */
export function proximaFaixa(faixas: FaixaEntrega[]): FaixaEntrega {
  const v = faixasValidas(faixas);
  if (v.length === 0) return { ...FAIXAS_INICIAIS[0] };
  const u = v[v.length - 1];
  return {
    ate_km: Math.round((u.ate_km + 1) * 100) / 100,
    taxa: Math.round((u.taxa + 1) * 100) / 100,
    tempo_max_min: u.tempo_max_min,
  };
}

/** Em qual faixa o km cai (como no servidor: km <= ate_km). Além da última: `dentro` false, com a última faixa. */
export function faixaDoKm(km: number, faixas: FaixaEntrega[]): { faixa: FaixaEntrega; dentro: boolean } | null {
  const v = faixasValidas(faixas);
  if (v.length === 0) return null;
  for (const f of v) if (km <= f.ate_km) return { faixa: f, dentro: true };
  return { faixa: v[v.length - 1], dentro: false };
}

/** Taxa e prazo de um km, com as faixas dadas (usado quando as faixas da tela ainda não foram salvas). */
export function cotarComFaixas(km: number, faixas: FaixaEntrega[], prazoExtraMin = 0):
  { taxa: number; ateKm: number; tempoMax: number; dentro: boolean } | null {
  const r = faixaDoKm(km, faixas);
  if (!r) return null;
  return { taxa: r.faixa.taxa, ateKm: r.faixa.ate_km, tempoMax: r.faixa.tempo_max_min + Math.max(0, prazoExtraMin), dentro: r.dentro };
}

/** A taxa do servidor usa o caminho de moto; sem a rota, ele estima a linha reta × 1,3. */
export const FATOR_CAMINHO = 1.3;

/** Distância em linha reta (km) entre dois pontos. */
export function distanciaKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ponto a `raioM` metros do centro, na direção `graus` (0 = norte, 90 = leste). Para pôr o rótulo na borda do círculo. */
export function pontoNaBorda(lat: number, lng: number, raioM: number, graus: number): [number, number] {
  const rad = (graus * Math.PI) / 180;
  const dLat = (raioM * Math.cos(rad)) / 111320;
  const dLng = (raioM * Math.sin(rad)) / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lat + dLat, lng + dLng];
}

/** 2,8 · 3 · 2,25 (até 2 casas, vírgula) */
export function kmTxt(n: number, casas = 2): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
}

/** "6 km" · "6 e 7 km" · "6, 7 e 10 km" */
export function listaKm(kms: number[]): string {
  const t = kms.map((k) => kmTxt(k));
  if (t.length <= 1) return `${t[0] ?? ''} km`;
  return `${t.slice(0, -1).join(', ')} e ${t[t.length - 1]} km`;
}

export interface UsoFaixas {
  /** Quantos pedidos caíram em cada linha (mesma ordem da lista que veio). */
  contagem: number[];
  /** Linha com o mesmo km de outra que vem antes. */
  duplicada: boolean[];
  /** Pedidos além da última faixa (de quando as faixas eram outras). */
  fora: number;
  /** Pedidos com distância. */
  total: number;
}

/** Quantos pedidos (pela distância de rota, em km) caíram em cada linha de faixa. Linha com 0 km não recebe nada. */
export function usoPorLinha(faixas: FaixaEntrega[], kms: number[]): UsoFaixas {
  const km = kms.filter((k) => Number.isFinite(k) && k > 0);
  const valida = faixas.map((f) => f.ate_km > 0);
  const duplicada = faixas.map((f, i) => valida[i] && faixas.some((g, j) => j < i && g.ate_km === f.ate_km));
  const maior = faixas.reduce((m, f) => (f.ate_km > m ? f.ate_km : m), 0);
  const contagem = faixas.map((f, i) => {
    if (!valida[i] || duplicada[i]) return 0;
    const anterior = faixas.reduce((m, g) => (g.ate_km > 0 && g.ate_km < f.ate_km && g.ate_km > m ? g.ate_km : m), 0);
    return km.filter((k) => k > anterior && k <= f.ate_km).length;
  });
  return { contagem, duplicada, fora: maior > 0 ? km.filter((k) => k > maior).length : 0, total: km.length };
}

/** Avisos de cada linha (não bloqueiam o salvar). */
export function avisosDasLinhas(faixas: FaixaEntrega[]): string[][] {
  const uso = usoPorLinha(faixas, []);
  return faixas.map((f, i) => {
    if (!(f.ate_km > 0)) return ['Faixa com 0 km: será ignorada ao salvar.'];
    if (uso.duplicada[i]) return [`Já existe outra faixa até ${kmTxt(f.ate_km)} km.`];
    // faixa anterior = a de maior km que ainda é menor que esta (a primeira, se houver repetidas)
    const a = faixas
      .filter((g, j) => g.ate_km > 0 && g.ate_km < f.ate_km && !uso.duplicada[j])
      .reduce<FaixaEntrega | null>((m, g) => (!m || g.ate_km > m.ate_km ? g : m), null);
    const avisos: string[] = [];
    if (a && f.taxa < a.taxa) avisos.push(`A taxa é menor que a da faixa de ${kmTxt(a.ate_km)} km.`);
    if (a && f.tempo_max_min < a.tempo_max_min) avisos.push(`O prazo é menor que o da faixa de ${kmTxt(a.ate_km)} km.`);
    return avisos;
  });
}

/** Km das faixas que não tiveram pedido (só as válidas e sem repetição). Vazio quando não há pedido nenhum. */
export function faixasSemPedido(faixas: FaixaEntrega[], uso: UsoFaixas): number[] {
  if (uso.total === 0) return [];
  return faixas
    .map((f, i) => ({ f, i }))
    .filter(({ f, i }) => f.ate_km > 0 && !uso.duplicada[i] && uso.contagem[i] === 0)
    .map(({ f }) => f.ate_km)
    .sort((a, b) => a - b);
}

/** "95% dos pedidos até 3 km": a menor faixa que reúne pelo menos 90% dos pedidos (ou a última, com a porcentagem real). */
export function resumoDistancia(kms: number[], faixas: FaixaEntrega[]): { pct: number; ateKm: number; total: number } | null {
  const km = kms.filter((k) => Number.isFinite(k) && k > 0).sort((a, b) => a - b);
  if (km.length === 0) return null;
  const v = faixasValidas(faixas);
  if (v.length === 0) {
    const p90 = km[Math.min(km.length - 1, Math.ceil(km.length * 0.9) - 1)];
    return { pct: Math.round((km.filter((k) => k <= p90).length / km.length) * 100), ateKm: Math.ceil(p90 * 10) / 10, total: km.length };
  }
  for (const f of v) {
    const cum = km.filter((k) => k <= f.ate_km).length;
    if (cum / km.length >= 0.9) return { pct: Math.round((cum / km.length) * 100), ateKm: f.ate_km, total: km.length };
  }
  const u = v[v.length - 1];
  return { pct: Math.round((km.filter((k) => k <= u.ate_km).length / km.length) * 100), ateKm: u.ate_km, total: km.length };
}

/**
 * Quanto do mapa mostrar: "perto" cobre as faixas que reúnem quase todos os pedidos (no mínimo as duas primeiras);
 * "tudo" vai até a última faixa. Valores em km, já com uma folga para o rótulo caber.
 */
export function raiosDoMapa(faixas: FaixaEntrega[], kms: number[]): { pertoKm: number; tudoKm: number } {
  const v = faixasValidas(faixas);
  const km = kms.filter((k) => Number.isFinite(k) && k > 0);
  if (v.length === 0) {
    const m = km.length ? Math.max(...km) : 3;
    const r = Math.max(2, Math.min(m, 10)) * 1.1;
    return { pertoKm: r, tudoKm: r };
  }
  const minimo = v[Math.min(1, v.length - 1)].ate_km;
  const res = resumoDistancia(km, v);
  const perto = Math.max(minimo, res ? res.ateKm : minimo);
  const tudo = v[v.length - 1].ate_km;
  return { pertoKm: Math.min(perto, tudo) * 1.12, tudoKm: tudo * 1.08 };
}

// ── Pedido mínimo ────────────────────────────────────────────────────────────

/** Exemplo de sacola para a prévia do cliente: ~83% do mínimo, em múltiplos de 10 centavos. */
export function previaMinimo(minimo: number): { sacola: number; falta: number; pct: number } {
  const minC = Math.round(minimo * 100);
  const sacolaC = Math.max(0, Math.round((minC * 0.83) / 10) * 10);
  const faltaC = Math.max(0, minC - sacolaC);
  return { sacola: sacolaC / 100, falta: faltaC / 100, pct: minC > 0 ? Math.round((sacolaC / minC) * 100) : 0 };
}

// ── Entrega grátis acima de um valor ─────────────────────────────────────────

export interface PedidoSimulado { subtotal: number; taxa: number; km: number | null }

/** O servidor (freteGratis em delivery-write) em uma linha: base = soma dos itens; ate_km 0 = qualquer distância da área. */
export function ganhariaFreteGratis(p: PedidoSimulado, acimaDe: number, ateKm: number): boolean {
  if (!(acimaDe > 0)) return false;
  if (p.subtotal + 0.005 < acimaDe) return false;
  if (ateKm > 0 && (p.km == null || p.km > ateKm)) return false;
  return true;
}

/** Com os pedidos entregues do mês: quantos teriam ganhado e quanto de taxa a loja deixaria de cobrar. */
export function simularFreteGratis(pedidos: PedidoSimulado[], acimaDe: number, ateKm: number): { n: number; total: number; taxaAbrir: number } {
  let n = 0; let taxaCents = 0;
  for (const p of pedidos) {
    if (!ganhariaFreteGratis(p, acimaDe, ateKm)) continue;
    n += 1;
    taxaCents += Math.round((Number.isFinite(p.taxa) ? p.taxa : 0) * 100);
  }
  return { n, total: pedidos.length, taxaAbrir: taxaCents / 100 };
}
