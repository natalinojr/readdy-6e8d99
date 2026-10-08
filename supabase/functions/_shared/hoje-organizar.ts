// Tela Hoje (2026-10-03): separa as pendências em blocos que dizem O QUE FAZER, não só o que existe.
// Função pura (testada em src/test/lib/hojeOrganizar.test.ts). Mora em _shared (2026-10-03) para a TELA
// (src/pages/hoje/organizar.ts reexporta) e o SERVIDOR (assistente-cron: bom dia, aviso no celular) contarem
// igual — "um número só". Só importa ./pendencia-visivel.ts (também puro): roda no Vite e no Deno.
//
//   agora        precisa de você hoje (urgente, vence em até 3 dias, pedido de boleto sem resposta)
//   em_dia       trabalho acumulado para pôr em dia (notas não lançadas, itens/contas sem classificar)
//   espera       pode esperar — volta sozinho para "agora" quando apertar (ex.: 3 dias antes de vencer)
//   outros       esperando outra pessoa (boleto já pedido ao fornecedor)
//   silenciado   aviso com "Ciente" dado (estoque crítico…): volta sozinho se piorar (assistente-cron)
//
// Junta o que é a mesma coisa (pedido do dono, 2026-10-02):
//   • contas da loja (atrasadas e as que vencem hoje) → um cartão "Contas" só
//     (2026-10-08), que já inclui as "Falta o boleto" vencidas ou de hoje da mesma loja;
//   • várias "Falta o boleto" do mesmo fornecedor na mesma loja → um cartão só ("OESA: 6 contas").

import { pendenciaVisivelPara } from './pendencia-visivel.ts';

export interface PendHoje {
  id: string;
  tenantId: string;
  loja: string;
  kind: string;
  ref: string | null;
  titulo: string;
  detalhe: string | null;
  rota: string | null;
  urgencia: 'alta' | 'normal' | 'baixa';
  acaoRequerida: boolean;
  status: string;
  criadaEm: string;
  payload: Record<string, unknown> | null;
}

export type Bloco = 'agora' | 'em_dia' | 'espera' | 'outros' | 'silenciado';

export interface ItemHoje {
  /** id estável do cartão (pendência única = id dela; grupo = chave do grupo) */
  chave: string;
  tipo: 'pendencia' | 'contas_vencidas' | 'boletos_fornecedor';
  bloco: Bloco;
  tenantId: string;
  loja: string;
  kind: string;
  titulo: string;
  detalhe: string | null;
  valor: number | null;
  /** data (YYYY-MM-DD) que aperta: vencimento da conta, quando houver */
  prazo: string | null;
  /** chave de ordenação: quem tem alguém esperando agora vem antes de tudo; depois o prazo */
  ordem: string;
  urgente: boolean;
  criadaEm: string;
  /** a pendência "dona" do cartão (contas_vencidas: a agregada; grupo: a de prazo mais curto) */
  principal: PendHoje;
  /** cartão Contas: as pendências agregadas da loja (atrasadas, vence hoje, notas não lançadas) */
  agregadas?: PendHoje[];
  /** pendências juntadas neste cartão (boletos sem boleto dentro das vencidas, ou do mesmo fornecedor) */
  juntas: PendHoje[];
  /** boleto pedido: dias desde o pedido */
  pedidoHaDias?: number;
  /** trabalho acumulado: a porção de hoje (null = pequeno, faz de uma vez) */
  porcao?: Porcao | null;
  fornecedor?: string;
}

/** Trabalho acumulado: não é "fazer agora", é "pôr em dia" (sem ficar eternamente no topo). */
// nota_nao_lancada NÃO entra: o cron só cria quando o boleto da nota já venceu ou vence em 3 dias (é "agora").
const ACUMULADO = new Set(['item_sem_classe', 'conta_sem_dre']);
/** Avisos sem ação obrigatória: ficam em "pode esperar" (o OK silencia até piorar).
 *  fique_de_olho (2026-10-05) é ciência, não tarefa: nunca entra no número vermelho de "Agora" nem segura o
 *  "Tudo em dia"; a tela o mostra numa seção própria (FiqueDeOlho.tsx), fora da lista que fica recolhida. */
