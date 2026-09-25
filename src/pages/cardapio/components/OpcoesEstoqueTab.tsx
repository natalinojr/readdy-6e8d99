import { useMemo, useState } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useProducao } from '@/contexts/ProducaoContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { invokeWithAuth } from '@/lib/supabase';
import { custoLinhaFicha } from '@/lib/unitConversion';

// Opções × Estoque (dono, 2026-09-25): liga os complementos do cardápio a insumos para darem baixa.
// Junta as opções de MESMO NOME de todos os itens (o mesmo "Guacamole - 50 ml" em 30 burritos vira uma
// linha). A sugestão de insumo é só um botão para clicar: nada é ligado sem a pessoa escolher e confirmar.

const UNIDADES = ['g', 'kg', 'ml', 'l', 'un'];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Núcleo do nome para achar o insumo: tira "adicional de", "extra", quantidade e sinais
const nucleo = (s: string) => norm(s)
  .replace(/\b\d+[.,]?\d*\s*(g|gr|kg|ml|l|un)\b/g, ' ')
  .replace(/\b(adicional|adicionais|extra|porcao|porção|de|do|da|com|mais|\+)\b/g, ' ')
  .replace(/[-()/]/g, ' ').replace(/\s+/g, ' ').trim();
const qtdNoNome = (s: string): { q: string; u: string } | null => {
  const m = norm(s).match(/\b(\d+[.,]?\d*)\s*(g|gr|kg|ml|l)\b/);
  if (!m) return null;
  return { q: m[1].replace('.', ','), u: m[2] === 'gr' ? 'g' : m[2] };
};
const unidadeInicial = (u: string) => (u === 'kg' ? 'g' : u === 'l' || u === 'L' ? 'ml' : u === 'unit' ? 'un' : u || 'un');
const IGNORADAS_KEY = (t: string) => `erpos_opcoes_nao_estoque_${t}`;

interface Linha { chave: string; nome: string; ids: string[]; itens: string[]; precos: number[] }
interface Escolha { alvo: string; q: string; u: string }

