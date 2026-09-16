import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { PRODUTOS_CARTAO, type ProdutoCartao } from './TaxasContratadas';

// Repasses da Stone dia a dia: quanto a Stone liquidou × quanto entrou no banco, separado em
// débito e crédito antecipado (edge conciliacao-pagamentos › stone_repasses → fn_stone_repasses).
// Mostra onde a diferença é real (faltou/sobrou) e onde é só falta de dado (sem extrato, dia fecha).

export interface RepasseStone {
  dia: string;
  pilha: 'antecipado' | 'debito';
  vendas: number;
  bruto: number;
  taxa: number;
  antecipacao: number;
  liquido_stone: number;
  depositado: number;
  creditos: number;
  diferenca: number;
  dia_liquido_stone: number;
  dia_depositado: number;
  situacao: 'ok' | 'dia_fecha' | 'faltou' | 'sobrou' | 'sem_deposito' | 'sem_venda' | 'sem_extrato';
}

const fmtData = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR');
const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Situação em português. `recente` = hoje/ontem, quando o arquivo da Stone ou o crédito ainda podem chegar. */
export function situacaoRepasse(r: RepasseStone): { label: string; explica: string; tom: 'ok' | 'info' | 'alerta' | 'erro' } {
  const recente = r.dia >= new Date(Date.now() - 36 * 3600_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  switch (r.situacao) {
    case 'ok':
      return { label: 'Bateu', explica: 'O banco recebeu exatamente o que a Stone liquidou.', tom: 'ok' };
    case 'dia_fecha':
      return {
        label: 'Bateu no dia',
        explica: `Separando débito e antecipado não fecha, mas o dia inteiro fecha (Stone ${formatCurrency(r.dia_liquido_stone)} × banco ${formatCurrency(r.dia_depositado)}). A Stone não informou a antecipação nas vendas desse dia.`,
        tom: 'info',
      };
    case 'faltou':
      return {
        label: 'Faltou no banco',
        explica: `A Stone diz que liquidou ${formatCurrency(r.liquido_stone)}, mas entrou ${formatCurrency(r.depositado)}. Confira no extrato do banco se o restante caiu em outro dia; se não caiu, cobre a Stone.`,
        tom: 'erro',
      };
    case 'sobrou':
      return {
        label: 'Entrou a mais',
        explica: `Entrou ${formatCurrency(r.depositado)} e a Stone só informou ${formatCurrency(r.liquido_stone)}. Pode ser crédito de outro dia caindo junto.`,
        tom: 'alerta',
      };
    case 'sem_deposito':
      return recente
        ? { label: 'Aguardando banco', explica: 'A Stone liquidou, mas o crédito ainda não apareceu no extrato. Normal para hoje/ontem.', tom: 'info' }
        : { label: 'Não entrou', explica: `A Stone liquidou ${formatCurrency(r.liquido_stone)} e nada entrou no banco nesse dia.`, tom: 'erro' };
    case 'sem_venda':
      return recente
        ? { label: 'Aguardando Stone', explica: 'O dinheiro entrou, mas o arquivo da Stone do dia só sai no dia seguinte.', tom: 'info' }
        : { label: 'Sem vendas da Stone', explica: 'Entrou no banco, mas não há vendas da Stone importadas para esse dia. Importe o período da Stone.', tom: 'alerta' };
    case 'sem_extrato':
    default:
      return { label: 'Sem extrato do banco', explica: 'Dia anterior ao extrato importado do banco: não há com o que comparar.', tom: 'info' };
  }
}

const TOM_CLS = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  info: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  alerta: 'bg-amber-50 text-amber-700 border-amber-200',
  erro: 'bg-red-50 text-red-700 border-red-200',
} as const;

type Filtro = 'problemas' | 'todos' | 'ok' | 'sem_dado';

interface Props {
  dateFrom: string;
  dateTo: string;
  abaInicial?: 'repasses' | 'taxas';
  onClose: () => void;
}

