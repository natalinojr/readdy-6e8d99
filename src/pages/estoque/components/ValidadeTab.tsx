import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { todayBrasilia } from '@/lib/dateUtils';
import { rotuloUnidade } from '@/lib/estoqueRegras';
import { useEstoqueTela } from '../EstoqueTela';
import {
  Faixa, CartaoAcao, CartaoBarra, SecaoTitulo, Chips, Vazio, Etiqueta, Pagina, btn, brl, semAcento,
  type TomCartao, type CorBarra,
} from './ui/EstoqueUi';

// Insumos › Validade e lotes (layout novo, 2026-10-04). Sem lote nenhum, a aba diz isso e explica como
// vai passar a funcionar (antes dizia "todos dentro do prazo"). Com lotes: faixa que filtra, alertas em
// cartões com "Registrar perda" e "Editar validade".

type Nivel = 'expired' | 'critical' | 'warning' | 'ok';

interface ExpiryAlert {
  ingredient_id: string;
  ingredient_name: string;
  id: string;
  batch_code: string | null;
  quantity_remaining: number;
  unit: string;
  unit_cost: number | null;
  received_date: string | null;
  expiry_date: string;
  days_until_expiry: number;
  /** Coluna real na view: alert_level (não "status") */
  alert_level: Nivel;
}

interface IngredientBatch {
  id: string;
  ingredient_id: string;
  batch_code: string | null;
  quantity_remaining: number;
  unit: string;
  unit_cost: number | null;
  supplier_id: string | null;
  received_date: string;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
  ingredient_name?: string;
}

/** Linha do select de lotes com o insumo junto (join). */
type LoteBruto = IngredientBatch & { ingredients: { name: string; unit: string } | null };

type FiltroNivel = 'all' | Nivel;

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;