const AVISO = new Set(['estoque_critico', 'fique_de_olho']);
/** Dias antes do vencimento em que a conta volta para "agora". */
export const DIAS_ANTES = 3;
/** Boleto pedido há este tanto de dias sem chegar → volta para "agora" (pedir de novo). Mesmo prazo
 *  da Trilha (DIAS_PARA_COBRAR = 2, _shared/trilha-acoes.ts); o cron também marca payload.cobrar. */
export const DIAS_SEM_RESPOSTA = 2;
/** Alguém esperando AGORA (operador no PDV, Pix pedido no grupo): topo da lista. */
const JA = new Set(['aprovacao', 'pagamento_grupo', 'pagamento_pendente']);
/** É para hoje mesmo sem vencimento no payload. */
// vendas_abaixo_ritmo e insumo_antes_do_pico (2026-10-03, avisos antes de virar problema) são do dia.
const HOJE_MESMO = new Set(['conta_vence_hoje', 'pedido_pagamento', 'pedido_pagamento_pagar', 'vendas_abaixo_ritmo', 'insumo_antes_do_pico']);

// ── Porções (2026-10-03): trabalho acumulado vira "a porção de hoje", com data para terminar ──────
/** Kinds agregados (payload.total) que viram porção. */
export const PORCAO_KINDS = new Set(['item_sem_classe', 'conta_sem_dre', 'nota_nao_lancada']);
/** Abaixo disso não vale dividir: faz de uma vez. */
export const PORCAO_MINIMO = 6;
export interface Porcao { meta: number; feitos: number; restante: number; dias: number; feita: boolean }
/**
 * Porção de hoje a partir do total do começo do dia (gravado pelo cron em pendencias_porcao na 1ª volta
 * depois das 8h, quando as automações da manhã já rodaram) e do total de agora: ~1/5 do que havia de
 * manhã (no mínimo 3), quanto já andou e em quantos dias termina nesse ritmo. "feitos" é quanto o total
 * caiu — não separa o que a pessoa fez do que o sistema lançou sozinho, e se chega coisa nova no meio do
 * dia o andamento some (o total subiu). É um guia de ritmo, não uma medida de quem fez.
 */
export function porcaoDe(totalInicio: number, totalAgora: number): Porcao | null {
  if (!(totalInicio >= PORCAO_MINIMO)) return null;
  const meta = Math.min(totalInicio, Math.max(3, Math.ceil(totalInicio / 5)));
  const feitos = Math.max(0, totalInicio - totalAgora);
  const restante = Math.max(0, totalAgora);
  return { meta, feitos, restante, dias: Math.ceil(restante / meta), feita: feitos >= meta };
}

const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** Dias entre duas datas YYYY-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

/**
 * Vencimento "DD/MM" do payload → YYYY-MM-DD. O ano é o que deixa a data mais perto de hoje,
 * respeitando se o cron disse que já venceu (vencida=true → no passado).
 */
export function prazoDe(p: PendHoje, hoje: string): string | null {
  const v = typeof p.payload?.vencimento === 'string' ? p.payload.vencimento : null;
  const m = v ? /^(\d{2})\/(\d{2})$/.exec(v) : null;
  if (!m) return null;
  const ano = Number(hoje.slice(0, 4));
  const cand = [ano - 1, ano, ano + 1].map((a) => `${a}-${m[2]}-${m[1]}`);
  const vencida = p.payload?.vencida === true;
  const validos = cand.filter((d) => (vencida ? d < hoje : p.payload?.vencida === false ? d >= hoje : true));
  const lista = validos.length ? validos : cand;
  return lista.reduce((melhor, d) => (Math.abs(diasEntre(hoje, d)) < Math.abs(diasEntre(hoje, melhor)) ? d : melhor), lista[0]);
}

/** "Falta o boleto: OESA — R$ 318,39, VENCIDA em 30/09" → "OESA". */
export function fornecedorDoBoleto(titulo: string): string | null {
  const m = /^Falta o boleto:\s*(.+?)\s+—\s+R\$/.exec(titulo);
  return m ? m[1].trim() : null;
}

