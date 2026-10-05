// "Vem aí — próximos 14 dias" da tela Hoje (2026-10-05): a conta que transforma o que a RPC
// fn_hoje_vem_ai devolve (contas por loja e dia, certificados, conexões, datas especiais do delivery) nas
// linhas que o dono lê, dia a dia. Sem tela e sem banco aqui — só regra, para teste.
//
// Regra do destaque âmbar ("acima do que costuma entrar"): o sistema só tem uma referência do que entra
// por dia, a META DE VENDAS por dia da semana (dashboard_metas). O dia sai em âmbar quando o total das
// contas passa da soma das metas das lojas olhadas naquele dia da semana. Sem meta em nenhuma loja,
// só o total aparece (não inventa referência).

export interface ContaDia {
  tenant_id: string; loja: string; dia: string; total: number; qtd: number;
  guias_total: number; guias: Array<{ descricao: string; valor: number }>;
  folha_total: number; folha_qtd: number;
}
export interface MetaDia { tenant_id: string; dia_semana: number; faturamento: number }
export interface CertNfse { nome: string; dia: string }
export interface Conexao { tipo: 'meta' | 'inter_pix'; tenant_id: string; loja: string; nome: string; dia: string }
export interface EspecialDelivery { tenant_id: string; loja: string; dia: string; rotulo: string | null; fechado: boolean; horarios: string | null }
export interface VemAiDados {
  hoje: string; ate: string;
  contas: ContaDia[]; metas: MetaDia[]; certificados: CertNfse[]; conexoes: Conexao[]; especiais: EspecialDelivery[];
}

export interface LinhaVemAi {
  chave: string;
  dia: string;
  tipo: 'conexao' | 'certificado' | 'contas' | 'especial';
  titulo: string;
  detalhe: string;
  /** segunda linha pequena (a divisão por loja, quando há mais de uma no dia) */
  sub?: string;
  /** contas acima da meta de vendas do dia */
  acima?: boolean;
  acao?: { label: string; tenantId: string; rota: string };
  /** frase curta para o resumo com a seção recolhida */
  curta: string;
}

