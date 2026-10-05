import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { custoLinhaFicha } from '@/lib/unitConversion';
import { custoFichaItens } from '@/lib/ifoodCusto';
import { custosIfood } from '../lib/useIfoodDados';
import { buscarAlvos, rotuloPasso, type AlvoCardapio } from '../lib/itensLogica';
import Folha from '@/pages/estoque/components/inicio/Folha';
import { btn, brl, semAcento } from '@/pages/estoque/components/ui/EstoqueUi';

// "Ligar à ficha" (área iFood, 2026-10-05, protótipo ifood-proposta.html › Ligar à ficha). Uma ligação só
// para custo e estoque: junta o que eram duas telas ("Vincular itens" do Gestor de Entregas e "Compor" do
// CMV). Item normal → item/combo do cardápio (já tem ficha e preço do balcão). Complemento → também opção.
// Combo que só existe no iFood → "Montar o custo com insumos" (custo à mão; não baixa estoque).
// Nada é sugerido sozinho (regra do dono 09-24): a pessoa escolhe cada par.

export interface ItemFila { nivel: 'item' | 'complemento'; nome: string; grupo: string | null; qtd: number; faturado: number }

interface Props {
  tenantId: string;
  aberta: boolean;
  fila: ItemFila[];
  indice?: number;
  /** true = trocar a ligação de um item que já tem (fila de 1): troca o rótulo do passo. */
  troca?: boolean;
  onFechar: () => void;
  /** Depois de gravar uma ligação (a aba recarrega). */
  onLigou: () => void;
}

interface Insumo { id: string; name: string; unit: string; unit_price: number | null }
interface LinhaEdit { ingredient_id: string; quantity: string; unit: string }
interface InfoAlvo { custo: number | null; preco: number | null }

const KIND: Record<string, string> = { item: 'Cardápio', combo: 'Combo', option: 'Opção' };
const UNID_LABEL: Record<string, string> = { g: 'g', kg: 'kg', ml: 'ml', L: 'L', unit: 'un' };
const unidadesDo = (u: string) => (u === 'g' || u === 'kg' ? ['g', 'kg'] : u === 'ml' || u === 'L' ? ['ml', 'L'] : ['unit']);
const unidadePadrao = (u: string) => (u === 'kg' ? 'g' : u === 'L' ? 'ml' : u);
const n = (v: unknown) => Number(v ?? 0) || 0;
const qtdNum = (s: string) => Number(String(s).replace(',', '.')) || 0;
const chaveAlvo = (a: Pick<AlvoCardapio, 'kind' | 'id'>) => `${a.kind}:${a.id}`;

/** Custo da ficha e preço do balcão dos alvos visíveis (itens e combos; opção só mostra o adicional). */
async function infoDosAlvos(tenantId: string, vis: AlvoCardapio[]): Promise<Map<string, InfoAlvo>> {
  const out = new Map<string, InfoAlvo>();
  const itemIds = vis.filter((a) => a.kind === 'item').map((a) => a.id);
  const comboIds = vis.filter((a) => a.kind === 'combo').map((a) => a.id);
  const optionIds = vis.filter((a) => a.kind === 'option').map((a) => a.id);
  const [pi, pc, po, ci] = await Promise.all([
    itemIds.length ? supabase.from('menu_items').select('id, price').in('id', itemIds) : null,
    comboIds.length ? supabase.from('combos').select('id, price').in('id', comboIds) : null,
    optionIds.length ? supabase.from('options').select('id, additional_price').in('id', optionIds) : null,
    comboIds.length ? supabase.from('combo_items').select('combo_id, item_id, quantity').in('combo_id', comboIds).is('deleted_at', null) : null,
  ]);
  const comps = (ci?.data ?? []) as Array<{ combo_id: string; item_id: string; quantity: number | null }>;
  const fichas = await custoFichaItens(tenantId, [...itemIds, ...comps.map((c) => c.item_id)]);
  for (const r of (pi?.data ?? []) as Array<{ id: string; price: number | null }>) out.set(`item:${r.id}`, { custo: fichas.get(r.id) ?? null, preco: n(r.price) });
  for (const r of (pc?.data ?? []) as Array<{ id: string; price: number | null }>) {
    const mine = comps.filter((c) => c.combo_id === r.id);
    let custo: number | null = mine.length ? 0 : null;
    for (const c of mine) { const v = fichas.get(c.item_id); if (v == null) { custo = null; break; } custo = (custo ?? 0) + v * (n(c.quantity) || 1); }
    out.set(`combo:${r.id}`, { custo, preco: n(r.price) });
  }
  for (const r of (po?.data ?? []) as Array<{ id: string; additional_price: number | null }>) out.set(`option:${r.id}`, { custo: null, preco: n(r.additional_price) });
  return out;
}

