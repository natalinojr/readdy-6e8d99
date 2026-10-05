// Painel de senhas na TV (/senhas/<token>) — lógica pura, sem tela.
// A Edge `senhas-tv` devolve só NÚMEROS de senha; nada de nome de cliente, item ou valor.

export interface SenhaPronta { senha: string; desde: string | null }
export interface PainelSenhas {
  loja: { nome: string; cor: string | null; logo: string | null };
  tenantId: string;
  preparando: string[];
  prontas: SenhaPronta[]; // mais recente primeiro
}
export type RespostaPainel =
  | { status: 'ok'; painel: PainelSenhas }
  | { status: 'desligado'; lojaNome: string | null }
  | { status: 'invalido' }
  | { status: 'erro' };

const FORMATO_SENHA = /^[A-Za-z]{0,2}-?[0-9]{1,6}$/;

const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze',
  'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 313 → "trezentos e treze". Aceita 0 a 999.999 (acima disso devolve os dígitos). */
export function numeroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999999) return String(n);
  if (n < 20) return UNIDADES[n];
  if (n < 100) {
    const d = Math.floor(n / 10), u = n % 10;
    return u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d];
  }
  if (n === 100) return 'cem';
  if (n < 1000) {
    const c = Math.floor(n / 100), r = n % 100;
    return r ? `${CENTENAS[c]} e ${numeroPorExtenso(r)}` : CENTENAS[c];
  }
  const m = Math.floor(n / 1000), r = n % 1000;
  const mil = m === 1 ? 'mil' : `${numeroPorExtenso(m)} mil`;
  if (!r) return mil;
  // "mil e cem", "mil e vinte" | "mil duzentos e trinta"
  return `${mil}${r < 100 || r % 100 === 0 ? ' e ' : ' '}${numeroPorExtenso(r)}`;
}

/** "313" → "trezentos e treze"; "P-14" → "P catorze". Fora do formato, lê como está. */
export function senhaPorExtenso(senha: string): string {
  const s = (senha ?? '').trim();
  const m = /^([A-Za-z]{0,2})-?([0-9]{1,6})$/.exec(s);
  if (!m) return s;
  const numero = numeroPorExtenso(parseInt(m[2], 10));
  return m[1] ? `${m[1].toUpperCase().split('').join(' ')} ${numero}` : numero;
}

/** Frase da chamada: "Senha trezentos e treze". */
export function fraseChamada(senha: string): string {
  return `Senha ${senhaPorExtenso(senha)}`;
}

/** Senhas que apareceram em "pode retirar" desde a leitura anterior (a TV só fala essas). */
export function novasProntas(anteriores: ReadonlySet<string>, atuais: readonly string[]): string[] {
  return atuais.filter((s) => !anteriores.has(s));
}

function listaSenhas(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    const s = String((it as { senha?: unknown })?.senha ?? '').trim();
    if (FORMATO_SENHA.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Lê a resposta da Edge. Só aceita senha no formato 300 / P-14 (guarda extra contra nome por engano). */
export function lerRespostaPainel(raw: unknown): RespostaPainel {
  const r = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (r.status === 'invalido') return { status: 'invalido' };
  if (r.status === 'desligado') return { status: 'desligado', lojaNome: typeof r.loja?.nome === 'string' ? r.loja.nome : null };
  if (r.status !== 'ok' || typeof r.tenant_id !== 'string') return { status: 'erro' };
  const prontas: SenhaPronta[] = [];
  if (Array.isArray(r.prontas)) {
    for (const p of r.prontas) {
      const s = String(p?.senha ?? '').trim();
      if (FORMATO_SENHA.test(s) && !prontas.some((x) => x.senha === s)) prontas.push({ senha: s, desde: typeof p?.desde === 'string' ? p.desde : null });
    }
  }
  const prontasSet = new Set(prontas.map((p) => p.senha));
  return {
    status: 'ok',
    painel: {
      tenantId: r.tenant_id,
      loja: {
        nome: typeof r.loja?.nome === 'string' && r.loja.nome ? r.loja.nome : 'Senhas',
        cor: typeof r.loja?.cor === 'string' ? r.loja.cor : null,
        logo: typeof r.loja?.logo === 'string' && r.loja.logo ? r.loja.logo : null,
      },
      // uma senha não aparece nas duas colunas
      preparando: listaSenhas(r.preparando).filter((s) => !prontasSet.has(s)),
      prontas,
    },
  };
}

/** Branco ou quase preto, o que ler melhor sobre a cor da loja (luminância WCAG). */
export function corTextoSobre(hex: string | null | undefined): string {
  const h = (hex ?? '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return '#FFFFFF';
  const n = parseInt(h.slice(1), 16);
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.4 ? '#1F1A14' : '#FFFFFF';
}

/** Hora e data da TV, sempre em Brasília. */
export function horaDaTv(d: Date): { hora: string; data: string } {
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const data = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
  return { hora, data };
}

/** Quantas senhas cabem na coluna "Preparando" e em quantas colunas (mais senhas = número menor). */
export function layoutPreparando(total: number): { colunas: 2 | 3; max: number; fonte: number } {
  return total <= 8 ? { colunas: 2, max: 8, fonte: 56 } : { colunas: 3, max: 15, fonte: 42 };
}

/** Link público do painel. */
export function caminhoTvSenhas(token: string): string {
  return `/senhas/${token}`;
}
