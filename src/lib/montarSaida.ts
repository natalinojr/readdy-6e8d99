// Delivery Fase 3 — "Montar saída" no Gestor de Entregas. SEMPRE sugestão: o gestor confirma (ou muda) com um clique.
// Regras puras (sem rede), testadas em src/test/lib/montarSaida.test.ts.
//
// 1. Candidatos: pedidos PRONTOS, sem entregador e sem fase do motoboy, com coordenada.
// 2. Semente = o mais urgente (prazo = criação + SLA). Junta o vizinho mais perto da última parada enquanto
//    ele estiver a até `raioKm` e nenhuma parada da saída estourar o prazo por causa dele (máx. `maxParadas`).
// 3. Ordem das paradas: vizinho mais próximo a partir da loja. Tempo estimado em linha reta × fator de ruas.
// 4. Motoboy sugerido: o livre (GPS recente, sem entrega em andamento) mais perto da loja.
// 5. Encaixar: motoboy que já tem pedido e AINDA NÃO SAIU da loja recebe primeiro os prontos perto de qualquer
//    parada dele (mesmas regras de raio, prazo e máx. de paradas). Os pedidos que já eram dele não saem.
// 6. Esperar: para cada saída, o pedido ainda na cozinha (com previsão de pronto em até `maxEsperaMin`) perto de
//    alguma parada e que não faz ninguém a mais atrasar vira uma OPÇÃO — a saída só sai depois que ele ficar pronto.

export interface PontoGeo { lat: number; lng: number }

export interface PedidoSaida extends PontoGeo {
  id: string;
  number: string;
  cliente: string;
  created_at: string;
  /** Prazo de entrega em minutos a partir da criação (null = sem prazo) */
  sla_min: number | null;
  /** Ainda na cozinha: quando deve ficar pronto (ms). A saída só sai depois disso. */
  prontoEm?: number | null;
}

/** Motoboy que já tem pedido(s) e ainda não saiu da loja */
export interface SaidaAberta { driver_id: string; nome: string; pedidos: PedidoSaida[] }

/** Pedido na cozinha que dá para a saída esperar */
export interface EsperaSaida {
  pedido: PedidoSaida;
  /** Minutos até ficar pronto (mín. 1) */
  esperaMin: number;
  /** Parada mais perto dele e a distância (km, linha reta) */
  perto: PedidoSaida;
  distKm: number;
}

export interface MotoboyLivre extends PontoGeo {
  driver_id: string;
  nome: string;
}

export interface Parada { pedido: PedidoSaida; chegadaMin: number; atrasa: boolean }

export interface SugestaoSaida {
  paradas: Parada[];
  km: number;
  minutos: number;
  motoboy: MotoboyLivre | null;
  /** Distância (km, linha reta) do motoboy sugerido até a loja */
  motoboyKm: number | null;
  mapsUrl: string;
  /** Saída de motoboy que já tinha pedido e não saiu: `fixos` já eram dele */
  encaixe?: { driver_id: string; nome: string; fixos: string[] };
  /** Opcional: pedido na cozinha que dá para esperar sem atrasar ninguém */
  espera?: EsperaSaida | null;
}

export interface OpcoesSaida {
  raioKm?: number;
  maxParadas?: number;
  kmh?: number;
  fatorRuas?: number;
  minPorParada?: number;
  /** Tempo até o motoboy sair da loja com os pedidos (buscar + conferir) */
  minSaida?: number;
  /** Quanto a saída pode esperar um pedido que ainda está na cozinha */
  maxEsperaMin?: number;
}

export const OPCOES_SAIDA: Required<OpcoesSaida> = { raioKm: 2.5, maxParadas: 3, kmh: 25, fatorRuas: 1.3, minPorParada: 3, minSaida: 5, maxEsperaMin: 8 };
const PADRAO = OPCOES_SAIDA;

export function distKm(a: PontoGeo, b: PontoGeo): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const prazoMs = (p: PedidoSaida) => (p.sla_min ? new Date(p.created_at).getTime() + p.sla_min * 60000 : Infinity);

