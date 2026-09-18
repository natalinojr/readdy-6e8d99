import { useCallback, useEffect, useState } from 'react';

// Classificar itens de fornecedor (CMV × despesa) DENTRO do chat do assistente (2026-09-16).
// Aparece embaixo do aviso "Itens novos para classificar" do assistente-cron. Carrega os pendentes
// na hora de abrir (não o que estava no aviso), então aviso antigo mostra "tudo classificado".
// Mesma regra da tela Financeiro › Classificação de Itens (fn_item_classify, via assistente-app):
// despesa exige categoria DRE; CMV aceita categoria de mercadoria opcional. Vínculo com insumo
// continua só pela tela (botão "Abrir a tela").

interface Item {
  id: string; description: string; supplier_name: string | null; unit_label: string | null;
  last_unit_price: number | null; suggested_classe: 'cmv' | 'despesa' | null;
  suggested_dre_category_id: string | null; suggestion_reason: string | null; merchandise_category_id: string | null;
  is_service?: boolean; // nota de serviço (NFS-e): sempre despesa
}
interface Loja {
  id: string; name: string; items: Item[];
  dre_categories: Array<{ id: string; name: string; group_type: string }>;
  merchandise_categories: Array<{ id: string; name: string }>;
}
type Call = <T>(action: string, extra?: Record<string, unknown>) => Promise<T>;

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const GRUPO: Record<string, string> = { expense: 'Despesas', personnel: 'Pessoal', admin: 'Administrativo', financial: 'Financeiro', other: 'Outros' };

function Linha({ loja, item, call, onFeito }: { loja: Loja; item: Item; call: Call; onFeito: (id: string) => void }) {
  const [modo, setModo] = useState<'cmv' | 'despesa' | null>(item.is_service ? 'despesa' : null);
  const [cat, setCat] = useState(item.suggested_dre_category_id ?? '');
  const [merc, setMerc] = useState(item.merchandise_category_id ?? '');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async (classe: 'cmv' | 'despesa') => {
    if (classe === 'despesa' && !cat) { setErro('Escolha a categoria da despesa'); return; }
    setBusy(true); setErro(null);
    try {
      await call('item_classify', {
        tenant_id: loja.id, ids: [item.id], classe,
        dre_category_id: classe === 'despesa' ? cat : undefined,
        merchandise_category_id: classe === 'cmv' && merc ? merc : undefined,
      });
      onFeito(item.id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível classificar');
      setBusy(false);
    }
  };

  const sel = 'w-full h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-800';
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
      <p className="text-sm font-semibold text-zinc-900 break-words">{item.description}</p>
      <p className="text-[11px] text-zinc-500">
        {[item.supplier_name, item.last_unit_price != null ? `${brl(Number(item.last_unit_price))}${item.unit_label ? `/${item.unit_label === 'unit' ? 'un' : item.unit_label}` : ''}` : null].filter(Boolean).join(' · ')}
      </p>
      {item.suggested_classe && (
        <p className="text-[11px] text-amber-700">{item.is_service ? 'Serviço · ' : ''}Sugestão: {item.suggested_classe === 'cmv' ? 'CMV' : 'Despesa'}{item.suggestion_reason ? ` (${item.suggestion_reason})` : ''}</p>
      )}
      {!modo && (
        <div className="flex gap-2 mt-2">
          <button disabled={busy} onClick={() => setModo('cmv')} className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold cursor-pointer disabled:opacity-50">CMV</button>
          <button disabled={busy} onClick={() => setModo('despesa')} className="flex-1 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold cursor-pointer disabled:opacity-50">Despesa</button>
        </div>
      )}
      {modo === 'cmv' && (
        <div className="mt-2 space-y-2">
          <select value={merc} onChange={(e) => setMerc(e.target.value)} className={sel}>
            <option value="">Categoria de mercadoria (opcional)</option>
            {loja.merchandise_categories.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => setModo(null)} className="h-9 px-3 rounded-lg border border-zinc-200 text-sm text-zinc-600 cursor-pointer">Voltar</button>
            <button disabled={busy} onClick={() => salvar('cmv')} className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold cursor-pointer disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar como CMV'}</button>
          </div>
        </div>
      )}
      {modo === 'despesa' && (
        <div className="mt-2 space-y-2">
          {loja.dre_categories.length ? (
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={sel}>
              <option value="">Categoria da despesa…</option>
              {loja.dre_categories.map((c) => <option key={c.id} value={c.id}>{c.name}{GRUPO[c.group_type] ? ` · ${GRUPO[c.group_type]}` : ''}</option>)}
            </select>
          ) : (
            <p className="text-xs text-zinc-500">Esta loja ainda não tem categorias de despesa. Crie pela tela.</p>
          )}
          <div className="flex gap-2">
            {!item.is_service && <button disabled={busy} onClick={() => setModo(null)} className="h-9 px-3 rounded-lg border border-zinc-200 text-sm text-zinc-600 cursor-pointer">Voltar</button>}
            <button disabled={busy || !cat} onClick={() => salvar('despesa')} className="flex-1 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold cursor-pointer disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar como despesa'}</button>
          </div>
        </div>
      )}
      {erro && <p className="text-[11px] text-red-600 mt-1">{erro}</p>}
    </div>
  );
}

