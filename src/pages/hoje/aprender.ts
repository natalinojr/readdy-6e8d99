// "Aprendi com você" (2026-10-03, tela Hoje fase 3): quando a pessoa toma a MESMA decisão de novo, o
// sistema pergunta "quer que eu faça sempre assim?". Um "sim" vira regra do piloto automático (tabela
// automacoes, com diário e desfazer); um "não" fica guardado e a pergunta não volta.
//
// Aprendizados de hoje (só em loja onde a pessoa é administradora ou gerente):
//   sem_boleto  "Não era boleto" 2+ vezes para o mesmo fornecedor → parar de cobrar boleto dele
//               (o assistente-cron fecha as próximas "Falta o boleto" desse fornecedor).
//   regra_auto  regra de lançamento por CNPJ que só SUGERE e já acertou 3+ vezes → passar a lançar
//               sozinha (mode 'auto', o mesmo que a tela Conciliação › Regras faz).
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { fornecedorDoBoleto } from './organizar';

export interface RegraLancamento {
  id: string; tenant_id: string; counterpart_doc: string | null; counterpart_label: string | null; supplier_name: string | null;
  launch_kind: string | null; dre_category_id: string | null; merchandise_category_id: string | null; competence_rule: string | null;
  cost_center_id: string | null; match_count: number | null; mode: string | null; allow_payroll?: boolean | null;
}

export interface Sugestao {
  /** chave estável da sugestão (loja + tipo + alvo) */
  id: string;
  tipo: 'sem_boleto' | 'regra_auto';
  tenantId: string;
  loja: string;
  /** o que a regra mira: fornecedor (maiúsculas) ou id da regra de lançamento */
  alvo: string;
  titulo: string;
  detalhe: string;
  sim: string;
  nao: string;
  regra?: RegraLancamento;
}

export interface Descarte { tenant_id: string; titulo: string; resolvida_por: string | null }
export interface Automacao { tenant_id: string; chave: string; alvo: string; ligada: boolean; origem: string }

/** Monta as sugestões (pura, testada em src/test/lib/hojeAprender.test.ts). */
export function montarSugestoes(
  descartes: Descarte[], regras: RegraLancamento[], automacoes: Automacao[], lojas: Map<string, string>,
): Sugestao[] {
  const ja = new Set(automacoes.map((a) => `${a.tenant_id}|${a.chave}|${a.alvo.toUpperCase()}`));
  const out: Sugestao[] = [];

  // "Falta o boleto" dispensada por gente ("Não era boleto" / "Não vou fazer") repetida para o mesmo
  // fornecedor. As que o sistema fechou (resolvida_por nulo) não contam.
  const cont = new Map<string, { tenantId: string; forn: string; n: number }>();
  for (const d of descartes) {
    if (!d.resolvida_por) continue;
    const forn = fornecedorDoBoleto(d.titulo)?.toUpperCase();
    if (!forn) continue;
    const k = JSON.stringify([d.tenant_id, forn]);
    const c = cont.get(k) ?? { tenantId: d.tenant_id, forn, n: 0 };
    c.n += 1;
    cont.set(k, c);
  }
  for (const { tenantId, forn, n } of cont.values()) {
    if (n < 2) continue;
    if (ja.has(`${tenantId}|sem_boleto_fornecedor|${forn}`)) continue;
    out.push({
      id: `sem_boleto:${tenantId}:${forn}`, tipo: 'sem_boleto', tenantId, loja: lojas.get(tenantId) ?? '', alvo: forn,
      titulo: `Paro de cobrar boleto de ${forn}?`,
      detalhe: `Você dispensou o boleto dele ${n} vezes. Se ele é pago por Pix, débito ou acerto, eu deixo de criar "Falta o boleto" para ele (menos quando você mesmo pedir o boleto).`,
      sim: 'Sim, pode parar', nao: 'Não, continue cobrando',
    });
  }

  // Regra de lançamento que só sugere e já acertou várias vezes.
  for (const r of regras) {
    if (r.mode === 'auto' || Number(r.match_count ?? 0) < 3) continue;
    if (ja.has(`${r.tenant_id}|regra_lancamento_auto|${r.id.toUpperCase()}`)) continue;
    const nome = r.supplier_name || r.counterpart_label || r.counterpart_doc || 'esse CNPJ';
    out.push({
      id: `regra_auto:${r.tenant_id}:${r.id}`, tipo: 'regra_auto', tenantId: r.tenant_id, loja: lojas.get(r.tenant_id) ?? '',
      alvo: r.id.toUpperCase(), regra: r,
      titulo: `Lanço sozinho os pagamentos de ${nome}?`,
      detalhe: `A regra dele já acertou ${r.match_count} vezes e você só confirmou. Daqui pra frente eu lanço sozinho o que não tiver dúvida (o resto continua pedindo sua confirmação).`,
      sim: 'Sim, lançar sozinho', nao: 'Não, eu confirmo cada um',
    });
  }
  return out;
}

