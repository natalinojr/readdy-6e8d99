// Pagamento dividido (2026-09-30, pedido do dono): um pagamento sem nota que cobre coisas diferentes —
// ex.: parte despesa (limpeza) e parte diária de freelancer no mesmo Pix. Cada parte vira o lançamento
// do seu tipo (conta própria baixada pelo valor da parte, na data e conta do pagamento); a soma tem que
// fechar com o pagamento. Edge conciliacao-pagamentos › create_split; o "Desfazer" do pagamento desfaz
// todas as partes.
import { useMemo, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import CategoriaCombobox from '../CategoriaCombobox';
import type { StatementImport } from '@/hooks/useConciliacao';
import { useFreelancers, usePrestadores, useCategoriasLancamento, numBR as lerBR } from './LancarDoExtrato';

const numBR = (s: string) => { const n = lerBR(s); return Number.isFinite(n) ? n : 0; };

type TipoParte = 'despesa' | 'compra' | 'freelancer' | 'prestador';
interface Parte {
  key: number; tipo: TipoParte; valor: string; descricao: string;
  dreCat: string; merc: string; freelaId: string; dias: string[];
  prestadorId: string; prestadorTipo: 'servico' | 'reembolso';
}
interface Props {
  transaction: StatementImport;
  competencia: string;
  onDone: () => void;
  onCancel: () => void;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const TIPOS: Array<[TipoParte, string]> = [['despesa', 'Despesa'], ['compra', 'Compra (CMV)'], ['freelancer', 'Freelancer'], ['prestador', 'Prestador MEI']];
const btn = 'w-full px-3 py-2.5 sm:py-2 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer';
const inp = 'w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300';

export default function DividirPagamento({ transaction, competencia, onDone, onCancel }: Props) {
  const { user } = useAuth();
  const { dreOptions, mercOptions } = useCategoriasLancamento();
  const { freelancers, freelaOptions } = useFreelancers();
  const { prestadorOptions } = usePrestadores();
  const valorPag = r2(Number(transaction.amount));
  const nova = (tipo: TipoParte, valor = ''): Parte => ({
    key: Date.now() + Math.random(), tipo, valor, descricao: '', dreCat: '', merc: '', freelaId: '', dias: [],
    prestadorId: '', prestadorTipo: 'servico',
  });
  const [partes, setPartes] = useState<Parte[]>(() => [nova('despesa'), nova('freelancer')]);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoFolha, setAvisoFolha] = useState<string | null>(null);
  const [permitirFolha, setPermitirFolha] = useState(false);
  // Existe NF do mesmo CNPJ com o valor de uma parte: quem tem certeza que é outro pagamento força
  const [avisoNota, setAvisoNota] = useState<string | null>(null);
  const [semNota, setSemNota] = useState(false);

  // Dia do pagamento e os seis anteriores (a diária quase sempre é de um deles)
  const ultimosDias = useMemo(() => {
    const base = new Date(transaction.transaction_date + 'T00:00:00');
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(d.getDate() - i); return d.toLocaleDateString('en-CA'); }).reverse();
  }, [transaction.transaction_date]);

  const soma = r2(partes.reduce((s, p) => s + numBR(p.valor), 0));
  const falta = r2(valorPag - soma);
  const muda = (key: number, patch: Partial<Parte>) => setPartes((v) => v.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const problema = (p: Parte, i: number): string | null => {
    const n = `Parte ${i + 1}`;
    if (!(numBR(p.valor) > 0)) return `${n}: informe o valor.`;
    if (p.tipo === 'despesa' && !p.dreCat) return `${n}: escolha a categoria da DRE.`;
    if (p.tipo === 'freelancer' && !p.freelaId && !p.descricao.trim()) return `${n}: escolha ou digite quem trabalhou.`;
    if (p.tipo === 'prestador' && !p.prestadorId) return `${n}: escolha o prestador.`;
    if (p.tipo === 'prestador' && p.prestadorTipo === 'reembolso' && !p.dreCat) return `${n}: escolha a categoria do reembolso.`;
    return null;
  };

  const lancar = async () => {
    if (!user?.tenantId) return;
    const prob = partes.map(problema).find(Boolean);
    if (prob) { setErro(prob); return; }
    if (Math.abs(falta) >= 0.005) { setErro(`As partes somam ${formatCurrency(soma)} e o pagamento é ${formatCurrency(valorPag)}: ajuste até fechar.`); return; }
    setErro(null);
    setBusy(true);
    const r = await invokeWithAuth<{ error?: string; results?: Array<{ ok: boolean; msg: string; code?: string }> }>('conciliacao-pagamentos', {
      body: {
        action: 'create_split', tenant_id: user.tenantId, id: transaction.id,
        competence_month: /^\d{4}-\d{2}$/.test(competencia) ? competencia : null,
        allow_payroll: permitirFolha,
        sem_nota_mesmo_assim: semNota,
        partes: partes.map((p) => ({
          kind: p.tipo, valor: r2(numBR(p.valor)),
          description: p.descricao.trim() || null,
          dre_category_id: p.tipo === 'despesa' || (p.tipo === 'prestador' && p.prestadorTipo === 'reembolso') ? p.dreCat : null,
          merchandise_category_id: p.tipo === 'compra' ? p.merc || null : null,
          supplier: p.tipo === 'compra' ? (transaction.counterpart_name || null) : null,
          dias: p.tipo === 'freelancer' ? p.dias : undefined,
          prestador_id: p.tipo === 'prestador' ? p.prestadorId : null,
          prestador_tipo: p.tipo === 'prestador' ? p.prestadorTipo : null,
        })),
      },
    });
    setBusy(false);
    const res = r.data?.results?.[0];
    const e = r.data?.error ?? r.error?.message ?? null;
    if (e || !res) { setErro(e ?? 'Não foi possível lançar.'); return; }
    if (!res.ok) {
      if (res.code === 'folha') { setAvisoFolha(res.msg); return; }
      if (res.code === 'tem_nota') { setAvisoNota(res.msg); return; }
      setErro(res.msg);
      return;
    }
    onDone();
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-500">
        Cada parte vira o lançamento do seu tipo, já pago nesta data e conta. A soma das partes tem que fechar com o pagamento; dá para desfazer tudo depois, no próprio pagamento.
      </p>

      {partes.map((p, i) => (
        <div key={p.key} className="bg-white border border-zinc-200 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-zinc-500 w-14 flex-shrink-0">Parte {i + 1}</span>
            <select value={p.tipo} onChange={(e) => muda(p.key, { tipo: e.target.value as TipoParte })}
              className="flex-1 min-w-0 px-2 py-2 sm:py-1.5 border border-zinc-200 rounded-lg text-sm bg-white">
              {TIPOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input value={p.valor} onChange={(e) => muda(p.key, { valor: e.target.value })} inputMode="decimal" placeholder="0,00" aria-label={`Valor da parte ${i + 1}`}
              className="w-28 px-2 py-2 sm:py-1.5 border border-zinc-200 rounded-lg text-sm text-right font-semibold" />
            {partes.length > 2 && (
              <button type="button" onClick={() => setPartes((v) => v.filter((x) => x.key !== p.key))} aria-label="Tirar parte"
                className="w-10 h-10 sm:w-8 sm:h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer">
                <i className="ri-delete-bin-line" />
              </button>
            )}
          </div>

          {(p.tipo === 'despesa' || p.tipo === 'compra') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={p.descricao} onChange={(e) => muda(p.key, { descricao: e.target.value })} className={inp}
                placeholder={p.tipo === 'compra' ? 'O que foi comprado' : 'Descrição (ex.: material de limpeza)'} />
              {p.tipo === 'despesa'
                ? <CategoriaCombobox value={p.dreCat} options={dreOptions} onChange={(v) => muda(p.key, { dreCat: v })} placeholder="Categoria da DRE…" buttonClassName={btn} />
                : <CategoriaCombobox value={p.merc} options={mercOptions} onChange={(v) => muda(p.key, { merc: v })} placeholder="Categoria do CMV…" buttonClassName={btn} />}
            </div>
          )}

          {p.tipo === 'freelancer' && (
            <div className="space-y-1.5">
              <CategoriaCombobox value={p.freelaId} options={freelaOptions} placeholder="Escolha o freelancer…"
                onChange={(id) => { const f = freelancers.find((x) => x.id === id); muda(p.key, { freelaId: id, descricao: f?.name ?? p.descricao }); }}
                onCreate={(texto) => muda(p.key, { freelaId: '', descricao: texto })}
                createLabel={(texto) => (texto ? `Cadastrar “${texto}” como freelancer` : 'Cadastrar um freelancer novo')}
                buttonClassName={btn} />
              {!p.freelaId && (
                <input value={p.descricao} onChange={(e) => muda(p.key, { descricao: e.target.value })} placeholder="Nome de quem trabalhou" className={inp} />
              )}
              <div className="flex flex-wrap items-center gap-1">
                {ultimosDias.map((d) => {
                  const on = p.dias.includes(d);
                  return (
                    <button key={d} type="button" onClick={() => muda(p.key, { dias: on ? p.dias.filter((x) => x !== d) : [...p.dias, d].sort() })}
                      className={`px-2 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${on ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}>
                      {new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-zinc-400">{p.dias.length ? `${p.dias.length} dia${p.dias.length > 1 ? 's' : ''} trabalhado${p.dias.length > 1 ? 's' : ''}.` : 'Sem dia marcado, a diária fica "aguardando dias" em Freelancers.'}</p>
            </div>
          )}

          {p.tipo === 'prestador' && (
            <div className="space-y-1.5">
              <CategoriaCombobox value={p.prestadorId} options={prestadorOptions} onChange={(v) => muda(p.key, { prestadorId: v })} placeholder="Escolha o prestador…" buttonClassName={btn} />
              <div className="flex flex-wrap bg-white border border-zinc-200 rounded-lg overflow-hidden w-fit">
                {([['servico', 'Serviço do mês'], ['reembolso', 'Reembolso']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => muda(p.key, { prestadorTipo: k })}
                    className={`px-3 py-1.5 text-xs font-semibold cursor-pointer ${p.prestadorTipo === k ? 'bg-violet-600 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>{l}</button>
                ))}
              </div>
              {p.prestadorTipo === 'reembolso' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={p.descricao} onChange={(e) => muda(p.key, { descricao: e.target.value })} placeholder="O que ele comprou" className={inp} />
                  <CategoriaCombobox value={p.dreCat} options={dreOptions} onChange={(v) => muda(p.key, { dreCat: v })} placeholder="Categoria da DRE…" buttonClassName={btn} />
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setPartes((v) => [...v, nova('despesa', falta > 0 ? falta.toFixed(2).replace('.', ',') : '')])} disabled={partes.length >= 6}
          className="px-3 py-2 sm:py-1 rounded-lg border border-violet-300 text-violet-700 text-sm sm:text-xs font-semibold cursor-pointer hover:bg-violet-50 disabled:opacity-50">
          <i className="ri-add-line" /> Adicionar parte
        </button>
        {falta > 0 && partes.some((p) => !p.valor.trim()) && (
          <button type="button" onClick={() => { const alvo = partes.find((p) => !p.valor.trim()); if (alvo) muda(alvo.key, { valor: falta.toFixed(2).replace('.', ',') }); }}
            className="px-3 py-2 sm:py-1 rounded-lg border border-zinc-200 text-zinc-600 text-sm sm:text-xs font-semibold cursor-pointer hover:bg-zinc-50">
            Completar com o que falta
          </button>
        )}
        <p className={`text-xs font-semibold ml-auto ${Math.abs(falta) < 0.005 ? 'text-emerald-700' : 'text-red-600'}`}>
          Partes: {formatCurrency(soma)} de {formatCurrency(valorPag)}
          {Math.abs(falta) < 0.005 ? ' ✓ fechou' : falta > 0 ? ` · faltam ${formatCurrency(falta)}` : ` · passou ${formatCurrency(-falta)}`}
        </p>
      </div>

      {avisoFolha && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-2.5 text-xs text-amber-800 space-y-1.5">
          <p><i className="ri-alert-line mr-1" />{avisoFolha}</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={permitirFolha} onChange={(e) => setPermitirFolha(e.target.checked)} />
            Não é salário: lançar mesmo assim
          </label>
        </div>
      )}
      {avisoNota && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-2.5 text-xs text-amber-800 space-y-1.5">
          <p><i className="ri-alert-line mr-1" />{avisoNota}</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={semNota} onChange={(e) => setSemNota(e.target.checked)} />
            É outro pagamento: lançar sem nota mesmo assim
          </label>
        </div>
      )}
      {erro && <p className="text-xs text-red-600">{erro}</p>}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <button onClick={lancar} disabled={busy || (!!avisoFolha && !permitirFolha) || (!!avisoNota && !semNota) || Math.abs(falta) >= 0.005}
          className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 cursor-pointer">
          {busy ? 'Lançando...' : `Lançar ${partes.length} partes`}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer">Voltar para um lançamento só</button>
      </div>
    </div>
  );
}