const pedidoEm = (p: PendHoje): string | null => (typeof p.payload?.pedido_em === 'string' ? p.payload.pedido_em.slice(0, 10) : null);

function item(p: PendHoje, hoje: string, bloco: Bloco, extra: Partial<ItemHoje> = {}): ItemHoje {
  const prazo = extra.prazo !== undefined ? extra.prazo : p.kind === 'conta_vence_hoje' ? hoje : prazoDe(p, hoje);
  const ordem = JA.has(p.kind) ? '0000-00-00' : prazo ?? (HOJE_MESMO.has(p.kind) ? hoje : '9999-12-31');
  return {
    chave: p.id, tipo: 'pendencia', bloco, tenantId: p.tenantId, loja: p.loja, kind: p.kind,
    titulo: p.titulo, detalhe: p.detalhe, valor: num(p.payload?.valor), urgente: p.urgencia === 'alta',
    criadaEm: p.criadaEm, principal: p, juntas: [], ...extra, prazo, ordem,
  };
}

/** Bloco de uma pendência sozinha. */
function blocoDe(p: PendHoje, hoje: string): { bloco: Bloco; pedidoHaDias?: number } {
  if (p.status === 'vista' && !p.acaoRequerida) return { bloco: 'silenciado' };
  if (p.kind === 'boleto_faltando') {
    const pedido = pedidoEm(p);
    if (pedido) {
      const dias = diasEntre(pedido, hoje);
      return { bloco: p.payload?.cobrar === true || dias >= DIAS_SEM_RESPOSTA ? 'agora' : 'outros', pedidoHaDias: dias };
    }
    const prazo = prazoDe(p, hoje);
    if (p.payload?.vencida === true) return { bloco: 'agora' };
    if (prazo && diasEntre(hoje, prazo) <= DIAS_ANTES) return { bloco: 'agora' };
    return { bloco: 'espera' };
  }
  // "Chegou a mercadoria?" respondido "ainda não": sai do "agora" e fica em "pode esperar" até chegar.
  if (p.kind === 'mercadoria_chegou' && p.status === 'vista') return { bloco: 'espera' };
  // Conta fixa que chegou (2026-10-06): avisa desde que chega, mas só vira "agora" perto de vencer.
  if (p.kind === 'fixa_chegou') {
    const prazo = prazoDe(p, hoje);
    if (p.urgencia === 'alta' || (prazo && diasEntre(hoje, prazo) <= DIAS_ANTES)) return { bloco: 'agora' };
    return { bloco: 'espera' };
  }
  if (ACUMULADO.has(p.kind)) return { bloco: 'em_dia' };
  if (AVISO.has(p.kind) || !p.acaoRequerida) return { bloco: 'espera' };
  return { bloco: 'agora' };
}

const ORDEM_BLOCO: Record<Bloco, number> = { agora: 0, em_dia: 1, espera: 2, outros: 3, silenciado: 4 };

/** Dentro do bloco: pelo prazo (o que venceu antes vem antes), depois urgente, depois chegada. */
export function compararItens(a: ItemHoje, b: ItemHoje): number {
  if (a.bloco !== b.bloco) return ORDEM_BLOCO[a.bloco] - ORDEM_BLOCO[b.bloco];
  if (a.ordem !== b.ordem) return a.ordem.localeCompare(b.ordem);
  if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
  return a.criadaEm.localeCompare(b.criadaEm);
}

