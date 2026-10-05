// "Vem aí — próximos 14 dias" (2026-10-05): seção recolhida no fim da Hoje do dono, com o que vem dia a dia
// em todas as lojas dele (contas a pagar, guias, folha, certificados, conexões, datas especiais do
// delivery). Só leitura: uma chamada à RPC fn_hoje_vem_ai (SECURITY DEFINER, só lojas em que a pessoa é
// admin, nunca devolve segredo) ao abrir a tela; cada linha tem o botão que leva à tela certa.
// Regras do destaque e dos textos: vemAiRegras.ts. Protótipo: docs/prototipos/sistema-proposta.html › "Vem aí".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { diaCurto, ddmm, montarVemAi, resumoVemAi, type VemAiDados } from './vemAiRegras';

const DIAS = 14;
// Dado do dia: uma releitura ao abrir só se a última tem mais de 5 minutos (a Hoje fica aberta o dia todo).
const IDADE_MAX = 5 * 60 * 1000;

interface Props {
  /** Só o dono vê (o servidor só devolve as lojas em que é admin). */
  dono: boolean;
  /** Loja escolhida nos botões do topo da Hoje ('' = todas). */
  filtroLoja: string;
  abrir: (tenantId: string, rota: string) => void;
}

export default function VemAi({ dono, filtroLoja, abrir }: Props) {
  const { user } = useAuth();
  const [dados, setDados] = useState<VemAiDados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const quando = useRef(0);
  const lendo = useRef(false);
  const eu = useRef<string | undefined>(undefined);
  eu.current = user?.id;

  const carregar = useCallback(async () => {
    if (!dono || lendo.current) return;
    lendo.current = true;
    const id = eu.current;
    try {
      const { data, error } = await supabase.rpc('fn_hoje_vem_ai', { p_dias: DIAS });
      if (eu.current !== id) return; // outra pessoa entrou no aparelho no meio da leitura
      if (error) throw new Error(error.message);
      setDados(data as VemAiDados);
      setErro(null);
      quando.current = Date.now();
    } catch (e) {
      if (eu.current === id) setErro(e instanceof Error ? e.message : String(e));
    } finally { lendo.current = false; }
  }, [dono]);

  useEffect(() => { setDados(null); setErro(null); quando.current = 0; void carregar(); }, [carregar, user?.id]);

  const linhas = useMemo(() => (dados ? montarVemAi(dados, filtroLoja) : []), [dados, filtroLoja]);
  if (!dono) return null;

  const alternar = () => {
    setAberto((a) => !a);
    if (!aberto && Date.now() - quando.current > IDADE_MAX) void carregar();
  };

  return (
    <section>
      <button onClick={alternar} className="w-full text-left cursor-pointer" aria-expanded={aberto}>
        <div className="flex items-baseline gap-2 mb-1 px-0.5">
          <h2 className="text-[15px] font-extrabold text-zinc-900 whitespace-nowrap">Vem aí</h2>
          <span className="text-[12px] text-zinc-400 truncate">próximos {DIAS} dias{filtroLoja ? '' : ' · todas as lojas'}</span>
          <span className="ml-auto text-[12px] font-bold text-amber-600">{aberto ? 'Esconder' : 'Ver'}</span>
        </div>
        {!aberto && (
          <p className="px-0.5 text-[12px] text-zinc-500">
            {erro ? 'Não consegui conferir o que vem aí agora.' : !dados ? 'Conferindo…' : resumoVemAi(linhas, DIAS)}
          </p>
        )}
      </button>

      {aberto && (
        <div className="mt-2">
          {erro && <p className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">Não consegui conferir: {erro}</p>}
          {!erro && !dados && <p className="text-[13px] text-zinc-400 px-0.5">Conferindo…</p>}
          {!erro && dados && linhas.length === 0 && <p className="text-[13px] text-zinc-500 px-0.5">{resumoVemAi(linhas, DIAS)}</p>}
          {linhas.length > 0 && (
            <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100 overflow-hidden">
              {linhas.map((l, i) => {
                const novoDia = i === 0 || linhas[i - 1].dia !== l.dia;
                return (
                  <div key={l.chave} className="flex items-center gap-3 px-3 py-2.5">
                    <div className={`w-11 flex-shrink-0 text-center leading-tight ${novoDia ? '' : 'invisible'}`}>
                      <p className="text-[11px] font-bold text-zinc-500">{diaCurto(l.dia)}</p>
                      <p className="text-[12px] font-semibold text-zinc-700 tabular-nums">{ddmm(l.dia)}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold text-zinc-900 leading-snug">{l.titulo}</p>
                      {l.detalhe && <p className={`text-[12px] leading-snug ${l.acima ? 'text-amber-700 font-semibold' : 'text-zinc-500'}`}>{l.detalhe}</p>}
                      {l.sub && <p className="text-[11px] text-zinc-400 leading-snug">{l.sub}</p>}
                    </div>
                    {l.acao && (
                      <button onClick={() => abrir(l.acao!.tenantId, l.acao!.rota)}
                        className="flex-shrink-0 h-9 px-3 rounded-xl border border-zinc-200 bg-white text-[12px] font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer">
                        {l.acao.label}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-1.5 px-0.5 text-[11px] text-zinc-400">Só leitura. Contas em aberto a partir de amanhã; o que vence hoje já está nos cartões acima.</p>
        </div>
      )}
    </section>
  );
}
