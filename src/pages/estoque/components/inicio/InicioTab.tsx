import { useMemo, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { somarDias } from '@/lib/dateUtils';
import { useAuth } from '@/contexts/AuthContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useToast } from '@/contexts/ToastContext';
import {
  contagemDeHoje, fmtQtd, quandoFica,
  type InsumoSituacao, type SituacaoEstoque,
} from '@/lib/estoqueRegras';
import ComprarSecao from './ComprarSecao';
import ContarSecao, { ContagemFolha } from './ContarSecao';
import ConfigFolha from './ConfigFolha';

// Início do Estoque (2026-10-03): abre respondendo "o que comprar", "o que contar" e "o que vai faltar",
// pela regra única (fn_estoque_situacao / src/lib/estoqueRegras.ts). As outras abas continuam iguais.
// Quem usa no dia a dia é a supervisão, no celular.
export default function InicioTab({ situacao, carregando, erro, onReload }: {
  situacao: SituacaoEstoque | null;
  carregando: boolean;
  erro: string | null;
  onReload: () => void;
}) {
  const [extras, setExtras] = useState<Set<string>>(new Set());
  const [contagem, setContagem] = useState<{ titulo: string; itens: InsumoSituacao[] } | null>(null);
  const [config, setConfig] = useState(false);

  const hoje = useMemo(() => (situacao ? contagemDeHoje(situacao) : null), [situacao]);

  if (!situacao || !hoje) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        {erro ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4">
            <p className="text-sm font-bold text-red-800">Não consegui ler o estoque</p>
            <p className="text-xs text-red-700 mt-1">{erro}</p>
            <button onClick={onReload} className="mt-2 text-xs font-bold text-red-700 underline cursor-pointer">Tentar de novo</button>
          </div>
        ) : (
          <div className="space-y-3 animate-pulse">
            <div className="h-7 w-2/3 bg-zinc-200 rounded-lg" />
            <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((k) => <div key={k} className="h-24 bg-zinc-100 rounded-2xl" />)}</div>
            <div className="h-40 bg-zinc-100 rounded-2xl" />
          </div>
        )}
      </div>
    );
  }

  const { totais, config: cfg } = situacao;
  const comprarIds = new Set(situacao.insumos.filter((i) => i.abaixoMinimo || extras.has(i.id)).map((i) => i.id));
  const vaiFaltar = situacao.insumos.filter((i) => i.vaiFaltar && !extras.has(i.id));
  const nComprar = comprarIds.size;
  const nContar = hoje.itens.length;

  const ir = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const partes: string[] = [];
  if (nComprar) partes.push(`comprar ${nComprar} ${nComprar === 1 ? 'insumo' : 'insumos'}`);
  if (nContar) partes.push(`contar ${nContar}`);
  const emDia = !nComprar && !nContar && !vaiFaltar.length;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-16">
      {emDia ? (
        <h2 className="text-2xl font-extrabold text-emerald-700 tracking-tight">Estoque em dia ✓</h2>
      ) : (
        <h2 className="text-[22px] md:text-2xl font-extrabold text-zinc-900 tracking-tight leading-tight">
          {partes.length ? `Hoje: ${partes.join(' e ')}` : 'Hoje: ver o que vai faltar'}
        </h2>
      )}
      <p className="text-xs text-zinc-500 mt-1 mb-3">
        Números de agora, pela mesma regra do Dashboard e do assistente.
        {carregando && <i className="ri-loader-4-line animate-spin ml-1 align-middle" />}
      </p>

      <div className="grid grid-cols-3 gap-2 mb-5">
        <Bloco icone="ri-shopping-cart-2-line" n={nComprar} rotulo="Comprar" detalhe={`abaixo do mínimo${totais.zeradosAbaixo ? ` · ${totais.zeradosAbaixo} zerados` : ''}`}
          tom={nComprar ? 'red' : 'ok'} onClick={() => ir('inicio-comprar')} />
        <Bloco icone="ri-scales-3-line" n={nContar} rotulo="Contar" detalhe={nContar ? (hoje.devidos.length ? 'contagem do dia' : 'conferir') : 'em dia'}
          tom={nContar ? 'dark' : 'ok'} onClick={() => ir('inicio-contar')} />
        <Bloco icone="ri-hourglass-line" n={vaiFaltar.length} rotulo="Vai faltar" detalhe={`em até ${cfg.diasPrevisao} dias`}
          tom={vaiFaltar.length ? 'amber' : 'ok'} onClick={() => ir('inicio-faltar')} />
      </div>

      <div className="space-y-6">
        <ComprarSecao situacao={situacao} extras={extras} onReload={onReload}
          onIrContar={() => setContagem({ titulo: 'Conferir', itens: hoje.conferir.length ? hoje.conferir : hoje.itens })} />

        <ContarSecao situacao={situacao} contagem={hoje} onReload={onReload}
          onContar={(itens, titulo) => setContagem({ titulo, itens })} onConfigurar={() => setConfig(true)} />

        <VaiFaltarSecao situacao={situacao} itens={vaiFaltar}
          onPorNaLista={(id) => { setExtras((s) => new Set(s).add(id)); ir('inicio-comprar'); }} onReload={onReload} />

        {cfg.podeConfigurar && (
          <button onClick={() => setConfig(true)} className="w-full flex items-center justify-center gap-2 text-xs font-bold text-zinc-500 hover:text-zinc-700 py-2 cursor-pointer">
            <i className="ri-settings-3-line" />Quanto pedir ({cfg.diasCompra} dias de uso) e contagens programadas
          </button>
        )}
      </div>

      <ContagemFolha
        aberta={!!contagem}
        titulo={contagem?.titulo ?? ''}
        itens={contagem?.itens ?? []}
        onFechar={() => setContagem(null)}
        onConcluida={() => { setContagem(null); onReload(); }}
      />
      <ConfigFolha aberta={config} situacao={situacao} onFechar={() => setConfig(false)} onReload={onReload} />
    </div>
  );
}

