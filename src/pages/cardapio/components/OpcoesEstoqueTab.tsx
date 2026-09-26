import { useMemo, useState } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useProducao } from '@/contexts/ProducaoContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { invokeWithAuth } from '@/lib/supabase';
import { custoLinhaFicha } from '@/lib/unitConversion';
import { insumosDaOpcao } from '@/lib/opcaoInsumos';

// Opções × Estoque (dono, 2026-09-25/26): liga os complementos do cardápio a insumos para darem baixa.
// Junta as opções de MESMO NOME de todos os itens (o mesmo "Guacamole - 50 ml" em 30 burritos vira uma linha).
// Ao escolher o insumo, cada item aparece com a própria quantidade (pode variar de um item para outro) e dá
// para desmarcar itens. Uma opção pode ter vários insumos: ligar aqui ACRESCENTA, não troca os que já existem.
// A sugestão de insumo é só um botão: nada é ligado sem a pessoa escolher e confirmar.

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

interface Membro { optionId: string; itemNome: string; insumos: string[]; preco: number }
interface Linha { chave: string; nome: string; membros: Membro[] }
interface Escolha { alvo: string; u: string; todos: string; qtd: Record<string, string>; marcado: Record<string, boolean> }

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
  const [ignoradas, setIgnoradas] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(IGNORADAS_KEY(tenantId)) ?? '[]'); } catch { return []; }
  });
  const salvarIgnoradas = (l: string[]) => {
    setIgnoradas(l);
    try { localStorage.setItem(IGNORADAS_KEY(tenantId), JSON.stringify(l)); } catch { /* sem storage: só nesta tela */ }
  };

  // Alvos possíveis: insumo (id) ou produção (rec:<id> → insumo que ela gera)
  const alvos = useMemo(() => {
    const saidas = new Set(recipes.map((r) => r.outputIngredientId).filter(Boolean));
    const l = insumos.filter((i) => !saidas.has(i.id)).map((i) => ({ chave: i.id, nome: i.nome, ingredientId: i.id, recipeId: null as string | null, unidade: i.unidade, preco: i.precoUnitario }));
    for (const r of recipes) {
      if (!r.outputIngredientId) continue;
      const ins = insumos.find((i) => i.id === r.outputIngredientId);
      l.push({ chave: `rec:${r.id}`, nome: `${r.name} (produção)`, ingredientId: r.outputIngredientId, recipeId: r.id, unidade: ins?.unidade ?? r.unit, preco: ins?.precoUnitario ?? 0 });
    }
    return l.sort((a, b) => a.nome.localeCompare(b.nome));
  }, [insumos, recipes]);
  const nomeInsumo = (id: string) => insumos.find((i) => i.id === id)?.nome ?? 'insumo';

  const { linhas, ligadas } = useMemo(() => {
    const mapa = new Map<string, Linha>();
    let nLigadas = 0;
    for (const it of itens) {
      for (const g of it.gruposOpcoes ?? []) {
        for (const o of g.opcoes ?? []) {
          if (o.ativo === false || !o.nome?.trim() || !/^[0-9a-f-]{36}$/i.test(o.id)) continue;
          const ins = insumosDaOpcao(o);
          if (ins.length) nLigadas++;
          const k = norm(o.nome);
          const l = mapa.get(k) ?? { chave: k, nome: o.nome.trim(), membros: [] };
          l.membros.push({ optionId: o.id, itemNome: it.nome, insumos: ins.map((x) => x.ingredientId), preco: Number(o.precoAdicional ?? 0) });
          mapa.set(k, l);
        }
      }
    }
    return { linhas: [...mapa.values()].sort((a, b) => b.membros.length - a.membros.length || a.nome.localeCompare(b.nome)), ligadas: nLigadas };
  }, [itens]);

  const semLigacao = (l: Linha) => l.membros.some((m) => m.insumos.length === 0);
  const pendentes = linhas.filter((l) => semLigacao(l) && !ignoradas.includes(l.chave));

  const sugestao = (nome: string) => {
    const n = nucleo(nome);
    if (n.length < 3) return null;
    let melhor: (typeof alvos)[number] | null = null;
    let pontos = 0;
    for (const a of alvos) {
      const an = nucleo(a.nome.replace(' (produção)', ''));
      if (!an) continue;
      const p = an === n ? 100 : (an.includes(n) || n.includes(an)) && Math.min(an.length, n.length) >= 4 ? Math.min(an.length, n.length) : 0;
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

  const escolher = (l: Linha, alvoChave: string) => {
    const a = alvos.find((x) => x.chave === alvoChave);
    const doNome = qtdNoNome(l.nome);
    const todos = escolhas[l.chave]?.todos || doNome?.q || '';
    // marca por padrão os itens que ainda não têm esse insumo
    const marcado: Record<string, boolean> = {};
    const qtd: Record<string, string> = {};
    for (const m of l.membros) { marcado[m.optionId] = !m.insumos.includes(a?.ingredientId ?? ''); qtd[m.optionId] = todos; }
    setEscolhas((e) => ({ ...e, [l.chave]: { alvo: alvoChave, u: doNome?.u ?? unidadeInicial(a?.unidade ?? 'un'), todos, qtd, marcado } }));
  };
  const mudar = (l: Linha, patch: Partial<Escolha>) => setEscolhas((e) => ({ ...e, [l.chave]: { ...e[l.chave], ...patch } }));

  const ligar = async (l: Linha) => {
    const e = escolhas[l.chave];
    const a = alvos.find((x) => x.chave === e?.alvo);
    if (!a) { addToast({ type: 'error', title: 'Escolha o insumo' }); return; }
    const marcados = l.membros.filter((m) => e.marcado[m.optionId]);
    if (!marcados.length) { addToast({ type: 'error', title: 'Marque pelo menos um item' }); return; }
    const semQtd = marcados.filter((m) => !(numero(e.qtd[m.optionId]) > 0));
    if (semQtd.length) { addToast({ type: 'error', title: 'Informe quanto sai do estoque', message: `Em: ${semQtd.map((m) => m.itemNome).join(', ')}.` }); return; }
    setSalvando(l.chave);
    const { data, error } = await invokeWithAuth<{ data: { ligadas: number } }>('menu-write', {
      body: { action: 'ligar_opcoes_estoque', active_tenant_id: tenantId, payload: {
        ingredient_id: a.ingredientId, production_recipe_id: a.recipeId, consumption_unit: e.u,
        vinculos: marcados.map((m) => ({ option_id: m.optionId, quantity: numero(e.qtd[m.optionId]) })),
      } },
    });
    setSalvando(null);
    if (error) { addToast({ type: 'error', title: 'Não foi possível ligar', message: error.message }); return; }
    addToast({ type: 'success', title: `"${l.nome}" ligado a ${a.nome}`, message: `${data?.data?.ligadas ?? marcados.length} item(ns) passam a dar baixa nas próximas vendas.` });
    setEscolhas((x) => { const n = { ...x }; delete n[l.chave]; return n; });
    await recarregar({ silent: true });
  };

  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: n > 0 && n < 0.1 ? 4 : 2 });

  return (
    <div className="space-y-4">
      <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 text-xs text-amber-900 space-y-1">
        <p><b>Opções × Estoque</b> — complementos ligados a um ou mais insumos dão baixa no estoque (e entram no CMV) sempre que o cliente escolhe.</p>
        <p className="text-amber-800">
          {ligadas} opção(ões) já ligada(s) · {pendentes.length} complemento(s) com item sem ligação.
          Opções com o mesmo nome em vários itens aparecem juntas; a quantidade pode ser diferente em cada item.
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

      {!pode && <p className="text-xs text-gray-500">Só administrador ou gerente pode ligar opções ao estoque.</p>}

      {visiveis.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">{filtro === 'ignoradas' ? 'Nenhuma opção marcada como fora do estoque.' : 'Nada por aqui.'}</p>
      ) : (
        <div className="space-y-2">
          {visiveis.map((l) => {
            const e = escolhas[l.chave];
            const a = alvos.find((x) => x.chave === e?.alvo);
            const sug = !e ? sugestao(l.nome) : null;
            const precos = l.membros.map((m) => m.preco);
            const precoMin = Math.min(...precos), precoMax = Math.max(...precos);
            // insumos que já aparecem nas opções desta linha
            const jaLigados = [...new Set(l.membros.flatMap((m) => m.insumos))];
            const nMarcados = e ? l.membros.filter((m) => e.marcado[m.optionId]).length : 0;
            return (
              <div key={l.chave} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-white">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-medium text-gray-800">{l.nome}</p>
                    <p className="text-[11px] text-gray-500" title={l.membros.map((m) => m.itemNome).join(', ')}>
                      em {l.membros.length} item(ns) · +{precoMin === precoMax ? brl(precoMin) : `${brl(precoMin)}–${brl(precoMax)}`}
                      {jaLigados.length > 0 && <> · já baixa: {jaLigados.map(nomeInsumo).join(', ')}{semLigacao(l) ? ' (não em todos)' : ''}</>}
                    </p>
                  </div>
                  <button type="button" onClick={() => salvarIgnoradas(ignoradas.includes(l.chave) ? ignoradas.filter((k) => k !== l.chave) : [...ignoradas, l.chave])}
                    className="text-[11px] text-gray-400 hover:text-gray-600 cursor-pointer">
                    {ignoradas.includes(l.chave) ? 'Voltar para pendentes' : 'Não é do estoque'}
                  </button>
                </div>

                {filtro !== 'ignoradas' && pode && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={e?.alvo ?? ''} onChange={(ev) => ev.target.value ? escolher(l, ev.target.value) : setEscolhas((x) => { const n = { ...x }; delete n[l.chave]; return n; })}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs max-w-[240px] cursor-pointer">
                      <option value="">{jaLigados.length ? 'Adicionar insumo...' : 'Escolher insumo...'}</option>
                      {alvos.map((x) => <option key={x.chave} value={x.chave}>{x.nome}</option>)}
                    </select>
                    {sug && (
                      <button type="button" onClick={() => escolher(l, sug.chave)}
                        className="text-[11px] px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 cursor-pointer">
                        Usar: {sug.nome}?
                      </button>
                    )}
                    {e && (
                      <>
                        <span className="text-[11px] text-gray-500">mesma quantidade para todos</span>
                        <input value={e.todos} placeholder="?" inputMode="decimal"
                          onChange={(ev) => {
                            const v = ev.target.value;
                            const qtd = { ...e.qtd };
                            for (const m of l.membros) if (e.marcado[m.optionId]) qtd[m.optionId] = v;
                            mudar(l, { todos: v, qtd });
                          }}
                          className="w-16 border border-gray-200 rounded px-1.5 py-1 text-xs" />
                        <select value={e.u} onChange={(ev) => mudar(l, { u: ev.target.value })}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs cursor-pointer">
                          {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </>
                    )}
                  </div>
                )}

                {e && a && filtro !== 'ignoradas' && pode && (
                  <div className="border border-gray-100 rounded-lg divide-y divide-gray-50">
                    <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-gray-500 bg-gray-50/60">
                      <input type="checkbox" checked={nMarcados === l.membros.length}
                        onChange={(ev) => mudar(l, { marcado: Object.fromEntries(l.membros.map((m) => [m.optionId, ev.target.checked])) })} />
                      <span className="flex-1">Item ({nMarcados} de {l.membros.length} marcados)</span>
                      <span className="w-28 text-right">quanto sai ({e.u})</span>
                      <span className="w-20 text-right">custo</span>
                    </div>
                    {l.membros.map((m) => {
                      const q = numero(e.qtd[m.optionId]);
                      const custo = q > 0 ? custoLinhaFicha(q, e.u, a.unidade, a.preco) : null;
                      const jaTem = m.insumos.includes(a.ingredientId);
                      return (
                        <label key={m.optionId} className={`flex items-center gap-2 px-2 py-1.5 text-xs ${e.marcado[m.optionId] ? '' : 'opacity-50'}`}>
                          <input type="checkbox" checked={!!e.marcado[m.optionId]}
                            onChange={(ev) => mudar(l, { marcado: { ...e.marcado, [m.optionId]: ev.target.checked } })} />
                          <span className="flex-1 min-w-0 truncate text-gray-700">
                            {m.itemNome}
                            {jaTem && <span className="text-[10px] text-amber-600"> · já tem, troca a quantidade</span>}
                            {!jaTem && m.insumos.length > 0 && <span className="text-[10px] text-gray-400"> · já baixa {m.insumos.map(nomeInsumo).join(', ')}</span>}
                          </span>
                          <input value={e.qtd[m.optionId] ?? ''} placeholder="?" inputMode="decimal" disabled={!e.marcado[m.optionId]}
                            onChange={(ev) => mudar(l, { qtd: { ...e.qtd, [m.optionId]: ev.target.value } })}
                            className={`w-28 border rounded px-1.5 py-1 text-xs text-right ${!e.marcado[m.optionId] || q > 0 ? 'border-gray-200' : 'border-red-400'}`} />
                          <span className="w-20 text-right text-[11px] text-amber-700">{custo !== null ? brl(custo) : '—'}</span>
                        </label>
                      );
                    })}
                    <div className="flex justify-end px-2 py-2">
                      <button type="button" disabled={salvando === l.chave || nMarcados === 0} onClick={() => ligar(l)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
                        {salvando === l.chave ? 'Ligando…' : `Ligar ${a.nome} em ${nMarcados} item(ns)`}
                      </button>
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
