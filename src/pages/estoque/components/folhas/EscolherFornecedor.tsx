import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import Folha from '../inicio/Folha';
import { semAcento } from '../ui/EstoqueUi';

// Escolher o fornecedor de um insumo (layout novo do Estoque). Lê fn_estoque_fornecedores, que só responde
// para quem configura o estoque (não abre fin_suppliers, que é do Financeiro). Quem usa guarda a escolha:
// aqui só se escolhe e devolve {id, nome}. A janela se fecha sozinha depois de escolher.

export interface FornecedorEscolhido { id: string; nome: string }
interface Linha extends FornecedorEscolhido { fone: string | null }

// Lista da loja guardada por 1 minuto: o "Arrumar a lista" abre esta janela dezenas de vezes seguidas.
const guardada = new Map<string, { em: number; lista: Linha[] }>();
const VALE_MS = 60_000;

export default function EscolherFornecedor({ aberta, titulo = 'Quem vende?', subtitulo, sugestoes = [], onEscolher, onFechar }: {
  aberta: boolean;
  titulo?: string;
  subtitulo?: string;
  /** Aparecem no topo, antes da busca (só os que existem na lista da loja) */
  sugestoes?: FornecedorEscolhido[];
  onEscolher: (f: FornecedorEscolhido) => void;
  onFechar: () => void;
}) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [lista, setLista] = useState<Linha[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [tentativa, setTentativa] = useState(0);

  // Ao abrir: limpa a busca e traz a lista (da memória, se for recente)
  useEffect(() => {
    if (!aberta) return;
    setBusca('');
    if (!tenantId) { setErro('Loja não identificada.'); return; }
    const guardado = guardada.get(tenantId);
    if (guardado && Date.now() - guardado.em < VALE_MS) { setLista(guardado.lista); setErro(null); return; }
    let vivo = true;
    setLista(null); // não deixa a lista de outra loja na tela enquanto carrega
    setCarregando(true);
    setErro(null);
    (async () => {
      try {
        const { data, error } = await supabase.rpc('fn_estoque_fornecedores', { p_tenant_id: tenantId });
        if (!vivo) return;
        if (error) {
          setLista(null);
          setErro(error.code === '42501'
            ? 'Só quem configura o estoque (dono, Supervisor ou quem faz o inventário) escolhe o fornecedor.'
            : error.message);
          return;
        }
        const linhas: Linha[] = ((data ?? []) as Array<{ id: string; nome: string; fone: string | null }>)
          .map((r) => ({ id: String(r.id), nome: String(r.nome ?? ''), fone: r.fone ? String(r.fone) : null }))
          .filter((r) => r.nome);
        guardada.set(tenantId, { em: Date.now(), lista: linhas });
        setLista(linhas);
      } catch (e) {
        if (vivo) { setLista(null); setErro((e as { message?: string })?.message ?? 'Não consegui trazer os fornecedores.'); }
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [aberta, tenantId, tentativa]);

  const achados = useMemo(() => {
    const t = semAcento(busca);
    if (!lista) return [];
    return t ? lista.filter((f) => semAcento(f.nome).includes(t)) : lista;
  }, [lista, busca]);

  // Sugestões que ainda existem na lista da loja (fornecedor apagado não aparece)
  const sugeridos = useMemo(() => {
    if (!lista) return [];
    const ids = new Set(lista.map((f) => f.id));
    const vistos = new Set<string>();
    return sugestoes.filter((s) => ids.has(s.id) && !vistos.has(s.id) && vistos.add(s.id));
  }, [lista, sugestoes]);

  const escolher = (f: FornecedorEscolhido) => {
    onEscolher({ id: f.id, nome: f.nome });
    onFechar();
  };

  const tentarDeNovo = () => {
    if (tenantId) guardada.delete(tenantId);
    setTentativa((t) => t + 1);
  };

  const teclado = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;

  return (
    <Folha aberta={aberta} titulo={titulo} subtitulo={subtitulo} onFechar={onFechar}>
      <div className="pb-3">
        {carregando && !lista ? (
          <p className="text-sm text-zinc-500 py-6 text-center">Carregando os fornecedores…</p>
        ) : erro ? (
          <div className="py-4 text-center">
            <p className="text-sm font-bold text-red-600">Não consegui abrir a lista</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{erro}</p>
            <button type="button" onClick={tentarDeNovo} className="mt-3 min-h-[40px] px-4 rounded-xl border border-zinc-200 text-[13px] font-bold text-zinc-700 cursor-pointer hover:bg-zinc-50">
              Tentar de novo
            </button>
          </div>
        ) : lista && lista.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm font-bold text-zinc-800">Nenhum fornecedor cadastrado</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">Cadastre em Financeiro › Compras › Fornecedores e volte aqui.</p>
          </div>
        ) : lista ? (
          <>
            <div className="flex items-center gap-2 h-11 px-3 rounded-xl border border-zinc-200 bg-zinc-50 focus-within:border-amber-300 focus-within:bg-white">
              <i className="ri-search-line text-zinc-400" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                autoFocus={teclado}
                placeholder="Procurar fornecedor…"
                className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-zinc-800"
              />
              {busca && (
                <button type="button" onClick={() => setBusca('')} aria-label="Limpar a busca" className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 cursor-pointer">
                  <i className="ri-close-line" />
                </button>
              )}
            </div>

            {!busca.trim() && sugeridos.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-amber-700 mb-1.5">Sugeridos</p>
                <div className="flex gap-1.5 flex-wrap">
                  {sugeridos.map((s) => (
                    <button key={s.id} type="button" onClick={() => escolher(s)}
                      className="h-9 px-3 rounded-full border border-amber-300 bg-amber-50 text-[12.5px] font-bold text-amber-800 cursor-pointer hover:bg-amber-100">
                      {s.nome}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11px] font-extrabold uppercase tracking-widest text-zinc-400 mt-4 mb-1">
              {busca.trim() ? `${achados.length} ${achados.length === 1 ? 'resultado' : 'resultados'}` : `Todos (${lista.length})`}
            </p>
            {achados.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4 text-center">Nenhum fornecedor com esse nome. Se for novo, cadastre em Financeiro › Compras › Fornecedores.</p>
            ) : (
              <div>
                {achados.map((f) => (
                  <button key={f.id} type="button" onClick={() => escolher(f)}
                    className="w-full min-h-[46px] flex items-center justify-between gap-3 px-1 py-2 border-t border-zinc-100 first:border-t-0 text-left cursor-pointer hover:bg-amber-50/60 rounded-lg">
                    <span className="text-[14px] font-semibold text-zinc-800 truncate">{f.nome}</span>
                    <i className="ri-arrow-right-s-line text-zinc-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </Folha>
  );
}