/** Minutos até o pedido ficar pronto (0 = já pronto ou previsão vencida) */
export function esperaMin(p: PedidoSaida, agora: number): number {
  return p.prontoEm ? Math.max(0, Math.ceil((p.prontoEm - agora) / 60000)) : 0;
}

/** Minutos até a saída sair da loja: buscar + conferir, ou esperar o último pedido da cozinha (+2 para pegar). */
export function minutosAteSair(ordem: PedidoSaida[], agora: number, o: Required<OpcoesSaida> = PADRAO): number {
  const espera = Math.max(0, ...ordem.map((p) => esperaMin(p, agora)));
  return espera > 0 ? Math.max(o.minSaida, espera + 2) : o.minSaida;
}

const pertoDoGrupo = (grupo: PedidoSaida[], p: PedidoSaida) => Math.min(...grupo.map((g) => distKm(g, p)));

/** Ordena as paradas pelo vizinho mais próximo a partir da origem. */
export function ordenarParadas(origem: PontoGeo, pedidos: PedidoSaida[]): PedidoSaida[] {
  const resto = [...pedidos];
  const out: PedidoSaida[] = [];
  let atual: PontoGeo = origem;
  while (resto.length) {
    let melhor = 0;
    for (let i = 1; i < resto.length; i++) if (distKm(atual, resto[i]) < distKm(atual, resto[melhor])) melhor = i;
    const [p] = resto.splice(melhor, 1);
    out.push(p);
    atual = p;
  }
  return out;
}

/** Simula a saída: chegada de cada parada (min a partir de agora) e se estoura o prazo. */
export function simular(origem: PontoGeo, ordem: PedidoSaida[], agora: number, o: Required<OpcoesSaida>) {
  let min = minutosAteSair(ordem, agora, o);
  let km = 0;
  let atual: PontoGeo = origem;
  const paradas: Parada[] = ordem.map((p) => {
    const d = distKm(atual, p) * o.fatorRuas;
    km += d;
    min += (d / o.kmh) * 60;
    const chegadaMin = Math.round(min);
    min += o.minPorParada;
    atual = p;
    return { pedido: p, chegadaMin, atrasa: agora + chegadaMin * 60000 > prazoMs(p) };
  });
  return { paradas, km: Math.round(km * 10) / 10, minutos: Math.round(min - o.minPorParada) };
}

export function linkMaps(origem: PontoGeo | null, ordem: PontoGeo[]): string {
  if (!ordem.length) return '';
  const f = (p: PontoGeo) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const destino = ordem[ordem.length - 1];
  const meio = ordem.slice(0, -1);
  const q = new URLSearchParams({ api: '1', destination: f(destino), travelmode: 'driving' });
  if (origem) q.set('origin', f(origem));
  if (meio.length) q.set('waypoints', meio.map(f).join('|'));
  return 'https://www.google.com/maps/dir/?' + q.toString();
}

const atrasos = (origem: PontoGeo, grupo: PedidoSaida[], agora: number, o: Required<OpcoesSaida>) =>
  simular(origem, ordenarParadas(origem, grupo), agora, o).paradas.filter((p) => p.atrasa).length;

/**
 * Junta ao grupo o candidato mais perto (pela função `dist`) enquanto couber, estiver no raio e não fizer
 * nenhuma parada a mais estourar o prazo. Tira de `resto` o que entrou.
 */
function juntar(grupo: PedidoSaida[], resto: PedidoSaida[], loja: PontoGeo | null, agora: number, o: Required<OpcoesSaida>,
  dist: (grupo: PedidoSaida[], p: PedidoSaida) => number) {
  while (grupo.length < o.maxParadas && resto.length) {
    let melhor = -1;
    let melhorD = Infinity;
    for (let i = 0; i < resto.length; i++) {
      const d = dist(grupo, resto[i]);
      if (d > o.raioKm) continue;
      if (d < melhorD) { melhor = i; melhorD = d; }
    }
    if (melhor < 0) break;
    const teste = [...grupo, resto[melhor]];
    const origemT = loja ?? teste[0];
    // Só junta se não fizer nenhum pedido a mais estourar o prazo
    if (atrasos(origemT, teste, agora, o) > atrasos(origemT, grupo, agora, o)) break;
    grupo.push(resto.splice(melhor, 1)[0]);
  }
}

