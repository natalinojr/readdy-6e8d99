import { useEffect, useMemo, useState } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useProducao } from '@/contexts/ProducaoContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { invokeWithAuth, supabase } from '@/lib/supabase';
import { custoLinhaFicha } from '@/lib/unitConversion';
import { insumosDaOpcao } from '@/lib/opcaoInsumos';

// Opções × Estoque (dono, 2026-09-25/26): liga os complementos do cardápio a insumos para darem baixa.
// Junta as opções de MESMO NOME de todos os itens (o mesmo "Guacamole - 50 ml" em 30 burritos vira uma linha).
// Ao escolher o insumo, cada item aparece com a própria quantidade (pode variar de um item para outro) e dá
// para desmarcar itens. Uma opção pode ter vários insumos: ligar aqui ACRESCENTA, não troca os que já existem.
// A sugestão de insumo é só um botão: nada é ligado sem a pessoa escolher e confirmar.
// 2026-10-06: a escolha é por busca digitando (insumo, produção ou produto do cardápio), dá para escolher vários
// de uma vez, e o produto do cardápio liga a opção à ficha técnica inteira dele (options.linked_item_id).

const UNIDADES = ['g', 'kg', 'ml', 'l', 'un'];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Núcleo do nome para achar o insumo: tira "adicional de", "extra", quantidade e sinais
const nucleo = (s: string) => norm(s)
  .replace(/\b\d+[.,]?\d*\s*(g|gr|kg|ml|l|un)\b/g, ' ')
  .replace(/\b(adicional|adicionais|extra|porcao|de|do|da|com|mais)\b/g, ' ')
  .replace(/[-()/+]/g, ' ').replace(/\s+/g, ' ').trim();
const qtdNoNome = (s: string): { q: string; u: string } | null => {
  const m = norm(s).match(/\b(\d+[.,]?\d*)\s*(g|gr|kg|ml|l)\b/);
  if (!m) return null;
  return { q: m[1].replace('.', ','), u: m[2] === 'gr' ? 'g' : m[2] };
};
const unidadeInicial = (u: string) => (u === 'kg' ? 'g' : u === 'l' || u === 'L' ? 'ml' : u === 'unit' ? 'un' : u || 'un');
const numero = (s: string) => Number(String(s ?? '').replace(',', '.'));
const IGNORADAS_KEY = (t: string) => `erpos_opcoes_nao_estoque_${t}`;
const MAX_RESULTADOS = 40;

type Tipo = 'insumo' | 'producao' | 'produto';
interface Alvo { chave: string; nome: string; tipo: Tipo; ingredientId: string | null; recipeId: string | null; itemId: string | null; unidade: string; preco: number }
interface Membro { optionId: string; itemId: string; itemNome: string; insumos: string[]; produto: string | null; preco: number }
interface Linha { chave: string; nome: string; membros: Membro[] }
interface Escolhido { chave: string; u: string; todos: string; qtd: Record<string, string> }
interface Escolha { alvos: Escolhido[]; marcado: Record<string, boolean> }

