import { useEffect, useMemo, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useDreGroups, isGrupoDespesa } from '@/hooks/useDreGroups';
import { formatCurrency } from '@/lib/formatters';
import CategoriaCombobox from '../CategoriaCombobox';
import type { StatementImport } from '@/hooks/useConciliacao';

// Pagamento sem nota: lança uma DESPESA (conta a pagar já baixada, com categoria da DRE) ou uma
// COMPRA (CMV, categoria de mercadoria) a partir da linha do extrato, na data e na conta do
// pagamento. Edge conciliacao-pagamentos › create_from_statement; "Desfazer" (undo) apaga o que
// foi criado e devolve a linha para pendente.

// Linhas que já têm destino: vínculo sugerido com nota/conta, transferência própria, repasse.
const JA_TEM_DESTINO = ['payable', 'inbound_doc', 'internal_transfer', 'stone_deposit', 'stone_detail', 'ifood_deposit', 'card_deposit'];

export function podeLancarDoExtrato(s: StatementImport) {
  return s.transaction_type === 'debit' && s.status === 'pending' && !s.reconciled && !JA_TEM_DESTINO.includes(String(s.match_kind ?? ''));
}

export type LancarTipo = 'despesa' | 'compra';
export interface LancarResultado { id: string; ok: boolean; msg: string; code?: string }
export interface LancarOpcoes {
  kind: LancarTipo;
  dre_category_id?: string | null;
  merchandise_category_id?: string | null;
  description?: string | null;
  supplier?: string | null;
  allow_payroll?: boolean;
  /** 'YYYY-MM': mês a que o gasto pertence (competência). Vazio = só a data do pagamento. */
  competence_month?: string | null;
}

// A edge aceita até 30 por chamada (e ignora o resto): manda em blocos.
export async function lancarDoExtrato(tenantId: string, ids: string[], opts: LancarOpcoes) {
  const results: LancarResultado[] = [];
  for (let i = 0; i < ids.length; i += 30) {
    const r = await invokeWithAuth<{ success?: boolean; error?: string; results?: LancarResultado[] }>('conciliacao-pagamentos', {
      body: { action: 'create_from_statement', tenant_id: tenantId, ids: ids.slice(i, i + 30), ...opts },
    });
    const error = r.data?.error ?? r.error?.message ?? null;
    if (error) return { results, error };
    results.push(...(r.data?.results ?? []));
  }
  return { results, error: null as string | null };
}

/** Categorias de despesa (DRE) e de mercadoria (CMV) da loja, no formato do CategoriaCombobox. */
export function useCategoriasLancamento() {
  const { user } = useAuth();
  const { groupMeta } = useDreGroups();
  const [dre, setDre] = useState<Array<{ id: string; name: string; group_type: string }>>([]);
  const [mercs, setMercs] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    setDre([]); setMercs([]);
    if (!user?.tenantId) return;
    let vivo = true;
    Promise.all([
      supabase.from('fin_dre_categories').select('id, name, group_type').eq('tenant_id', user.tenantId)
        .is('deleted_at', null).eq('is_active', true).order('name'),
      supabase.from('fin_merchandise_categories').select('id, name').eq('tenant_id', user.tenantId)
        .eq('is_active', true).order('sort_order').order('name'),
    ]).then(([d, m]) => {
      if (!vivo) return;
      setDre(((d.data ?? []) as Array<{ id: string; name: string; group_type: string }>).filter((c) => isGrupoDespesa(c.group_type)));
      setMercs((m.data ?? []) as Array<{ id: string; name: string }>);
    });
    return () => { vivo = false; };
  }, [user?.tenantId]);
  const dreOptions = useMemo(() => dre.map((c) => ({ id: c.id, label: c.name, sub: groupMeta(c.group_type)?.label ?? null })), [dre, groupMeta]);
  const mercOptions = useMemo(() => mercs.map((m) => ({ id: m.id, label: m.name, sub: 'CMV' })), [mercs]);
  const dreNome = (id: string | null | undefined) => dre.find((c) => c.id === id)?.name ?? null;
  return { dreOptions, mercOptions, dreNome };
}

interface Props {
  transaction: StatementImport;
  onDone: () => void;
  /** Avisa o modal quando o painel abre/fecha (o modal esconde o formulário antigo de categoria). */
  onAbertoChange?: (aberto: boolean) => void;
}