/**
 * Monta as sugestões de saída. `loja` null (loja sem pin no mapa) = a rota começa na 1ª parada.
 * Cada motoboy livre é sugerido no máximo uma vez; sem motoboy livre a sugestão vem sem motoboy (gestor escolhe).
 * `abertas`: motoboys com pedido que ainda não saíram (recebem encaixe primeiro). `emPreparo`: pedidos na cozinha,
 * sem entregador, com previsão de pronto — viram a opção "esperar" de no máximo uma saída cada.
 */
export function montarSaidas(pedidos: PedidoSaida[], motoboys: MotoboyLivre[], loja: PontoGeo | null, agora: number, opcoes: OpcoesSaida = {},
  extras: { abertas?: SaidaAberta[]; emPreparo?: PedidoSaida[] } = {}): SugestaoSaida[] {
  const o = { ...PADRAO, ...opcoes };
  const resto = [...pedidos].sort((a, b) => prazoMs(a) - prazoMs(b) || a.created_at.localeCompare(b.created_at));
  const livres = [...motoboys];
  const saidas: SugestaoSaida[] = [];
  const fechar = (grupo: PedidoSaida[]) => {
    const origem = loja ?? grupo[0];
    const ordem = ordenarParadas(origem, grupo);
    return { ...simular(origem, ordem, agora, o), mapsUrl: linkMaps(loja, ordem) };
  };

  // 1. Encaixar nos motoboys que ainda não saíram (o mais urgente primeiro)
  const urgencia = (ab: SaidaAberta) => Math.min(...ab.pedidos.map(prazoMs));
  for (const ab of [...(extras.abertas ?? [])].filter((a) => a.pedidos.length).sort((a, b) => urgencia(a) - urgencia(b))) {
    const grupo = [...ab.pedidos];
    juntar(grupo, resto, loja, agora, o, pertoDoGrupo);
    if (grupo.length === ab.pedidos.length) continue; // nada perto para encaixar
    saidas.push({ ...fechar(grupo), motoboy: null, motoboyKm: null, encaixe: { driver_id: ab.driver_id, nome: ab.nome, fixos: ab.pedidos.map((p) => p.id) } });
  }

  // 2. Saídas novas com os prontos que sobraram
  while (resto.length) {
    const grupo = [resto.shift()!];
    juntar(grupo, resto, loja, agora, o, (g, p) => distKm(g[g.length - 1], p));
    const sim = fechar(grupo);
    let motoboy: MotoboyLivre | null = null;
    let motoboyKm: number | null = null;
    if (livres.length) {
      const ref = loja ?? sim.paradas[0].pedido;
      livres.sort((a, b) => distKm(a, ref) - distKm(b, ref));
      motoboy = livres.shift()!;
      motoboyKm = Math.round(distKm(motoboy, ref) * 10) / 10;
    }
    saidas.push({ ...sim, motoboy, motoboyKm });
  }

  // 3. Opção de esperar um pedido da cozinha (cada um em uma saída só)
  const cozinha = (extras.emPreparo ?? []).filter((p) => p.prontoEm && esperaMin(p, agora) <= o.maxEsperaMin);
  for (const s of saidas) {
    const grupo = s.paradas.map((p) => p.pedido);
    if (grupo.length >= o.maxParadas || !cozinha.length) continue;
    const origem = loja ?? grupo[0];
    const base = s.paradas.filter((p) => p.atrasa).length;
    let melhor: EsperaSaida | null = null;
    for (const c of cozinha) {
      const perto = grupo.reduce((a, b) => (distKm(b, c) < distKm(a, c) ? b : a));
      const d = distKm(perto, c);
      if (d > o.raioKm || (melhor && d >= melhor.distKm)) continue;
      if (atrasos(origem, [...grupo, c], agora, o) > base) continue;
      melhor = { pedido: c, esperaMin: Math.max(1, esperaMin(c, agora)), perto, distKm: d };
    }
    if (melhor) {
      s.espera = { ...melhor, distKm: Math.round(melhor.distKm * 10) / 10 };
      cozinha.splice(cozinha.indexOf(melhor.pedido), 1);
    }
  }
  return saidas;
}
