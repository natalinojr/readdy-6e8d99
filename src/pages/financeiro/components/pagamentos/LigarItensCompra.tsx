// Ligar os itens da compra ao insumo aqui mesmo (2026-10-06, pedido do dono: "pode vincular os itens aqui
// mesmo, pra ficar mais prático, não precisar sair dessa tela"). Mesmo vínculo da Classificação de itens:
// fn_item_link_ingredient (corrige o custo e dá entrada no estoque dos recebimentos) ou fn_item_classify
// como despesa (não vai ao estoque). Itens pendentes: fn_compra_itens_ligar.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { confirmar } from '@/components/base/Dialogos';
import { useEstoque, type Insumo as InsumoEstoque } from '@/contexts/EstoqueContext';
import { useIngredientCategories } from '@/hooks/useIngredientCategories';
import { useDreGroups, isGrupoDespesa } from '@/hooks/useDreGroups';
import { un, num, mesmaUnidade, uppInicial, avisoConversao } from '@/lib/vinculoConversao';
import { lerValorBR } from '@/lib/formatters';
import CategoriaCombobox from '../CategoriaCombobox';
import InsumoModal from '@/pages/estoque/components/insumos/InsumoModal';
import { useToast } from '@/contexts/ToastContext';
import { brl, PRINCIPAL, SECUNDARIO } from './comum';

interface Pendente { purchase_item_id: string; classification_id: string | null; descricao: string; quantidade: number; unidade: string | null; valor: number; classe: string | null }
interface Opcao { id: string; name: string; unit: string | null; category: string | null }
interface Cat { id: string; name: string; group_type: string }

export default function LigarItensCompra({ tenantId, purchaseId, podeCriar, onMudou }: {
  tenantId: string; purchaseId: string; podeCriar: boolean; onMudou: () => void;
}) {
  const [itens, setItens] = useState<Pendente[] | null>(null);
  const [insumos, setInsumos] = useState<Opcao[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [novo, setNovo] = useState<{ item: Pendente; nome: string } | null>(null);
  const { upsertInsumo, reloadInsumos } = useEstoque();
  const { names: categoriasInsumo, addCategory } = useIngredientCategories();
  const { groupMeta } = useDreGroups();
  const toast = useToast();

  const carregar = useCallback(async () => {
    const [it, ins, c] = await Promise.all([
      supabase.rpc('fn_compra_itens_ligar', { p_tenant: tenantId, p_purchase: purchaseId }),
      supabase.rpc('fn_item_link_options', { p_tenant: tenantId }),
      supabase.from('fin_dre_categories').select('id, name, group_type').eq('tenant_id', tenantId).is('deleted_at', null).eq('is_active', true).order('name'),
    ]);
    if (it.error) { setErro(it.error.message); setItens([]); return; }
    setItens((it.data ?? []) as Pendente[]);
    setInsumos((ins.data ?? []) as Opcao[]);
    setCats(((c.data ?? []) as Cat[]).filter((x) => isGrupoDespesa(x.group_type)));
  }, [tenantId, purchaseId]);
  useEffect(() => { void carregar(); }, [carregar]);

  const insOptions = useMemo(() => insumos.map((i) => ({ id: i.id, label: i.name, sub: [un(i.unit), i.category].filter(Boolean).join(' · ') })), [insumos]);
  const catOptions = useMemo(() => cats.map((c) => ({ id: c.id, label: c.name, sub: groupMeta(c.group_type)?.label ?? null })), [cats, groupMeta]);

  // Toast além da linha verde: quando o último item é ligado, a compra sai da lista e o painel some junto.
  const resolvido = async (texto: string) => {
    setFeito(texto);
    toast.success('Item resolvido', texto);
    await carregar();
    onMudou();
  };

  const criarInsumo = async (item: Pendente, data: Omit<InsumoEstoque, 'estoqueAtual' | 'ultimaEntrada' | 'fichaTecnica' | 'esgotado'> & { id?: string }) => {
    if (data.categoria && data.categoria !== 'Sem categoria' && !categoriasInsumo.includes(data.categoria)) await addCategory(data.categoria);
    const id = await upsertInsumo({
      nome: data.nome, unidade: data.unidade, categoria: data.categoria, usageType: data.usageType,
      precoUnitario: data.precoUnitario, priceSource: data.priceSource, estoqueMinimo: data.estoqueMinimo,
      purchaseUnit: data.purchaseUnit, purchaseFactor: data.purchaseFactor ?? 1, dreCategoryId: data.dreCategoryId,
      rastrearEstoque: data.rastrearEstoque, contaInventario: data.contaInventario,
      unidadeContagem: data.unidadeContagem ?? null, fatorContagem: data.fatorContagem ?? null,
    });
    setNovo(null);
    if (!id) { setErro('Não foi possível criar o insumo. Confira se já não existe um com este nome.'); return; }
    await Promise.all([carregar(), reloadInsumos()]);
    setEscolhaInicial({ itemId: item.purchase_item_id, ingId: id, unit: data.unidade });
  };
  // Insumo recém-criado já fica escolhido na linha do item
  const [escolhaInicial, setEscolhaInicial] = useState<{ itemId: string; ingId: string; unit: string | null } | null>(null);

  if (itens === null) return <p className="text-xs text-zinc-400 mt-2">Carregando os itens…</p>;
  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 flex flex-col gap-2">
      {feito && <p className="text-xs text-emerald-700 font-semibold"><i className="ri-check-line" /> {feito}</p>}
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {itens.length === 0 ? (
        <p className="text-xs text-emerald-700 font-semibold"><i className="ri-checkbox-circle-line" /> Todos os itens desta compra estão ligados.</p>
      ) : itens.map((it) => (
        <LinhaItem key={it.purchase_item_id} it={it} tenantId={tenantId} insOptions={insOptions} insumos={insumos} catOptions={catOptions}
          podeCriar={podeCriar} inicial={escolhaInicial?.itemId === it.purchase_item_id ? escolhaInicial : null}
          onCriar={(nome) => setNovo({ item: it, nome })} onFeito={resolvido} onErro={setErro} />
      ))}
      <p className="text-[11px] text-zinc-400">O vínculo vale para as próximas compras deste produto e corrige o custo das já lançadas. Mesmo vínculo da Classificação de itens.</p>
      {novo && (
        <InsumoModal insumo={null} nomeInicial={novo.nome} categoriasDisponiveis={categoriasInsumo}
          onClose={() => setNovo(null)} onSave={(data) => { void criarInsumo(novo.item, data); }} />
      )}
    </div>
  );
}