// Data pura (AAAA-MM-DD) sem fuso: new Date('2026-10-04') é meia-noite UTC e aparecia 03/10 em Brasília.
function formatDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
/** "qui 08/10" (com o ano só quando não é o de agora). Sem fuso: só aritmética de calendário. */
function dataCurta(ymd: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  const dia = DIAS_SEMANA[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  const ano = m[1] === todayBrasilia().slice(0, 4) ? '' : `/${m[1]}`;
  return `${dia} ${m[3]}/${m[2]}${ano}`;
}

/** Dias até vencer em datas de Brasília (validade é AAAA-MM-DD; new Date() dela é meia-noite UTC). Negativo = vencido. */
function diasAteVencer(ymd: string): number {
  const utc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((utc(ymd) - utc(todayBrasilia())) / 86400000);
}

function formatQty(qty: number, unit: string) {
  return `${qty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${rotuloUnidade(unit)}`;
}

/** Quando vence, em palavras, e a cor do texto. */
function quando(dias: number): { txt: string; cls: string } {
  if (dias < 0) return { txt: `vencido há ${plural(-dias, 'dia', 'dias')}`, cls: 'text-red-600' };
  if (dias === 0) return { txt: 'vence hoje', cls: 'text-red-600' };
  if (dias === 1) return { txt: 'vence amanhã', cls: 'text-orange-600' };
  return { txt: `vence em ${dias} dias`, cls: dias <= 3 ? 'text-orange-600' : dias <= 7 ? 'text-amber-700' : 'text-emerald-700' };
}

const SECOES: Array<{ nivel: Nivel; titulo: string; tom: TomCartao; icone: string }> = [
  { nivel: 'expired', titulo: 'Vencidos', tom: 'alerta', icone: 'ri-error-warning-line' },
  { nivel: 'critical', titulo: 'Vence em até 3 dias', tom: 'prop', icone: 'ri-alarm-warning-line' },
  { nivel: 'warning', titulo: 'Vence em 4 a 7 dias', tom: 'neutro', icone: 'ri-time-line' },
  { nivel: 'ok', titulo: 'Dentro do prazo', tom: 'neutro', icone: 'ri-checkbox-circle-line' },
];
const TITULO_NIVEL: Record<Nivel, string> = {
  expired: 'Vencidos', critical: 'Vence em até 3 dias', warning: 'Vence em 4 a 7 dias', ok: 'Dentro do prazo',
};

export default function ValidadeTab() {
  const { user } = useAuth();
  const toast = useToast();
  const { abrirPerda } = useEstoqueTela();
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([]);
  const [allBatches, setAllBatches] = useState<IngredientBatch[]>([]);
  const [loading, setLoading] = useState(true);
  // Erro de leitura aparece no lugar da lista (antes virava "tudo dentro do prazo").
  const [erroAlertas, setErroAlertas] = useState<string | null>(null);
  const [erroLotes, setErroLotes] = useState<string | null>(null);
  const [filter, setFilter] = useState<FiltroNivel>('all');
  const [viewMode, setViewMode] = useState<'alerts' | 'all'>('alerts');
  const [search, setSearch] = useState('');
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [editingExpiry, setEditingExpiry] = useState<string>('');
  const [savingExpiry, setSavingExpiry] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Carrega alertas de validade da view (só da loja aberta)
      const { data: alertData, error: alertErr } = await supabase
        .from('ingredient_expiry_alerts')
        .select('*')
        .eq('tenant_id', user.tenantId)
        .order('days_until_expiry', { ascending: true });

      // Carrega todos os lotes com join de insumo
      // Coluna real: expiry_date (não expires_at)
      const { data: batchData, error: batchErr } = await supabase
        .from('ingredient_batches')
        .select(`
          id, batch_code, quantity_remaining, unit_cost, supplier_id,
          received_date, expiry_date, notes, created_at,
          ingredient_id, tenant_id,
          ingredients (name, unit)
        `)
        .eq('tenant_id', user.tenantId)
        .order('expiry_date', { ascending: true, nullsFirst: false });

      setErroAlertas(alertErr ? alertErr.message : null);
      setErroLotes(batchErr ? batchErr.message : null);
      setAlerts((alertData ?? []) as unknown as ExpiryAlert[]);
      setAllBatches(
        ((batchData ?? []) as unknown as LoteBruto[]).map((b) => ({
          ...b,
          ingredient_name: b.ingredients?.name ?? '—',
          unit: b.ingredients?.unit ?? b.unit ?? '',
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    if (!user?.tenantId) return;
    loadData();
  }, [user?.tenantId, loadData]);

  const handleSaveExpiry = async (batchId: string) => {
    if (!user?.tenantId || !editingExpiry) return;
    setSavingExpiry(true);
    try {
      const { data, error } = await supabase
        .from('ingredient_batches')
        .update({ expiry_date: editingExpiry })
        .eq('id', batchId)
        .eq('tenant_id', user.tenantId)
        .select('id');
      // Confere o resultado: antes fechava a edição como se tivesse salvo mesmo com erro.
      if (error || !data?.length) {
        toast.error('Não salvei a validade', error?.message ?? 'Nenhum lote foi alterado. Atualize e tente de novo.');
        return;
      }
      setEditingBatchId(null);
      setEditingExpiry('');
      await loadData();
      toast.success('Validade atualizada');
    } finally {
      setSavingExpiry(false);
    }
  };

  const editar = (id: string, atual: string | null) => { setEditingBatchId(id); setEditingExpiry(atual ? atual.split('T')[0] : ''); };
  const cancelarEdicao = () => { setEditingBatchId(null); setEditingExpiry(''); };

  const termo = semAcento(search);
  const filteredAlerts = alerts.filter((a) => {
    const matchStatus = filter === 'all' || a.alert_level === filter;
    const matchSearch = !termo || semAcento(a.ingredient_name).includes(termo);
    return matchStatus && matchSearch;
  });
  const filteredBatches = allBatches.filter((b) => !termo || semAcento(b.ingredient_name ?? '').includes(termo));

  const counts: Record<Nivel, number> = {
    expired: alerts.filter((a) => a.alert_level === 'expired').length,
    critical: alerts.filter((a) => a.alert_level === 'critical').length,
    warning: alerts.filter((a) => a.alert_level === 'warning').length,
    ok: alerts.filter((a) => a.alert_level === 'ok').length,
  };
  // Tocar duas vezes no mesmo número tira o filtro.
  const escolher = (n: Nivel) => { setFilter((f) => (f === n ? 'all' : n)); setViewMode('alerts'); };

  if (loading) {
    return (
      <div className="py-14 text-center">
        <div className="w-6 h-6 mx-auto border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const botaoAtualizar = (
    <button type="button" onClick={loadData} className={btn('out', 'sm')} title="Atualizar">
      <i className="ri-refresh-line" /> Atualizar
    </button>
  );

  // Nenhum lote na loja (e a leitura deu certo): diz a verdade e mostra o caminho.
  if (!erroAlertas && !erroLotes && alerts.length === 0 && allBatches.length === 0) {
    return (
      <Pagina>
        <Vazio icone="ri-calendar-check-line" titulo="Nenhum lote com validade nesta loja" acao={botaoAtualizar}>
          Esta aba mostra o que vai vencer. Hoje nenhuma entrada anota a validade, por isso ela está vazia.
        </Vazio>
        <SecaoTitulo titulo="Como vai funcionar" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          <CartaoBarra cor="blue">
            <div className="flex items-start gap-2">
              <p className="flex-1 text-[14.5px] font-extrabold text-zinc-900"><i className="ri-truck-line text-blue-600 mr-1.5" />No Receber mercadoria</p>
              <Etiqueta tom="blue">em breve</Etiqueta>
            </div>
            <p className="text-[12.5px] text-zinc-600 leading-relaxed mt-1">
              Para perecível (laticínios, hortifrúti, molhos) o celular pergunta <b>"vence quando?"</b>: um toque em 3 dias, 7 dias, 15 dias ou a data.
            </p>
          </CartaoBarra>
          <CartaoBarra cor="amber">
            <div className="flex items-start gap-2">
              <p className="flex-1 text-[14.5px] font-extrabold text-zinc-900"><i className="ri-knife-line text-amber-600 mr-1.5" />Na Produção</p>
              <Etiqueta tom="blue">em breve</Etiqueta>
            </div>
            <p className="text-[12.5px] text-zinc-600 leading-relaxed mt-1">
              A ficha de produção guarda o prazo (guacamole = 3 dias). Ao registrar a produção, o lote já nasce com a validade.
            </p>
          </CartaoBarra>
        </div>
      </Pagina>
    );
  }

  // Valor que sobrou em cada lote (só dá para somar onde há custo).
  const valorDe = (lista: ExpiryAlert[]) => {
    const comCusto = lista.filter((a) => a.unit_cost != null);
    return { total: comCusto.reduce((s, a) => s + Number(a.quantity_remaining) * Number(a.unit_cost), 0), parcial: comCusto.length < lista.length };
  };

  return (
    <Pagina>
      {/* Faixa: os 4 números, e cada um filtra os alertas ao tocar */}
      {!erroAlertas && (
        <Faixa itens={[
          { valor: counts.expired, rotulo: 'Vencidos', tom: counts.expired ? 'red' : 'neutro', onClick: () => escolher('expired') },
          { valor: counts.critical, rotulo: 'Vence em até 3 dias', tom: counts.critical ? 'amber' : 'neutro', onClick: () => escolher('critical') },
          { valor: counts.warning, rotulo: 'Em 4 a 7 dias', onClick: () => escolher('warning') },
          { valor: counts.ok, rotulo: 'Ok (mais de 7 dias)', tom: counts.ok ? 'green' : 'neutro', onClick: () => escolher('ok') },
        ]} />
      )}

      {/* Alertas / Todos os lotes, busca e atualizar */}
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        <Chips<'alerts' | 'all'>
          valor={viewMode} onChange={setViewMode}
          opcoes={[
            { id: 'alerts', rotulo: 'Alertas', n: alerts.length },
            { id: 'all', rotulo: 'Todos os lotes', n: allBatches.length },
          ]}
        />
        <div className="flex items-center gap-2 md:ml-auto">
          <div className="relative flex-1 md:w-64">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
            <input
              type="text" placeholder="Procurar insumo..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 rounded-xl border border-zinc-200 shadow-sm pl-9 pr-3 text-sm bg-white focus:outline-none focus:border-amber-400"
            />
          </div>
          <div className="flex-shrink-0">{botaoAtualizar}</div>
        </div>
      </div>

      {viewMode === 'alerts' && filter !== 'all' && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          Mostrando só <b className="text-zinc-800">{TITULO_NIVEL[filter]}</b>
          <button type="button" onClick={() => setFilter('all')} className={btn('ghost', 'sm')}>Ver todos</button>
        </div>
      )}

      {/* Alertas */}
      {viewMode === 'alerts' && (
        erroAlertas ? (
          <ErroLeitura msg={erroAlertas} onTentar={loadData} />
        ) : filteredAlerts.length === 0 ? (
          alerts.length === 0 ? (
            <Vazio icone="ri-calendar-line" titulo="Nenhum lote com data de validade"
              acao={<button type="button" onClick={() => setViewMode('all')} className={btn('out', 'sm')}>Ver todos os lotes</button>}>
              Os lotes que existem ainda não têm validade marcada. Ponha a data em "Todos os lotes" e eles passam a aparecer aqui.
            </Vazio>
          ) : (
            <Vazio icone="ri-filter-line" titulo="Nenhum lote nesta busca"
              acao={<button type="button" onClick={() => { setFilter('all'); setSearch(''); }} className={btn('out', 'sm')}>Tirar os filtros</button>} />
          )
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            {SECOES.map((s) => {
              const lista = filteredAlerts.filter((a) => a.alert_level === s.nivel);
              if (!lista.length) return null;
              const v = valorDe(lista);
              return (
                <CartaoAcao
                  key={s.nivel} tom={s.tom} icone={s.icone}
                  titulo={<>{s.titulo} <Etiqueta tom={s.nivel === 'ok' ? 'green' : s.nivel === 'warning' ? 'amber' : 'red'}>{lista.length}</Etiqueta></>}
                  direita={v.total > 0 ? (
                    <div className="text-right">
                      <p className="text-[13px] font-extrabold tabular-nums text-zinc-800">{brl(v.total)}</p>
                      <p className="text-[10.5px] text-zinc-400">{v.parcial ? 'no estoque (parcial)' : 'no estoque'}</p>
                    </div>
                  ) : undefined}
                >
                  <ul className="divide-y divide-zinc-200/70">
                    {lista.map((a) => {
                      const q = quando(Number(a.days_until_expiry));
                      const editando = editingBatchId === a.id;
                      return (
                        <li key={a.id} className="py-2.5 first:pt-1 last:pb-0.5">
                          <p className="text-[13.5px] font-bold text-zinc-800 break-words">{a.ingredient_name}</p>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            {formatQty(Number(a.quantity_remaining), a.unit)}
                            {a.batch_code ? ` · lote ${a.batch_code}` : ''}
                            {a.received_date ? ` · recebido ${formatDate(a.received_date).slice(0, 5)}` : ''}
                            {' · '}vence {dataCurta(a.expiry_date)}
                            {' · '}<b className={q.cls}>{q.txt}</b>
                          </p>
                          <div className="mt-2">
                            {editando ? (
                              <EditorValidade
                                valor={editingExpiry} onChange={setEditingExpiry} salvando={savingExpiry}
                                onSalvar={() => handleSaveExpiry(a.id)} onCancelar={cancelarEdicao}
                              />
                            ) : (
                              <div className="flex gap-2 flex-wrap">
                                <button type="button" onClick={() => abrirPerda(a.ingredient_id)} className={btn(s.nivel === 'expired' ? 'perigo' : 'out', 'sm')}>
                                  <i className="ri-delete-bin-6-line" /> {s.nivel === 'expired' ? 'Jogou fora? Registrar perda' : 'Registrar perda'}
                                </button>
                                <button type="button" onClick={() => editar(a.id, a.expiry_date)} className={btn('out', 'sm')}>
                                  <i className="ri-pencil-line" /> Editar validade
                                </button>
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </CartaoAcao>
              );
            })}
          </div>
        )
      )}

      {/* Todos os lotes */}
      {viewMode === 'all' && (
        erroLotes ? (
          <ErroLeitura msg={erroLotes} onTentar={loadData} />
        ) : filteredBatches.length === 0 ? (
          <Vazio icone="ri-stack-line" titulo={allBatches.length === 0 ? 'Nenhum lote cadastrado' : 'Nenhum lote encontrado'}>
            {allBatches.length === 0 ? 'Entradas e compras ainda não registram lote nem validade.' : 'Nenhum lote nesta busca.'}
          </Vazio>
        ) : (
          <>
            {/* Celular: cartão por lote (a tabela não cabe em 375px) */}
            <ul className="md:hidden space-y-2">
              {filteredBatches.map((b) => {
                const daysLeft = b.expiry_date ? diasAteVencer(b.expiry_date) : null;
                const isExpired = daysLeft != null && daysLeft < 0;
                const isEditing = editingBatchId === b.id;
                const cor: CorBarra = isExpired ? 'red' : daysLeft != null && daysLeft <= 7 ? 'amber' : 'zinc';
                return (
                  <li key={b.id}>
                    <CartaoBarra cor={cor}>
                      <p className="text-sm font-bold text-zinc-800 break-words line-clamp-2">{b.ingredient_name}</p>
                      <div className="flex items-baseline justify-between gap-2 mt-1">
                        <span className="text-xs text-zinc-500">
                          {formatQty(Number(b.quantity_remaining), b.unit)}{b.batch_code ? ` · lote ${b.batch_code}` : ''}
                          {b.received_date ? ` · recebido ${formatDate(b.received_date).slice(0, 5)}` : ''}
                        </span>
                        <span className="text-sm font-semibold text-zinc-700 whitespace-nowrap">
                          {b.unit_cost != null ? Number(b.unit_cost).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}
                        </span>
                      </div>
                      <div className="mt-2">
                        {isEditing ? (
                          <div>
                            <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Data de validade</label>
                            <EditorValidade
                              valor={editingExpiry} onChange={setEditingExpiry} salvando={savingExpiry}
                              onSalvar={() => handleSaveExpiry(b.id)} onCancelar={cancelarEdicao}
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            {b.expiry_date && daysLeft != null ? (
                              <span className={`text-xs font-bold ${quando(daysLeft).cls}`}>
                                {dataCurta(b.expiry_date)} · {quando(daysLeft).txt}
                              </span>
                            ) : (
                              <span className="text-xs text-zinc-400">Sem validade</span>
                            )}
                            <span className="flex-1" />
                            <button type="button" onClick={() => editar(b.id, b.expiry_date)} className={btn('out', 'sm')}>
                              <i className={b.expiry_date ? 'ri-pencil-line' : 'ri-calendar-check-line'} /> {b.expiry_date ? 'Editar validade' : 'Pôr validade'}
                            </button>
                          </div>
                        )}
                      </div>
                    </CartaoBarra>
                  </li>
                );
              })}
            </ul>

            <div className="hidden md:block bg-white rounded-2xl border border-zinc-200 overflow-hidden overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: '640px' }}>
                <thead className="border-b border-zinc-200">
                  <tr>
                    <th className="text-left pl-5 pr-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Insumo</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Código do Lote</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Quantidade</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Custo/Un</th>
                    <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Recebido em</th>
                    <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Vencimento</th>
                    <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100/80">
                  {filteredBatches.map((b) => {
                    const daysLeft = b.expiry_date ? diasAteVencer(b.expiry_date) : null;
                    const isExpired = daysLeft != null && daysLeft < 0;
                    const isEditing = editingBatchId === b.id;
                    return (
                      <tr key={b.id} className={`hover:bg-zinc-50 transition-colors ${isExpired ? 'bg-red-50/50' : ''}`}>
                        <td className="pl-5 pr-4 py-3 font-semibold text-zinc-800"><span className="block truncate max-w-[240px]" title={b.ingredient_name}>{b.ingredient_name}</span></td>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                          {b.batch_code ?? <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-700">
                          {formatQty(Number(b.quantity_remaining), b.unit)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-zinc-500">
                          {b.unit_cost != null
                            ? Number(b.unit_cost).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                            : <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center text-zinc-500 text-xs">
                          {b.received_date ? formatDate(b.received_date) : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isEditing ? (
                            <div className="flex justify-center">
                              <EditorValidade
                                valor={editingExpiry} onChange={setEditingExpiry} salvando={savingExpiry}
                                onSalvar={() => handleSaveExpiry(b.id)} onCancelar={cancelarEdicao}
                              />
                            </div>
                          ) : b.expiry_date && daysLeft != null ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`text-xs font-semibold ${isExpired ? 'text-red-600' : daysLeft <= 3 ? 'text-orange-600' : daysLeft <= 7 ? 'text-amber-600' : 'text-zinc-600'}`}>
                                {formatDate(b.expiry_date)}
                              </span>
                              <span className={`text-[10px] font-bold ${isExpired ? 'text-red-500' : daysLeft <= 3 ? 'text-orange-500' : daysLeft <= 7 ? 'text-amber-500' : 'text-zinc-400'}`}>
                                {isExpired ? `vencido há ${Math.abs(daysLeft)}d` : `${daysLeft}d restantes`}
                              </span>
                            </div>
                          ) : (
                            <span className="text-zinc-300 text-xs">Sem validade</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {!isEditing && (
                            <button type="button" onClick={() => editar(b.id, b.expiry_date)} className={btn('out', 'sm')}>
                              <i className={b.expiry_date ? 'ri-pencil-line' : 'ri-calendar-check-line'} /> {b.expiry_date ? 'Editar validade' : 'Pôr validade'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </Pagina>
  );
}

function ErroLeitura({ msg, onTentar }: { msg: string; onTentar: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-5 text-center">
      <i className="ri-error-warning-line text-3xl text-red-300" />
      <p className="text-sm font-extrabold text-red-700 mt-1">Não foi possível ler os lotes</p>
      <p className="text-xs text-red-600 mt-1 break-words">{msg}</p>
      <button type="button" onClick={onTentar} className={`${btn('out', 'sm')} mt-3`}>Tentar de novo</button>
    </div>
  );
}

function EditorValidade({ valor, onChange, onSalvar, onCancelar, salvando }: {
  valor: string; onChange: (v: string) => void; onSalvar: () => void; onCancelar: () => void; salvando: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input
        type="date" value={valor} onChange={(e) => onChange(e.target.value)} aria-label="Nova data de validade"
        className="h-[38px] text-base md:text-sm border border-amber-300 rounded-xl px-2 bg-white focus:outline-none focus:border-amber-500"
      />
      <button type="button" onClick={onSalvar} disabled={salvando || !valor} className={btn('p', 'sm')}>
        {salvando ? <i className="ri-loader-4-line animate-spin" /> : 'Salvar'}
      </button>
      <button type="button" onClick={onCancelar} disabled={salvando} className={btn('out', 'sm')} aria-label="Cancelar">
        <i className="ri-close-line" />
      </button>
    </div>
  );
}
