import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { confirmar, perguntar } from '@/components/base/Dialogos';
import { useVoltarFecha } from '@/lib/voltarAndroid';

// ── Fornecedor pré-pago (2026-09-26, caso Facebook/Meta Ads) ─────────────────
// A loja põe crédito por Pix (recarga) e depois recebe a nota do que foi CONSUMIDO no mês.
// Recarga = sai do caixa, fica como crédito, fora do DRE. Nota = despesa no mês do consumo,
// paga com o crédito. Backend: conciliacao-pagamentos › prepaid_* (tabelas fin_prepaid_*).

export interface PrePagoMove {
  id: string; kind: 'topup' | 'consumption' | 'adjust'; amount: number; date: string;
  statement_id: string | null; document_id: string | null; note: string | null;
}
export interface PrePagoNota { id: string; numero: number | null; valor: number; competencia: string; antes_do_inicio: boolean }
export interface PrePagoFornecedor {
  id: string; cnpj: string; name: string; dre_category_id: string; cost_center_id: string | null;
  start_date: string; opening_balance: number; is_active: boolean; saldo: number;
  moves: PrePagoMove[]; notas_pendentes: PrePagoNota[];
}
type Resp<T> = T & { success?: boolean; error?: string; message?: string };
interface Dre { id: string; name: string; group_type: string }

async function conc<T>(tenantId: string, body: Record<string, unknown>): Promise<Resp<T>> {
  const { data, error } = await invokeWithAuth<Resp<T>>('conciliacao-pagamentos', { body: { tenant_id: tenantId, ...body } });
  if (error) return { success: false, error: error.message } as Resp<T>;
  return (data ?? { success: false, error: 'Sem resposta' }) as Resp<T>;
}

export async function listarPrePagos(tenantId: string, cnpj?: string | null) {
  return conc<{ suppliers?: PrePagoFornecedor[]; financeiro_inicio?: string | null }>(tenantId, { action: 'prepaid_list', cnpj: cnpj ?? undefined });
}

const brl = (n: number | null | undefined) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n ?? 0));
const dataBR = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—');
const mesBR = (s: string) => `${s.slice(5, 7)}/${s.slice(0, 4)}`;
const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

function useDres(tenantId: string) {
  const [dres, setDres] = useState<Dre[]>([]);
  useEffect(() => {
    if (!tenantId) return;
    supabase.from('fin_dre_categories').select('id, name, group_type').eq('tenant_id', tenantId).is('deleted_at', null).order('sort_order')
      .then(({ data }) => setDres(((data ?? []) as Dre[]).filter((d) => !['revenue', 'tax', 'cost'].includes(d.group_type))));
  }, [tenantId]);
  return dres;
}

