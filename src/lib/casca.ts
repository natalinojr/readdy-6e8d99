// Regras puras da casca nova (2026-10-05): barra de baixo do celular por papel, busca do "Ir para…"
// e qual tela/grupo está aberto. A lista de telas vem de src/constants/telas.ts (já filtrada por quem vê).
import { TELAS, type Tela, type GrupoId } from '@/constants/telas';

/** Barra de baixo por papel: 4 telas + "Mais". O 3º é sempre o Lançar (o "+"). */
const BARRA_POR_PAPEL: Record<string, string[]> = {
  admin: ['hoje', 'dashboard', 'lancar', 'financeiro'],
  gerente: ['hoje', 'dashboard', 'lancar', 'financeiro'],
  supervisao: ['hoje', 'pdv-caixa', 'lancar', 'pedidos'],
  caixa: ['pdv-caixa', 'hoje', 'lancar', 'receber'],
};
const BARRA_PADRAO = ['hoje', 'pedidos', 'lancar', 'pdv-caixa'];

/** Rótulo curto na barra (o nome inteiro não cabe em 1/5 da tela). */
const ROTULO_BARRA: Record<string, string> = {
  'pdv-caixa': 'Caixa',
  receber: 'Recebimentos',
  'gestor-pedidos': 'Cozinha',
  'gestor-entregas': 'Entregas',
  'config-delivery': 'Delivery próprio',
  'pdv-garcom': 'Garçom',
  'pdv-delivery': 'Telefone',
  autoatendimento: 'Totem',
  'trafego-pago': 'Tráfego',
  estudio: 'Estúdio',
  clientes: 'Clientes',
  configuracoes: 'Ajustes',
  'admin-master': 'Admin',
  pendencias: 'Pendências',
  relatorios: 'Relatórios',
};

export interface BotaoBarra {
  tela: Tela;
  rotulo: string;
  /** O "+" do meio (Lançar). */
  meio: boolean;
}

/**
 * Os botões da barra de baixo (sem o "Mais", que é sempre o último). Tela que a pessoa não vê vira o
 * próximo item visível do catálogo (depois dela, na ordem do menu) que ainda não está na barra.
 * Se o Lançar não estiver liberado, o "+" some (não vira outra tela).
 */
export function montarBarra(perfil: string | null | undefined, visiveis: Tela[], catalogo: Tela[] = TELAS): BotaoBarra[] {
  const desejo = (perfil && BARRA_POR_PAPEL[perfil]) || BARRA_PADRAO;
  const visivel = new Set(visiveis.map((t) => t.id));
  const usados = new Set<string>();
  // Primeiro reserva as que a pessoa vê, para a troca não pegar uma que já vem depois.
  for (const id of desejo) if (visivel.has(id)) usados.add(id);
  const saida: BotaoBarra[] = [];
  for (const id of desejo) {
    let tela: Tela | undefined;
    if (visivel.has(id)) {
      tela = catalogo.find((t) => t.id === id);
    } else if (id !== 'lancar') {
      const i = catalogo.findIndex((t) => t.id === id);
      const ordem = [...catalogo.slice(i + 1), ...catalogo.slice(0, Math.max(i, 0))];
      tela = ordem.find((t) => visivel.has(t.id) && !usados.has(t.id) && t.id !== 'lancar');
      if (tela) usados.add(tela.id);
    }
    if (!tela) continue;
    saida.push({ tela, rotulo: ROTULO_BARRA[tela.id] ?? tela.rotulo, meio: tela.id === 'lancar' });
  }
  return saida;
}

/** Sem acento e minúsculas, para a busca. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Busca do "Ir para…": rótulo primeiro, depois apelido, depois a descrição. Vazio = a lista inteira. */
export function buscarTelas<T extends Pick<Tela, 'rotulo' | 'descricao' | 'apelidos'>>(q: string, telas: T[]): T[] {
  const s = normalizar(q);
  if (!s) return telas;
  const pontos = (t: T): number => {
    const r = normalizar(t.rotulo);
    if (r === s) return 100;
    if (r.startsWith(s)) return 80;
    if (r.split(/[\s&·]+/).some((p) => p.startsWith(s))) return 70;
    const ap = (t.apelidos ?? []).map(normalizar);
    if (ap.some((a) => a === s)) return 60;
    if (ap.some((a) => a.startsWith(s) || a.split(' ').some((p) => p.startsWith(s)))) return 50;
    if (r.includes(s)) return 40;
    if (s.length >= 3 && ap.some((a) => a.includes(s))) return 30;
    if (s.length >= 3 && normalizar(t.descricao).includes(s)) return 10;
    return 0;
  };
  return telas
    .map((t, i) => ({ t, i, p: pontos(t) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.t);
}

/** A tela do catálogo que corresponde à rota aberta (o prefixo mais longo). */
export function telaDaRota(pathname: string, telas: Tela[] = TELAS): Tela | null {
  let melhor: Tela | null = null;
  for (const t of telas) {
    if (pathname === t.rota || pathname.startsWith(t.rota + '/')) {
      if (!melhor || t.rota.length > melhor.rota.length) melhor = t;
    }
  }
  return melhor;
}

/** Grupo aberto no menu: o da tela atual (ou o Hoje, quando a tela não está no catálogo). */
export function grupoDaRota(pathname: string, telas: Tela[] = TELAS): GrupoId {
  return telaDaRota(pathname, telas)?.grupo ?? 'hoje';
}