/** Lê o que precisa e devolve as sugestões das lojas em que a pessoa é administradora ou gerente. */
export async function carregarSugestoes(papeis: Map<string, string> | null): Promise<Sugestao[]> {
  const lojasGestor = [...(papeis ?? new Map()).entries()].filter(([, p]) => p === 'admin' || p === 'gerente').map(([id]) => id);
  if (!lojasGestor.length) return [];
  const desde = new Date(Date.now() - 120 * 86400000).toISOString();
  const [desc, regras, auto, lojas] = await Promise.all([
    supabase.from('pendencias').select('tenant_id, titulo, resolvida_por')
      .in('tenant_id', lojasGestor).eq('kind', 'boleto_faltando').eq('status', 'descartada').gte('resolvida_em', desde).limit(500),
    // fin_reconciliation_rules não tem leitura direta pelo app: lê pela função do banco
    supabase.rpc('fn_regras_lancamento_gestor', { p_tenants: lojasGestor }),
    supabase.from('automacoes').select('tenant_id, chave, alvo, ligada, origem').in('tenant_id', lojasGestor),
    supabase.from('tenants').select('id, name').in('id', lojasGestor),
  ]);
  const nomes = new Map(((lojas.data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]));
  return montarSugestoes(
    (desc.data ?? []) as Descarte[], (regras.data ?? []) as RegraLancamento[], (auto.data ?? []) as Automacao[], nomes,
  );
}

/** Muda a regra de lançamento entre "só sugere" e "lança sozinha" — o mesmo salvamento da tela
 *  Conciliação › Regras (só administrador ou gerente, conferido no servidor). */
export async function salvarModoRegra(r: RegraLancamento, modo: 'auto' | 'suggest'): Promise<void> {
  const { data, error } = await invokeWithAuth<{ error?: string }>('conciliacao-pagamentos', {
    body: {
      action: 'launch_rule_save', tenant_id: r.tenant_id, counterpart_doc: r.counterpart_doc, counterpart_label: r.counterpart_label,
      kind: r.launch_kind, dre_category_id: r.launch_kind === 'compra' ? null : r.dre_category_id,
      merchandise_category_id: r.launch_kind === 'compra' ? r.merchandise_category_id : null,
      competence_rule: r.competence_rule === 'prev' ? 'prev' : 'same', mode: modo, supplier_name: r.supplier_name, cost_center_id: r.cost_center_id ?? null,
      // sem isto o salvamento apagaria o "não é salário" já decidido na regra
      allow_payroll: r.allow_payroll === true,
    },
  });
  const falha = data?.error ?? error?.message;
  if (falha) throw new Error(String(falha));
}

/** Liga, desliga ou recusa uma automação (tabela automacoes, só administrador ou gerente). */
export async function definirAutomacao(tenantId: string, chave: 'sem_boleto_fornecedor' | 'regra_lancamento_auto', alvo: string, ligada: boolean, origem: 'manual' | 'aprendida' | 'recusada'): Promise<void> {
  const { error } = await supabase.rpc('fn_automacao_definir', { p_tenant: tenantId, p_chave: chave, p_alvo: alvo, p_ligada: ligada, p_origem: origem, p_params: null });
  if (error) throw new Error(error.message);
}

/** Responde a sugestão. "Sim" liga a regra (e, na regra de lançamento, muda para lançar sozinha); "não" guarda a recusa. */
export async function responderSugestao(s: Sugestao, aceitar: boolean): Promise<void> {
  if (aceitar && s.tipo === 'regra_auto' && s.regra) await salvarModoRegra(s.regra, 'auto');
  await definirAutomacao(s.tenantId, s.tipo === 'sem_boleto' ? 'sem_boleto_fornecedor' : 'regra_lancamento_auto', s.alvo, aceitar, aceitar ? 'aprendida' : 'recusada');
}
