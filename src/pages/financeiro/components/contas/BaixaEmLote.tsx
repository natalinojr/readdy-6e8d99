// "Paguei no banco" em lote (2026-10-08): dar baixa de várias contas selecionadas de uma vez, pelo mesmo
// caminho da baixa de uma conta (financial-write › pay_bill, com o aviso antes de pagar). Cada conta é
// baixada pelo que falta pagar; a data e a forma valem para todas; a classificação DRE é pedida só nas
// contas que não têm (regra do dono, 2026-09-12).
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
type Resultado = { ok: true } | { ok: false; avisos?: AvisoPagar[]; erro?: string };

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
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { toPayload } = useDreEscolha();

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

  const falta = (c: Conta) => Math.round((Number(c.amount) - Number(c.paid_amount ?? 0)) * 100) / 100;
  const pendentes = (contas ?? []).filter((c) => !(res[c.id]?.ok));
  const comAviso = pendentes.filter((c) => { const r = res[c.id]; return r && !r.ok && r.avisos?.length; });
  const total = pendentes.reduce((t, c) => t + falta(c), 0);

  const salvar = async () => {
    const semDre = pendentes.filter((c) => precisaClassificarDRE(c) && !dre[c.id]);
    if (semDre.length) { setErro(`Escolha a classificação DRE de ${semDre.length === 1 ? '1 conta' : `${semDre.length} contas`}.`); return; }
    if (comAviso.some((c) => (motivos[c.id] ?? '').trim().length < 3)) { setErro('Escreva o motivo nas contas com aviso para dar baixa mesmo assim.'); return; }
    setSalvando(true); setErro(null);
    const novo: Record<string, Resultado> = { ...res };
    // Uma de cada vez: o servidor confere os avisos de cada conta (pagamento em dobro, valor diferente…).
    for (const c of pendentes) {
      const jaAvisou = !!(res[c.id] && !res[c.id].ok && (res[c.id] as { avisos?: AvisoPagar[] }).avisos?.length);
      const { data: r, error } = await invokeWithAuth<{ error?: string }>('financial-write', {
        body: { action: 'pay_bill', tenant_id: tenantId, payload: {
          id: c.id, paid_date: dia, paid_amount: falta(c), payment_method: forma,
          ...(precisaClassificarDRE(c) ? toPayload(dre[c.id]) ?? {} : {}),
          ...(jaAvisou ? { motivo_aviso: (motivos[c.id] ?? '').trim() } : {}),
        } },
      });
      if ((error as { code?: string } | null)?.code === PRECISA_CONFIRMAR) novo[c.id] = { ok: false, avisos: avisosDaMensagem(error!.message) };
      else if (error?.message || r?.error) novo[c.id] = { ok: false, erro: String(error?.message ?? r?.error) };
      else novo[c.id] = { ok: true };
      setRes({ ...novo });
    }
    setSalvando(false);
    const faltam = (contas ?? []).filter((c) => !novo[c.id]?.ok);
    if (!faltam.length) onFeito();
  };

  const feitas = (contas ?? []).filter((c) => res[c.id]?.ok).length;
  const campo = 'h-9 px-2 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:border-amber-400';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => !salvando && onFechar()}>
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold text-zinc-900">Paguei no banco</h3>
          <button onClick={onFechar} disabled={salvando} className="w-9 h-9 rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar"><i className="ri-close-line text-lg" /></button>
        </div>
        <p className="text-xs text-zinc-500">Dá baixa nas contas abaixo pelo valor que falta. Não faz pagamento: é para o que já saiu do banco.</p>

        {contas === null ? <p className="text-sm text-zinc-500">Carregando…</p> : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-zinc-500">Pago em
                <input type="date" value={dia} max={hoje} onChange={(e) => setDia(e.target.value)} className={`${campo} w-full mt-0.5`} disabled={salvando} />
              </label>
              <label className="text-[11px] text-zinc-500">Como
                <select value={forma} onChange={(e) => setForma(e.target.value)} className={`${campo} w-full mt-0.5`} disabled={salvando}>
                  {['Boleto', 'Pix', 'Transferência', 'Dinheiro'].map((f) => <option key={f}>{f}</option>)}
                </select>
              </label>
            </div>

            <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl">
              {contas.map((c) => {
                const r = res[c.id];
                return (
                  <li key={c.id} className="px-3 py-2 space-y-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-zinc-500 tabular-nums w-11">{ddmm(c.due_date)}</span>
                      <span className="flex-1 min-w-0 truncate text-sm font-semibold text-zinc-800">{c.supplier || c.description}</span>
                      <span className="text-sm font-bold tabular-nums">{brl(falta(c))}</span>
                      {r?.ok && <i className="ri-check-line text-emerald-600" title="Baixa feita" />}
                    </div>
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
                <button onClick={salvar} disabled={salvando} className={PRINCIPAL}>
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
