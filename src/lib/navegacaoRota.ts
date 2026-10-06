// Navegação do motoboy dentro do app: a rota vem pronta do servidor (motoboy-signal › navegar, ORS);
// aqui só se acompanha o GPS sobre a linha — onde ele está, a próxima manobra e quanto falta.

export type LatLng = [number, number];

export interface PassoRota { texto: string; tipo: number; distancia_m: number; duracao_s: number; ini: number; fim: number }
export interface PernaRota { parada_id: string | null; distancia_m: number; duracao_s: number; passos: PassoRota[] }

/** Distância em metros entre dois pontos (haversine). */
export function distM(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Distância acumulada (m) do início da linha até cada ponto. */
export function acumulado(linha: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < linha.length; i++) out.push(out[i - 1] + distM(linha[i - 1], linha[i]));
  return out;
}

export interface Projecao {
  /** Índice do trecho (linha[idx] → linha[idx+1]) onde o motoboy está. */
  idx: number;
  /** Metros percorridos ao longo da linha até a projeção. */
  percorrido: number;
  /** Distância (m) do GPS até a linha — fora da rota quando grande. */
  fora: number;
}

function projetarNoTrecho(a: LatLng, b: LatLng, p: LatLng): { t: number; d: number } {
  // Plano local em metros (cidade: erro desprezível)
  const kx = Math.cos(p[0] * Math.PI / 180) * 111320, ky = 110540;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky;
  const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const x = ax + t * dx, y = ay + t * dy;
  return { t, d: Math.sqrt(x * x + y * y) };
}

/**
 * Projeta o GPS na linha. Procura primeiro a partir de onde ele estava (`desde`), para não
 * "pular" para um trecho anterior quando a rota passa duas vezes pela mesma rua; se ficou
 * longe de tudo dali para frente, procura na linha inteira.
 */
export function projetar(linha: LatLng[], cum: number[], p: LatLng, desde = 0): Projecao | null {
  if (linha.length < 2) return null;
  const buscar = (de: number): Projecao => {
    let melhor: Projecao = { idx: de, percorrido: cum[de], fora: Infinity };
    for (let i = de; i < linha.length - 1; i++) {
      const { t, d } = projetarNoTrecho(linha[i], linha[i + 1], p);
      if (d < melhor.fora) melhor = { idx: i, percorrido: cum[i] + t * (cum[i + 1] - cum[i]), fora: d };
    }
    return melhor;
  };
  const inicio = Math.max(0, Math.min(desde - 2, linha.length - 2));
  const frente = buscar(inicio);
  if (frente.fora <= 60 || inicio === 0) return frente;
  const tudo = buscar(0);
  return tudo.fora < frente.fora ? tudo : frente;
}

export interface Orientacao {
  /** Próxima manobra (texto do ORS, em português) e o tipo (ícone). */
  texto: string;
  tipo: number;
  /** Metros até a próxima manobra. */
  emM: number;
  /** Até a parada atual (fim da 1ª perna). */
  faltaM: number;
  faltaS: number;
}

/** Próxima manobra e quanto falta até a 1ª parada, a partir da projeção. */
export function orientar(perna: PernaRota, cum: number[], proj: Projecao): Orientacao | null {
  const passos = perna.passos;
  if (!passos.length) return null;
  const fimPerna = passos[passos.length - 1].fim;
  const faltaM = Math.max(0, (cum[fimPerna] ?? cum[cum.length - 1]) - proj.percorrido);
  const faltaS = perna.distancia_m > 0 ? Math.round(perna.duracao_s * (faltaM / perna.distancia_m)) : 0;
  // Passo em que ele está: a manobra que interessa é a do passo SEGUINTE (acontece no fim deste).
  let atual = passos.findIndex((s) => proj.idx >= s.ini && proj.idx < s.fim);
  if (atual < 0) atual = proj.idx >= fimPerna ? passos.length - 1 : 0;
  const prox = passos[Math.min(atual + 1, passos.length - 1)];
  const emM = Math.max(0, (cum[passos[atual].fim] ?? 0) - proj.percorrido);
  return { texto: prox.texto, tipo: prox.tipo, emM: atual + 1 >= passos.length ? faltaM : emM, faltaM, faltaS };
}

/** "350 m" / "1,2 km". */
export function textoDistancia(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

/** Ícone (Remix) para o tipo de manobra do ORS. */
export function iconeManobra(tipo: number): string {
  switch (tipo) {
    case 0: case 2: return 'ri-corner-up-left-line';
    case 1: case 3: return 'ri-corner-up-right-line';
    case 4: case 12: return 'ri-arrow-left-up-line';
    case 5: case 13: return 'ri-arrow-right-up-line';
    case 7: case 8: return 'ri-refresh-line';
    case 9: return 'ri-arrow-go-back-line';
    case 10: return 'ri-flag-2-fill';
    default: return 'ri-arrow-up-line';
  }
}