function LinhaItem({ it, tenantId, insOptions, insumos, catOptions, podeCriar, inicial, onCriar, onFeito, onErro }: {
  it: Pendente; tenantId: string; insOptions: Array<{ id: string; label: string; sub?: string | null }>; insumos: Opcao[];
  catOptions: Array<{ id: string; label: string; sub?: string | null }>; podeCriar: boolean;
  inicial: { ingId: string; unit: string | null } | null;
  onCriar: (nome: string) => void; onFeito: (texto: string) => void; onErro: (e: string | null) => void;
}) {
  const [ing, setIng] = useState<{ id: string; unit: string | null } | null>(inicial ? { id: inicial.ingId, unit: inicial.unit } : null);
  const [upp, setUpp] = useState(inicial ? uppInicial(it.unidade, inicial.unit) : '');
  const [despesa, setDespesa] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (inicial) { setIng({ id: inicial.ingId, unit: inicial.unit }); setUpp(uppInicial(it.unidade, inicial.unit)); } }, [inicial, it.unidade]);
  const nomeIng = ing ? insumos.find((x) => x.id === ing.id)?.name ?? 'insumo' : '';

  const ligar = async () => {
    if (!ing || !it.classification_id) return;
    const u = lerValorBR(upp);
    if (!(u > 0)) { onErro(`Diga quanto de ${nomeIng} (${un(ing.unit)}) vem em 1 ${un(it.unidade)}.`); return; }
    if (u === 1 && !mesmaUnidade(it.unidade, ing.unit)
      && !(await confirmar({ titulo: `Confere? 1 ${un(it.unidade)} de "${it.descricao}" = 1 ${un(ing.unit)} de ${nomeIng}.`, confirmarLabel: 'Confirmar' }))) return;
    const aviso = avisoConversao(it.unidade, ing.unit, u);
    if (aviso && !(await confirmar({ titulo: aviso, confirmarLabel: 'Confirmar' }))) return;
    setOcupado(true); onErro(null);
    const { data, error } = await supabase.rpc('fn_item_link_ingredient', {
      p_tenant: tenantId, p_id: it.classification_id, p_ingredient_id: ing.id, p_units_per_package: u,
    });
    setOcupado(false);
    if (error) { onErro(error.message); return; }
    const d = (data ?? {}) as { estoque_entraram?: number; estoque_quantidade?: number; unidade?: string };
    onFeito(`"${it.descricao}" ligado a ${nomeIng}${d.estoque_entraram ? ` · +${num(Number(d.estoque_quantidade ?? 0))} ${un(d.unidade)} no estoque` : ''}.`);
  };

  const comoDespesa = async (catId: string) => {
    if (!it.classification_id || !catId) return;
    setOcupado(true); onErro(null);
    const { error } = await supabase.rpc('fn_item_classify', {
      p_tenant: tenantId, p_ids: [it.classification_id], p_classe: 'despesa', p_dre_category_id: catId, p_merchandise_category_id: null,
    });
    setOcupado(false);
    if (error) { onErro(error.message); return; }
    onFeito(`"${it.descricao}" marcado como despesa (não vai ao estoque).`);
  };

  return (
    <div className="rounded-lg bg-white border border-zinc-200 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <b className="text-[13px] text-zinc-800 break-words">{it.descricao}</b>
        <span className="text-xs text-zinc-500 tabular-nums">{num(Number(it.quantidade))} {un(it.unidade)} · {brl(Number(it.valor))}</span>
      </div>
      {!it.classification_id ? (
        <p className="text-[11px] text-zinc-400 mt-1">Este item ainda não entrou na Classificação de itens — ligue por lá.</p>
      ) : ing ? (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs text-zinc-700"><i className="ri-links-line text-emerald-600" /> {nomeIng}</span>
          <label className="flex items-center gap-1.5 text-xs text-zinc-600">
            1 {un(it.unidade)} =
            <input autoFocus value={upp} inputMode="decimal" placeholder="?" onChange={(e) => setUpp(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void ligar(); }}
              className="w-16 h-8 border border-zinc-200 rounded-lg px-2 text-sm focus:outline-none focus:border-amber-400" />
            {un(ing.unit)}
          </label>
          <button disabled={ocupado} onClick={() => void ligar()} className={PRINCIPAL}><i className="ri-check-line" /> Ligar</button>
          <button disabled={ocupado} onClick={() => { setIng(null); setUpp(''); }} className="text-xs text-zinc-500 cursor-pointer">Trocar</button>
        </div>
      ) : despesa ? (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <CategoriaCombobox value="" options={catOptions} disabled={ocupado} placeholder="Categoria da despesa…"
            onChange={(id) => { if (id) void comoDespesa(id); }}
            buttonClassName="text-xs font-semibold rounded-lg px-2 py-1.5 w-[220px] cursor-pointer bg-white text-zinc-600 border border-zinc-200" />
          <button onClick={() => setDespesa(false)} className="text-xs text-zinc-500 cursor-pointer">Voltar</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <CategoriaCombobox value="" options={insOptions} disabled={ocupado} placeholder="Ligar a um insumo…"
            onChange={(id) => { const g = insumos.find((x) => x.id === id); if (g) { setIng({ id: g.id, unit: g.unit }); setUpp(uppInicial(it.unidade, g.unit)); } }}
            onCreate={podeCriar ? (texto) => onCriar(texto || it.descricao) : undefined}
            createLabel={(texto) => (texto ? `Criar insumo “${texto}”` : 'Criar novo insumo')}
            buttonClassName="text-xs font-semibold rounded-lg px-2 py-1.5 w-[220px] cursor-pointer bg-white text-zinc-600 border border-dashed border-zinc-300 hover:border-emerald-400" />
          <button onClick={() => setDespesa(true)} className={SECUNDARIO}>Não vai ao estoque (despesa)</button>
        </div>
      )}
    </div>
  );
}
