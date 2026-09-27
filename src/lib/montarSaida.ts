// Delivery Fase 3 — "Montar saída" no Gestor de Entregas. SEMPRE sugestão: o gestor confirma (ou muda) com um clique.
// Regras puras (sem rede), testadas em src/test/lib/montarSaida.test.ts.
//
// 1. Candidatos: pedidos PRONTOS, sem entregador e sem fase do motoboy, com coordenada.
// 2. Semente = o mais urgente (prazo = criação + SLA). Junta o vizinho mais perto da última parada enquanto
//    ele estiver a até `raioKm` e nenhuma parada da saída estourar o prazo por causa dele (máx. `maxParadas`).
// 3. Ordem das paradas: vizinho mais próximo a partir da loja. Tempo estimado em linha reta × fator de ruas.
// 4. Motoboy sugerido: o livre (GPS recente, sem entrega em andamento) mais perto da loja.

export interface PontoGeo { lat: number; lng: number }

export interface PedidoSaida extends PontoGeo {
  id: string;
  number: string;
  cliente: string;
  created_at: string;
  /** Prazo de entrega em minutos a partir da criação (null = sem prazo) */
  sla_min: number | null;
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
}

export interface OpcoesSaida {
  raioKm?: number;
  maxParadas?: number;
  kmh?: number;
  fatorRuas?: number;
  minPorParada?: number;
  /** Tempo até o motoboy sair da loja com os pedidos (buscar + conferir) */
  minSaida?: number;
}

const PADRAO: Required<OpcoesSaida> = { raioKm: 2.5, maxParadas: 3, kmh: 25, fatorRuas: 1.3, minPorParada: 3, minSaida: 5 };

export function distKm(a: PontoGeo, b: PontoGeo): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const prazoMs = (p: PedidoSaida) => (p.sla_min ? new Date(p.created_at).getTime() + p.sla_min * 60000 : Infinity);

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
  let min = o.minSaida;
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

/**
 * Monta as sugestões de saída. `loja` null (loja sem pin no mapa) = a rota começa na 1ª parada.
 * Cada motoboy livre é sugerido no máximo uma vez; sem motoboy livre a sugestão vem sem motoboy (gestor escolhe).
 */
export function montarSaidas(pedidos: PedidoSaida[], motoboys: MotoboyLivre[], loja: PontoGeo | null, agora: number, opcoes: OpcoesSaida = {}): SugestaoSaida[] {
  const o = { ...PADRAO, ...opcoes };
  const resto = [...pedidos].sort((a, b) => prazoMs(a) - prazoMs(b) || a.created_at.localeCompare(b.created_at));
  const livres = [...motoboys];
  const saidas: SugestaoSaida[] = [];

  while (resto.length) {
    const grupo = [resto.shift()!];
    while (grupo.length < o.maxParadas && resto.length) {
      const ultimo = grupo[grupo.length - 1];
      let melhor = -1;
      for (let i = 0; i < resto.length; i++) {
        if (distKm(ultimo, resto[i]) > o.raioKm) continue;
        if (melhor < 0 || distKm(ultimo, resto[i]) < distKm(ultimo, resto[melhor])) melhor = i;
      }
      if (melhor < 0) break;
      const teste = [...grupo, resto[melhor]];
      const origemT = loja ?? teste[0];
      const antes = simular(origemT, ordenarParadas(origemT, grupo), agora, o).paradas.filter((p) => p.atrasa).length;
      const depois = simular(origemT, ordenarParadas(origemT, teste), agora, o).paradas.filter((p) => p.atrasa).length;
      // Só junta se não fizer nenhum pedido a mais estourar o prazo
      if (depois > antes) break;
      grupo.push(resto.splice(melhor, 1)[0]);
    }
    const origem = loja ?? grupo[0];
    const ordem = ordenarParadas(origem, grupo);
    const sim = simular(origem, ordem, agora, o);
    let motoboy: MotoboyLivre | null = null;
    let motoboyKm: number | null = null;
    if (livres.length) {
      const ref = loja ?? ordem[0];
      livres.sort((a, b) => distKm(a, ref) - distKm(b, ref));
      motoboy = livres.shift()!;
      motoboyKm = Math.round(distKm(motoboy, ref) * 10) / 10;
    }
    saidas.push({ ...sim, motoboy, motoboyKm, mapsUrl: linkMaps(loja, ordem) });
  }
  return saidas;
}