export function organizarHoje(pendencias: PendHoje[], hoje: string, porcoes?: Map<string, number>): ItemHoje[] {
  // Tarefas vencidas são da pessoa: aparecem na rotina ("Suas tarefas"), não como pendência da loja.
  const lista = pendencias.filter((p) => p.kind !== 'tarefa_vencida');
  const usadas = new Set<string>();
  const itens: ItemHoje[] = [];

  // 1) Um cartão "Contas" por loja (2026-10-08, tela Financeiro › Contas): junta "N contas atrasadas" e
  //    "Vence hoje", e engole as "Falta o boleto" vencidas ou de hoje (e ainda não pedidas) da mesma loja —
  //    são as mesmas contas. O detalhe mora na tela Contas. "Notas não lançadas" fica no cartão dela (tem a
  //    porção do dia e outra ação: lançar a nota).
  const DE_CONTAS = new Set(['conta_atrasada', 'conta_vence_hoje']);
  const porLoja = new Map<string, PendHoje[]>();
  for (const p of lista) if (DE_CONTAS.has(p.kind)) porLoja.set(p.tenantId, [...(porLoja.get(p.tenantId) ?? []), p]);
  for (const [tenantId, ags] of porLoja) {
    const de = (k: string) => ags.find((p) => p.kind === k);
    const atr = de('conta_atrasada'), hj = de('conta_vence_hoje');
    const juntas = lista.filter((p) => p.kind === 'boleto_faltando' && p.tenantId === tenantId && !usadas.has(p.id)
      && ((atr && p.payload?.vencida === true) || (hj && p.payload?.vencida !== true && prazoDe(p, hoje) === hoje))
      && blocoDe(p, hoje).bloco === 'agora');
    juntas.forEach((p) => usadas.add(p.id));
    ags.forEach((p) => usadas.add(p.id));
    const qtd = (p: PendHoje | undefined) => num(p?.payload?.total) ?? 0;
    const partes = [
      atr && `${qtd(atr)} ${qtd(atr) === 1 ? 'vencida' : 'vencidas'}`,
      hj && `${qtd(hj)} vence${qtd(hj) === 1 ? '' : 'm'} hoje`,
    ].filter(Boolean);
    // A pendência "dona" é a mais apertada: atrasada > vence hoje.
    const dona = (atr ?? hj) as PendHoje;
    const valor = num(atr?.payload?.valor) ?? 0;
    const valorHoje = num(hj?.payload?.valor) ?? 0;
    const silenciado = ags.every((p) => p.status === 'vista' && !p.acaoRequerida);
    const prazos = juntas.map((p) => prazoDe(p, hoje)).filter((d): d is string => !!d).sort();
    itens.push(item(dona, hoje, silenciado ? 'silenciado' : 'agora', {
      chave: `contas:${tenantId}`, tipo: 'contas_vencidas', juntas, agregadas: ags,
      titulo: `Contas: ${partes.join(' · ')}`,
      detalhe: null,
      valor: Math.round((valor + valorHoje) * 100) / 100,
      prazo: atr ? prazos[0] ?? null : hoje, urgente: true,
    }));
  }

  // 2) Várias "Falta o boleto" do mesmo fornecedor e no mesmo bloco → um cartão só.
  const grupos = new Map<string, PendHoje[]>();
  for (const p of lista) {
    if (p.kind !== 'boleto_faltando' || usadas.has(p.id)) continue;
    const forn = fornecedorDoBoleto(p.titulo);
    if (!forn) continue;
    const chave = `${p.tenantId}|${forn.toLowerCase()}|${blocoDe(p, hoje).bloco}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), p]);
  }
  for (const [chave, ps] of grupos) {
    if (ps.length < 2) continue;
    ps.forEach((p) => usadas.add(p.id));
    const ordenadas = ps.slice().sort((a, b) => (prazoDe(a, hoje) ?? '').localeCompare(prazoDe(b, hoje) ?? ''));
    const principal = ordenadas[0];
    const { bloco, pedidoHaDias } = blocoDe(principal, hoje);
    const forn = fornecedorDoBoleto(principal.titulo) as string;
    const total = ps.reduce((s, p) => s + (num(p.payload?.valor) ?? 0), 0);
    const vencidas = ps.filter((p) => p.payload?.vencida === true).length;
    itens.push(item(principal, hoje, bloco, {
      chave: `boletos:${chave}`, tipo: 'boletos_fornecedor', juntas: ordenadas, fornecedor: forn, pedidoHaDias,
      titulo: `${forn}: ${ps.length} contas sem boleto`,
      detalhe: vencidas ? `${vencidas} já ${vencidas === 1 ? 'venceu' : 'venceram'}. Um pedido só resolve todas.` : 'Um pedido só resolve todas.',
      valor: Math.round(total * 100) / 100, urgente: ps.some((p) => p.urgencia === 'alta'),
    }));
  }

  // 3) O resto, uma pendência por cartão. Trabalho acumulado ganha a porção de hoje. A porção NÃO muda
  //    o bloco (revisão 2026-10-03): nota não lançada é boleto vencido ou vencendo — continua em "Agora"
  //    mesmo com a porção feita, e o servidor (resumo/bom dia, sem porções) conta igual à tela. Quem
  //    usa a porção feita é a página: o acumulado ("Para pôr em dia") com a porção do dia feita não
  //    segura o "Tudo em dia".
  for (const p of lista) {
    if (usadas.has(p.id)) continue;
    const { bloco, pedidoHaDias } = blocoDe(p, hoje);
    const forn = p.kind === 'boleto_faltando' ? fornecedorDoBoleto(p.titulo) ?? undefined : undefined;
    const total = num(p.payload?.total);
    const porcao = PORCAO_KINDS.has(p.kind) && total != null ? porcaoDe(porcoes?.get(p.id) ?? total, total) : undefined;
    itens.push(item(p, hoje, bloco, { pedidoHaDias, fornecedor: forn, porcao }));
  }

  return itens.sort(compararItens);
}

/** Quantos cartões em "agora" por loja (os botões de loja do topo). */
export function contarAgoraPorLoja(itens: ItemHoje[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of itens) if (i.bloco === 'agora') m.set(i.tenantId, (m.get(i.tenantId) ?? 0) + 1);
  return m;
}

/**
 * A pendência aparece na Hoje desta pessoa? Mesma regra da caixa de pendências (papel na loja), e o Pix
 * pedido no grupo só para o dono — é ele quem paga com PIN no chat; para os demais seria cartão sem saída.
 */
export function visivelNaHoje(kind: string, perfil: string | undefined, email: string | null | undefined, ehDono: boolean): boolean {
  if ((kind === 'pagamento_grupo' || kind === 'pagamento_pendente') && !ehDono) return false;
  return pendenciaVisivelPara(kind, perfil, email);
}

/** "Agora" de uma pessoa (servidor: bom dia e aviso no celular) — o mesmo número da tela Hoje dela. */
export function agoraDaPessoa(pends: PendHoje[], papeis: Map<string, string>, email: string | null, ehDono: boolean, hoje: string): ItemHoje[] {
  const vis = pends.filter((p) => papeis.has(p.tenantId) && visivelNaHoje(p.kind, papeis.get(p.tenantId), email, ehDono));
  return organizarHoje(vis, hoje).filter((i) => i.bloco === 'agora');
}

/** Linha do banco (pendencias + tenants(name)) → PendHoje. */
// deno-lint-ignore no-explicit-any
export function pendHojeDaLinha(r: any): PendHoje {
  const t = r?.tenants;
  return {
    id: String(r.id), tenantId: String(r.tenant_id), loja: String((Array.isArray(t) ? t[0]?.name : t?.name) ?? ''),
    kind: String(r.kind), ref: r.ref ?? null, titulo: String(r.titulo ?? ''), detalhe: r.detalhe ?? null, rota: r.rota ?? null,
    urgencia: r.urgencia, acaoRequerida: !!r.acao_requerida, status: String(r.status), criadaEm: String(r.criada_em),
    payload: (r.payload as Record<string, unknown> | null) ?? null,
  };
}

/** Colunas que a Hoje lê de `pendencias` (tela e servidor). */
export const COLUNAS_PEND_HOJE = 'id, tenant_id, kind, ref, titulo, detalhe, rota, urgencia, acao_requerida, status, criada_em, payload, tenants(name)';

/** Título curto para aviso (sem "Falta o boleto:" e sem o valor no fim). */
export function tituloCurto(t: string): string {
  return t.replace(/^Falta o boleto:\s*/, 'Boleto: ')
    .replace(/,\s*(VENCIDA em\s+\d{2}\/\d{2}|vence\s+(HOJE|amanhã|\d{2}\/\d{2}))$/i, '')
    .replace(/\s+—\s+R\$\s*[\d.,]+(\s+\S+)?$/, '');
}