// tenantId/abertoInicial: usado pela caixa de pendências do chat (2026-09-18) — só a loja da
// pendência e já aberto. Na mensagem do aviso segue como antes (todas as lojas, atrás do botão).
export default function ItensClassificarCard({ call, tenantId, abertoInicial = false, onFeito, onTudo }: { call: Call; tenantId?: string; abertoInicial?: boolean; onFeito?: () => void; onTudo?: () => void }) {
  const [lojas, setLojas] = useState<Loja[] | null>(null);
  const [aberto, setAberto] = useState(abertoInicial);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feitos, setFeitos] = useState(0);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const todas = (await call<{ tenants: Loja[] }>('items_pending')).tenants;
      // items_pending só traz lojas onde você é admin/gerente: loja que não veio não é "nada
      // pendente", é sem permissão (senão a pendência mostraria tudo certo com itens em aberto).
      if (tenantId && !todas.some((l) => l.id === tenantId)) throw new Error('Você precisa ser admin ou gerente dessa loja para classificar os itens. Abra a tela com a loja certa.');
      setLojas(tenantId ? todas.filter((l) => l.id === tenantId) : todas);
    }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível carregar os itens'); }
    setLoading(false);
  }, [call, tenantId]);
  // Aberto de saída (pendências): carrega já.
  useEffect(() => { if (abertoInicial) carregar(); }, [abertoInicial, carregar]);

  const feito = (lojaId: string, itemId: string) => {
    setFeitos((n) => n + 1);
    onFeito?.();
    setLojas((ls) => {
      const resto = (ls ?? []).map((l) => (l.id === lojaId ? { ...l, items: l.items.filter((i) => i.id !== itemId) } : l)).filter((l) => l.items.length);
      if (!resto.length) setTimeout(() => onTudo?.(), 0); // zerou: a pendência some da caixa já
      return resto;
    });
  };

  if (!aberto) {
    return (
      <button
        onClick={() => { setAberto(true); carregar(); }}
        className="mt-1.5 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm text-white font-semibold cursor-pointer"
      >
        <i className="ri-price-tag-3-line" /> Classificar aqui
      </button>
    );
  }
  const total = (lojas ?? []).reduce((s, l) => s + l.items.length, 0);
  return (
    <div className="mt-1.5 rounded-2xl border border-violet-200 bg-violet-50/40 p-2.5 space-y-2">
      {loading && <p className="text-xs text-zinc-500 px-1">Carregando itens…</p>}
      {erro && (
        <div className="px-1">
          <p className="text-xs text-red-600">{erro}</p>
          <button onClick={carregar} className="text-xs font-semibold text-violet-700 cursor-pointer">Tentar de novo</button>
        </div>
      )}
      {!loading && !erro && lojas && total === 0 && (
        <p className="text-sm text-emerald-700 font-semibold px-1"><i className="ri-check-line" /> Tudo classificado{feitos ? ` (${feitos} agora)` : ''}.</p>
      )}
      {!loading && (lojas ?? []).map((l) => (
        <div key={l.id} className="space-y-1.5">
          <p className="text-xs font-bold text-zinc-600 px-1">{l.name} · {l.items.length} pendente(s)</p>
          {l.items.slice(0, 15).map((i) => <Linha key={i.id} loja={l} item={i} call={call} onFeito={(id) => feito(l.id, id)} />)}
          {l.items.length > 15 && <p className="text-[11px] text-zinc-500 px-1">Classifique estes que aparecem os próximos {Math.min(15, l.items.length - 15)}.</p>}
        </div>
      ))}
    </div>
  );
}
