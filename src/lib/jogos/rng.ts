// Sorteio determinístico dos jogos (mulberry32). A mesma semente gera sempre a mesma
// fase — é o que permite refazer a partida a partir dos toques gravados e conferir a
// pontuação fora do celular (ranking da Fase 3).
export function proximo(estado: { rng: number }): number {
  estado.rng = (estado.rng + 0x6d2b79f5) | 0;
  let t = estado.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function entre(estado: { rng: number }, min: number, max: number): number {
  return min + proximo(estado) * (max - min);
}

export function novaSemente(): number {
  return (Math.random() * 4294967296) >>> 0;
}
