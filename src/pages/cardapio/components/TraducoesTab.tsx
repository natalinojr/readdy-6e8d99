// Cardápio › Traduções — revisar o cardápio nos idiomas que a loja oferece.
//
// Duas coisas moram aqui:
//   1. quais idiomas a loja oferece ao cliente (sem nenhum, o seletor de idioma
//      nem aparece nas telas do cliente);
//   2. a tradução de cada texto, com o português ao lado para conferir.
//
// A IA escreve, a pessoa confere. Texto corrigido à mão vira `manual` e a IA
// nunca mais o sobrescreve. Quando o português é editado depois, a linha
// aparece como "desatualizada" em vez de envelhecer calada.
//
// Nada disso muda o pedido: o cliente lê em inglês, a cozinha recebe em
// português. Ver supabase/functions/_shared/menu-i18n.ts.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { invokeWithAuth } from '@/lib/supabase';

const IDIOMAS: Array<{ code: string; nome: string; bandeira: string }> = [
  { code: 'en', nome: 'Inglês', bandeira: '🇺🇸' },
  { code: 'es', nome: 'Espanhol', bandeira: '🇪🇸' },
];

const TIPOS: Array<{ id: Linha['entity_type']; label: string }> = [
  { id: 'category', label: 'Categorias' },
  { id: 'item', label: 'Itens' },
  { id: 'option_group', label: 'Grupos de opção' },
  { id: 'option', label: 'Opções' },
  { id: 'preset_obs', label: 'Observações' },
];

interface Linha {
  entity_type: 'item' | 'category' | 'option_group' | 'option' | 'preset_obs';
  entity_id: string;
  source_name: string;
  source_description: string | null;
  name: string | null;
  description: string | null;
  origin: 'ai' | 'manual' | null;
  is_reviewed: boolean;
  status: 'missing' | 'stale' | 'ok';
}

interface Contagens { total: number; missing: number; stale: number; reviewed: number }