export default function RepassesStoneModal({ dateFrom, dateTo, abaInicial = 'repasses', onClose }: Props) {
  const { user } = useAuth();
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [rows, setRows] = useState<RepasseStone[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('problemas');
  const [aba, setAba] = useState<'repasses' | 'taxas'>(abaInicial);

  useEffect(() => {
    if (!user?.tenantId || !from || !to || from > to) return;
    let vivo = true;
    setLoading(true); setErro(null);
    invokeWithAuth<{ success?: boolean; error?: string; rows?: RepasseStone[] }>('conciliacao-pagamentos', {
      body: { action: 'stone_repasses', tenant_id: user.tenantId, date_from: from, date_to: to },
    }).then((r) => {
      if (!vivo) return;
      const e = r.data?.error ?? r.error?.message;
      if (e) setErro(e);
      setRows((r.data?.rows ?? []).map((x) => ({
        ...x,
        vendas: Number(x.vendas), bruto: Number(x.bruto), taxa: Number(x.taxa), antecipacao: Number(x.antecipacao),
        liquido_stone: Number(x.liquido_stone), depositado: Number(x.depositado), creditos: Number(x.creditos),
        diferenca: Number(x.diferenca), dia_liquido_stone: Number(x.dia_liquido_stone), dia_depositado: Number(x.dia_depositado),
      })));
      setLoading(false);
    });
    return () => { vivo = false; };
  }, [user?.tenantId, from, to]);

  const comSituacao = useMemo(() => rows.map((r) => ({ r, s: situacaoRepasse(r) })), [rows]);

  const resumo = useMemo(() => {
    const soma = (f: (x: { r: RepasseStone; s: ReturnType<typeof situacaoRepasse> }) => boolean) => {
      const l = comSituacao.filter(f);
      return { n: l.length, stone: l.reduce((a, x) => a + x.r.liquido_stone, 0), banco: l.reduce((a, x) => a + x.r.depositado, 0), dif: l.reduce((a, x) => a + x.r.diferenca, 0) };
    };
    return {
      ok: soma((x) => x.s.tom === 'ok' || x.r.situacao === 'dia_fecha'),
      problemas: soma((x) => x.s.tom === 'erro' || x.s.tom === 'alerta'),
      semDado: soma((x) => x.s.tom === 'info' && x.r.situacao !== 'dia_fecha'),
    };
  }, [comSituacao]);

  const visiveis = comSituacao.filter(({ r, s }) => {
    if (filtro === 'todos') return true;
    if (filtro === 'problemas') return s.tom === 'erro' || s.tom === 'alerta';
    if (filtro === 'ok') return s.tom === 'ok' || r.situacao === 'dia_fecha';
    return s.tom === 'info' && r.situacao !== 'dia_fecha';
  });

  const chip = (k: Filtro, label: string, n: number, extra?: string) => (
    <button
      onClick={() => setFiltro(k)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer whitespace-nowrap ${filtro === k ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'}`}
    >
      {label} <span className="opacity-70">({n}){extra ? ` · ${extra}` : ''}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-zinc-900 flex items-center gap-2"><i className="ri-bank-card-line text-amber-500" /> Repasses da Stone</h3>
            <p className="text-xs text-zinc-500">
              {aba === 'repasses'
                ? 'Quanto a Stone liquidou × quanto entrou no banco, por dia, separado em débito e crédito antecipado.'
                : 'Taxa que a Stone cobrou em cada venda × taxa contratada.'}
            </p>
            <div className="flex gap-1 mt-2">
              {(['repasses', 'taxas'] as const).map((a) => (
                <button key={a} onClick={() => setAba(a)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${aba === a ? 'bg-amber-100 text-amber-800' : 'text-zinc-500 hover:bg-zinc-100'}`}>
                  {a === 'repasses' ? 'Repasses' : 'Taxas'}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer flex-shrink-0">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {aba === 'taxas' && <TaxasView from={from} to={to} setFrom={setFrom} setTo={setTo} />}
        {aba === 'repasses' && (<>
        <div className="px-5 py-3 border-b border-zinc-100 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-lg px-2 py-1.5">
              <i className="ri-calendar-line text-zinc-400 text-sm" />
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}
                className="border-0 text-xs font-semibold text-zinc-700 focus:outline-none bg-transparent w-28" />
              <span className="text-zinc-300 text-xs">até</span>
              <input type="date" value={to} min={from || undefined} max={hojeBR()} onChange={(e) => setTo(e.target.value)}
                className="border-0 text-xs font-semibold text-zinc-700 focus:outline-none bg-transparent w-28" />
            </div>
            {loading && <div className="w-4 h-4 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-700 font-semibold">Diferença real a conferir</p>
              <p className="text-lg font-bold text-red-700">{formatCurrency(resumo.problemas.dif)}</p>
              <p className="text-xs text-red-600/80">{resumo.problemas.n} repasse(s) · Stone {formatCurrency(resumo.problemas.stone)} × banco {formatCurrency(resumo.problemas.banco)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-xs text-emerald-700 font-semibold">Bateu</p>
              <p className="text-lg font-bold text-emerald-700">{formatCurrency(resumo.ok.banco)}</p>
              <p className="text-xs text-emerald-600/80">{resumo.ok.n} repasse(s) · diferença {formatCurrency(resumo.ok.dif)}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-xs text-zinc-600 font-semibold">Sem como conferir</p>
              <p className="text-lg font-bold text-zinc-700">{formatCurrency(resumo.semDado.stone + resumo.semDado.banco)}</p>
              <p className="text-xs text-zinc-500">{resumo.semDado.n} repasse(s) · sem extrato ou aguardando arquivo</p>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {chip('problemas', 'Com diferença', resumo.problemas.n)}
            {chip('ok', 'Bateu', resumo.ok.n)}
            {chip('sem_dado', 'Sem como conferir', resumo.semDado.n)}
            {chip('todos', 'Todos', rows.length)}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {erro && <p className="px-5 py-3 text-sm text-red-600">Não foi possível carregar: {erro}</p>}
          {!loading && !erro && visiveis.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-zinc-500">
              {filtro === 'problemas' ? 'Nenhuma diferença no período. 🎉' : 'Nada neste filtro.'}
            </p>
          )}
          {visiveis.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-50 text-zinc-500 border-b border-zinc-100">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Dia</th>
                  <th className="text-left font-semibold px-3 py-2">Tipo</th>
                  <th className="text-right font-semibold px-3 py-2">Vendas</th>
                  <th className="text-right font-semibold px-3 py-2 hidden md:table-cell">Bruto</th>
                  <th className="text-right font-semibold px-3 py-2 hidden md:table-cell">Taxa</th>
                  <th className="text-right font-semibold px-3 py-2 hidden md:table-cell">Antecipação</th>
                  <th className="text-right font-semibold px-3 py-2">Stone liquidou</th>
                  <th className="text-right font-semibold px-3 py-2">Entrou no banco</th>
                  <th className="text-right font-semibold px-3 py-2">Diferença</th>
                  <th className="text-left font-semibold px-3 py-2">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visiveis.map(({ r, s }) => (
                  <tr key={r.dia + r.pilha} className="align-top hover:bg-zinc-50/60">
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-zinc-800">{fmtData(r.dia)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-600">{r.pilha === 'antecipado' ? 'Crédito antecipado' : 'Débito'}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">{r.vendas || '—'}</td>
                    <td className="px-3 py-2 text-right text-zinc-600 hidden md:table-cell">{r.bruto ? formatCurrency(r.bruto) : '—'}</td>
                    <td className="px-3 py-2 text-right text-zinc-600 hidden md:table-cell">{r.taxa ? formatCurrency(r.taxa) : '—'}</td>
                    <td className="px-3 py-2 text-right text-zinc-600 hidden md:table-cell">{r.antecipacao ? formatCurrency(r.antecipacao) : '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-zinc-800 whitespace-nowrap">{r.vendas ? formatCurrency(r.liquido_stone) : '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-zinc-800 whitespace-nowrap">{r.creditos ? formatCurrency(r.depositado) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${s.tom === 'erro' ? 'text-red-600' : s.tom === 'alerta' ? 'text-amber-600' : 'text-zinc-400'}`}>
                      {s.tom === 'ok' || r.situacao === 'dia_fecha' || r.situacao === 'sem_extrato' ? '—' : formatCurrency(r.diferenca)}
                    </td>
                    <td className="px-3 py-2 min-w-[12rem]">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${TOM_CLS[s.tom]}`}>{s.label}</span>
                      {s.tom !== 'ok' && <p className="text-[11px] text-zinc-500 mt-1 leading-snug">{s.explica}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}

// ── Aba Taxas: cobrado × contratado (conciliacao-pagamentos › card_fee_check → fn_card_fee_check) ──

interface TaxaLinha {
  dia: string;
  pilha: 'antecipado' | 'debito';
  taxa_cobrada_pct: number;
  produto: ProdutoCartao | null;
  bandeira: string | null;
  taxa_contratada_pct: number | null;
  antecipacao_contratada_pct: number | null;
  vendas: number;
  bruto: number;
  mdr_cobrado: number;
  mdr_esperado: number | null;
  dif_mdr: number | null;
  antecipacao_cobrada: number;
  antecipacao_esperada: number;
  dif_antecipacao: number;
  situacao: 'ok' | 'acima' | 'abaixo' | 'sem_contrato';
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}%`;

const SITUACAO_TAXA: Record<TaxaLinha['situacao'], { label: string; cls: string }> = {
  ok: { label: 'Conforme contrato', cls: TOM_CLS.ok },
  acima: { label: 'Cobrou a mais', cls: TOM_CLS.erro },
  abaixo: { label: 'Cobrou a menos', cls: TOM_CLS.info },
  sem_contrato: { label: 'Sem taxa contratada', cls: TOM_CLS.alerta },
};

function TaxasView({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<TaxaLinha[]>([]);
  const [hasContract, setHasContract] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.tenantId || !from || !to || from > to) return;
    let vivo = true;
    setLoading(true); setErro(null);
    invokeWithAuth<{ error?: string; has_contract?: boolean; rows?: Array<Record<string, unknown>> }>('conciliacao-pagamentos', {
      body: { action: 'card_fee_check', tenant_id: user.tenantId, date_from: from, date_to: to },
    }).then((r) => {
      if (!vivo) return;
      const e = r.data?.error ?? r.error?.message;
      if (e) setErro(e);
      setHasContract(Boolean(r.data?.has_contract));
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      setRows((r.data?.rows ?? []).map((x) => ({
        dia: String(x.dia), pilha: x.pilha as TaxaLinha['pilha'], taxa_cobrada_pct: Number(x.taxa_cobrada_pct),
        produto: (x.produto as ProdutoCartao | null) ?? null, bandeira: (x.bandeira as string | null) ?? null,
        taxa_contratada_pct: n(x.taxa_contratada_pct), antecipacao_contratada_pct: n(x.antecipacao_contratada_pct),
        vendas: Number(x.vendas), bruto: Number(x.bruto), mdr_cobrado: Number(x.mdr_cobrado),
        mdr_esperado: n(x.mdr_esperado), dif_mdr: n(x.dif_mdr), antecipacao_cobrada: Number(x.antecipacao_cobrada),
        antecipacao_esperada: Number(x.antecipacao_esperada), dif_antecipacao: Number(x.dif_antecipacao),
        situacao: x.situacao as TaxaLinha['situacao'],
      })));
      setLoading(false);
    });
    return () => { vivo = false; };
  }, [user?.tenantId, from, to]);

  // Agrupa o período por taxa cobrada × taxa contratada casada
  const grupos = useMemo(() => {
    const m = new Map<string, TaxaLinha & { dias: Set<string>; dif_total: number }>();
    for (const r of rows) {
      const k = [r.pilha, r.taxa_cobrada_pct, r.produto, r.bandeira, r.taxa_contratada_pct, r.situacao].join('|');
      const dif = Number(r.dif_mdr ?? 0) + Number(r.dif_antecipacao ?? 0);
      const g = m.get(k);
      if (!g) { m.set(k, { ...r, dias: new Set([r.dia]), dif_total: dif }); continue; }
      g.vendas += r.vendas; g.bruto += r.bruto; g.mdr_cobrado += r.mdr_cobrado;
      g.antecipacao_cobrada += r.antecipacao_cobrada; g.antecipacao_esperada += r.antecipacao_esperada;
      g.dif_total += dif; g.dias.add(r.dia);
    }
    const ordem = { acima: 0, sem_contrato: 1, abaixo: 2, ok: 3 } as const;
    return [...m.values()].map((g) => ({ ...g, key: [g.pilha, g.taxa_cobrada_pct, g.produto, g.bandeira, g.taxa_contratada_pct, g.situacao].join('|') }))
      .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || b.bruto - a.bruto);
  }, [rows]);

  const soma = (f: (r: TaxaLinha) => boolean, campo: (r: TaxaLinha) => number) => rows.filter(f).reduce((a, r) => a + campo(r), 0);
  const aMais = soma((r) => r.situacao === 'acima', (r) => Number(r.dif_mdr ?? 0) + Number(r.dif_antecipacao ?? 0));
  const brutoOk = soma((r) => r.situacao === 'ok' || r.situacao === 'abaixo', (r) => r.bruto);
  const brutoSem = soma((r) => r.situacao === 'sem_contrato', (r) => r.bruto);
  const custoTotal = soma(() => true, (r) => r.mdr_cobrado + r.antecipacao_cobrada);
  const brutoTotal = soma(() => true, (r) => r.bruto);
  const diasAcima = rows.filter((r) => r.situacao === 'acima');

  return (
    <>
      <div className="px-5 py-3 border-b border-zinc-100 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-lg px-2 py-1.5">
            <i className="ri-calendar-line text-zinc-400 text-sm" />
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}
              className="border-0 text-xs font-semibold text-zinc-700 focus:outline-none bg-transparent w-28" />
            <span className="text-zinc-300 text-xs">até</span>
            <input type="date" value={to} min={from || undefined} max={hojeBR()} onChange={(e) => setTo(e.target.value)}
              className="border-0 text-xs font-semibold text-zinc-700 focus:outline-none bg-transparent w-28" />
          </div>
          {loading && <div className="w-4 h-4 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />}
          {brutoTotal > 0 && (
            <span className="text-xs text-zinc-500">
              Custo total com a Stone: <strong className="text-zinc-800">{formatCurrency(custoTotal)}</strong> ({pct((100 * custoTotal) / brutoTotal)} do bruto)
            </span>
          )}
        </div>

        {hasContract === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <i className="ri-information-line mr-1" />
            Nenhuma taxa contratada cadastrada. Cadastre em <strong>Configurações › Como o dinheiro entra › Taxas contratadas</strong>.
            Enquanto isso, a tabela mostra só as taxas que a Stone cobrou.
          </div>
        )}

        {hasContract && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-700 font-semibold">Cobrado a mais</p>
              <p className="text-lg font-bold text-red-700">{formatCurrency(aMais)}</p>
              <p className="text-xs text-red-600/80">{diasAcima.reduce((a, r) => a + r.vendas, 0)} venda(s) acima do contrato</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-xs text-emerald-700 font-semibold">Conforme contrato</p>
              <p className="text-lg font-bold text-emerald-700">{formatCurrency(brutoOk)}</p>
              <p className="text-xs text-emerald-600/80">em vendas (valor bruto)</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-700 font-semibold">Sem taxa contratada</p>
              <p className="text-lg font-bold text-amber-700">{formatCurrency(brutoSem)}</p>
              <p className="text-xs text-amber-600/80">vendas antes da vigência ou produto não cadastrado</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {erro && <p className="px-5 py-3 text-sm text-red-600">Não foi possível carregar: {erro}</p>}
        {!loading && !erro && grupos.length === 0 && <p className="px-5 py-10 text-center text-sm text-zinc-500">Nenhuma venda da Stone no período.</p>}
        {grupos.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-50 text-zinc-500 border-b border-zinc-100">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Tipo</th>
                <th className="text-right font-semibold px-3 py-2">Taxa cobrada</th>
                {hasContract && <th className="text-left font-semibold px-3 py-2">Contrato</th>}
                <th className="text-right font-semibold px-3 py-2">Vendas</th>
                <th className="text-right font-semibold px-3 py-2 hidden md:table-cell">Bruto</th>
                <th className="text-right font-semibold px-3 py-2">Taxa (R$)</th>
                <th className="text-right font-semibold px-3 py-2 hidden md:table-cell">Antecipação (R$)</th>
                {hasContract && <th className="text-right font-semibold px-3 py-2">Diferença</th>}
                {hasContract && <th className="text-left font-semibold px-3 py-2">Situação</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {grupos.map((g) => (
                <tr key={g.key} className="align-top hover:bg-zinc-50/60">
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-700">{g.pilha === 'antecipado' ? 'Crédito antecipado' : 'Sem antecipação'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-zinc-800">{pct(g.taxa_cobrada_pct)}</td>
                  {hasContract && (
                    <td className="px-3 py-2 text-zinc-600">
                      {g.produto ? (
                        <>
                          {PRODUTOS_CARTAO[g.produto]}{g.bandeira ? ` · ${g.bandeira}` : ''} · <strong>{pct(g.taxa_contratada_pct)}</strong>
                          {g.antecipacao_contratada_pct !== null && g.pilha === 'antecipado' && (
                            <span className="text-zinc-400"> · antecip. {pct(g.antecipacao_contratada_pct)} a.m.</span>
                          )}
                        </>
                      ) : <span className="text-zinc-400">—</span>}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right text-zinc-600 whitespace-nowrap">{g.vendas}<span className="text-zinc-400"> · {g.dias.size} dia(s)</span></td>
                  <td className="px-3 py-2 text-right text-zinc-600 hidden md:table-cell">{formatCurrency(g.bruto)}</td>
                  <td className="px-3 py-2 text-right text-zinc-800 whitespace-nowrap">{formatCurrency(g.mdr_cobrado)}</td>
                  <td className="px-3 py-2 text-right text-zinc-800 whitespace-nowrap hidden md:table-cell">{g.antecipacao_cobrada ? formatCurrency(g.antecipacao_cobrada) : '—'}</td>
                  {hasContract && (
                    <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${g.situacao === 'acima' ? 'text-red-600' : 'text-zinc-400'}`}>
                      {g.situacao === 'sem_contrato' ? '—' : formatCurrency(g.dif_total)}
                    </td>
                  )}
                  {hasContract && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${SITUACAO_TAXA[g.situacao].cls}`}>{SITUACAO_TAXA[g.situacao].label}</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {diasAcima.length > 0 && (
          <div className="px-5 py-3 border-t border-zinc-100">
            <p className="text-xs font-semibold text-zinc-700 mb-1">Dias com cobrança acima do contrato</p>
            <div className="space-y-1">
              {diasAcima.map((r) => (
                <div key={r.dia + r.pilha + r.taxa_cobrada_pct} className="flex justify-between gap-2 text-xs text-zinc-600">
                  <span>
                    {fmtData(r.dia)} · {r.vendas} venda(s) a {pct(r.taxa_cobrada_pct)} (contrato {pct(r.taxa_contratada_pct)})
                    {Number(r.dif_antecipacao) > 0.005 && (
                      <> · antecipação cobrada {formatCurrency(r.antecipacao_cobrada)}, esperada {formatCurrency(r.antecipacao_esperada)}</>
                    )}
                  </span>
                  <span className="font-semibold text-red-600 whitespace-nowrap">{formatCurrency(Number(r.dif_mdr ?? 0) + Number(r.dif_antecipacao ?? 0))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