export default function LigarFichaFolha({ tenantId, aberta, fila, indice = 0, troca = false, onFechar, onLigou }: Props) {
  const [idx, setIdx] = useState(indice);
  const [alvos, setAlvos] = useState<AlvoCardapio[] | null>(null);
  const [info, setInfo] = useState<Map<string, InfoAlvo>>(new Map());
  const [busca, setBusca] = useState('');
  const [escolha, setEscolha] = useState<AlvoCardapio | 'sem_estoque' | null>(null);
  const [modo, setModo] = useState<'escolher' | 'montar'>('escolher');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const atual = fila[Math.min(idx, Math.max(0, fila.length - 1))] ?? null;

  // Abriu: volta para o item pedido.
  useEffect(() => { if (aberta) setIdx(indice); }, [aberta, indice]);
  // Trocou de item: limpa a escolha.
  useEffect(() => { setBusca(''); setEscolha(null); setModo('escolher'); setErro(null); }, [idx, aberta]);

  useEffect(() => {
    if (!aberta || alvos) return;
    let vivo = true;
    supabase.rpc('fn_ifood_vinculo_alvos', { p_tenant: tenantId }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { setErro(error.message); setAlvos([]); return; }
      setAlvos((data ?? []) as AlvoCardapio[]);
    });
    return () => { vivo = false; };
  }, [aberta, alvos, tenantId]);

  const achados = useMemo(() => (alvos && atual ? buscarAlvos(alvos, atual.nivel, busca, 40) : []), [alvos, atual, busca]);
  // Custo da ficha só dos ~20 primeiros resultados visíveis.
  const chaveVisiveis = achados.slice(0, 20).map(chaveAlvo).join(',');
  useEffect(() => {
    if (!aberta || modo !== 'escolher') return;
    const faltam = achados.slice(0, 20).filter((a) => !info.has(chaveAlvo(a)));
    if (!faltam.length) return;
    let vivo = true;
    infoDosAlvos(tenantId, faltam).then((m) => {
      if (!vivo) return;
      setInfo((antes) => { const novo = new Map(antes); for (const a of faltam) novo.set(chaveAlvo(a), m.get(chaveAlvo(a)) ?? { custo: null, preco: null }); for (const [k, v] of m) novo.set(k, v); return novo; });
    }).catch(() => { /* sem o custo na lista: a ligação continua possível */ });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, modo, chaveVisiveis, tenantId]);

  const avancar = () => {
    if (idx + 1 < fila.length) setIdx(idx + 1); else onFechar();
  };

  const gravar = async (kind: string, target: string | null) => {
    if (!atual) return;
    setSalvando(true); setErro(null);
    const { error } = await supabase.rpc('fn_ifood_vinculo_salvar', {
      p_tenant: tenantId, p_level: atual.nivel, p_name: atual.nome, p_group: atual.grupo, p_ifood_id: null,
      p_external_code: null, p_kind: kind, p_target: target,
    });
    if (error) { setSalvando(false); setErro(error.message); return false; }
    await custosIfood(tenantId, true).catch(() => null);
    setSalvando(false);
    onLigou();
    return true;
  };

  const ligar = async () => {
    if (!escolha) return;
    const ok = escolha === 'sem_estoque' ? await gravar('sem_estoque', null) : await gravar(escolha.kind, escolha.id);
    if (ok) avancar();
  };

  const ultimo = idx + 1 >= fila.length;
  const pct = fila.length ? Math.round(((Math.min(idx, fila.length - 1) + 1) / fila.length) * 100) : 0;

  return (
    <Folha aberta={aberta && !!atual} titulo={troca ? 'Trocar a ligação' : 'Ligar à ficha'} onFechar={onFechar} fecharNoFundo={modo === 'escolher' && !salvando}
      rodape={atual && (modo === 'escolher' ? (
        <>
          {fila.length > 1 && <button type="button" className={`${btn('out')} flex-1`} disabled={salvando} onClick={avancar}>{ultimo ? 'Fechar' : 'Pular'}</button>}
          <button type="button" className={`${btn('p')} flex-[2]`} disabled={!escolha || salvando} onClick={ligar}>
            {salvando ? 'Salvando…' : ultimo ? 'Ligar e concluir' : 'Ligar e ir para o próximo'}
          </button>
        </>
      ) : null)}>
      {atual && (
        <div className="pb-2">
          {!troca && fila.length > 1 && (
            <>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-amber-700">{rotuloPasso(idx, fila.length)}</p>
              <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden mt-1"><div className="h-full bg-amber-400" style={{ width: `${pct}%` }} /></div>
            </>
          )}
          <div className="mt-3">
            <p className="text-[15px] font-extrabold text-zinc-900 leading-snug">{atual.nome}</p>
            <p className="text-xs text-zinc-500">
              {atual.nivel === 'complemento' ? `Complemento${atual.grupo ? ` · ${atual.grupo}` : ''}` : 'Item do iFood'} · vendeu {atual.qtd.toLocaleString('pt-BR')}
              {atual.faturado > 0.005 ? ` · ${brl(atual.faturado)}` : ''}
            </p>
          </div>

          {modo === 'escolher' ? (
            <div className="mt-3 space-y-3">
              <p className="text-[13px] font-extrabold text-zinc-800">É qual item do seu cardápio?</p>
              <div className="relative">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={atual.nivel === 'item' ? 'Buscar item ou combo do cardápio' : 'Buscar opção, item ou combo do cardápio'}
                  className="w-full h-11 pl-9 pr-3 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:border-amber-400" />
              </div>
              {!alvos ? (
                <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : (
                <div className="rounded-2xl border border-zinc-200 divide-y divide-zinc-100 max-h-[40dvh] overflow-y-auto">
                  {achados.map((a, k) => {
                    const sel = escolha !== 'sem_estoque' && escolha?.kind === a.kind && escolha.id === a.id;
                    const inf = info.get(chaveAlvo(a));
                    return (
                      <button key={chaveAlvo(a)} type="button" disabled={salvando} onClick={() => setEscolha(a)}
                        className={`w-full text-left px-3 py-2.5 flex gap-2.5 items-center cursor-pointer ${sel ? 'bg-amber-50' : 'hover:bg-zinc-50'}`}>
                        <span className={`w-8 h-8 rounded-xl flex-none flex items-center justify-center ${sel ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                          <i className={sel ? 'ri-check-line' : a.kind === 'option' ? 'ri-add-circle-line' : 'ri-restaurant-line'} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <b className="block text-[13.5px] text-zinc-900 truncate">{a.nome}</b>
                          <span className="block text-[11.5px] text-zinc-500 truncate">
                            {KIND[a.kind]}{a.detalhe ? ` · ${a.detalhe}` : ''}
                            {a.kind !== 'option' && (k < 20 ? (inf ? (inf.custo != null ? ` · comida ${brl(inf.custo)} pela ficha` : ' · sem ficha') : '') : '')}
                          </span>
                        </span>
                        {inf?.preco != null && inf.preco > 0.005 && (
                          <span className="text-right flex-none"><b className="block text-[13px]">{brl(inf.preco)}</b><span className="block text-[10.5px] text-zinc-400">{a.kind === 'option' ? 'adicional' : 'no balcão'}</span></span>
                        )}
                      </button>
                    );
                  })}
                  {achados.length === 0 && <p className="px-3 py-5 text-center text-xs text-zinc-400">Nada encontrado{semAcento(busca) ? ` para "${busca.trim()}"` : ''}.</p>}
                </div>
              )}

              <div className="space-y-2">
                <button type="button" disabled={salvando} onClick={() => setEscolha('sem_estoque')}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border flex items-center gap-2.5 cursor-pointer ${escolha === 'sem_estoque' ? 'border-amber-300 bg-amber-50' : 'border-zinc-200 hover:bg-zinc-50'}`}>
                  <i className={`${escolha === 'sem_estoque' ? 'ri-check-line text-amber-700' : 'ri-prohibited-line text-zinc-400'} text-lg`} />
                  <span><b className="block text-[13px] text-zinc-800">Não usa estoque</b><span className="block text-[11.5px] text-zinc-500">Ex.: "sem cebola", embalagem do iFood. Custo zero.</span></span>
                </button>
                <button type="button" disabled={salvando} onClick={() => setModo('montar')}
                  className="w-full text-left px-3 py-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 flex items-center gap-2.5 cursor-pointer">
                  <i className="ri-add-line text-lg text-zinc-400" />
                  <span><b className="block text-[13px] text-zinc-800">Montar o custo com insumos</b><span className="block text-[11.5px] text-zinc-500">Para combo que só existe no iFood.</span></span>
                </button>
              </div>

              {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{erro}</p>}
              <p className="text-[11.5px] text-amber-900 bg-amber-50 rounded-xl px-3 py-2 leading-snug">
                <b>Com a ligação:</b> o custo entra na sobra, o estoque baixa quando o pedido entrar na cozinha do ERPOS e os complementos se ligam do mesmo jeito.
              </p>
            </div>
          ) : (
            <MontarCusto tenantId={tenantId} item={atual} ultimo={ultimo} onVoltar={() => { setModo('escolher'); setErro(null); }}
              onSalvou={async () => { await custosIfood(tenantId, true).catch(() => null); onLigou(); avancar(); }} />
          )}
        </div>
      )}
    </Folha>
  );
}

// ── Montar o custo com insumos (copiado do EditorComposicao do CMV antigo; grava em fn_ifood_cmv_salvar) ──

function MontarCusto({ tenantId, item, ultimo, onVoltar, onSalvou }: {
  tenantId: string; item: ItemFila; ultimo: boolean; onVoltar: () => void; onSalvou: () => Promise<void>;
}) {
  const [insumos, setInsumos] = useState<Insumo[] | null>(null);
  const [ls, setLs] = useState<LinhaEdit[]>([]);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetchAllRows<Insumo>((f, t) => supabase.from('ingredients').select('id, name, unit, unit_price').eq('tenant_id', tenantId).is('deleted_at', null).order('name').order('id').range(f, t))
      .then((r) => { if (!vivo) return; if (r.error) setErro(r.error.message); setInsumos(r.rows); });
    return () => { vivo = false; };
  }, [tenantId]);

  const porId = useMemo(() => new Map((insumos ?? []).map((i) => [i.id, i])), [insumos]);
  const custoLinha = (l: LinhaEdit) => { const i = porId.get(l.ingredient_id); return i ? custoLinhaFicha(qtdNum(l.quantity), l.unit, i.unit, n(i.unit_price)) : 0; };
  const custoUnit = ls.reduce((s, l) => s + custoLinha(l), 0);
  const precoMedio = item.qtd > 0 ? item.faturado / item.qtd : 0;
  const q = semAcento(busca);
  const achados = q.length >= 2 ? (insumos ?? []).filter((i) => semAcento(i.name).includes(q) && !ls.some((l) => l.ingredient_id === i.id)).slice(0, 8) : [];

  const salvar = async () => {
    if (!ls.length) { setErro('Adicione ao menos um insumo.'); return; }
    if (ls.some((l) => qtdNum(l.quantity) <= 0)) { setErro('Informe a quantidade de todos os insumos (ou remova a linha).'); return; }
    setSalvando(true); setErro(null);
    // A ligação ao cardápio (se houver) continua: é ela que dá baixa no estoque. O custo à mão vale quando
    // não há ligação ou quando o item ligado não tem ficha (ifoodCusto.ts).
    const { error } = await supabase.rpc('fn_ifood_cmv_salvar', {
      p_tenant: tenantId, p_kind: item.nivel, p_name: item.nome,
      p_linhas: ls.map((l) => ({ ingredient_id: l.ingredient_id, quantity: qtdNum(l.quantity), unit: l.unit })),
    });
    if (error) { setSalvando(false); setErro(error.message); return; }
    await onSalvou();
    setSalvando(false);
  };

  return (
    <div className="mt-3 space-y-3">
      <p className="text-[13px] font-extrabold text-zinc-800">Do que é feito?</p>
      <div className="relative">
        <i className="ri-add-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Adicionar insumo (digite o nome)"
          className="w-full h-11 pl-9 pr-3 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:border-amber-400" />
        {achados.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden">
            {achados.map((i) => (
              <button key={i.id} type="button" onClick={() => { setLs([...ls, { ingredient_id: i.id, quantity: '', unit: unidadePadrao(i.unit) }]); setBusca(''); }}
                className="w-full flex justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-zinc-50 cursor-pointer">
                <span className="text-zinc-800">{i.name}</span>
                <span className="text-xs text-zinc-400 tabular-nums whitespace-nowrap">{brl(n(i.unit_price))}/{UNID_LABEL[i.unit] ?? i.unit}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-200 divide-y divide-zinc-100">
        {!insumos && <div className="flex justify-center py-5"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>}
        {insumos && ls.length === 0 && <p className="px-3 py-5 text-center text-xs text-zinc-400">Nenhum insumo ainda. Adicione acima.</p>}
        {ls.map((l, k) => {
          const ins = porId.get(l.ingredient_id);
          return (
            <div key={l.ingredient_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="flex-1 min-w-[140px]">
                <p className="text-[13px] text-zinc-800">{ins?.name ?? 'Insumo removido'}</p>
                {ins && <p className="text-[11px] text-zinc-400 tabular-nums">{brl(n(ins.unit_price))}/{UNID_LABEL[ins.unit] ?? ins.unit}</p>}
              </div>
              <input inputMode="decimal" value={l.quantity} placeholder="Qtd" onChange={(e) => setLs(ls.map((x, i) => (i === k ? { ...x, quantity: e.target.value.replace(/[^\d,.]/g, '') } : x)))}
                className="w-20 h-9 px-2 border border-zinc-200 rounded-lg text-sm text-right tabular-nums focus:outline-none focus:border-amber-400" />
              <select value={l.unit} onChange={(e) => setLs(ls.map((x, i) => (i === k ? { ...x, unit: e.target.value } : x)))} className="h-9 px-2 border border-zinc-200 rounded-lg text-sm bg-white">
                {unidadesDo(ins?.unit ?? l.unit).map((u) => <option key={u} value={u}>{UNID_LABEL[u]}</option>)}
              </select>
              <span className="w-16 text-right text-[13px] tabular-nums text-zinc-700">{brl(custoLinha(l))}</span>
              <button type="button" aria-label="Tirar" onClick={() => setLs(ls.filter((_, i) => i !== k))} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"><i className="ri-delete-bin-line" /></button>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-zinc-50 p-3 text-center">
        <div><p className="text-[11px] text-zinc-500">Comida por unidade</p><p className="font-extrabold tabular-nums">{brl(custoUnit)}</p></div>
        <div><p className="text-[11px] text-zinc-500">Preço médio no iFood</p><p className="font-extrabold tabular-nums">{precoMedio > 0 ? brl(precoMedio) : '—'}</p></div>
      </div>
      <p className="text-[11.5px] text-zinc-500 leading-snug">Custo montado à mão entra na sobra, mas <b>não baixa estoque</b>: para baixar, ligue ao item do cardápio.</p>
      {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{erro}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" className={`${btn('out')} flex-1`} disabled={salvando} onClick={onVoltar}>Voltar</button>
        <button type="button" className={`${btn('p')} flex-[2]`} disabled={salvando || ls.length === 0} onClick={salvar}>
          {salvando ? 'Salvando…' : ultimo ? 'Salvar e concluir' : 'Salvar e ir para o próximo'}
        </button>
      </div>
    </div>
  );
}
