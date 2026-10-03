import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confirmar } from '@/components/base/Dialogos';
import { invokeWithAuth } from '@/lib/supabase';
import { un, normUn, mesmaUnidade, uppInicial, avisoConversao } from '@/lib/vinculoConversao';

// Classificar itens de fornecedor (CMV × despesa) DENTRO do chat do assistente (2026-09-16).
// Aparece embaixo do aviso "Itens novos para classificar" do assistente-cron. Carrega os pendentes
// na hora de abrir (não o que estava no aviso), então aviso antigo mostra "tudo classificado".
// Mesma regra da tela Financeiro › Classificação de Itens (fn_item_classify, via assistente-app):
// despesa exige categoria DRE; CMV aceita categoria de mercadoria opcional. Desde 2026-09-27 o CMV
// também liga a um insumo do estoque já existente (fn_item_link_ingredient, via assistente-app
// item_link — vira CMV na categoria do insumo). Desde 2026-10-03 cria o insumo que falta ali mesmo
// (nome, unidade, categoria; stock-write com o tenant_id da loja do item, não a do login) e já o
// escolhe para o vínculo — o preço sai das notas ao vincular (fn_item_link_ingredient).

interface Item {
  id: string; description: string; supplier_name: string | null; unit_label: string | null;
  last_unit_price: number | null; suggested_classe: 'cmv' | 'despesa' | null;
  suggested_dre_category_id: string | null; suggestion_reason: string | null; merchandise_category_id: string | null;
  is_service?: boolean; // veio de nota de serviço (NFS-e); CMV se o fornecedor vende produto
}
interface Loja {
  id: string; name: string; items: Item[];
  dre_categories: Array<{ id: string; name: string; group_type: string }>;
  merchandise_categories: Array<{ id: string; name: string }>;
  ingredients?: Array<{ id: string; name: string; unit: string | null }>;
}
type Call = <T>(action: string, extra?: Record<string, unknown>) => Promise<T>;

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// Unidades do insumo novo (as mesmas da janela de insumo do Estoque); a da nota vem marcada se for uma delas
const UNIDADES = ['kg', 'g', 'l', 'ml', 'un'] as const;
const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const GRUPO: Record<string, string> = { expense: 'Despesas', personnel: 'Pessoal', admin: 'Administrativo', financial: 'Financeiro', other: 'Outros' };