export default function TraducoesTab() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const tenantId = user?.tenantId ?? null;

  const [idiomasLoja, setIdiomasLoja] = useState<string[]>([]);
  const [idioma, setIdioma] = useState<string>('en');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [contagens, setContagens] = useState<Contagens | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [traduzindo, setTraduzindo] = useState(false);
  const [progresso, setProgresso] = useState('');
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

  const [filtroTipo, setFiltroTipo] = useState<Linha['entity_type'] | 'todos'>('todos');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'missing' | 'stale' | 'ai'>('todos');
  const [busca, setBusca] = useState('');

  const [editando, setEditando] = useState<string | null>(null);
  const [rascunhoNome, setRascunhoNome] = useState('');
  const [rascunhoDesc, setRascunhoDesc] = useState('');

  const chamar = useCallback(async function <T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T | null> {
    if (!tenantId) return null;
    const { data, error } = await invokeWithAuth<T>('menu-translate', { body: { tenant_id: tenantId, ...payload } });
    if (error) throw new Error(error.message);
    const erro = (data as Record<string, unknown> | null)?.error;
    if (erro) throw new Error(String(erro));
    return data;
  }, [tenantId]);

  const carregarIdiomas = useCallback(async () => {
    try {
      const r = await chamar<{ locales: Array<{ locale: string }> }>({ action: 'get_locales' });
      setIdiomasLoja((r?.locales ?? []).map((l) => l.locale));
    } catch (err) {
      addToast({ type: 'error', title: `Erro ao ler os idiomas da loja: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [chamar, addToast]);

  const carregarLista = useCallback(async (loc: string) => {
    setCarregando(true);
    try {
      const r = await chamar<{ rows: Linha[]; counts: Contagens }>({ action: 'list', locale: loc });
      setLinhas(r?.rows ?? []);
      setContagens(r?.counts ?? null);
    } catch (err) {
      addToast({ type: 'error', title: `Erro ao carregar as traduções: ${err instanceof Error ? err.message : String(err)}` });
      setLinhas([]);
      setContagens(null);
    } finally {
      setCarregando(false);
    }
  }, [chamar, addToast]);

  useEffect(() => { void carregarIdiomas(); }, [carregarIdiomas]);
  useEffect(() => {
    if (idiomasLoja.length === 0) { setLinhas([]); setContagens(null); return; }
    if (!idiomasLoja.includes(idioma)) { setIdioma(idiomasLoja[0]); return; }
    void carregarLista(idioma);
  }, [idiomasLoja, idioma, carregarLista]);

  async function alternarIdiomaDaLoja(code: string) {
    const novos = idiomasLoja.includes(code) ? idiomasLoja.filter((l) => l !== code) : [...idiomasLoja, code];
    try {
      await chamar({ action: 'set_locales', locales: novos });
      setIdiomasLoja(novos);
      addToast({
        type: 'success',
        title: novos.length === 0
          ? 'A loja voltou a ser só em português — o seletor de idioma some das telas do cliente.'
          : `Idiomas da loja: ${novos.map((l) => IDIOMAS.find((i) => i.code === l)?.nome ?? l).join(', ')}.`,
      });
    } catch (err) {
      addToast({ type: 'error', title: `Erro ao salvar os idiomas: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // A Edge traduz um pedaço por chamada (Edge Function tem tempo limitado) e
  // devolve quanto falta. Aqui insistimos até zerar, mostrando o progresso.
  async function traduzir(escopo: 'missing' | 'all') {
    if (traduzindo) return;
    setTraduzindo(true);
    setProgresso('Começando...');
    try {
      let total = 0;
      for (let volta = 0; volta < 40; volta++) {
        const r = await chamar<{ translated: number; remaining: number; done: boolean; failed?: string[] }>({
          action: 'translate', locale: idioma, scope: volta === 0 ? escopo : 'missing',
        });
        total += r?.translated ?? 0;
        const falta = r?.remaining ?? 0;
        setProgresso(falta > 0 ? `${total} traduzidos · faltam ${falta} textos` : `${total} traduzidos`);
        if (r?.done || falta === 0) break;
      }
      addToast({ type: 'success', title: `Tradução concluída: ${total} textos.` });
      await carregarLista(idioma);
    } catch (err) {
      addToast({ type: 'error', title: `Erro ao traduzir: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setTraduzindo(false);
      setProgresso('');
    }
  }

  function abrirEdicao(l: Linha) {
    setEditando(`${l.entity_type}:${l.entity_id}`);
    setRascunhoNome(l.name ?? '');
    setRascunhoDesc(l.description ?? '');
  }

  async function salvarEdicao(l: Linha) {
    const chave = `${l.entity_type}:${l.entity_id}`;
    if (rascunhoNome.trim() === '') {
      addToast({ type: 'error', title: 'A tradução não pode ficar em branco.' });
      return;
    }
    setSalvandoId(chave);
    try {
      await chamar({
        action: 'upsert', locale: idioma,
        entity_type: l.entity_type, entity_id: l.entity_id,
        name: rascunhoNome.trim(), description: rascunhoDesc.trim() || null,
      });
      setLinhas((prev) => prev.map((x) => (x.entity_type === l.entity_type && x.entity_id === l.entity_id
        ? { ...x, name: rascunhoNome.trim(), description: rascunhoDesc.trim() || null, origin: 'manual', is_reviewed: true, status: 'ok' }
        : x)));
      setEditando(null);
    } catch (err) {
      addToast({ type: 'error', title: `Erro ao salvar: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSalvandoId(null);
    }
  }

  const visiveis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (filtroTipo !== 'todos' && l.entity_type !== filtroTipo) return false;
      if (filtroStatus === 'missing' && l.status !== 'missing') return false;
      if (filtroStatus === 'stale' && l.status !== 'stale') return false;
      if (filtroStatus === 'ai' && !(l.origin === 'ai' && l.status !== 'missing')) return false;
      if (b && !`${l.source_name} ${l.name ?? ''}`.toLowerCase().includes(b)) return false;
      return true;
    });
  }, [linhas, filtroTipo, filtroStatus, busca]);

  if (!tenantId) {
    return <div className="px-4 md:px-6 py-10 text-sm text-gray-500">Selecione uma loja para gerenciar as traduções.</div>;
  }

  return (
    <div className="px-4 md:px-6 py-5 space-y-5">
      {/* ── Idiomas da loja ─────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-100 p-4">
        <h2 className="text-sm font-bold text-gray-900">Idiomas oferecidos ao cliente</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          O português é sempre a base e não precisa ser ligado. Sem nenhum idioma marcado, o seletor não aparece para o cliente.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {IDIOMAS.map((i) => {
            const ligado = idiomasLoja.includes(i.code);
            return (
              <button
                key={i.code}
                type="button"
                onClick={() => void alternarIdiomaDaLoja(i.code)}
                className={'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors cursor-pointer ' +
                  (ligado ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}
              >
                <span aria-hidden="true">{i.bandeira}</span>
                {i.nome}
                {ligado ? <i className="ri-check-line" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      {idiomasLoja.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <p className="text-sm text-gray-600">Ligue um idioma acima para começar a traduzir o cardápio.</p>
        </div>
      ) : (
        <>
          {/* ── Barra de ações ──────────────────────────────────────────── */}
          <section className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {idiomasLoja.map((code) => {
                const meta = IDIOMAS.find((i) => i.code === code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setIdioma(code)}
                    className={'px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ' +
                      (idioma === code ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
                  >
                    {meta?.bandeira} {meta?.nome ?? code}
                  </button>
                );
              })}

              <div className="flex-1" />

              <button
                type="button"
                disabled={traduzindo}
                onClick={() => void traduzir('missing')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer transition-colors"
              >
                <i className={traduzindo ? 'ri-loader-4-line animate-spin' : 'ri-translate-2'} />
                Traduzir o que falta
              </button>
              <button
                type="button"
                disabled={traduzindo}
                onClick={() => void traduzir('all')}
                title="Refaz tudo que veio da IA. O que você corrigiu à mão é preservado."
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-60 text-gray-700 text-sm font-semibold cursor-pointer transition-colors"
              >
                <i className="ri-refresh-line" />
                Refazer tudo
              </button>
            </div>

            {traduzindo && progresso ? (
              <p className="text-xs text-orange-700 bg-orange-50 rounded-lg px-3 py-2">{progresso}</p>
            ) : null}

            {contagens ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-600 font-semibold">{contagens.total} textos</span>
                {contagens.missing > 0 ? (
                  <span className="px-2 py-1 rounded-md bg-red-50 text-red-700 font-semibold">{contagens.missing} sem tradução</span>
                ) : (
                  <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 font-semibold">tudo traduzido</span>
                )}
                {contagens.stale > 0 ? (
                  <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-700 font-semibold">{contagens.stale} desatualizados</span>
                ) : null}
                <span className="px-2 py-1 rounded-md bg-blue-50 text-blue-700 font-semibold">{contagens.reviewed} revisados por você</span>
              </div>
            ) : null}
          </section>

          {/* ── Filtros ─────────────────────────────────────────────────── */}
          <section className="flex flex-wrap items-center gap-2">
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as typeof filtroTipo)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white cursor-pointer"
            >
              <option value="todos">Todos os tipos</option>
              {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>

            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white cursor-pointer"
            >
              <option value="todos">Tudo</option>
              <option value="missing">Sem tradução</option>
              <option value="stale">Desatualizados</option>
              <option value="ai">Escritos pela IA (a conferir)</option>
            </select>

            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar..."
              className="flex-1 min-w-[180px] px-3 py-2 rounded-lg border border-gray-200 text-sm"
            />
          </section>

          {/* ── Lista ───────────────────────────────────────────────────── */}
          {carregando ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : visiveis.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-500">
              Nada aqui com esses filtros.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-100">
              {visiveis.map((l) => {
                const chave = `${l.entity_type}:${l.entity_id}`;
                const emEdicao = editando === chave;
                const tipoLabel = TIPOS.find((t) => t.id === l.entity_type)?.label ?? l.entity_type;
                return (
                  <div key={chave} className="p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 text-[10px] font-bold uppercase tracking-wide">{tipoLabel}</span>
                      {l.status === 'missing' ? (
                        <span className="px-2 py-0.5 rounded-md bg-red-50 text-red-700 text-[10px] font-bold">SEM TRADUÇÃO</span>
                      ) : l.status === 'stale' ? (
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold" title="O texto em português mudou depois desta tradução.">DESATUALIZADO</span>
                      ) : l.origin === 'manual' ? (
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold">REVISADO</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 text-[10px] font-bold">IA</span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Português</p>
                        <p className="text-sm font-semibold text-gray-800 break-words">{l.source_name}</p>
                        {l.source_description ? (
                          <p className="text-xs text-gray-500 mt-1 break-words">{l.source_description}</p>
                        ) : null}
                      </div>

                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                          {IDIOMAS.find((i) => i.code === idioma)?.nome ?? idioma}
                        </p>
                        {emEdicao ? (
                          <div className="space-y-2">
                            <input
                              value={rascunhoNome}
                              onChange={(e) => setRascunhoNome(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-orange-300 text-sm"
                              placeholder="Tradução do nome"
                            />
                            {l.source_description ? (
                              <textarea
                                value={rascunhoDesc}
                                onChange={(e) => setRascunhoDesc(e.target.value)}
                                rows={3}
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs"
                                placeholder="Tradução da descrição"
                              />
                            ) : null}
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={salvandoId === chave}
                                onClick={() => void salvarEdicao(l)}
                                className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                              >
                                Salvar
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditando(null)}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold cursor-pointer"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => abrirEdicao(l)}
                            className="w-full text-left group cursor-pointer"
                          >
                            {l.name ? (
                              <>
                                <p className="text-sm font-semibold text-gray-800 group-hover:text-orange-600 break-words">{l.name}</p>
                                {l.description ? <p className="text-xs text-gray-500 mt-1 break-words">{l.description}</p> : null}
                              </>
                            ) : (
                              <p className="text-sm text-gray-400 italic group-hover:text-orange-600">sem tradução — clique para escrever</p>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-gray-400 px-1">
            O cliente lê o cardápio no idioma que escolher, mas o pedido chega à cozinha e à impressora sempre em português.
          </p>
        </>
      )}
    </div>
  );
}