export default function OpcoesEstoqueTab() {
  const { itens, recarregar } = useCardapio();
  const { insumos } = useEstoque();
  const { recipes } = useProducao();
  const { user } = useAuth();
  const { addToast } = useToast();
  const tenantId = user?.tenantId ?? '';
  const pode = user?.perfil === 'admin' || user?.perfil === 'gerente';

  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'pendentes' | 'todas' | 'ignoradas'>('pendentes');
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  // Busca do insumo de cada linha (o que está digitado) e qual linha está com a lista aberta
  const [buscaAlvo, setBuscaAlvo] = useState<Record<string, string>>({});
  const [aberta, setAberta] = useState<string | null>(null);
  const [ignoradas, setIgnoradas] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(IGNORADAS_KEY(tenantId)) ?? '[]'); } catch { return []; }
  });
  const salvarIgnoradas = (l: string[]) => {
    setIgnoradas(l);
    try { localStorage.setItem(IGNORADAS_KEY(tenantId), JSON.stringify(l)); } catch { /* sem storage: só nesta tela */ }
  };

  // O cardápio carrega as fichas vazias: a ficha de cada produto (para contar e dar o custo) vem direto do banco.
  const [fichas, setFichas] = useState<Map<string, Array<{ ingredient_id: string; quantity: number; unit: string }>> | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    (async () => {
      const m = new Map<string, Array<{ ingredient_id: string; quantity: number; unit: string }>>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('item_ingredients').select('item_id, ingredient_id, quantity, unit').eq('tenant_id', tenantId).order('id').range(from, from + 999);
        if (error) return;
        for (const r of (data ?? []) as Array<{ item_id: string; ingredient_id: string; quantity: number; unit: string }>) {
          if (!(Number(r.quantity) > 0)) continue;
          m.set(r.item_id, [...(m.get(r.item_id) ?? []), r]);
        }
        if (!data || data.length < 1000) break;
      }
      if (vivo) setFichas(m);
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  // Alvos possíveis: insumo (id), produção (rec:<id> → insumo que ela gera) ou produto do cardápio (item:<id>)
  const alvos = useMemo(() => {
    const saidas = new Set(recipes.map((r) => r.outputIngredientId).filter(Boolean));
    const l: Alvo[] = insumos.filter((i) => !saidas.has(i.id)).map((i) => ({ chave: i.id, nome: i.nome, tipo: 'insumo' as Tipo, ingredientId: i.id, recipeId: null, itemId: null, unidade: i.unidade, preco: i.precoUnitario }));
    for (const r of recipes) {
      if (!r.outputIngredientId) continue;
      const ins = insumos.find((i) => i.id === r.outputIngredientId);
      l.push({ chave: `rec:${r.id}`, nome: r.name, tipo: 'producao', ingredientId: r.outputIngredientId, recipeId: r.id, itemId: null, unidade: ins?.unidade ?? r.unit, preco: ins?.precoUnitario ?? 0 });
    }
    for (const it of itens) {
      if (!/^[0-9a-f-]{36}$/i.test(it.id)) continue;
      l.push({ chave: `item:${it.id}`, nome: it.nome, tipo: 'produto', ingredientId: null, recipeId: null, itemId: it.id, unidade: 'un', preco: 0 });
    }
    return l.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [insumos, recipes, itens]);
  const alvoPorChave = useMemo(() => new Map(alvos.map((a) => [a.chave, a])), [alvos]);
  const nomeInsumo = (id: string) => insumos.find((i) => i.id === id)?.nome ?? 'insumo';
  const nomeProduto = (id: string) => itens.find((i) => i.id === id)?.nome ?? 'produto';
  const insumoPorId = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos]);
  // Custo de 1 unidade do produto pela ficha atual
  const custoProduto = (itemId: string) => {
    const f = fichas?.get(itemId);
    if (!f) return null;
    return f.reduce((s, r) => { const ins = insumoPorId.get(r.ingredient_id); return s + (ins ? custoLinhaFicha(Number(r.quantity), r.unit, ins.unidade, ins.precoUnitario) : 0); }, 0);
  };

  const { linhas, ligadas } = useMemo(() => {
    const mapa = new Map<string, Linha>();
    let nLigadas = 0;
    for (const it of itens) {
      for (const g of it.gruposOpcoes ?? []) {
        for (const o of g.opcoes ?? []) {
          if (o.ativo === false || !o.nome?.trim() || !/^[0-9a-f-]{36}$/i.test(o.id)) continue;
          const ins = insumosDaOpcao(o);
          if (ins.length || o.linkedItemId) nLigadas++;
          const k = norm(o.nome);
          const l = mapa.get(k) ?? { chave: k, nome: o.nome.trim(), membros: [] };
          l.membros.push({ optionId: o.id, itemId: it.id, itemNome: it.nome, insumos: ins.map((x) => x.ingredientId), produto: o.linkedItemId ?? null, preco: Number(o.precoAdicional ?? 0) });
          mapa.set(k, l);
        }
      }
    }
    return { linhas: [...mapa.values()].sort((a, b) => b.membros.length - a.membros.length || a.nome.localeCompare(b.nome)), ligadas: nLigadas };
  }, [itens]);

  const semLigacao = (l: Linha) => l.membros.some((m) => m.insumos.length === 0 && !m.produto);
  const pendentes = linhas.filter((l) => semLigacao(l) && !ignoradas.includes(l.chave));

  const sugestao = (nome: string) => {
    const n = nucleo(nome);
    if (n.length < 3) return null;
    let melhor: Alvo | null = null;
    let pontos = 0;
    for (const a of alvos) {
      const an = nucleo(a.nome);
      if (!an) continue;
      // produto do cardápio só quando o nome bate inteiro (ex.: opção "Burrito Chilli" → produto "Burrito Chilli")
      const p = an === n ? 100 : a.tipo !== 'produto' && (an.includes(n) || n.includes(an)) && Math.min(an.length, n.length) >= 4 ? Math.min(an.length, n.length) : 0;
      if (p > pontos) { pontos = p; melhor = a; }
    }
    return melhor;
  };

  const visiveis = linhas.filter((l) => {
    if (filtro === 'ignoradas') { if (!ignoradas.includes(l.chave)) return false; }
    else if (filtro === 'pendentes') { if (!semLigacao(l) || ignoradas.includes(l.chave)) return false; }
    const b = norm(busca);
    return !b || norm(l.nome).includes(b) || l.membros.some((m) => norm(m.itemNome).includes(b));
  });

  const limpar = (l: Linha) => setEscolhas((x) => { const n = { ...x }; delete n[l.chave]; return n; });

  // Acrescenta um insumo/produção/produto à escolha da linha. Produto é um só por opção: escolher outro troca.
  const acrescentar = (l: Linha, chave: string) => {
    const a = alvoPorChave.get(chave);
    if (!a) return;
    setBuscaAlvo((b) => ({ ...b, [l.chave]: '' }));
    setAberta(null);
    setEscolhas((ex) => {
      const atual = ex[l.chave];
      if (atual?.alvos.some((x) => x.chave === chave)) return ex;
      const doNome = qtdNoNome(l.nome);
      const todos = a.tipo === 'produto' ? '' : (atual?.alvos.length ? '' : doNome?.q || '');
      const qtd: Record<string, string> = {};
      for (const m of l.membros) qtd[m.optionId] = todos;
      const novo: Escolhido = { chave, u: (!atual?.alvos.length && doNome?.u) || unidadeInicial(a.unidade), todos, qtd };
      const outros = (atual?.alvos ?? []).filter((x) => !(a.tipo === 'produto' && alvoPorChave.get(x.chave)?.tipo === 'produto'));
      // marca por padrão (na primeira escolha) os itens que ainda não têm esse insumo/produto
      const marcado = atual?.marcado ?? Object.fromEntries(l.membros.map((m) => [m.optionId,
        a.tipo === 'produto' ? m.produto !== a.itemId && m.itemId !== a.itemId : !m.insumos.includes(a.ingredientId ?? '')]));
      return { ...ex, [l.chave]: { alvos: [...outros, novo], marcado } };
    });
  };
  const tirar = (l: Linha, chave: string) => setEscolhas((ex) => {
    const atual = ex[l.chave];
    if (!atual) return ex;
    const alvosRestantes = atual.alvos.filter((x) => x.chave !== chave);
    if (!alvosRestantes.length) { const n = { ...ex }; delete n[l.chave]; return n; }
    return { ...ex, [l.chave]: { ...atual, alvos: alvosRestantes } };
  });
  const mudarAlvo = (l: Linha, chave: string, patch: Partial<Escolhido>) => setEscolhas((ex) => {
    const atual = ex[l.chave];
    if (!atual) return ex;
    return { ...ex, [l.chave]: { ...atual, alvos: atual.alvos.map((x) => (x.chave === chave ? { ...x, ...patch } : x)) } };
  });
  const mudarMarcado = (l: Linha, marcado: Record<string, boolean>) => setEscolhas((ex) => (ex[l.chave] ? { ...ex, [l.chave]: { ...ex[l.chave], marcado } } : ex));

  const ligar = async (l: Linha) => {
    const e = escolhas[l.chave];
    const escolhidos = (e?.alvos ?? []).map((x) => ({ x, a: alvoPorChave.get(x.chave) })).filter((p): p is { x: Escolhido; a: Alvo } => !!p.a);
    if (!escolhidos.length) { addToast({ type: 'error', title: 'Escolha o insumo' }); return; }
    const marcados = l.membros.filter((m) => e.marcado[m.optionId]);
    if (!marcados.length) { addToast({ type: 'error', title: 'Marque pelo menos um item' }); return; }
    for (const { x, a } of escolhidos) {
      if (a.tipo === 'produto') continue;
      const semQtd = marcados.filter((m) => !(numero(x.qtd[m.optionId]) > 0));
      if (semQtd.length) { addToast({ type: 'error', title: `Informe quanto sai de ${a.nome}`, message: `Em: ${semQtd.map((m) => m.itemNome).join(', ')}.` }); return; }
    }
    setSalvando(l.chave);
    const feitos: string[] = [];
    for (const { x, a } of escolhidos) {
      const { error } = a.tipo === 'produto'
        ? await invokeWithAuth('menu-write', {
          body: { action: 'ligar_opcoes_produto', active_tenant_id: tenantId, payload: {
            item_id: a.itemId, option_ids: marcados.filter((m) => m.itemId !== a.itemId).map((m) => m.optionId),
          } },
        })
        : await invokeWithAuth('menu-write', {
          body: { action: 'ligar_opcoes_estoque', active_tenant_id: tenantId, payload: {
            ingredient_id: a.ingredientId, production_recipe_id: a.recipeId, consumption_unit: x.u,
            vinculos: marcados.map((m) => ({ option_id: m.optionId, quantity: numero(x.qtd[m.optionId]) })),
          } },
        });
      if (error) {
        setSalvando(null);
        addToast({ type: 'error', title: `Não foi possível ligar ${a.nome}`, message: feitos.length ? `${error.message} (já ligado: ${feitos.join(', ')})` : error.message });
        if (feitos.length) await recarregar({ silent: true });
        return;
      }
      feitos.push(a.nome);
    }
    setSalvando(null);
    addToast({ type: 'success', title: `"${l.nome}" ligado a ${feitos.join(' + ')}`, message: `${marcados.length} item(ns) passam a dar baixa nas próximas vendas.` });
    limpar(l);
    await recarregar({ silent: true });
  };

  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: n > 0 && n < 0.1 ? 4 : 2 });
  const rotuloTipo: Record<Tipo, { txt: string; cls: string }> = {
    insumo: { txt: 'INSUMO', cls: 'bg-gray-100 text-gray-500' },
    producao: { txt: 'PRODUÇÃO', cls: 'bg-amber-100 text-amber-700' },
    produto: { txt: 'PRODUTO', cls: 'bg-sky-100 text-sky-700' },
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 text-xs text-amber-900 space-y-1">
        <p><b>Opções × Estoque</b> — complementos ligados a um ou mais insumos dão baixa no estoque (e entram no CMV) sempre que o cliente escolhe.</p>
        <p className="text-amber-800">
          {ligadas} opção(ões) já ligada(s) · {pendentes.length} complemento(s) com item sem ligação.
          Opções com o mesmo nome em vários itens aparecem juntas; a quantidade pode ser diferente em cada item.
          Dá para escolher vários insumos de uma vez, uma produção ou um produto do cardápio (a opção passa a baixar a ficha técnica inteira dele).
          Para aplicar nas vendas já feitas, use "Aplicar nas vendas já feitas" na aba Opções de cada item.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar opção ou item..."
          className="flex-1 min-w-[180px] border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400" />
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          {([['pendentes', 'Sem ligação'], ['todas', 'Todas'], ['ignoradas', `Não são do estoque (${ignoradas.filter((k) => linhas.some((p) => p.chave === k)).length})`]] as const).map(([id, rot]) => (
            <button key={id} type="button" onClick={() => setFiltro(id)}
              className={`px-3 py-2 cursor-pointer ${filtro === id ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{rot}</button>
          ))}
        </div>
      </div>

      {!pode && <p className="text-xs text-gray-500">Só administrador ou supervisor pode ligar opções ao estoque.</p>}

      {visiveis.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">{filtro === 'ignoradas' ? 'Nenhuma opção marcada como fora do estoque.' : 'Nada por aqui.'}</p>
      ) : (
        <div className="space-y-2">
          {visiveis.map((l) => {
            const e = escolhas[l.chave];
            const escolhidos = (e?.alvos ?? []).map((x) => ({ x, a: alvoPorChave.get(x.chave) })).filter((p): p is { x: Escolhido; a: Alvo } => !!p.a);
            const qtdEscolhidos = escolhidos.filter(({ a }) => a.tipo !== 'produto');
            const produtoEscolhido = escolhidos.find(({ a }) => a.tipo === 'produto')?.a ?? null;
            const sug = !e ? sugestao(l.nome) : null;
            const precos = l.membros.map((m) => m.preco);
            const precoMin = Math.min(...precos), precoMax = Math.max(...precos);
            // insumos e produtos que já aparecem nas opções desta linha
            const jaLigados = [...new Set(l.membros.flatMap((m) => m.insumos))];
            const jaProdutos = [...new Set(l.membros.map((m) => m.produto).filter((p): p is string => !!p))];
            const nMarcados = e ? l.membros.filter((m) => e.marcado[m.optionId]).length : 0;
            const texto = buscaAlvo[l.chave] ?? '';
            const t = norm(texto);
            const jaEscolhidas = new Set((e?.alvos ?? []).map((x) => x.chave));
            const achados = aberta === l.chave ? alvos.filter((a) => !jaEscolhidas.has(a.chave) && (!t || norm(a.nome).includes(t))) : [];
            return (
              <div key={l.chave} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-white">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-medium text-gray-800">{l.nome}</p>
                    <p className="text-[11px] text-gray-500" title={l.membros.map((m) => m.itemNome).join(', ')}>
                      em {l.membros.length} item(ns) · +{precoMin === precoMax ? brl(precoMin) : `${brl(precoMin)}–${brl(precoMax)}`}
                      {(jaLigados.length > 0 || jaProdutos.length > 0) && <> · já baixa: {[...jaLigados.map(nomeInsumo), ...jaProdutos.map((p) => `ficha de ${nomeProduto(p)}`)].join(', ')}{semLigacao(l) ? ' (não em todos)' : ''}</>}
                    </p>
                  </div>
                  <button type="button" onClick={() => salvarIgnoradas(ignoradas.includes(l.chave) ? ignoradas.filter((k) => k !== l.chave) : [...ignoradas, l.chave])}
                    className="text-[11px] text-gray-400 hover:text-gray-600 cursor-pointer">
                    {ignoradas.includes(l.chave) ? 'Voltar para pendentes' : 'Não é do estoque'}
                  </button>
                </div>

                {filtro !== 'ignoradas' && pode && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full sm:w-72">
                      <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
                      <input value={texto} role="combobox" aria-expanded={aberta === l.chave}
                        placeholder={(jaLigados.length || jaProdutos.length || escolhidos.length) ? 'Adicionar insumo ou produto...' : 'Digite o insumo ou produto...'}
                        onFocus={() => setAberta(l.chave)}
                        onBlur={() => setAberta((a) => (a === l.chave ? null : a))}
                        onChange={(ev) => { setBuscaAlvo((b) => ({ ...b, [l.chave]: ev.target.value })); setAberta(l.chave); }}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Escape') { setAberta(null); (ev.target as HTMLInputElement).blur(); }
                          if (ev.key === 'Enter' && achados.length) { ev.preventDefault(); acrescentar(l, achados[0].chave); }
                        }}
                        className="w-full border border-gray-200 rounded-lg pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:border-orange-400" />
                      {aberta === l.chave && (
                        <div className="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
                          {achados.length === 0 ? (
                            <p className="text-[11px] text-gray-400 text-center py-2">Nada encontrado</p>
                          ) : (
                            <>
                              {achados.slice(0, MAX_RESULTADOS).map((a) => {
                                const nFicha = a.itemId ? fichas?.get(a.itemId)?.length ?? 0 : 0;
                                return (
                                  <button key={a.chave} type="button"
                                    onMouseDown={(ev) => ev.preventDefault()}
                                    onClick={() => acrescentar(l, a.chave)}
                                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-orange-50 cursor-pointer">
                                    <span className={`px-1 py-0.5 text-[9px] font-bold rounded ${rotuloTipo[a.tipo].cls}`}>{rotuloTipo[a.tipo].txt}</span>
                                    <span className="flex-1 min-w-0 truncate text-gray-700">{a.nome}</span>
                                    <span className="text-[10px] text-gray-400 whitespace-nowrap">
                                      {a.tipo === 'produto'
                                        ? (!fichas ? '' : nFicha > 0 ? `${nFicha} na ficha` : 'sem ficha')
                                        : `${a.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/${a.unidade}`}
                                    </span>
                                  </button>
                                );
                              })}
                              {achados.length > MAX_RESULTADOS && <p className="text-[10px] text-gray-400 text-center py-1">+{achados.length - MAX_RESULTADOS} — digite mais para achar</p>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {sug && (
                      <button type="button" onClick={() => acrescentar(l, sug.chave)}
                        className="text-[11px] px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 cursor-pointer">
                        Usar: {sug.tipo === 'produto' ? `ficha de ${sug.nome}` : sug.nome}?
                      </button>
                    )}
                  </div>
                )}

                {e && escolhidos.length > 0 && filtro !== 'ignoradas' && pode && (
                  <div className="space-y-1.5">
                    {escolhidos.map(({ x, a }) => (
                      <div key={x.chave} className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${a.tipo === 'produto' ? 'bg-sky-50 border border-sky-100' : 'bg-gray-50 border border-gray-100'}`}>
                        <span className={`px-1 py-0.5 text-[9px] font-bold rounded ${rotuloTipo[a.tipo].cls}`}>{rotuloTipo[a.tipo].txt}</span>
                        <span className="font-medium text-gray-800 min-w-0 truncate">{a.nome}</span>
                        {a.tipo === 'produto' ? (
                          <span className="text-[11px] text-sky-700">
                            {!fichas ? 'baixa a ficha técnica inteira'
                              : (fichas.get(a.itemId!)?.length ?? 0) === 0 ? <span className="text-red-500">o produto está sem ficha técnica — nada sai do estoque</span>
                                : `baixa a ficha técnica inteira (${fichas.get(a.itemId!)!.length} insumo(s))${jaProdutos.some((p) => p !== a.itemId) ? ' · troca o produto que a opção já tinha' : ''}`}
                          </span>
                        ) : (
                          <>
                            <span className="text-[11px] text-gray-500">mesma quantidade para todos</span>
                            <input value={x.todos} placeholder="?" inputMode="decimal"
                              onChange={(ev) => {
                                const v = ev.target.value;
                                const qtd = { ...x.qtd };
                                for (const m of l.membros) if (e.marcado[m.optionId]) qtd[m.optionId] = v;
                                mudarAlvo(l, x.chave, { todos: v, qtd });
                              }}
                              className="w-16 border border-gray-200 rounded px-1.5 py-1 text-xs bg-white" />
                            <select value={x.u} onChange={(ev) => mudarAlvo(l, x.chave, { u: ev.target.value })}
                              className="border border-gray-200 rounded px-1.5 py-1 text-xs cursor-pointer bg-white">
                              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </>
                        )}
                        <button type="button" onClick={() => tirar(l, x.chave)} title="Tirar"
                          className="ml-auto w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-white cursor-pointer">
                          <i className="ri-close-line" />
                        </button>
                      </div>
                    ))}

                    <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 overflow-x-auto">
                      <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-gray-500 bg-gray-50/60 min-w-max sm:min-w-0">
                        <input type="checkbox" checked={nMarcados === l.membros.length}
                          onChange={(ev) => mudarMarcado(l, Object.fromEntries(l.membros.map((m) => [m.optionId, ev.target.checked])))} />
                        <span className="flex-1 min-w-[140px]">Item ({nMarcados} de {l.membros.length} marcados)</span>
                        {qtdEscolhidos.map(({ x, a }) => (
                          <span key={x.chave} className="w-24 text-right truncate" title={`${a.nome} (${x.u})`}>{a.nome} ({x.u})</span>
                        ))}
                        <span className="w-20 text-right">custo</span>
                      </div>
                      {l.membros.map((m) => {
                        const marcado = !!e.marcado[m.optionId];
                        const proprio = !!produtoEscolhido && produtoEscolhido.itemId === m.itemId;
                        let custo: number | null = 0;
                        for (const { x, a } of qtdEscolhidos) {
                          const q = numero(x.qtd[m.optionId]);
                          if (!(q > 0)) { custo = null; break; }
                          custo += custoLinhaFicha(q, x.u, a.unidade, a.preco);
                        }
                        if (custo !== null && produtoEscolhido && !proprio) {
                          const cp = custoProduto(produtoEscolhido.itemId!);
                          custo = cp === null ? null : custo + cp;
                        }
                        const avisos: string[] = [];
                        for (const { a } of qtdEscolhidos) if (m.insumos.includes(a.ingredientId ?? '')) avisos.push(`já tem ${a.nome}, troca a quantidade`);
                        if (proprio) avisos.push('é o próprio produto, não liga');
                        else if (produtoEscolhido && m.produto && m.produto !== produtoEscolhido.itemId) avisos.push(`troca a ficha de ${nomeProduto(m.produto)}`);
                        const outros = [...m.insumos.filter((id) => !qtdEscolhidos.some(({ a }) => a.ingredientId === id)).map(nomeInsumo), ...(m.produto && !produtoEscolhido ? [`ficha de ${nomeProduto(m.produto)}`] : [])];
                        return (
                          <label key={m.optionId} className={`flex items-center gap-2 px-2 py-1.5 text-xs min-w-max sm:min-w-0 ${marcado ? '' : 'opacity-50'}`}>
                            <input type="checkbox" checked={marcado}
                              onChange={(ev) => mudarMarcado(l, { ...e.marcado, [m.optionId]: ev.target.checked })} />
                            <span className="flex-1 min-w-[140px] truncate text-gray-700">
                              {m.itemNome}
                              {avisos.length > 0 && <span className="text-[10px] text-amber-600"> · {avisos.join(' · ')}</span>}
                              {outros.length > 0 && <span className="text-[10px] text-gray-400"> · já baixa {outros.join(', ')}</span>}
                            </span>
                            {qtdEscolhidos.map(({ x }) => {
                              const q = numero(x.qtd[m.optionId]);
                              return (
                                <input key={x.chave} value={x.qtd[m.optionId] ?? ''} placeholder="?" inputMode="decimal" disabled={!marcado}
                                  onChange={(ev) => mudarAlvo(l, x.chave, { qtd: { ...x.qtd, [m.optionId]: ev.target.value } })}
                                  className={`w-24 border rounded px-1.5 py-1 text-xs text-right ${!marcado || q > 0 ? 'border-gray-200' : 'border-red-400'}`} />
                              );
                            })}
                            <span className="w-20 text-right text-[11px] text-amber-700">{custo !== null && marcado ? brl(custo) : '—'}</span>
                          </label>
                        );
                      })}
                      <div className="flex flex-wrap items-center justify-end gap-2 px-2 py-2">
                        <button type="button" onClick={() => limpar(l)} className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-50 cursor-pointer">Cancelar</button>
                        <button type="button" disabled={salvando === l.chave || nMarcados === 0} onClick={() => ligar(l)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
                          {salvando === l.chave ? 'Ligando…' : `Ligar ${escolhidos.map(({ a }) => a.nome).join(' + ')} em ${nMarcados} item(ns)`}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