function Linha({ loja, item, call, onFeito }: { loja: Loja; item: Item; call: Call; onFeito: (id: string) => void }) {
  const [modo, setModo] = useState<'cmv' | 'despesa' | null>(null);
  const [cat, setCat] = useState(item.suggested_dre_category_id ?? '');
  const [merc, setMerc] = useState(item.merchandise_category_id ?? '');
  // Vínculo com insumo: busca → escolhe → "1 <un da nota> = N <un do insumo>"
  const [busca, setBusca] = useState('');
  const [ingId, setIngId] = useState<string | null>(null);
  const [upp, setUpp] = useState('');
  // Insumos criados aqui entram na lista sem recarregar o cartão
  const [novos, setNovos] = useState<Array<{ id: string; name: string; unit: string | null }>>([]);
  const insumos = useMemo(() => [...(loja.ingredients ?? []), ...novos], [loja.ingredients, novos]);
  const ing = ingId ? insumos.find((g) => g.id === ingId) : undefined;
  const achados = useMemo(() => {
    const q = norm(busca.trim());
    if (!q) return [];
    return insumos.filter((g) => norm(g.name).includes(q)).slice(0, 6);
  }, [busca, insumos]);
  const itemUn = item.unit_label === 'unit' ? 'un' : item.unit_label;
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Insumo que não está na lista: nome, unidade e categoria (opcional)
  const [novo, setNovo] = useState<{ nome: string; unidade: string; cat: string } | null>(null);

  const escolher = (g: { id: string; unit: string | null }) => { setIngId(g.id); setUpp(uppInicial(item.unit_label, g.unit)); setErro(null); };

  const abrirNovo = () => {
    const u = normUn(item.unit_label);
    setNovo({ nome: busca.trim() || item.description, unidade: (UNIDADES as readonly string[]).includes(u) ? u : 'kg', cat: '' });
    setErro(null);
  };

  const criarInsumo = async () => {
    if (!novo) return;
    const nome = novo.nome.trim();
    if (!nome) { setErro('Dê um nome ao insumo'); return; }
    const igual = insumos.find((g) => norm(g.name) === norm(nome));
    if (igual) { escolher(igual); setNovo(null); setBusca(''); return; }
    setBusy(true); setErro(null);
    // Loja do item (não a do login): stock-write confere que você é dessa loja
    const { data, error } = await invokeWithAuth<{ data?: { id?: string } }>('stock-write', {
      body: {
        action: 'upsert_ingredient', tenant_id: loja.id, id: null, name: nome, unit: novo.unidade,
        unit_price: 0, price_source: 'auto', min_stock: 0, current_stock: 0, usage_type: 'final',
        category: loja.merchandise_categories.find((m) => m.id === novo.cat)?.name ?? '',
        purchase_unit: null, purchase_factor: 1, track_stock: true, count_inventory: true,
      },
    });
    setBusy(false);
    const id = data?.data?.id;
    if (error || !id) { setErro(error?.message ?? 'Não foi possível criar o insumo'); return; }
    const criado = { id: String(id), name: nome, unit: novo.unidade === 'l' ? 'L' : novo.unidade === 'un' ? 'unit' : novo.unidade };
    setNovos((l) => [...l, criado]);
    escolher(criado); setNovo(null); setBusca('');
  };

  const vincular = async () => {
    if (!ing) return;
    const n = Number(upp.replace(',', '.'));
    if (!(n > 0)) { setErro(`Informe quanto do insumo (${un(ing.unit)}) vem em 1 ${itemUn || 'un'}`); return; }
    if (n === 1 && !mesmaUnidade(item.unit_label, ing.unit)
      && !(await confirmar({ titulo: `Confere? 1 ${itemUn || 'un'} de "${item.description}" = 1 ${un(ing.unit)} do insumo.`, confirmarLabel: 'Confirmar' }))) return;
    const aviso = avisoConversao(item.unit_label, ing.unit, n);
    if (aviso && !(await confirmar({ titulo: aviso, confirmarLabel: 'Confirmar' }))) return;
    setBusy(true); setErro(null);
    try {
      await call('item_link', { tenant_id: loja.id, id: item.id, ingredient_id: ing.id, units_per_package: n });
      onFeito(item.id);
      window.dispatchEvent(new CustomEvent('itens-classificados', { detail: { tenantId: loja.id } }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível vincular');
      setBusy(false);
    }
  };

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
      // A tela Financeiro › Classificação de Itens, se aberta atrás do chat, recarrega sem F5
      window.dispatchEvent(new CustomEvent('itens-classificados', { detail: { tenantId: loja.id } }));
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
          {!item.is_service && (ing ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <i className="ri-links-line text-emerald-600" />
                <p className="flex-1 min-w-0 text-sm font-semibold text-zinc-800 truncate">{ing.name}</p>
                <button disabled={busy} onClick={() => { setIngId(null); setUpp(''); }} className="text-xs text-zinc-500 underline cursor-pointer">trocar</button>
              </div>
              <label className="flex items-center gap-1.5 text-sm text-zinc-700">
                1 {itemUn || 'un'} =
                <input autoFocus value={upp} inputMode="decimal" placeholder="?" onChange={(e) => setUpp(e.target.value)}
                  className="w-20 h-8 rounded border border-zinc-200 bg-white px-2 text-sm" />
                {un(ing.unit)}
              </label>
              <p className="text-[11px] text-zinc-500">Quanto do insumo entra no estoque a cada {itemUn || 'unidade'} comprada. O item vira CMV na categoria do insumo.</p>
            </div>
          ) : novo ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2 space-y-1.5">
              <p className="text-[11px] font-bold text-emerald-800">Novo insumo do estoque</p>
              <input autoFocus value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Nome do insumo" className={sel} />
              <div className="flex gap-1">
                {UNIDADES.map((u) => (
                  <button key={u} type="button" disabled={busy} onClick={() => setNovo({ ...novo, unidade: u })}
                    className={`flex-1 h-8 rounded-lg border text-sm font-semibold cursor-pointer ${novo.unidade === u ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-zinc-200 text-zinc-600'}`}>
                    {u === 'l' ? 'L' : u}
                  </button>
                ))}
              </div>
              <select value={novo.cat} onChange={(e) => setNovo({ ...novo, cat: e.target.value })} className={sel}>
                <option value="">Categoria do insumo (opcional)</option>
                {loja.merchandise_categories.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <p className="text-[11px] text-zinc-500">A unidade é a do estoque e da ficha técnica. O preço vem das notas quando você ligar o item.</p>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => { setNovo(null); setErro(null); }} className="h-9 px-3 rounded-lg border border-zinc-200 bg-white text-sm text-zinc-600 cursor-pointer">Cancelar</button>
                <button disabled={busy || !novo.nome.trim()} onClick={criarInsumo} className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold cursor-pointer disabled:opacity-50">{busy ? 'Criando…' : 'Criar insumo'}</button>
              </div>
            </div>
          ) : (
            <div>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ligar a insumo do estoque (buscar)…" className={sel} />
              {achados.length > 0 && (
                <div className="mt-1 rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
                  {achados.map((g) => (
                    <button key={g.id} onClick={() => escolher(g)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left text-sm text-zinc-800 hover:bg-emerald-50 cursor-pointer">
                      <span className="truncate">{g.name}</span><span className="text-[11px] text-zinc-400 shrink-0">{un(g.unit)}</span>
                    </button>
                  ))}
                </div>
              )}
              {busca.trim() && !achados.length && <p className="text-[11px] text-zinc-500 mt-1">Nenhum insumo com esse nome.</p>}
              <button disabled={busy} onClick={abrirNovo}
                className="mt-1 w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-emerald-300 text-left text-sm font-semibold text-emerald-700 hover:bg-emerald-50 cursor-pointer">
                <i className="ri-add-line" /><span className="truncate">{busca.trim() ? `Criar insumo “${busca.trim()}”` : 'Não está na lista? Criar insumo'}</span>
              </button>
            </div>
          ))}
          {!ing && !novo && (
            <select value={merc} onChange={(e) => setMerc(e.target.value)} className={sel}>
              <option value="">Categoria de mercadoria (opcional)</option>
              {loja.merchandise_categories.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          {!novo && (
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => { setModo(null); setIngId(null); setBusca(''); setUpp(''); }} className="h-9 px-3 rounded-lg border border-zinc-200 text-sm text-zinc-600 cursor-pointer">Voltar</button>
              {ing ? (
                <button disabled={busy} onClick={vincular} className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold cursor-pointer disabled:opacity-50">{busy ? 'Salvando…' : 'Vincular e salvar CMV'}</button>
              ) : (
                <button disabled={busy} onClick={() => salvar('cmv')} className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold cursor-pointer disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar como CMV'}</button>
              )}
            </div>
          )}
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
            <button disabled={busy} onClick={() => setModo(null)} className="h-9 px-3 rounded-lg border border-zinc-200 text-sm text-zinc-600 cursor-pointer">Voltar</button>
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
  // Quem usa passa onTudo como arrow inline: numa ref, para o carregar não mudar a cada render (e não recarregar em laço).
  const onTudoRef = useRef(onTudo);
  onTudoRef.current = onTudo;

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const r = await call<{ tenants: Loja[]; gestor?: string[] }>('items_pending');
      const todas = r.tenants;
      // items_pending só traz lojas COM item pendente onde você é admin/gerente; `gestor` lista todas as
      // lojas em que você classifica. Loja fora de `tenants`: se você é gestor dela, não sobrou nada
      // (2026-10-03: antes dizia "precisa ser admin ou gerente" para o dono com tudo classificado).
      if (tenantId && !todas.some((l) => l.id === tenantId)) {
        if (r.gestor && !r.gestor.includes(tenantId)) throw new Error('Só admin ou supervisor dessa loja classifica os itens.');
        setLojas([]);
        setTimeout(() => onTudoRef.current?.(), 0); // a pendência some da caixa/Hoje
        setLoading(false);
        return;
      }
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