export default function OpcoesEstoqueTab() {
  const { itens, recarregar } = useCardapio();
  const { insumos } = useEstoque();
  const { recipes } = useProducao();
  const { user } = useAuth();
  const { addToast } = useToast();
  const tenantId = user?.tenantId ?? '';
  const pode = user?.perfil === 'admin' || user?.perfil === 'gerente';

  const [busca, setBusca] = useState('');
  const [verIgnoradas, setVerIgnoradas] = useState(false);
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

  const { pendentes, ligadas } = useMemo(() => {
    const mapa = new Map<string, Linha>();
    let nLigadas = 0;
    for (const it of itens) {
      for (const g of it.gruposOpcoes ?? []) {
        for (const o of g.opcoes ?? []) {
          if (o.ativo === false || !o.nome?.trim()) continue;
          if (o.ingredientId) { nLigadas++; continue; }
          if (!/^[0-9a-f-]{36}$/i.test(o.id)) continue;
          const k = norm(o.nome);
          const l = mapa.get(k) ?? { chave: k, nome: o.nome.trim(), ids: [], itens: [], precos: [] };
          l.ids.push(o.id);
          if (!l.itens.includes(it.nome)) l.itens.push(it.nome);
          l.precos.push(Number(o.precoAdicional ?? 0));
          mapa.set(k, l);
        }
      }
    }
    return { pendentes: [...mapa.values()].sort((a, b) => b.ids.length - a.ids.length || a.nome.localeCompare(b.nome)), ligadas: nLigadas };
  }, [itens]);

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

  const visiveis = pendentes.filter((l) => (verIgnoradas ? ignoradas.includes(l.chave) : !ignoradas.includes(l.chave))
    && (!busca || norm(l.nome).includes(norm(busca)) || l.itens.some((i) => norm(i).includes(norm(busca)))));

  const escolher = (l: Linha, alvoChave: string) => {
    const a = alvos.find((x) => x.chave === alvoChave);
    const doNome = qtdNoNome(l.nome);
    setEscolhas((e) => ({ ...e, [l.chave]: { alvo: alvoChave, q: e[l.chave]?.q || doNome?.q || '', u: doNome?.u ?? unidadeInicial(a?.unidade ?? 'un') } }));
  };

  const ligar = async (l: Linha) => {
    const e = escolhas[l.chave];
    const a = alvos.find((x) => x.chave === e?.alvo);
    const q = Number(String(e?.q ?? '').replace(',', '.'));
    if (!a) { addToast({ type: 'error', title: 'Escolha o insumo' }); return; }
    if (!(q > 0)) { addToast({ type: 'error', title: 'Informe quanto sai do estoque', message: `Em "${l.nome}".` }); return; }
    setSalvando(l.chave);
    const { data, error } = await invokeWithAuth<{ data: { ligadas: number } }>('menu-write', {
      body: { action: 'ligar_opcoes_estoque', active_tenant_id: tenantId, payload: {
        option_ids: l.ids, ingredient_id: a.ingredientId, production_recipe_id: a.recipeId, consumption_quantity: q, consumption_unit: e.u,
      } },
    });
    setSalvando(null);
    if (error) { addToast({ type: 'error', title: 'Não foi possível ligar', message: error.message }); return; }
    addToast({ type: 'success', title: `"${l.nome}" ligado a ${a.nome}`, message: `${data?.data?.ligadas ?? l.ids.length} opção(ões) passam a dar baixa nas próximas vendas.` });
    setEscolhas((x) => { const n = { ...x }; delete n[l.chave]; return n; });
    await recarregar({ silent: true });
  };

  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: n > 0 && n < 0.1 ? 4 : 2 });

  return (
    <div className="space-y-4">
      <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 text-xs text-amber-900 space-y-1">
        <p><b>Opções × Estoque</b> — complementos ligados a um insumo dão baixa no estoque (e entram no CMV) sempre que o cliente escolhe.</p>
        <p className="text-amber-800">
          {ligadas} opção(ões) já ligada(s) · {pendentes.length - ignoradas.filter((k) => pendentes.some((p) => p.chave === k)).length} complemento(s) sem ligação.
          Opções com o mesmo nome em vários itens são ligadas juntas. Para aplicar nas vendas já feitas, use "Aplicar nas vendas já feitas" na aba Opções de cada item.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar opção ou item..."
          className="flex-1 min-w-[180px] border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400" />
        <button type="button" onClick={() => setVerIgnoradas((v) => !v)}
          className="px-3 py-2 rounded-lg text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer">
          {verIgnoradas ? 'Ver pendentes' : `Não são do estoque (${ignoradas.filter((k) => pendentes.some((p) => p.chave === k)).length})`}
        </button>
      </div>

      {!pode && <p className="text-xs text-gray-500">Só administrador ou gerente pode ligar opções ao estoque.</p>}

      {visiveis.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">{verIgnoradas ? 'Nenhuma opção marcada como fora do estoque.' : 'Nenhum complemento sem ligação.'}</p>
      ) : (
        <div className="space-y-2">
          {visiveis.map((l) => {
            const e = escolhas[l.chave];
            const a = alvos.find((x) => x.chave === e?.alvo);
            const sug = !e ? sugestao(l.nome) : null;
            const q = Number(String(e?.q ?? '').replace(',', '.'));
            const custo = a && q > 0 ? custoLinhaFicha(q, e.u, a.unidade, a.preco) : null;
            const precoMin = Math.min(...l.precos), precoMax = Math.max(...l.precos);
            return (
              <div key={l.chave} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-white">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-medium text-gray-800">{l.nome}</p>
                    <p className="text-[11px] text-gray-500" title={l.itens.join(', ')}>
                      em {l.itens.length} item(ns): {l.itens.slice(0, 3).join(', ')}{l.itens.length > 3 ? ` e mais ${l.itens.length - 3}` : ''}
                      {' · '}+{precoMin === precoMax ? brl(precoMin) : `${brl(precoMin)}–${brl(precoMax)}`}
                    </p>
                  </div>
                  <button type="button" onClick={() => salvarIgnoradas(verIgnoradas ? ignoradas.filter((k) => k !== l.chave) : [...ignoradas, l.chave])}
                    className="text-[11px] text-gray-400 hover:text-gray-600 cursor-pointer">
                    {verIgnoradas ? 'Voltar para pendentes' : 'Não é do estoque'}
                  </button>
                </div>

                {!verIgnoradas && pode && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={e?.alvo ?? ''} onChange={(ev) => escolher(l, ev.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs max-w-[240px] cursor-pointer">
                      <option value="">Escolher insumo...</option>
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
                        <span className="text-[11px] text-gray-500">sai do estoque</span>
                        <input value={e.q} onChange={(ev) => setEscolhas((x) => ({ ...x, [l.chave]: { ...e, q: ev.target.value } }))} placeholder="?" inputMode="decimal"
                          className={`w-16 border rounded px-1.5 py-1 text-xs ${q > 0 ? 'border-gray-200' : 'border-red-400'}`} />
                        <select value={e.u} onChange={(ev) => setEscolhas((x) => ({ ...x, [l.chave]: { ...e, u: ev.target.value } }))}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs cursor-pointer">
                          {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        {custo !== null && <span className="text-[11px] text-amber-700">custo {brl(custo)}</span>}
                        <button type="button" disabled={salvando === l.chave} onClick={() => ligar(l)}
                          className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
                          {salvando === l.chave ? 'Ligando…' : `Ligar em ${l.ids.length}`}
                        </button>
                      </>
                    )}
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