const DIAS_CURTO = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const DIAS_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dowDe = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
export const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
export const diaCurto = (ymd: string) => DIAS_CURTO[dowDe(ymd)];
const diaLongo = (ymd: string) => DIAS_LONGO[dowDe(ymd)];
const RANK: Record<LinhaVemAi['tipo'], number> = { conexao: 0, certificado: 1, contas: 2, especial: 3 };
const abreviaLoja = (n: string) => n.replace(/^El Patr[oó]n\s+/i, '').replace(/\s*&\s*El Patr[oó]n\s*$/i, '').trim() || n;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Monta as linhas, em ordem de dia. `filtroLoja` = a loja escolhida no topo da Hoje ('' = todas). */
export function montarVemAi(d: VemAiDados, filtroLoja = ''): LinhaVemAi[] {
  const daLoja = <T extends { tenant_id: string }>(xs: T[]) => (filtroLoja ? xs.filter((x) => x.tenant_id === filtroLoja) : xs);
  const linhas: LinhaVemAi[] = [];

  // ── Contas a pagar por dia (todas as lojas olhadas somadas) ──
  const metas = daLoja(d.metas);
  const metaDoDow = (dow: number) => metas.filter((m) => m.dia_semana === dow).reduce((s, m) => s + Number(m.faturamento || 0), 0);
  const porDia = new Map<string, ContaDia[]>();
  for (const c of daLoja(d.contas)) porDia.set(c.dia, [...(porDia.get(c.dia) ?? []), c]);
  for (const [dia, cs] of porDia) {
    const total = cs.reduce((s, c) => s + Number(c.total), 0);
    const qtd = cs.reduce((s, c) => s + Number(c.qtd), 0);
    const guias = cs.flatMap((c) => c.guias ?? []);
    const folhaTotal = cs.reduce((s, c) => s + Number(c.folha_total), 0);
    const folhaQtd = cs.reduce((s, c) => s + Number(c.folha_qtd), 0);
    const guiasTotal = cs.reduce((s, c) => s + Number(c.guias_total), 0);
    const restoQtd = qtd - guias.length - folhaQtd;
    const restoTotal = total - guiasTotal - folhaTotal;
    const partes: string[] = [];
    for (const g of guias) partes.push(`${String(g.descricao).split(/\s+[—-]\s+/)[0]} ${brl(Number(g.valor))}`);
    if (folhaQtd > 0) partes.push(`folha ${brl(folhaTotal)}`);
    if (restoQtd > 0) partes.push(`${plural(restoQtd, 'conta', 'contas')} (${brl(restoTotal)})`);
    const meta = metaDoDow(dowDe(dia));
    const acima = meta > 0 && total > meta;
    const lojas = cs.length > 1 ? cs.map((c) => `${abreviaLoja(c.loja)} ${brl(Number(c.total))}`).join(' · ') : undefined;
    linhas.push({
      chave: `contas:${dia}`, dia, tipo: 'contas',
      titulo: `Saem ${brl(total)}`,
      detalhe: [partes.join(' + '), acima ? `acima da meta de vendas do dia (${brl(meta)})` : ''].filter(Boolean).join(' · '),
      sub: lojas, acima,
      acao: { label: 'Ver', tenantId: cs.length === 1 ? cs[0].tenant_id : '', rota: '/financeiro?tab=pagar' },
      curta: `${brl(total)} saem ${diaLongo(dia)}`,
    });
  }

  // ── Certificados da NFS-e ──
  for (const c of d.certificados) {
    linhas.push({
      chave: `cert:${c.nome}:${c.dia}`, dia: c.dia, tipo: 'certificado',
      titulo: `Certificado da NFS-e vence${c.nome ? ` — ${c.nome}` : ''}`,
      detalhe: 'sem ele não emite nota de serviço',
      acao: { label: 'Renovar', tenantId: '', rota: '/notas-servico' },
      curta: `certificado da NFS-e vence ${diaLongo(c.dia)} (${ddmm(c.dia)})`,
    });
  }

  // ── Conexões (token do Meta, certificado do Pix do Inter) ──
  for (const c of daLoja(d.conexoes)) {
    const meta = c.tipo === 'meta';
    linhas.push({
      chave: `con:${c.tipo}:${c.tenant_id}:${c.dia}`, dia: c.dia, tipo: 'conexao',
      titulo: meta ? `Conexão do Meta Ads vence — ${abreviaLoja(c.loja)}` : `Certificado do Pix do Inter vence — ${abreviaLoja(c.loja)}`,
      detalhe: meta ? 'anúncios e relatórios param até reconectar' : 'o Pix do totem e do tablet para até trocar o certificado',
      acao: { label: meta ? 'Reconectar' : 'Ver', tenantId: c.tenant_id, rota: meta ? '/trafego-pago' : '/configuracoes?tab=estacoes' },
      curta: `${meta ? 'conexão do Meta' : 'certificado do Pix'} vence ${diaLongo(c.dia)} (${ddmm(c.dia)})`,
    });
  }

  // ── Datas especiais do delivery ──
  for (const e of daLoja(d.especiais)) {
    const nome = e.rotulo?.trim() || 'data especial';
    linhas.push({
      chave: `esp:${e.tenant_id}:${e.dia}`, dia: e.dia, tipo: 'especial',
      titulo: e.fechado ? `Delivery fechado — ${nome}` : `Delivery com horário especial — ${nome}`,
      detalhe: `${abreviaLoja(e.loja)}${!e.fechado && e.horarios ? ` · ${e.horarios}` : ''}`,
      acao: { label: 'Ajustar', tenantId: e.tenant_id, rota: '/config-delivery?aba=horario' },
      curta: `${nome.toLowerCase()} no delivery ${diaLongo(e.dia)} (${ddmm(e.dia)})`,
    });
  }

  return linhas.sort((a, b) => a.dia.localeCompare(b.dia) || RANK[a.tipo] - RANK[b.tipo] || a.chave.localeCompare(b.chave));
}

/** Frase da seção recolhida: "3 coisas: R$ 6.200 saem quarta, certificado vence sábado e mais 1". */
export function resumoVemAi(linhas: LinhaVemAi[], dias = 14): string {
  if (!linhas.length) return `Nada vence nos próximos ${dias} dias.`;
  const mostra = linhas.slice(0, 3).map((l) => l.curta);
  const resto = linhas.length - mostra.length;
  return `${plural(linhas.length, 'coisa', 'coisas')}: ${mostra.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''}.`;
}