function Bloco({ icone, n, rotulo, detalhe, tom, onClick }: {
  icone: string; n: number; rotulo: string; detalhe: string; tom: 'red' | 'dark' | 'amber' | 'ok'; onClick: () => void;
}) {
  const cor = tom === 'red' ? 'text-red-600' : tom === 'amber' ? 'text-amber-600' : tom === 'ok' ? 'text-emerald-600' : 'text-zinc-900';
  return (
    <button onClick={onClick} className="relative text-left bg-white border border-zinc-200 rounded-2xl px-3 py-2.5 hover:border-amber-300 cursor-pointer">
      <i className={`${icone} text-lg text-amber-600`} />
      {tom === 'ok' && <i className="ri-check-line absolute right-2.5 top-2 text-emerald-600 font-bold" />}
      <p className={`text-[26px] font-extrabold leading-none mt-1 tabular-nums ${cor}`}>{n}</p>
      <p className="text-[12.5px] font-extrabold text-zinc-800 mt-1">{rotulo}</p>
      <p className="text-[10.5px] text-zinc-400 leading-tight mt-0.5">{detalhe}</p>
    </button>
  );
}

function VaiFaltarSecao({ situacao, itens, onPorNaLista, onReload }: {
  situacao: SituacaoEstoque;
  itens: InsumoSituacao[];
  onPorNaLista: (id: string) => void;
  onReload: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const { reloadInsumos } = useEstoque();
  const [salvando, setSalvando] = useState<string | null>(null);
  const { diasPrevisao } = situacao.config;
  const comUso = situacao.insumos.filter((i) => i.acompanha && (i.consumoDia ?? 0) > 0).length;
  const acompanhados = situacao.insumos.filter((i) => i.acompanha).length;

  // Mínimo sugerido para quem não tem: o uso dos dias de previsão, num passo redondo.
  const minimoSugerido = (i: InsumoSituacao) => {
    const passo = i.unidade === 'unit' ? 1 : i.unidade === 'g' || i.unidade === 'ml' ? 100 : 0.5;
    return Math.max(passo, Math.ceil(((i.consumoDia ?? 0) * diasPrevisao) / passo) * passo);
  };
  const definirMinimo = async (i: InsumoSituacao, v: number) => {
    setSalvando(i.id);
    const { error } = await invokeWithAuth('stock-write', { body: { action: 'upsert_ingredient', tenant_id: user!.tenantId, id: i.id, name: i.nome, min_stock: v } });
    setSalvando(null);
    if (error) { toast.error('Não salvei o mínimo', error.message); return; }
    toast.success(`${i.nome}: mínimo de ${fmtQtd(v, i.unidade)}`, 'Agora ele avisa sozinho.');
    void reloadInsumos();
    onReload();
  };

  return (
    <section id="inicio-faltar" className="scroll-mt-4">
      <div className="flex items-baseline gap-2 mb-2 px-0.5">
        <h2 className="text-base font-extrabold text-zinc-900">Vai faltar</h2>
        <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${itens.length ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white'}`}>{itens.length}</span>
        <span className="text-xs text-zinc-400 flex-1">em até {diasPrevisao} dias, fora da lista</span>
      </div>
      <div className="space-y-2.5">
        {itens.length === 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-start gap-3">
            <i className="ri-checkbox-circle-fill text-xl text-emerald-600 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-emerald-800">Nada vai faltar fora da lista</p>
              <p className="text-xs text-emerald-700 mt-0.5">Pelo ritmo de uso, o que não está em “Comprar” dura mais de {diasPrevisao} dias.</p>
            </div>
          </div>
        )}
        {itens.map((i) => {
          const d = i.diasRestantes ?? 0;
          const acabou = d < 0.5;
          const dias = Math.max(1, Math.round(d));
          const sug = minimoSugerido(i);
          return (
            <div key={i.id} className="relative bg-white border border-zinc-200 rounded-2xl pl-4 pr-3 py-3 overflow-hidden">
              <span className={`absolute left-0 top-0 bottom-0 w-1 ${d < 2 ? 'bg-red-500' : 'bg-amber-400'}`} />
              <div className="flex items-center gap-2">
                <p className="text-sm font-extrabold text-zinc-900 flex-1 truncate">{i.nome}</p>
                <span className={`text-[10px] font-bold uppercase tracking-wide rounded-md px-1.5 py-0.5 ${d < 2 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                  {acabou ? 'acabou' : `~${dias} ${dias === 1 ? 'dia' : 'dias'}`}
                </span>
              </div>
              <p className="text-[12px] text-zinc-500 mt-1 leading-snug">
                {acabou ? (i.estoque < 0 ? `Pelo sistema já acabou (mostra ${fmtQtd(i.estoque, i.unidade)})` : 'Já acabou') : `Acaba ${quandoFica(somarDias(situacao.hoje, dias), situacao.hoje)}`}
                {' · '}usa ~{fmtQtd(i.consumoDia ?? 0, i.unidade)} por dia · {i.minimo > 0 ? `mínimo ${fmtQtd(i.minimo, i.unidade)} (ainda não avisou)` : <b>sem estoque mínimo</b>}
              </p>
              <div className="flex gap-2 mt-2 flex-wrap">
                <button onClick={() => onPorNaLista(i.id)} className="min-h-[36px] px-3 rounded-xl bg-amber-500 text-zinc-900 text-[12.5px] font-bold cursor-pointer flex items-center gap-1">
                  <i className="ri-add-line" />Pôr na lista
                </button>
                {i.minimo === 0 && (
                  <button disabled={salvando === i.id} onClick={() => definirMinimo(i, sug)} className="min-h-[36px] px-3 rounded-xl border border-zinc-200 text-[12.5px] font-bold text-zinc-700 cursor-pointer disabled:opacity-50">
                    Mínimo de {fmtQtd(sug, i.unidade)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-400 bg-zinc-50 rounded-xl px-3 py-2 mt-2 leading-snug">
        {situacao.janelaDias
          ? <>Previsão pelo uso dos últimos {situacao.janelaDias.toLocaleString('pt-BR')} dias (vendas que baixam pela ficha técnica, perdas e produção). {comUso} dos {acompanhados} insumos acompanhados têm uso registrado; os outros só avisam pelo mínimo.</>
          : <>Ainda não há 3 dias de uso registrado nesta loja, então não dá para prever. Por enquanto só o mínimo avisa.</>}
      </p>
    </section>
  );
}
