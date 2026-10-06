import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { custoLinhaFicha } from '@/lib/unitConversion';
import { custoFichaItens } from '@/lib/ifoodCusto';
import { custosIfood } from '../lib/useIfoodDados';
import { buscarAlvos, rotuloPasso, type AlvoCardapio } from '../lib/itensLogica';
import { Folha } from '@/components/kit';
import { btn, brl, semAcento } from '@/components/kit';

// "Ligar à ficha" (área iFood, 2026-10-05, protótipo ifood-proposta.html › Ligar à ficha). Uma ligação só
// para custo e estoque: junta o que eram duas telas ("Vincular itens" do Gestor de Entregas e "Compor" do
// CMV). Item → item ou combo do cardápio principal (já tem ficha e preço do balcão); opção não entra (dono, 05/10).
// Ficha do iFood montada com itens + insumos (embalagem, sachê, combo só do iFood) → MontarFicha.
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
  const [escolha, setEscolha] = useState<AlvoCardapio | 'sem_estoque' | 'escolhas' | null>(null);
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

  // Só o cardápio principal (itens e combos), nunca opção (dono, 05/10).
  const principais = useMemo(() => (alvos ?? []).filter((a) => a.kind !== 'option'), [alvos]);
  const achados = useMemo(() => (alvos && atual ? buscarAlvos(principais, atual.nivel, busca, 40) : []), [alvos, principais, atual, busca]);
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
    const ok = escolha === 'sem_estoque' || escolha === 'escolhas' ? await gravar(escolha, null) : await gravar(escolha.kind, escolha.id);
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
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item ou combo do cardápio"
                  className="w-full h-11 pl-9 pr-3 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:border-amber-400" />
              </div>
              {!alvos ? (
                <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : (
                <div className="rounded-2xl border border-zinc-200 divide-y divide-zinc-100 max-h-[40dvh] overflow-y-auto">
                  {achados.map((a, k) => {
                    const sel = typeof escolha === 'object' && escolha?.kind === a.kind && escolha.id === a.id;
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
                {atual.nivel === 'item' && (
                  <button type="button" disabled={salvando} onClick={() => setEscolha('escolhas')}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border flex items-center gap-2.5 cursor-pointer ${escolha === 'escolhas' ? 'border-amber-300 bg-amber-50' : 'border-zinc-200 hover:bg-zinc-50'}`}>
                    <i className={`${escolha === 'escolhas' ? 'ri-check-line text-amber-700' : 'ri-stack-line text-zinc-400'} text-lg`} />
                    <span><b className="block text-[13px] text-zinc-800">É um combo de escolhas</b><span className="block text-[11.5px] text-zinc-500">O cliente escolhe o burrito, a bebida… nos complementos. A comida é a soma do que ele escolheu: depois ligue cada escolha ao item do cardápio.</span></span>
                  </button>
                )}
                <button type="button" disabled={salvando} onClick={() => setEscolha('sem_estoque')}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border flex items-center gap-2.5 cursor-pointer ${escolha === 'sem_estoque' ? 'border-amber-300 bg-amber-50' : 'border-zinc-200 hover:bg-zinc-50'}`}>
                  <i className={`${escolha === 'sem_estoque' ? 'ri-check-line text-amber-700' : 'ri-prohibited-line text-zinc-400'} text-lg`} />
                  <span><b className="block text-[13px] text-zinc-800">Não usa estoque</b><span className="block text-[11.5px] text-zinc-500">Ex.: "sem cebola", embalagem do iFood. Custo zero.</span></span>
                </button>
                <button type="button" disabled={salvando} onClick={() => setModo('montar')}
                  className="w-full text-left px-3 py-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 flex items-center gap-2.5 cursor-pointer">
                  <i className="ri-add-line text-lg text-zinc-400" />
                  <span><b className="block text-[13px] text-zinc-800">Montar a ficha do iFood (itens + insumos)</b><span className="block text-[11.5px] text-zinc-500">Quando no delivery vai algo a mais: embalagem, sachê, talher, ou combo que só existe no iFood.</span></span>
                </button>
              </div>

              {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{erro}</p>}
              <p className="text-[11.5px] text-amber-900 bg-amber-50 rounded-xl px-3 py-2 leading-snug">
                <b>Com a ligação:</b> o custo entra no lucro bruto, o estoque baixa quando o pedido entrar na cozinha do ERPOS e os complementos se ligam do mesmo jeito.
              </p>
            </div>
          ) : (
            <MontarFicha tenantId={tenantId} item={atual} ultimo={ultimo} itensCardapio={principais} inicial={typeof escolha === 'object' ? escolha : null} onVoltar={() => { setModo('escolher'); setErro(null); }}
              onSalvou={async () => { await custosIfood(tenantId, true).catch(() => null); onLigou(); avancar(); }} />
          )}
        </div>
      )}
    </Folha>
  );
}

// ── Montar a ficha do iFood: itens do cardápio + insumos (dono, 05/10: no delivery vai embalagem, sachê…) ──
// Grava em fn_ifood_ficha_salvar (ifood_ficha_linhas). Vale para o custo e para a baixa de estoque no modo "Entrar na
// cozinha do ERPOS" (ifood-shipping/funnel.ts): itens viram linhas do pedido; insumos baixam ligados ao pedido.

type LinhaFicha = { kind: 'item'; id: string; nome: string; quantity: string } | { kind: 'insumo'; id: string; nome: string; quantity: string; unit: string };

function MontarFicha({ tenantId, item, ultimo, itensCardapio, inicial, onVoltar, onSalvou }: {
  tenantId: string; item: ItemFila; ultimo: boolean; itensCardapio: AlvoCardapio[]; inicial: AlvoCardapio | null;
  onVoltar: () => void; onSalvou: () => Promise<void>;
}) {
  const [insumos, setInsumos] = useState<Insumo[] | null>(null);
  const [ls, setLs] = useState<LinhaFicha[]>(() => (inicial && inicial.kind === 'item' ? [{ kind: 'item', id: inicial.id, nome: inicial.nome, quantity: '1' }] : []));
  const [custoItem, setCustoItem] = useState<Map<string, number | null>>(new Map());
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetchAllRows<Insumo>((f, t) => supabase.from('ingredients').select('id, name, unit, unit_price').eq('tenant_id', tenantId).is('deleted_at', null).order('name').order('id').range(f, t))
      .then((r) => { if (!vivo) return; if (r.error) setErro(r.error.message); setInsumos(r.rows); });
    return () => { vivo = false; };
  }, [tenantId]);

  // Custo da ficha de cada item do cardápio que entrou na lista.
  const idsItens = ls.filter((l) => l.kind === 'item').map((l) => l.id).join(',');
  useEffect(() => {
    const faltam = ls.filter((l) => l.kind === 'item' && !custoItem.has(l.id)).map((l) => l.id);
    if (!faltam.length) return;
    let vivo = true;
    custoFichaItens(tenantId, faltam).then((m) => { if (vivo) setCustoItem((a) => { const novo = new Map(a); for (const [k, v] of m) novo.set(k, v); return novo; }); }).catch(() => null);
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsItens, tenantId]);

  const porId = useMemo(() => new Map((insumos ?? []).map((i) => [i.id, i])), [insumos]);
  const custoLinha = (l: LinhaFicha): number | null => {
    const q = qtdNum(l.quantity);
    if (l.kind === 'item') { const c = custoItem.get(l.id); return c == null ? null : c * q; }
    const i = porId.get(l.id); return i ? custoLinhaFicha(q, l.unit, i.unit, n(i.unit_price)) : 0;
  };
  const custos = ls.map(custoLinha);
  const semFicha = ls.filter((l, k) => l.kind === 'item' && custoItem.has(l.id) && custos[k] == null);
  const custoUnit = custos.some((c) => c == null) ? null : custos.reduce<number>((s, c) => s + (c ?? 0), 0);
  const precoMedio = item.qtd > 0 ? item.faturado / item.qtd : 0;
  const q = semAcento(busca);
  const achadosItens = q.length >= 2 ? itensCardapio.filter((a) => a.kind === 'item' && semAcento(a.nome).includes(q) && !ls.some((l) => l.kind === 'item' && l.id === a.id)).slice(0, 6) : [];
  const achadosIns = q.length >= 2 ? (insumos ?? []).filter((i) => semAcento(i.name).includes(q) && !ls.some((l) => l.kind === 'insumo' && l.id === i.id)).slice(0, 6) : [];
  const linhasItem = ls.filter((l) => l.kind === 'item');
  const umItemSo = linhasItem.length === 1 && qtdNum(linhasItem[0].quantity) === 1;

  const salvar = async () => {
    if (!ls.length) { setErro('Adicione ao menos um item ou insumo.'); return; }
    if (ls.some((l) => qtdNum(l.quantity) <= 0)) { setErro('Informe a quantidade de todas as linhas (ou tire a linha).'); return; }
    setSalvando(true); setErro(null);
    const { error } = await supabase.rpc('fn_ifood_ficha_salvar', {
      p_tenant: tenantId, p_level: item.nivel, p_name: item.nome, p_group: item.grupo,
      p_linhas: ls.map((l) => (l.kind === 'item'
        ? { kind: 'item', menu_item_id: l.id, quantity: qtdNum(l.quantity) }
        : { kind: 'insumo', ingredient_id: l.id, quantity: qtdNum(l.quantity), unit: l.unit })),
    });
    if (error) { setSalvando(false); setErro(error.message); return; }
    await onSalvou();
    setSalvando(false);
  };
  const mudarQtd = (k: number, v: string) => setLs(ls.map((x, i) => (i === k ? { ...x, quantity: v.replace(/[^\d,.]/g, '') } : x)));

  return (
    <div className="mt-3 space-y-3">
      <div>
        <p className="text-[13px] font-extrabold text-zinc-800">Ficha do iFood: do que é feito?</p>
        <p className="text-[11.5px] text-zinc-500">Itens do cardápio (já têm ficha) + o que muda no delivery: embalagem, sachê, talher…</p>
      </div>
      <div className="relative">
        <i className="ri-add-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Adicionar item do cardápio ou insumo"
          className="w-full h-11 pl-9 pr-3 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:border-amber-400" />
        {(achadosItens.length > 0 || achadosIns.length > 0) && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
            {achadosItens.map((a) => (
              <button key={`i${a.id}`} type="button" onClick={() => { setLs([...ls, { kind: 'item', id: a.id, nome: a.nome, quantity: '1' }]); setBusca(''); }}
                className="w-full flex justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-zinc-50 cursor-pointer">
                <span className="text-zinc-800"><i className="ri-restaurant-line text-zinc-400" /> {a.nome}</span>
                <span className="text-xs text-zinc-400 whitespace-nowrap">item do cardápio</span>
              </button>
            ))}
            {achadosIns.map((i) => (
              <button key={`n${i.id}`} type="button" onClick={() => { setLs([...ls, { kind: 'insumo', id: i.id, nome: i.name, quantity: '', unit: unidadePadrao(i.unit) }]); setBusca(''); }}
                className="w-full flex justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-zinc-50 cursor-pointer">
                <span className="text-zinc-800"><i className="ri-archive-line text-zinc-400" /> {i.name}</span>
                <span className="text-xs text-zinc-400 tabular-nums whitespace-nowrap">insumo · {brl(n(i.unit_price))}/{UNID_LABEL[i.unit] ?? i.unit}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-200 divide-y divide-zinc-100">
        {ls.length === 0 && <p className="px-3 py-5 text-center text-xs text-zinc-400">Nada ainda. Adicione acima.</p>}
        {ls.map((l, k) => {
          const ins = l.kind === 'insumo' ? porId.get(l.id) : undefined;
          const c = custos[k];
          const fichaItem = l.kind === 'item' ? custoItem.get(l.id) : undefined;
          const sub = l.kind === 'item'
            ? (custoItem.has(l.id) ? (fichaItem == null ? 'item sem ficha no cardápio' : `ficha ${brl(fichaItem)}`) : 'item do cardápio')
            : ins ? `${brl(n(ins.unit_price))}/${UNID_LABEL[ins.unit] ?? ins.unit}` : 'insumo';
          return (
            <div key={`${l.kind}${l.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="flex-1 min-w-[140px]">
                <p className="text-[13px] text-zinc-800"><i className={l.kind === 'item' ? 'ri-restaurant-line text-zinc-400' : 'ri-archive-line text-zinc-400'} /> {l.nome}</p>
                <p className="text-[11px] text-zinc-400">{sub}</p>
              </div>
              <input inputMode="decimal" value={l.quantity} placeholder="Qtd" onChange={(e) => mudarQtd(k, e.target.value)}
                className="w-16 h-9 px-2 border border-zinc-200 rounded-lg text-sm text-right tabular-nums focus:outline-none focus:border-amber-400" />
              {l.kind === 'insumo' ? (
                <select value={l.unit} onChange={(e) => setLs(ls.map((x, i) => (i === k && x.kind === 'insumo' ? { ...x, unit: e.target.value } : x)))} className="h-9 px-2 border border-zinc-200 rounded-lg text-sm bg-white">
                  {unidadesDo(ins?.unit ?? l.unit).map((u) => <option key={u} value={u}>{UNID_LABEL[u]}</option>)}
                </select>
              ) : <span className="text-xs text-zinc-500 w-8">un</span>}
              <span className={`w-16 text-right text-[13px] tabular-nums ${c == null ? 'text-orange-600' : 'text-zinc-700'}`}>{c == null ? '—' : brl(c)}</span>
              <button type="button" aria-label="Tirar" onClick={() => setLs(ls.filter((_, i) => i !== k))} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"><i className="ri-delete-bin-line" /></button>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-zinc-50 p-3 text-center">
        <div><p className="text-[11px] text-zinc-500">Comida por unidade</p><p className="font-extrabold tabular-nums">{custoUnit == null ? '—' : brl(custoUnit)}</p></div>
        <div><p className="text-[11px] text-zinc-500">Preço médio no iFood</p><p className="font-extrabold tabular-nums">{precoMedio > 0 ? brl(precoMedio) : '—'}</p></div>
      </div>
      {semFicha.length > 0 && <p className="text-[11.5px] text-orange-700 bg-orange-50 rounded-xl px-3 py-2">{semFicha.map((l) => l.nome).join(', ')} não tem ficha técnica no cardápio: o custo fica em aberto até cadastrar a ficha.</p>}
      <p className="text-[11.5px] text-zinc-500 leading-snug">
        O custo de tudo entra no lucro bruto. Estoque, quando o pedido entrar na cozinha do ERPOS:{' '}
        {umItemSo ? <>baixa o <b>{linhasItem[0].nome}</b></> : linhasItem.length ? <>baixa os itens (na cozinha aparecem como "parte de {item.nome}", a R$ 0)</> : null}
        {ls.some((l) => l.kind === 'insumo') ? <>{linhasItem.length ? ' e ' : ''}os insumos baixam junto com o pedido (voltam se o iFood cancelar)</> : null}.
      </p>
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
