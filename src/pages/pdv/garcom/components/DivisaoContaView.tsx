import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { CarrinhoItem } from '@/contexts/PDVContext';
import type { Rodada } from '../types';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Tipos ─────────────────────────────────────────────────────────────────────
export interface ClienteDivisao {
  id: string;
  nome: string;
  corIdx: number;
}

export interface UnidadeItem {
  uid: string;
  cartId: string;
  nome: string;
  precoUnitario: number;
  opcoes: string;
  clienteId: string | null;
  /** Nome da pessoa que fez o pedido (para pré-atribuição automática) */
  pessoaOrigem?: string;
}

export interface DivisaoResultado {
  clientes: ClienteDivisao[];
  atribuicoes: Record<string, string | null>;
  totalPorCliente: Record<string, number>;
  itensPorCliente: Record<string, UnidadeItem[]>;
}

/** Estado persistido da divisão (salvo e restaurado ao trocar de aba) */
export interface DivisaoPersistedState {
  clientes: ClienteDivisao[];
  atribuicoes: Record<string, string | null>;
}

const CORES = [
  { bg: 'bg-amber-500', text: 'text-amber-700', light: 'bg-amber-50', border: 'border-amber-300', dot: 'bg-amber-500', ring: 'ring-amber-400' },
  { bg: 'bg-teal-500', text: 'text-teal-700', light: 'bg-teal-50', border: 'border-teal-300', dot: 'bg-teal-500', ring: 'ring-teal-400' },
  { bg: 'bg-rose-500', text: 'text-rose-700', light: 'bg-rose-50', border: 'border-rose-300', dot: 'bg-rose-500', ring: 'ring-rose-400' },
  { bg: 'bg-violet-500', text: 'text-violet-700', light: 'bg-violet-50', border: 'border-violet-300', dot: 'bg-violet-500', ring: 'ring-violet-400' },
  { bg: 'bg-sky-500', text: 'text-sky-700', light: 'bg-sky-50', border: 'border-sky-300', dot: 'bg-sky-500', ring: 'ring-sky-400' },
  { bg: 'bg-orange-500', text: 'text-orange-700', light: 'bg-orange-50', border: 'border-orange-300', dot: 'bg-orange-500', ring: 'ring-orange-400' },
  { bg: 'bg-green-500', text: 'text-green-700', light: 'bg-green-50', border: 'border-green-300', dot: 'bg-green-500', ring: 'ring-green-400' },
  { bg: 'bg-pink-500', text: 'text-pink-700', light: 'bg-pink-50', border: 'border-pink-300', dot: 'bg-pink-500', ring: 'ring-pink-400' },
];

function getCor(idx: number) {
  return CORES[idx % CORES.length];
}

interface Props {
  rodadas: Rodada[];
  itensNovos: CarrinhoItem[];
  pessoasMesa: string[];
  mesaNome: string;
  onDivisaoChange?: (resultado: DivisaoResultado) => void;
  estadoPersistido?: DivisaoPersistedState | null;
  onEstadoChange?: (estado: DivisaoPersistedState) => void;
}