// ── Formulário: marcar/editar fornecedor como pré-pago ───────────────────────
function FormPrePago({ tenantId, cnpj, nome, inicial, inicioSugerido, onSalvo, onCancelar, onErro }: {
  tenantId: string; cnpj: string; nome: string; inicial?: PrePagoFornecedor | null; inicioSugerido: string;
  onSalvo: (msg: string) => void; onCancelar?: () => void; onErro: (t: string, m?: string) => void;
}) {
  const dres = useDres(tenantId);
  const [dre, setDre] = useState(inicial?.dre_category_id ?? '');
  const [inicio, setInicio] = useState(inicial?.start_date ?? inicioSugerido);
  const [abertura, setAbertura] = useState(String(inicial?.opening_balance ?? 0).replace('.', ','));
  const [salvando, setSalvando] = useState(false);
  // Marketing costuma ser a categoria do Facebook/Google: sugere se existir
  useEffect(() => {
    if (dre || dres.length === 0) return;
    const mk = dres.find((d) => /marketing|publicidade|propaganda|anúncio|anuncio/i.test(d.name));
    if (mk) setDre(mk.id);
  }, [dres, dre]);

  const salvar = async () => {
    setSalvando(true);
    const r = await conc<object>(tenantId, {
      action: 'prepaid_save', cnpj, name: nome, dre_category_id: dre, cost_center_id: inicial?.cost_center_id ?? null,
      start_date: inicio, opening_balance: Number(abertura.replace(/\./g, '').replace(',', '.')) || 0, is_active: true,
    });
    setSalvando(false);
    if (!r.success) { onErro('Não foi possível salvar', r.error); return; }
    onSalvo(r.message ?? 'Salvo');
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Categoria da DRE do consumo</label>
          <select value={dre} onChange={(e) => setDre(e.target.value)} className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 cursor-pointer">
            <option value="">Escolha…</option>
            {dres.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Recargas a partir de</label>
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Crédito que já havia nessa data</label>
          <input inputMode="decimal" value={abertura} onChange={(e) => setAbertura(e.target.value)} className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-right focus:outline-none focus:border-amber-400" />
        </div>
      </div>
      <p className="text-[11px] text-zinc-500">
        Os Pix a este CNPJ desde essa data viram <strong>recarga</strong>: saem do caixa, mas não entram no DRE. Cada nota vira a despesa do mês em que foi consumida e desconta do crédito.
        Se não souber o crédito inicial, deixe 0 e depois use "Acertar saldo" com o saldo que o fornecedor mostra.
      </p>
      <div className="flex justify-end gap-2">
        {onCancelar && <button onClick={onCancelar} className="px-3 py-1.5 text-xs font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 cursor-pointer">Cancelar</button>}
        <button onClick={salvar} disabled={salvando || !dre || !inicio}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-40 cursor-pointer">
          {salvando ? 'Salvando…' : inicial ? 'Salvar' : 'Marcar como pré-pago'}
        </button>
      </div>
    </div>
  );
}

// ── Bloco dentro do "Conferir" da nota ───────────────────────────────────────
/** Mostra o crédito do fornecedor e lança a nota do crédito. `onAtivo(true)` = o Conferir
 *  esconde o lançamento normal (parcelas, nota do mês, tipo). */
export function PrePagoConferir({ doc, tenantId, podeLancar, onAtivo, onLancado, onErro }: {
  doc: { id: string; emitente_cnpj: string | null; emitente_nome: string | null; valor_total: number; modelo: number; emitted_at: string | null; itens?: Array<{ competencia?: string | null }> };
  tenantId: string; podeLancar: boolean;
  onAtivo: (ativo: boolean) => void; onLancado: (msg: string) => void; onErro: (t: string, m?: string) => void;
}) {
  const [sup, setSup] = useState<PrePagoFornecedor | null>(null);
  const [inicioLoja, setInicioLoja] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [configurando, setConfigurando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const cnpj = soDigitos(doc.emitente_cnpj);

  const carregar = useCallback(async () => {
    if (cnpj.length !== 14) { setCarregado(true); return; }
    const r = await listarPrePagos(tenantId, cnpj);
    const s = r.success ? (r.suppliers ?? []).find((x) => x.is_active) ?? null : null;
    setSup(s);
    setInicioLoja(r.financeiro_inicio ?? null);
    setCarregado(true);
    onAtivo(Boolean(s));
  }, [tenantId, cnpj, onAtivo]);
  useEffect(() => { carregar(); }, [carregar]);

  const competencia = useMemo(() => {
    const c = String(doc.itens?.[0]?.competencia ?? '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(c) ? c : String(doc.emitted_at ?? '').slice(0, 10);
  }, [doc.itens, doc.emitted_at]);

  if (!carregado || cnpj.length !== 14) return null;

  if (!sup) {
    // Só NFS-e oferece: é onde aparece crédito de anúncio/plataforma
    if (Number(doc.modelo) !== 10 || !podeLancar) return null;
    const sugerido = inicioLoja ?? `${competencia.slice(0, 7)}-01`;
    return (
      <div className="border border-zinc-100 rounded-xl p-3">
        {!configurando ? (
          <button onClick={() => setConfigurando(true)} className="w-full text-left flex items-start gap-2 cursor-pointer">
            <i className="ri-wallet-3-line text-violet-500 mt-0.5" />
            <span>
              <span className="text-xs font-bold text-zinc-800">Você põe crédito neste fornecedor por Pix? (ex.: Facebook, Google Ads)</span>
              <span className="block text-[11px] text-zinc-500">Marque como <strong>pré-pago</strong>: os Pix viram recarga e esta nota vira a despesa do mês do consumo, paga com o crédito. Aí não precisa bater Pix com nota.</span>
            </span>
          </button>
        ) : (
          <>
            <p className="text-xs font-bold text-zinc-800 mb-2"><i className="ri-wallet-3-line text-violet-500 mr-1" />{doc.emitente_nome} é pré-pago</p>
            <FormPrePago tenantId={tenantId} cnpj={cnpj} nome={doc.emitente_nome ?? cnpj} inicioSugerido={sugerido}
              onCancelar={() => setConfigurando(false)} onErro={onErro}
              onSalvo={async () => { setConfigurando(false); await carregar(); }} />
          </>
        )}
      </div>
    );
  }

  const total = Number(doc.valor_total ?? 0);
  const depois = Math.round((sup.saldo - total) * 100) / 100;
  const antes = competencia < sup.start_date;
  const lancar = async () => {
    setEnviando(true);
    const r = await conc<object>(tenantId, { action: 'prepaid_consume', document_id: doc.id });
    setEnviando(false);
    if (!r.success) { onErro('Não foi possível lançar', r.error); return; }
    onLancado(r.message ?? 'Lançada do crédito');
  };

  return (
    <div className="border border-violet-200 bg-violet-50/40 rounded-xl p-3 space-y-2">
      <p className="text-xs font-bold text-zinc-800"><i className="ri-wallet-3-line text-violet-600 mr-1" />Fornecedor pré-pago: esta nota é o consumo de {mesBR(competencia)}</p>
      {antes ? (
        <p className="text-[11px] text-amber-800">
          O consumo de {mesBR(competencia)} é de antes do início do crédito ({dataBR(sup.start_date)}): foi pago com recargas que não estão no sistema. Normalmente se <strong>ignora</strong> esta nota (botão de ignorar na lista).
        </p>
      ) : (
        <>
          <p className="text-[11px] text-zinc-600">Vira despesa no DRE em <strong>{dataBR(competencia)}</strong> e é paga com o crédito. Não mexe no caixa: o dinheiro já saiu nas recargas.</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white rounded-lg border border-zinc-100 p-2"><p className="text-[10px] uppercase text-zinc-400">Crédito agora</p><p className="text-sm font-bold text-zinc-800">{brl(sup.saldo)}</p></div>
            <div className="bg-white rounded-lg border border-zinc-100 p-2"><p className="text-[10px] uppercase text-zinc-400">Esta nota</p><p className="text-sm font-bold text-zinc-800">− {brl(total)}</p></div>
            <div className="bg-white rounded-lg border border-zinc-100 p-2"><p className="text-[10px] uppercase text-zinc-400">Depois</p><p className={`text-sm font-bold ${depois < -0.009 ? 'text-red-600' : 'text-emerald-700'}`}>{brl(depois)}</p></div>
          </div>
          {depois < -0.009 && (
            <p className="text-[11px] text-red-600">O crédito fica negativo: falta alguma recarga no extrato (paga de outra conta?) ou o crédito inicial está errado. Dá para lançar e depois "Acertar saldo" em Notas de entrada › Crédito pré-pago.</p>
          )}
          <div className="flex justify-end">
            <button onClick={lancar} disabled={!podeLancar || enviando || total <= 0}
              title={!podeLancar ? 'Apenas administradores e gerentes' : undefined}
              className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-40 cursor-pointer">
              {enviando ? 'Lançando…' : `Lançar do crédito · ${brl(total)}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Janela "Crédito pré-pago": saldo, extrato do crédito, acerto ────────────
const KIND: Record<PrePagoMove['kind'], { txt: string; icon: string }> = {
  topup: { txt: 'Recarga (Pix)', icon: 'ri-add-circle-line text-emerald-600' },
  consumption: { txt: 'Consumo (nota)', icon: 'ri-indeterminate-circle-line text-violet-600' },
  adjust: { txt: 'Acerto', icon: 'ri-equalizer-line text-zinc-500' },
};

export function PrePagoModal({ tenantId, podeLancar, onClose, onConferir, onErro, onOk }: {
  tenantId: string; podeLancar: boolean; onClose: () => void;
  onConferir: (documentId: string) => void; onErro: (t: string, m?: string) => void; onOk: (msg: string) => void;
}) {
  useVoltarFecha(true, onClose, 'prepago');
  const [lista, setLista] = useState<PrePagoFornecedor[] | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [inicioLoja, setInicioLoja] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await listarPrePagos(tenantId);
    if (!r.success) { onErro('Não foi possível carregar', r.error); setLista([]); return; }
    setLista(r.suppliers ?? []);
    setInicioLoja(r.financeiro_inicio ?? null);
  }, [tenantId, onErro]);
  useEffect(() => { carregar(); }, [carregar]);

  const acertar = async (s: PrePagoFornecedor) => {
    const v = await perguntar({
      titulo: `Saldo de crédito em ${s.name}`,
      mensagem: `Digite o saldo que o fornecedor mostra hoje (no Facebook: Gerenciador de Anúncios › Cobrança › saldo disponível). O sistema está com ${brl(s.saldo)}. A diferença entra como acerto, fora do DRE.`,
      placeholder: '0,00', confirmarLabel: 'Acertar',
    });
    if (v == null) return;
    const r = await conc<object>(tenantId, { action: 'prepaid_adjust', supplier_id: s.id, saldo_real: v.replace(/\./g, '').replace(',', '.') });
    if (!r.success) { onErro('Não foi possível acertar', r.error); return; }
    onOk(r.message ?? 'Saldo acertado');
    await carregar();
  };
  const apagarAcerto = async (m: PrePagoMove) => {
    if (!(await confirmar({ titulo: 'Apagar este acerto?', mensagem: `${brl(m.amount)} em ${dataBR(m.date)}. O saldo volta a ser calculado sem ele.`, confirmarLabel: 'Apagar', perigo: true }))) return;
    const r = await conc<object>(tenantId, { action: 'prepaid_move_delete', id: m.id });
    if (!r.success) { onErro('Não foi possível apagar', r.error); return; }
    await carregar();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b border-zinc-100">
          <div>
            <h3 className="text-sm font-bold text-zinc-900"><i className="ri-wallet-3-line text-violet-600 mr-1" />Crédito pré-pago</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Fornecedores em que você põe crédito por Pix e recebe a nota do consumo depois. Recarga sai do caixa; a despesa entra no DRE pela nota, no mês do consumo.</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500"><i className="ri-close-line" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {lista === null ? <p className="text-sm text-zinc-400 text-center py-6">Carregando…</p>
            : lista.length === 0 ? <p className="text-sm text-zinc-500 text-center py-6">Nenhum fornecedor pré-pago. Para marcar um, abra uma nota dele em "Conferir".</p>
            : lista.map((s) => {
              // Saldo depois de cada movimento (a lista vem do mais novo para o mais antigo)
              const asc = [...s.moves].reverse();
              let acc = Number(s.opening_balance);
              const saldoApos = new Map<string, number>();
              for (const m of asc) { acc = Math.round((acc + Number(m.amount)) * 100) / 100; saldoApos.set(m.id, acc); }
              return (
                <div key={s.id} className="border border-zinc-100 rounded-xl">
                  <div className="p-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-zinc-800 truncate">{s.name}{!s.is_active && <span className="ml-2 text-[10px] font-semibold text-zinc-400">desativado</span>}</p>
                      <p className="text-[11px] text-zinc-500">Recargas desde {dataBR(s.start_date)} · crédito inicial {brl(s.opening_balance)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-zinc-400">Saldo de crédito</p>
                      <p className={`text-xl font-bold ${s.saldo < -0.009 ? 'text-red-600' : 'text-violet-700'}`}>{brl(s.saldo)}</p>
                    </div>
                  </div>
                  {podeLancar && (
                    <div className="px-4 pb-3 flex flex-wrap gap-2">
                      <button onClick={() => acertar(s)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 cursor-pointer">Acertar saldo</button>
                      <button onClick={() => setEditando(editando === s.id ? null : s.id)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-zinc-600 hover:bg-zinc-100 cursor-pointer">Editar</button>
                    </div>
                  )}
                  {editando === s.id && (
                    <div className="px-4 pb-4">
                      <FormPrePago tenantId={tenantId} cnpj={s.cnpj} nome={s.name} inicial={s} inicioSugerido={inicioLoja ?? s.start_date}
                        onCancelar={() => setEditando(null)} onErro={onErro}
                        onSalvo={async (msg) => { setEditando(null); onOk(msg); await carregar(); }} />
                    </div>
                  )}
                  {s.saldo < -0.009 && (
                    <p className="mx-4 mb-3 text-[11px] text-red-600">Saldo negativo: falta alguma recarga (Pix de outra conta ou cartão?) ou o crédito inicial está errado. Use "Acertar saldo" com o valor que o fornecedor mostra.</p>
                  )}
                  {s.notas_pendentes.length > 0 && (
                    <div className="mx-4 mb-3 rounded-lg bg-amber-50 border border-amber-100 p-2.5 space-y-1">
                      <p className="text-[11px] font-bold text-amber-800">Notas a lançar do crédito</p>
                      {s.notas_pendentes.map((n) => (
                        <div key={n.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-zinc-700">NF {n.numero ?? '—'} · consumo de {mesBR(n.competencia)} · {brl(n.valor)}{n.antes_do_inicio && <span className="text-amber-700"> · antes do início: ignorar</span>}</span>
                          <button onClick={() => onConferir(n.id)} className="font-semibold text-amber-700 hover:underline cursor-pointer whitespace-nowrap">Conferir</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="border-t border-zinc-100 max-h-72 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-50 text-zinc-400 uppercase text-[10px] sticky top-0">
                        <tr><th className="text-left px-3 py-1.5">Data</th><th className="text-left px-3 py-1.5">Movimento</th><th className="text-right px-3 py-1.5">Valor</th><th className="text-right px-3 py-1.5">Saldo</th><th className="w-8" /></tr>
                      </thead>
                      <tbody>
                        {s.moves.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-zinc-400">Nenhuma recarga ou consumo ainda.</td></tr>}
                        {s.moves.map((m) => (
                          <tr key={m.id} className="border-t border-zinc-50">
                            <td className="px-3 py-1.5 text-zinc-600 whitespace-nowrap">{dataBR(m.date)}</td>
                            <td className="px-3 py-1.5 text-zinc-700"><i className={`${KIND[m.kind].icon} mr-1`} />{KIND[m.kind].txt}{m.note && <span className="block text-[10px] text-zinc-400">{m.note}</span>}</td>
                            <td className={`px-3 py-1.5 text-right font-medium whitespace-nowrap ${Number(m.amount) < 0 ? 'text-violet-700' : 'text-emerald-700'}`}>{Number(m.amount) > 0 ? '+' : ''}{brl(m.amount)}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-600 whitespace-nowrap">{brl(saldoApos.get(m.id))}</td>
                            <td className="px-1">
                              {m.kind === 'adjust' && podeLancar && (
                                <button onClick={() => apagarAcerto(m)} title="Apagar acerto" className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 cursor-pointer"><i className="ri-delete-bin-line" /></button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