export default function LancarDoExtrato({ transaction, onDone, onAbertoChange }: Props) {
  const { user } = useAuth();
  const { dreOptions, mercOptions } = useCategoriasLancamento();
  const nomePadrao = transaction.counterpart_name || transaction.description || '';
  const [aberto, setAberto] = useState(false);
  useEffect(() => { onAbertoChange?.(aberto); }, [aberto, onAbertoChange]);
  const [tipo, setTipo] = useState<LancarTipo>('despesa');
  const [descricao, setDescricao] = useState(nomePadrao);
  const [fornecedor, setFornecedor] = useState(transaction.counterpart_name || '');
  const [dreCat, setDreCat] = useState('');
  const [merc, setMerc] = useState('');
  const [lembrar, setLembrar] = useState(false);
  // Competência (2026-09-18): mês do pagamento, o anterior (royalties, contas de consumo) ou outro
  const mesPag = transaction.transaction_date.slice(0, 7);
  const mesAnt = (() => { const [y, m] = mesPag.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
  const [compModo, setCompModo] = useState<'same' | 'prev' | 'outro'>('same');
  const [compOutro, setCompOutro] = useState(mesPag);
  const competencia = compModo === 'same' ? mesPag : compModo === 'prev' ? mesAnt : compOutro;
  const [avisoFolha, setAvisoFolha] = useState<string | null>(null);
  const [permitirFolha, setPermitirFolha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAberto(false); setTipo('despesa'); setDescricao(nomePadrao); setFornecedor(transaction.counterpart_name || '');
    setDreCat(''); setMerc(''); setLembrar(false); setAvisoFolha(null); setPermitirFolha(false); setErro(null);
    setCompModo('same'); setCompOutro(transaction.transaction_date.slice(0, 7));
  }, [transaction.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const doc = transaction.counterpart_doc ?? '';

  const lancar = async () => {
    if (!user?.tenantId) return;
    if (tipo === 'despesa' && !dreCat) { setErro('Escolha a categoria da despesa.'); return; }
    setErro(null);
    setBusy(true);
    const { results, error } = await lancarDoExtrato(user.tenantId, [transaction.id], {
      kind: tipo,
      dre_category_id: tipo === 'despesa' ? dreCat : null,
      merchandise_category_id: tipo === 'compra' ? merc || null : null,
      description: descricao.trim() || null,
      supplier: tipo === 'compra' ? fornecedor.trim() || null : null,
      allow_payroll: permitirFolha,
      competence_month: /^\d{4}-\d{2}$/.test(competencia) ? competencia : null,
    });
    const r = results[0];
    if (error || !r) { setBusy(false); setErro(error ?? 'Não foi possível lançar.'); return; }
    if (!r.ok) {
      setBusy(false);
      if (r.code === 'folha') { setAvisoFolha(r.msg); return; }
      setErro(r.msg);
      return;
    }
    // "Fazer sempre assim": regra de LANÇAMENTO para este CPF/CNPJ/chave (2026-09-18). Antes só
    // etiquetava o extrato — não entrava na DRE e ainda escondia o pagamento do alerta.
    if (lembrar && doc) {
      const rr = await invokeWithAuth<{ success?: boolean; error?: string }>('conciliacao-pagamentos', {
        body: {
          action: 'launch_rule_save', tenant_id: user.tenantId, counterpart_doc: doc,
          counterpart_label: transaction.counterpart_name ?? transaction.description,
          kind: tipo, dre_category_id: tipo === 'despesa' ? dreCat : null, merchandise_category_id: tipo === 'compra' ? merc || null : null,
          competence_rule: compModo === 'prev' ? 'prev' : 'same', supplier_name: tipo === 'compra' ? fornecedor.trim() || null : descricao.trim() || null,
        },
      });
      const e = rr.data?.error ?? rr.error?.message;
      // Lançamento feito; só a regra falhou: mostra aqui em vez de fechar (antes: alerta do navegador)
      if (e) { setBusy(false); setErro('Lançado, mas a regra não foi salva: ' + e); return; }
    }
    setBusy(false);
    onDone();
  };

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-violet-300 bg-violet-50/50 text-left hover:bg-violet-50 cursor-pointer">
        <i className="ri-add-circle-line text-violet-600 text-lg" />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-violet-800">Lançar a partir deste pagamento</span>
          <span className="block text-xs text-violet-600">Pagamento sem nota? Vira despesa ou compra já paga nesta data e conta.</span>
        </span>
      </button>
    );
  }

  return (
    <div className="border border-violet-200 rounded-xl p-3 space-y-3 bg-violet-50/40">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-violet-800"><i className="ri-add-circle-line mr-1" />Lançar {formatCurrency(Number(transaction.amount))} de {new Date(transaction.transaction_date + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
        <button onClick={() => setAberto(false)} className="text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer">Cancelar</button>
      </div>

      <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden w-fit">
        {([['despesa', 'Despesa', 'ri-file-list-3-line'], ['compra', 'Compra (CMV)', 'ri-shopping-cart-line']] as const).map(([k, label, icon]) => (
          <button key={k} onClick={() => setTipo(k)}
            className={`px-3 py-1.5 text-xs font-semibold cursor-pointer flex items-center gap-1 ${tipo === k ? 'bg-violet-600 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
            <i className={icon} /> {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-zinc-500">
        {tipo === 'despesa'
          ? 'Vira uma conta a pagar já baixada nesta data, com a categoria da DRE (limpeza, manutenção, serviço, frete…).'
          : 'Vira uma compra de mercadoria já paga nesta data: entra no CMV na categoria escolhida. Não mexe no estoque.'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-zinc-600 mb-1">{tipo === 'compra' ? 'O que foi comprado' : 'Descrição'}</label>
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)}
            placeholder={tipo === 'compra' ? 'Ex.: Gelo, verduras da feira…' : 'Ex.: Diária de limpeza'}
            className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
        </div>
        {tipo === 'compra' && (
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Fornecedor</label>
            <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">{tipo === 'despesa' ? 'Categoria da DRE *' : 'Categoria do CMV'}</label>
          {tipo === 'despesa' ? (
            <CategoriaCombobox value={dreCat} options={dreOptions} onChange={setDreCat} placeholder="Escolha a categoria…"
              buttonClassName="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer" />
          ) : (
            <CategoriaCombobox value={merc} options={mercOptions} onChange={setMerc} placeholder="Escolha a categoria…"
              buttonClassName="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm bg-white cursor-pointer" />
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-600 mb-1">Competência (mês a que o gasto pertence)</label>
        <div className="flex flex-wrap items-center gap-2">
          {([['same', `Mês do pagamento (${mesPag.slice(5)}/${mesPag.slice(0, 4)})`], ['prev', `Mês anterior (${mesAnt.slice(5)}/${mesAnt.slice(0, 4)})`], ['outro', 'Outro']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setCompModo(k)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${compModo === k ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}>
              {label}
            </button>
          ))}
          {compModo === 'outro' && (
            <input type="month" value={compOutro} onChange={(e) => setCompOutro(e.target.value)}
              className="px-2 py-1 border border-zinc-200 rounded-lg text-xs bg-white" />
          )}
        </div>
      </div>

      {doc && (
        <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
          <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} className="mt-0.5" />
          <span>
            <b>Fazer sempre assim</b> para {transaction.counterpart_name || doc}: os próximos pagamentos viram {tipo === 'compra' ? 'compra' : 'esta despesa'}
            {compModo === 'prev' ? ' com competência do mês anterior' : ' com competência do mês do pagamento'} (sugerido em "Confirmar vínculos").
          </span>
        </label>
      )}

      {avisoFolha && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-2.5 text-xs text-amber-800 space-y-1.5">
          <p><i className="ri-alert-line mr-1" />{avisoFolha}</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={permitirFolha} onChange={(e) => setPermitirFolha(e.target.checked)} />
            Não é salário: lançar mesmo assim
          </label>
        </div>
      )}
      {erro && <p className="text-xs text-red-600">{erro}</p>}

      <div className="flex items-center gap-2">
        <button onClick={lancar} disabled={busy || (!!avisoFolha && !permitirFolha)}
          className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 cursor-pointer">
          {busy ? 'Lançando...' : tipo === 'despesa' ? 'Lançar despesa paga' : 'Lançar compra paga'}
        </button>
        <span className="text-[11px] text-zinc-400">Dá para desfazer depois, no próprio pagamento.</span>
      </div>
    </div>
  );
}