export default function DivisaoContaView({
  rodadas, itensNovos, pessoasMesa, mesaNome: _mesaNome,
  onDivisaoChange, estadoPersistido, onEstadoChange,
}: Props) {
  // ── Clientes ──────────────────────────────────────────────────────────────
  const initClientes = (): ClienteDivisao[] => {
    if (estadoPersistido?.clientes && estadoPersistido.clientes.length > 0) {
      return estadoPersistido.clientes;
    }
    const nomes = pessoasMesa.length >= 2
      ? pessoasMesa.slice(0, 8)
      : pessoasMesa.length === 1
        ? [pessoasMesa[0], 'Pessoa 2']
        : ['Pessoa 1', 'Pessoa 2'];
    return nomes.map((nome, i) => ({ id: `cli-${i}`, nome, corIdx: i }));
  };
  const [clientes, setClientes] = useState<ClienteDivisao[]>(initClientes);

  // Sincronizar nomes quando pessoasMesa mudar (só se não restaurou de estado persistido)
  const jaRestaurouRef = useRef(!!estadoPersistido?.clientes?.length);
  useEffect(() => {
    if (jaRestaurouRef.current) return;
    if (pessoasMesa.length === 0) return;
    setClientes((prev) => {
      const novosNomes = pessoasMesa.slice(0, 8);
      const atualizados = novosNomes.map((nome, i) => {
        const existente = prev[i];
        if (existente) return { ...existente, nome };
        return { id: `cli-sync-${i}-${Date.now()}`, nome, corIdx: i };
      });
      const extras = prev.slice(novosNomes.length);
      return [...atualizados, ...extras].slice(0, 8);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoasMesa]);

  const [clienteSelecionado, setClienteSelecionado] = useState<string>('');
  useEffect(() => {
    setClienteSelecionado((prev) => {
      if (prev && clientes.find((c) => c.id === prev)) return prev;
      return clientes[0]?.id ?? '';
    });
  }, [clientes]);

  const [showAddCliente, setShowAddCliente] = useState(false);
  const [novoNome, setNovoNome] = useState('');

  // ── Unidades de itens ─────────────────────────────────────────────────────
  const todasUnidades = useMemo<UnidadeItem[]>(() => {
    const unidades: UnidadeItem[] = [];
    const processarCarrinho = (items: CarrinhoItem[], prefixo: string, pessoaOrigem?: string) => {
      items.forEach((item) => {
        for (let u = 0; u < item.quantidade; u++) {
          unidades.push({
            uid: `${prefixo}::${item.cartId}::${u}`,
            cartId: item.cartId,
            nome: item.nome,
            precoUnitario: item.precoTotal,
            opcoes: item.opcoes.map((o) => o.opcaoNome).join(', '),
            clienteId: null,
            pessoaOrigem,
          });
        }
      });
    };
    rodadas.forEach((r) => {
      // Extrai o nome da pessoa do nomeResponsavel (formato: "Nome · Origem" ou só "Nome")
      const partes = r.nomeResponsavel?.split('·');
      const nomePessoa = partes?.[0]?.trim();
      processarCarrinho(r.itens, `r-${r.id}`, nomePessoa || undefined);
    });
    processarCarrinho(itensNovos, 'novo');
    return unidades;
  }, [rodadas, itensNovos]);

  /**
   * Tenta encontrar o clienteId correspondente a um nome de pessoa.
   * Faz match case-insensitive e por prefixo para robustez.
   */
  const resolverClientePorNome = useCallback((nome: string | undefined, clientesLista: ClienteDivisao[]): string | null => {
    if (!nome) return null;
    const nomeLower = nome.toLowerCase().trim();
    // Match exato primeiro
    const exato = clientesLista.find((c) => c.nome.toLowerCase().trim() === nomeLower);
    if (exato) return exato.id;
    // Match por prefixo (ex: "João" bate em "João Silva")
    const prefixo = clientesLista.find((c) => c.nome.toLowerCase().trim().startsWith(nomeLower) || nomeLower.startsWith(c.nome.toLowerCase().trim()));
    return prefixo?.id ?? null;
  }, []);

  const [atribuicoes, setAtribuicoes] = useState<Record<string, string | null>>(() => {
    if (estadoPersistido?.atribuicoes) return estadoPersistido.atribuicoes;
    // Pré-atribuição automática: atribui cada unidade ao cliente correspondente
    // com base no nome da pessoa que fez o pedido (pessoaOrigem da rodada)
    const clientesInit = initClientes();
    const atrib: Record<string, string | null> = {};
    const unidades: UnidadeItem[] = [];
    const processarCarrinho = (items: CarrinhoItem[], prefixo: string, pessoaOrigem?: string) => {
      items.forEach((item) => {
        for (let u = 0; u < item.quantidade; u++) {
          unidades.push({
            uid: `${prefixo}::${item.cartId}::${u}`,
            cartId: item.cartId,
            nome: item.nome,
            precoUnitario: item.precoTotal,
            opcoes: item.opcoes.map((o) => o.opcaoNome).join(', '),
            clienteId: null,
            pessoaOrigem,
          });
        }
      });
    };
    rodadas.forEach((r) => {
      const partes = r.nomeResponsavel?.split('·');
      const nomePessoa = partes?.[0]?.trim();
      processarCarrinho(r.itens, `r-${r.id}`, nomePessoa || undefined);
    });
    processarCarrinho([], 'novo');

    unidades.forEach((u) => {
      if (u.pessoaOrigem) {
        const nomeLower = u.pessoaOrigem.toLowerCase().trim();
        const cliente = clientesInit.find((c) =>
          c.nome.toLowerCase().trim() === nomeLower ||
          c.nome.toLowerCase().trim().startsWith(nomeLower) ||
          nomeLower.startsWith(c.nome.toLowerCase().trim())
        );
        atrib[u.uid] = cliente?.id ?? null;
      } else {
        atrib[u.uid] = null;
      }
    });
    return atrib;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // Sincronizar atribuições quando novos itens chegam (preserva existentes, pré-atribui novos)
  useEffect(() => {
    setAtribuicoes((prev) => {
      const novo: Record<string, string | null> = {};
      todasUnidades.forEach((u) => {
        if (u.uid in prev) {
          novo[u.uid] = prev[u.uid];
        } else {
          // Nova unidade: tenta pré-atribuir automaticamente
          if (u.pessoaOrigem) {
            const clienteId = resolverClientePorNome(u.pessoaOrigem, clientes);
            novo[u.uid] = clienteId;
          } else {
            novo[u.uid] = null;
          }
        }
      });
      return novo;
    });
  }, [todasUnidades, clientes, resolverClientePorNome]);

  // Persistir estado ao mudar (debounce para evitar loop)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      onEstadoChange?.({ clientes, atribuicoes });
    }, 200);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientes, atribuicoes]);

  // ── Cálculos ──────────────────────────────────────────────────────────────
  const totalGeral = todasUnidades.reduce((a, u) => a + u.precoUnitario, 0);

  const totalPorCliente = useMemo(() => {
    const map: Record<string, number> = {};
    clientes.forEach((c) => { map[c.id] = 0; });
    todasUnidades.forEach((u) => {
      const cId = atribuicoes[u.uid];
      if (cId && map[cId] !== undefined) map[cId] += u.precoUnitario;
    });
    return map;
  }, [clientes, todasUnidades, atribuicoes]);

  const itensPorCliente = useMemo(() => {
    const map: Record<string, UnidadeItem[]> = {};
    clientes.forEach((c) => { map[c.id] = []; });
    todasUnidades.forEach((u) => {
      const cId = atribuicoes[u.uid];
      if (cId && map[cId]) map[cId].push(u);
    });
    return map;
  }, [clientes, todasUnidades, atribuicoes]);

  const unidadesNaoAtribuidas = todasUnidades.filter((u) => !atribuicoes[u.uid]);
  const totalNaoAtribuido = unidadesNaoAtribuidas.reduce((a, u) => a + u.precoUnitario, 0);
  const tudoAtribuido = unidadesNaoAtribuidas.length === 0 && todasUnidades.length > 0;

  useEffect(() => {
    onDivisaoChange?.({ clientes, atribuicoes, totalPorCliente, itensPorCliente });
  }, [clientes, atribuicoes, totalPorCliente, itensPorCliente, onDivisaoChange]);

  // ── Ações ─────────────────────────────────────────────────────────────────
  const atribuirUnidade = useCallback((uid: string, clienteId: string | null) => {
    setAtribuicoes((prev) => ({ ...prev, [uid]: clienteId }));
  }, []);

  const atribuirTudoPara = (clienteId: string) => {
    setAtribuicoes(Object.fromEntries(todasUnidades.map((u) => [u.uid, clienteId])));
  };

  const dividirIgualmente = () => {
    const novos: Record<string, string | null> = {};
    todasUnidades.forEach((u, idx) => {
      novos[u.uid] = clientes[idx % clientes.length]?.id ?? null;
    });
    setAtribuicoes(novos);
  };

  const limparAtribuicoes = () => {
    setAtribuicoes(Object.fromEntries(todasUnidades.map((u) => [u.uid, null])));
  };

  const adicionarCliente = () => {
    const nome = novoNome.trim();
    if (!nome || clientes.length >= 8) return;
    const idx = clientes.length;
    const novo: ClienteDivisao = { id: `cli-add-${Date.now()}`, nome, corIdx: idx };
    setClientes((prev) => [...prev, novo]);
    setClienteSelecionado(novo.id);
    setNovoNome('');
    setShowAddCliente(false);
  };

  const removerCliente = (clienteId: string) => {
    if (clientes.length <= 2) return;
    setClientes((prev) => prev.filter((c) => c.id !== clienteId));
    setAtribuicoes((prev) => {
      const novo = { ...prev };
      Object.keys(novo).forEach((k) => { if (novo[k] === clienteId) novo[k] = null; });
      return novo;
    });
    if (clienteSelecionado === clienteId) {
      setClienteSelecionado(clientes.find((c) => c.id !== clienteId)?.id ?? '');
    }
  };

  // ── Agrupamento ───────────────────────────────────────────────────────────
  const gruposNaoAtribuidos = useMemo(() => {
    const grupos: { cartId: string; nome: string; opcoes: string; precoUnitario: number; uids: string[] }[] = [];
    unidadesNaoAtribuidas.forEach((u) => {
      const g = grupos.find((g) => g.cartId === u.cartId);
      if (g) { g.uids.push(u.uid); }
      else { grupos.push({ cartId: u.cartId, nome: u.nome, opcoes: u.opcoes, precoUnitario: u.precoUnitario, uids: [u.uid] }); }
    });
    return grupos;
  }, [unidadesNaoAtribuidas]);

  const gruposPorCliente = useMemo(() => {
    const result: Record<string, { cartId: string; nome: string; opcoes: string; precoUnitario: number; uids: string[] }[]> = {};
    clientes.forEach((c) => {
      const itens = itensPorCliente[c.id] ?? [];
      const grupos: { cartId: string; nome: string; opcoes: string; precoUnitario: number; uids: string[] }[] = [];
      itens.forEach((u) => {
        const g = grupos.find((g) => g.cartId === u.cartId);
        if (g) { g.uids.push(u.uid); }
        else { grupos.push({ cartId: u.cartId, nome: u.nome, opcoes: u.opcoes, precoUnitario: u.precoUnitario, uids: [u.uid] }); }
      });
      result[c.id] = grupos;
    });
    return result;
  }, [clientes, itensPorCliente]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Seletor de clientes */}
      <div className="px-3 pt-3 pb-2 border-b border-zinc-200 bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Quem vai pagar o quê?</p>
          <div className="flex items-center gap-2">
            <button
              onClick={dividirIgualmente}
              className="text-[10px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer whitespace-nowrap"
            >
              <i className="ri-equalizer-line mr-0.5" />Dividir igual
            </button>
            <span className="text-zinc-300">·</span>
            <button
              onClick={limparAtribuicoes}
              className="text-[10px] font-semibold text-zinc-400 hover:text-zinc-600 cursor-pointer whitespace-nowrap"
            >
              Limpar
            </button>
          </div>
        </div>

        {/* Cards de clientes — scrolláveis no mobile */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3">
          {clientes.map((c) => {
            const cor = getCor(c.corIdx);
            const total = totalPorCliente[c.id] ?? 0;
            const ativo = clienteSelecionado === c.id;
            return (
              <div key={c.id} className="flex-shrink-0 relative group">
                <button
                  onClick={() => setClienteSelecionado(c.id)}
                  className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border-2 transition-all cursor-pointer min-w-[72px] ${
                    ativo ? `${cor.border} ${cor.light}` : 'border-zinc-200 bg-white hover:border-zinc-300'
                  }`}
                >
                  <div className={`w-7 h-7 flex items-center justify-center rounded-full text-white text-xs font-black ${cor.bg}`}>
                    {c.nome.charAt(0).toUpperCase()}
                  </div>
                  <span className={`text-[10px] font-semibold truncate max-w-[64px] ${ativo ? cor.text : 'text-zinc-600'}`}>{c.nome}</span>
                  <span className={`text-[9px] font-bold ${total > 0 ? cor.text : 'text-zinc-400'}`}>{total > 0 ? fmt(total) : '—'}</span>
                </button>
                {clientes.length > 2 && (
                  <button
                    onClick={() => removerCliente(c.id)}
                    className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <i className="ri-close-line text-[8px]" />
                  </button>
                )}
              </div>
            );
          })}

          {clientes.length < 8 && (
            <button
              onClick={() => setShowAddCliente(true)}
              className="flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-xl border-2 border-dashed border-zinc-300 hover:border-amber-400 hover:bg-amber-50 transition-all cursor-pointer min-w-[72px]"
            >
              <div className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
                <i className="ri-add-line text-sm" />
              </div>
              <span className="text-[10px] font-semibold text-zinc-400">Adicionar</span>
            </button>
          )}
        </div>

        {/* Atalhos "Tudo para X" */}
        <div className="flex gap-1.5 mt-2 flex-wrap overflow-x-auto pb-1">
          {clientes.map((c) => {
            const cor = getCor(c.corIdx);
            return (
              <button
                key={c.id}
                onClick={() => atribuirTudoPara(c.id)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border cursor-pointer transition-colors whitespace-nowrap ${cor.light} ${cor.border} ${cor.text}`}
              >
                <i className="ri-user-fill text-[9px]" />
                Tudo para {c.nome.split(' ')[0]}
              </button>
            );
          })}
        </div>

        {clienteSelecionado && (
          <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 rounded-lg border border-zinc-200">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getCor(clientes.find((c) => c.id === clienteSelecionado)?.corIdx ?? 0).dot}`} />
            <p className="text-[10px] text-zinc-500">
              Clique em <i className="ri-user-add-line" /> nos itens para atribuir a <strong>{clientes.find((c) => c.id === clienteSelecionado)?.nome}</strong>
            </p>
          </div>
        )}
      </div>

      {/* Lista de itens */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {gruposNaoAtribuidos.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <i className="ri-question-line text-amber-500" />
              Não atribuídos ({unidadesNaoAtribuidas.length} unidade{unidadesNaoAtribuidas.length !== 1 ? 's' : ''})
            </p>
            <div className="space-y-1.5">
              {gruposNaoAtribuidos.map((grupo) => (
                <GrupoItemCard
                  key={`na-${grupo.cartId}`}
                  grupo={grupo}
                  clientes={clientes}
                  clienteSelecionado={clienteSelecionado}
                  atribuicoes={atribuicoes}
                  onAtribuirUnidade={atribuirUnidade}
                  onAtribuirTodas={(uids, cId) => {
                    setAtribuicoes((prev) => {
                      const novo = { ...prev };
                      uids.forEach((uid) => { novo[uid] = cId; });
                      return novo;
                    });
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {clientes.map((c) => {
          const grupos = gruposPorCliente[c.id] ?? [];
          if (grupos.length === 0) return null;
          const cor = getCor(c.corIdx);
          return (
            <div key={c.id}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${cor.dot}`} />
                <p className={`text-[10px] font-bold uppercase tracking-wider ${cor.text}`}>
                  {c.nome} — {fmt(totalPorCliente[c.id])}
                </p>
              </div>
              <div className="space-y-1.5">
                {grupos.map((grupo) => (
                  <GrupoItemCard
                    key={`${c.id}-${grupo.cartId}`}
                    grupo={grupo}
                    clientes={clientes}
                    clienteSelecionado={clienteSelecionado}
                    atribuicoes={atribuicoes}
                    onAtribuirUnidade={atribuirUnidade}
                    onAtribuirTodas={(uids, cId) => {
                      setAtribuicoes((prev) => {
                        const novo = { ...prev };
                        uids.forEach((uid) => { novo[uid] = cId; });
                        return novo;
                      });
                    }}
                    clienteAtualId={c.id}
                    corCliente={cor}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {todasUnidades.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <i className="ri-receipt-line text-3xl text-zinc-300 block mb-2" />
            <p className="text-sm text-zinc-400">Nenhum item para dividir</p>
            <p className="text-xs text-zinc-300 mt-1">Adicione itens ao pedido primeiro</p>
          </div>
        )}
      </div>

      {/* Rodapé */}
      <div className="px-3 pb-4 pt-3 border-t border-zinc-200 bg-white flex-shrink-0">
        <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 rounded-xl">
          <div className="flex items-center gap-2">
            {totalNaoAtribuido > 0 ? (
              <>
                <i className="ri-error-warning-line text-amber-500 text-sm" />
                <span className="text-xs text-amber-700 font-semibold">
                  {fmt(totalNaoAtribuido)} ainda não atribuído
                </span>
              </>
            ) : todasUnidades.length > 0 ? (
              <>
                <i className="ri-checkbox-circle-fill text-green-500 text-sm" />
                <span className="text-xs text-green-700 font-semibold">Todos os itens atribuídos!</span>
              </>
            ) : null}
          </div>
          <span className="text-sm font-black text-zinc-900">{fmt(totalGeral)}</span>
        </div>

        {tudoAtribuido && (
          <div className="mt-2 space-y-1">
            {clientes.filter((c) => totalPorCliente[c.id] > 0).map((c) => {
              const cor = getCor(c.corIdx);
              return (
                <div key={c.id} className={`flex items-center justify-between px-3 py-1.5 rounded-lg ${cor.light} border ${cor.border}`}>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${cor.dot}`} />
                    <span className={`text-xs font-semibold ${cor.text}`}>{c.nome}</span>
                  </div>
                  <span className={`text-xs font-black ${cor.text}`}>{fmt(totalPorCliente[c.id])}</span>
                </div>
              );
            })}
          </div>
        )}

        {!tudoAtribuido && todasUnidades.length > 0 && (
          <p className="text-[10px] text-zinc-400 text-center mt-2">
            Atribua todos os itens para ver o resumo e liberar o pagamento
          </p>
        )}
      </div>

      {showAddCliente && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xs p-5 space-y-4">
            <h3 className="text-sm font-bold text-zinc-900">Adicionar Pessoa</h3>
            <input
              type="text"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adicionarCliente()}
              placeholder="Nome da pessoa..."
              autoFocus
              className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
              maxLength={30}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddCliente(false); setNovoNome(''); }}
                className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={adicionarCliente}
                disabled={!novoNome.trim()}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-componente GrupoItemCard ─────────────────────────────────────────────
interface GrupoItemCardProps {
  grupo: { cartId: string; nome: string; opcoes: string; precoUnitario: number; uids: string[] };
  clientes: ClienteDivisao[];
  clienteSelecionado: string;
  atribuicoes: Record<string, string | null>;
  onAtribuirUnidade: (uid: string, clienteId: string | null) => void;
  onAtribuirTodas: (uids: string[], clienteId: string | null) => void;
  clienteAtualId?: string;
  corCliente?: ReturnType<typeof getCor>;
}

function GrupoItemCard({
  grupo, clientes, clienteSelecionado, atribuicoes,
  onAtribuirUnidade, onAtribuirTodas, clienteAtualId, corCliente,
}: GrupoItemCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const totalGrupo = grupo.uids.length * grupo.precoUnitario;

  const qtdNoSelecionado = grupo.uids.filter((uid) => atribuicoes[uid] === clienteSelecionado).length;
  const qtdNaoAtribuidas = grupo.uids.filter((uid) => !atribuicoes[uid]).length;

  const handleAtribuirRapido = () => {
    if (!clienteSelecionado) return;
    if (qtdNoSelecionado === grupo.uids.length) {
      onAtribuirTodas(grupo.uids, null);
    } else {
      const naoAtribuidas = grupo.uids.filter((uid) => !atribuicoes[uid]);
      if (naoAtribuidas.length > 0) {
        onAtribuirTodas(naoAtribuidas, clienteSelecionado);
      } else {
        onAtribuirTodas(grupo.uids, clienteSelecionado);
      }
    }
  };

  const isAtribuidoAoSelecionado = qtdNoSelecionado === grupo.uids.length;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${
        clienteAtualId && corCliente
          ? `${corCliente.light} ${corCliente.border}`
          : 'bg-white border-zinc-200'
      }`}
    >
      {clienteAtualId && corCliente ? (
        <div className={`w-1.5 rounded-full flex-shrink-0 self-stretch ${corCliente.dot}`} />
      ) : (
        <div className="w-1.5 rounded-full flex-shrink-0 self-stretch bg-zinc-200" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-zinc-400 flex-shrink-0">{grupo.uids.length}x</span>
          <p className="text-xs font-semibold text-zinc-800 truncate">{grupo.nome}</p>
        </div>
        {grupo.opcoes && (
          <p className="text-[10px] text-zinc-400 truncate">{grupo.opcoes}</p>
        )}
        {grupo.uids.length > 1 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {grupo.uids.map((uid) => {
              const cId = atribuicoes[uid];
              const c = clientes.find((cl) => cl.id === cId);
              const cor = c ? getCor(c.corIdx) : null;
              return (
                <button
                  key={uid}
                  onClick={() => {
                    if (cId === clienteSelecionado) {
                      onAtribuirUnidade(uid, null);
                    } else {
                      onAtribuirUnidade(uid, clienteSelecionado || null);
                    }
                  }}
                  title={c ? `Unidade de ${c.nome} — clique para mover` : 'Não atribuída — clique para atribuir'}
                  className={`w-5 h-5 flex items-center justify-center rounded-full border-2 cursor-pointer transition-all ${
                    cor
                      ? `${cor.bg} border-transparent text-white`
                      : 'bg-zinc-100 border-zinc-300 text-zinc-400 hover:border-amber-400'
                  }`}
                >
                  {cor ? (
                    <span className="text-[8px] font-black">{c?.nome.charAt(0)}</span>
                  ) : (
                    <i className="ri-add-line text-[8px]" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <span className="text-xs font-bold text-zinc-700 flex-shrink-0">{fmt(totalGrupo)}</span>

      <button
        onClick={handleAtribuirRapido}
        title={
          isAtribuidoAoSelecionado
            ? 'Remover atribuição'
            : qtdNaoAtribuidas > 0
              ? `Atribuir ${qtdNaoAtribuidas} unidade(s) para ${clientes.find((c) => c.id === clienteSelecionado)?.nome ?? ''}`
              : `Mover para ${clientes.find((c) => c.id === clienteSelecionado)?.nome ?? ''}`
        }
        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer flex-shrink-0 ${
          isAtribuidoAoSelecionado
            ? 'bg-zinc-200 text-zinc-500 hover:bg-red-100 hover:text-red-500'
            : 'bg-amber-100 text-amber-600 hover:bg-amber-200'
        }`}
      >
        <i className={`${isAtribuidoAoSelecionado ? 'ri-close-line' : 'ri-user-add-line'} text-sm`} />
      </button>

      {/* Menu de contexto — usa portal no body para evitar overflow cortado */}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors"
        >
          <i className="ri-more-2-fill text-sm" />
        </button>
        {showMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
            <div className="fixed z-50 bg-white border border-zinc-200 rounded-xl shadow-lg min-w-[180px] overflow-hidden"
              style={(() => {
                const rect = menuRef.current?.getBoundingClientRect();
                if (!rect) return {};
                const spaceBelow = window.innerHeight - rect.bottom;
                const top = spaceBelow > 180 ? rect.bottom + 4 : rect.top - 4;
                const transform = spaceBelow > 180 ? 'translateY(0)' : 'translateY(-100%)';
                return { top, right: window.innerWidth - rect.right, transform };
              })()}
            >
              <div className="px-3 py-1.5 border-b border-zinc-100">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Atribuir todas as unidades</p>
              </div>
              <button
                onClick={() => { onAtribuirTodas(grupo.uids, null); setShowMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
              >
                <i className="ri-close-circle-line" />
                Não atribuir
              </button>
              {clientes.map((c) => {
                const cor = getCor(c.corIdx);
                const isAtual = clienteAtualId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => { onAtribuirTodas(grupo.uids, c.id); setShowMenu(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs cursor-pointer whitespace-nowrap hover:bg-zinc-50 ${isAtual ? `${cor.text} font-bold` : 'text-zinc-700'}`}
                  >
                    <div className={`w-2 h-2 rounded-full ${cor.dot}`} />
                    {c.nome}
                    {isAtual && <i className="ri-check-line ml-auto" />}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
