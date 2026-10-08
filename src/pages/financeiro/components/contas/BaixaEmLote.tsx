// "Paguei no banco" em lote (2026-10-08): dar baixa de várias contas selecionadas de uma vez. Mesma regra do
// "Já paguei" de uma conta (dono, 2026-10-08): boleto/Pix/transferência → cada conta procura a sua saída no
// extrato (conciliacao-pagamentos › bill_extrato_search) e a baixa sai da linha do banco (link_manual);
// dinheiro/cartão, ou conta cuja saída não está no extrato → financial-write › pay_bill com a data
// escolhida, pelo que falta pagar e com o aviso antes de pagar. A classificação DRE é pedida só nas contas
// que não têm (regra do dono, 2026-09-12).
import { useEffect, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import DreClassificacaoSelect, { precisaClassificarDRE, useDreEscolha } from '@/pages/financeiro/components/DreClassificacaoSelect';
import AvisoAntesDePagar, { avisosDaMensagem, PRECISA_CONFIRMAR, type AvisoPagar } from '@/components/feature/pagamentos/AvisoAntesDePagar';
import { todayBrasilia } from '@/lib/dateUtils';
import { brl, ddmm, PRINCIPAL, SECUNDARIO } from '../pagamentos/comum';

interface Conta {
  id: string; description: string; supplier: string | null; amount: number; paid_amount: number | null; due_date: string;
  dre_category_id: string | null; reference_type: string | null; status: string;
}
interface Candidata { id: string; transaction_date: string; valor: number; diferenca: number; description: string | null; counterpart_name: string | null; sugerida: boolean }
type Resultado = { ok: true } | { ok: false; avisos?: AvisoPagar[]; erro?: string };
const FORMAS_BANCO = ['Boleto', 'Pix', 'Transferência'];
const SEM_EXTRATO = '';

export default function BaixaEmLote({ tenantId, ids, onFechar, onFeito }: {
  tenantId: string; ids: string[]; onFechar: () => void; onFeito: () => void;
}) {
  const hoje = todayBrasilia();
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [dia, setDia] = useState(hoje);
  const [forma, setForma] = useState('Boleto');
  const [dre, setDre] = useState<Record<string, string>>({});
  const [res, setRes] = useState<Record<string, Resultado>>({});
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  // Saídas do extrato por conta e a escolhida ('' = dar baixa sem o extrato)
  const [cands, setCands] = useState<Record<string, Candidata[]> | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { toPayload } = useDreEscolha();
  const peloBanco = FORMAS_BANCO.includes(forma);

  useEffect(() => {
    supabase.from('fin_accounts_payable')
      .select('id, description, supplier, amount, paid_amount, due_date, dre_category_id, reference_type, status')
      .eq('tenant_id', tenantId).in('id', ids)
      .then(({ data, error }) => {
        if (error) { setErro(error.message); setContas([]); return; }
        const l = ((data ?? []) as Conta[]).filter((c) => !['paid', 'cancelled'].includes(c.status));
        setContas(l.sort((a, b) => a.due_date.localeCompare(b.due_date)));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, ids.join(',')]);

  // Procura a saída de cada conta uma vez (a forma "do banco" é a mesma para Boleto/Pix/Transferência).
  useEffect(() => {
    if (!peloBanco || !contas?.length || cands) return;
    let vivo = true;
    Promise.all(contas.map((c) => invokeWithAuth<{ candidatos?: Candidata[] }>('conciliacao-pagamentos', {
      body: { action: 'bill_extrato_search', tenant_id: tenantId, bill_id: c.id },
    }).then(({ data }) => [c.id, data?.candidatos ?? []] as const).catch(() => [c.id, [] as Candidata[]] as const)))
      .then((pares) => {
        if (!vivo) return;
        const m: Record<string, Candidata[]> = {};
        const esc: Record<string, string> = {};
        const usadas = new Set<string>();
        for (const [id, l] of pares) {
          m[id] = l;
          // Pré-escolhe a melhor saída ainda não usada por outra conta da seleção.
          const melhor = l.find((x) => !usadas.has(x.id));
          esc[id] = melhor?.id ?? SEM_EXTRATO;
          if (melhor) usadas.add(melhor.id);
        }
        setCands(m); setEscolha(esc);
      });
    return () => { vivo = false; };
  }, [peloBanco, contas, cands, tenantId]);

  const falta = (c: Conta) => Math.round((Number(c.amount) - Number(c.paid_amount ?? 0)) * 100) / 100;
  const pendentes = (contas ?? []).filter((c) => !(res[c.id]?.ok));
  const comAviso = pendentes.filter((c) => { const r = res[c.id]; return r && !r.ok && r.avisos?.length; });
  const total = pendentes.reduce((t, c) => t + falta(c), 0);
  const viaExtrato = (c: Conta) => peloBanco && !!escolha[c.id];
  const precisaData = pendentes.some((c) => !viaExtrato(c));
  const procurando = peloBanco && !!contas?.length && !cands;

  const salvar = async () => {
    const semDre = pendentes.filter((c) => precisaClassificarDRE(c) && !dre[c.id]);
    if (semDre.length) { setErro(`Escolha a classificação DRE de ${semDre.length === 1 ? '1 conta' : `${semDre.length} contas`}.`); return; }
    const linhas = pendentes.filter(viaExtrato).map((c) => escolha[c.id]);
    if (new Set(linhas).size !== linhas.length) { setErro('A mesma saída do banco foi escolhida para duas contas.'); return; }
    if (comAviso.some((c) => (motivos[c.id] ?? '').trim().length < 3)) { setErro('Escreva o motivo nas contas com aviso para dar baixa mesmo assim.'); return; }
    setSalvando(true); setErro(null);
    const novo: Record<string, Resultado> = { ...res };
    // Uma de cada vez: o servidor confere cada conta (aviso antes de pagar, linha já conciliada…).
    for (const c of pendentes) {
      const dreP = precisaClassificarDRE(c) ? toPayload(dre[c.id]) ?? {} : {};
      if (viaExtrato(c)) {
        const { data: r, error } = await invokeWithAuth<{ error?: string; results?: Array<{ ok: boolean; msg: string }> }>('conciliacao-pagamentos', {
          body: { action: 'link_manual', tenant_id: tenantId, id: escolha[c.id], alvo: { kind: 'payable', ref_id: c.id }, ...dreP },
        });
        const r0 = r?.results?.[0];
        novo[c.id] = error || r?.error ? { ok: false, erro: String(error?.message ?? r?.error) } : r0 && !r0.ok ? { ok: false, erro: r0.msg } : { ok: true };
      } else {
        const jaAvisou = !!(res[c.id] && !res[c.id].ok && (res[c.id] as { avisos?: AvisoPagar[] }).avisos?.length);
        const { data: r, error } = await invokeWithAuth<{ error?: string }>('financial-write', {
          body: { action: 'pay_bill', tenant_id: tenantId, payload: {
            id: c.id, paid_date: dia, paid_amount: falta(c), payment_method: forma, ...dreP,
            ...(jaAvisou ? { motivo_aviso: (motivos[c.id] ?? '').trim() } : {}),
          } },
        });
        if ((error as { code?: string } | null)?.code === PRECISA_CONFIRMAR) novo[c.id] = { ok: false, avisos: avisosDaMensagem(error!.message) };
        else if (error?.message || r?.error) novo[c.id] = { ok: false, erro: String(error?.message ?? r?.error) };
        else novo[c.id] = { ok: true };
      }
      setRes({ ...novo });
    }
    setSalvando(false);
    const faltam = (contas ?? []).filter((c) => !novo[c.id]?.ok);
    if (!faltam.length) onFeito();
  };

  const feitas = (contas ?? []).filter((c) => res[c.id]?.ok).length;
  const campo = 'h-9 px-2 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:border-amber-400';
  const chip = (f: string) => `h-9 px-3 rounded-lg border text-sm font-semibold cursor-pointer ${forma === f ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`;
  const nomeSaida = (x: Candidata) => `${ddmm(x.transaction_date)} · ${x.counterpart_name || x.description || 'saída'} · ${brl(x.valor)}${Math.abs(x.diferenca) < 0.01 ? '' : x.diferenca > 0 ? ` (+${brl(x.diferenca)} juros)` : ` (−${brl(-x.diferenca)} desconto)`}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => !salvando && onFechar()}>
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold text-zinc-900">Já paguei</h3>
          <button onClick={onFechar} disabled={salvando} className="w-9 h-9 rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar"><i className="ri-close-line text-lg" /></button>
        </div>
        <p className="text-xs text-zinc-500">Dá baixa nas contas abaixo. Não faz pagamento: é para o que já foi pago.</p>

        {contas === null ? <p className="text-sm text-zinc-500">Carregando…</p> : (
          <>
            <div>
              <p className="text-[11px] text-zinc-500 mb-1">Como foi pago?</p>
              <div className="flex flex-wrap gap-1.5">
                {[...FORMAS_BANCO, 'Dinheiro', 'Cartão'].map((f) => (
                  <button key={f} type="button" disabled={salvando} onClick={() => setForma(f)} className={chip(f)}>{f}</button>
                ))}
              </div>
            </div>
            {peloBanco && <p className="text-[11px] text-zinc-500">{procurando ? 'Procurando a saída de cada conta no extrato…' : 'Cada conta usa a saída do extrato escolhida abaixo (data e valor vêm do banco).'}</p>}
            {precisaData && !procurando && (
              <label className="block text-[11px] text-zinc-500">{peloBanco ? 'Pago em (contas sem saída no extrato)' : 'Pago em'}
                <input type="date" value={dia} max={hoje} onChange={(e) => setDia(e.target.value)} className={`${campo} w-full mt-0.5`} disabled={salvando} />
              </label>
            )}

            <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl">
              {contas.map((c) => {
                const r = res[c.id];
                const lista = cands?.[c.id] ?? [];
                return (
                  <li key={c.id} className="px-3 py-2 space-y-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-zinc-500 tabular-nums w-11">{ddmm(c.due_date)}</span>
                      <span className="flex-1 min-w-0 truncate text-sm font-semibold text-zinc-800">{c.supplier || c.description}</span>
                      <span className="text-sm font-bold tabular-nums">{brl(falta(c))}</span>
                      {r?.ok && <i className="ri-check-line text-emerald-600" title="Baixa feita" />}
                    </div>
                    {!r?.ok && peloBanco && cands && (
                      <select value={escolha[c.id] ?? SEM_EXTRATO} disabled={salvando} onChange={(e) => setEscolha((x) => ({ ...x, [c.id]: e.target.value }))}
                        className={`${campo} w-full text-xs ${escolha[c.id] ? '' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
                        {lista.map((x) => <option key={x.id} value={x.id}>{nomeSaida(x)}</option>)}
                        <option value={SEM_EXTRATO}>{lista.length ? 'Nenhuma destas — dar baixa sem o extrato' : 'Não achei no extrato — dar baixa sem ele'}</option>
                      </select>
                    )}
                    {!r?.ok && precisaClassificarDRE(c) && (
                      <DreClassificacaoSelect value={dre[c.id] ?? ''} onChange={(v) => setDre((d) => ({ ...d, [c.id]: v }))} categorias={[]} />
                    )}
                    {r && !r.ok && r.erro && <p className="text-[11px] text-red-600">{r.erro}</p>}
                    {r && !r.ok && r.avisos?.length ? <AvisoAntesDePagar avisos={r.avisos} motivo={motivos[c.id] ?? ''} onMotivo={(m) => setMotivos((x) => ({ ...x, [c.id]: m }))} compacto /> : null}
                  </li>
                );
              })}
              {contas.length === 0 && <li className="px-3 py-3 text-sm text-zinc-500">Essas contas já estão pagas ou canceladas.</li>}
            </ul>

            {erro && <p className="text-xs text-red-600">{erro}</p>}

            <div className="flex items-center gap-2 pt-1">
              {pendentes.length > 0 && (
                <button onClick={salvar} disabled={salvando || procurando} className={PRINCIPAL}>
                  {salvando ? `Dando baixa… ${feitas}/${contas.length}` : <><i className="ri-check-double-line" /> {comAviso.length ? 'Dar baixa mesmo assim' : `Dar baixa em ${pendentes.length === 1 ? '1 conta' : `${pendentes.length} contas`}`} · {brl(total)}</>}
                </button>
              )}
              <button onClick={feitas ? onFeito : onFechar} disabled={salvando} className={SECUNDARIO}>{feitas ? 'Fechar' : 'Cancelar'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
