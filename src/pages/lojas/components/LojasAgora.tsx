import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLojasComparar } from '@/hooks/useLojasComparar';
import { corDaLoja, rotuloComparacao, totalLojas, type LojaComparada } from '@/lib/lojasComparar';
import { cliqueParaNovaAba } from '@/lib/novaJanela';
import { AgoraTexto, AoVivo, brl, EscolherLojasModal, EtiquetaDia, MetaBarra, MetaTexto, PontoLoja, Variacao, useAbrirLoja } from './ui';

// "Suas lojas agora" no topo de /modulos (2026-10-04): o total e cada loja ao vivo, no dia da loja (soma das
// sessões abertas no dia). Só para quem vê o Dashboard em 2 ou mais lojas (dono e gerente, pelo padrão).
// Tocar numa loja entra no Dashboard dela; "Comparar lojas" abre /lojas.

/** Linha "agora × semana passada" acumulada do dia, bem pequena (só no computador). */
function Mini({ loja, cor }: { loja: LojaComparada; cor: string }) {
  const horas = [...Object.keys(loja.atual.serie), ...Object.keys(loja.anterior.serie)].map(Number);
  if (horas.length === 0) return <div className="h-[30px]" />;
  const ini = Math.min(...horas); const fim = Math.max(...horas) + 1;
  const acc = (s: Record<string, number>) => { let t = 0; const out: number[] = []; for (let h = ini; h <= fim; h++) { out.push(t); t += s[String(h)] ?? 0; } return out; };
  const a = acc(loja.atual.serie); const b = acc(loja.anterior.serie);
  const max = Math.max(1, ...a, ...b);
  const W = 200; const H = 30;
  const pts = (arr: number[]) => arr.map((v, i) => `${((i / Math.max(1, arr.length - 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[30px] mt-2" aria-hidden="true">
      <polyline points={pts(b)} fill="none" stroke="#d4d4d8" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <polyline points={pts(a)} fill="none" stroke={cor} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export default function LojasAgora() {
  const { canSwitchTenant } = useAuth();
  const { lojas, carregando, setOculta } = useLojasComparar('hoje', canSwitchTenant, 2);
  const abrirLoja = useAbrirLoja();
  const navigate = useNavigate();
  const [verParadas, setVerParadas] = useState(false);
  const [escolher, setEscolher] = useState(false);

  const cores = useMemo(() => Object.fromEntries(lojas.map((l, i) => [l.tenantId, corDaLoja(i)])), [lojas]);
  const mostradas = lojas.filter((l) => !l.oculta && !l.parada).sort((a, b) => b.atual.faturamento - a.atual.faturamento);
  const paradas = lojas.filter((l) => !l.oculta && l.parada);
  const ocultas = lojas.filter((l) => l.oculta);
  const total = totalLojas(mostradas);

  if (!canSwitchTenant) return null;
  if (carregando) {
    return <div className="mb-8 h-36 rounded-2xl border border-zinc-200 bg-white/60 animate-pulse" />;
  }
  // Comparação só faz sentido com 2+ lojas em que a pessoa vê o Dashboard
  if (lojas.length < 2) return null;

  const abrir = (l: LojaComparada) => { abrirLoja(l.tenantId); };
  const rotulo = mostradas[0] ? rotuloComparacao('hoje', mostradas[0]) : '';

  return (
    <section className="mb-8 bg-white/85 backdrop-blur-sm border border-zinc-200 rounded-2xl p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-black text-zinc-800 whitespace-nowrap">Suas lojas agora</span>
        <AoVivo soPontoNoCelular />
        <span className="flex-1" />
        <button onClick={() => setEscolher(true)} title="Escolher lojas"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 cursor-pointer">
          <i className="ri-equalizer-line text-base" />
        </button>
        <a href="/lojas"
          onClick={(e) => { if (cliqueParaNovaAba(e)) return; e.preventDefault(); navigate('/lojas'); }}
          className="text-xs font-bold text-amber-700 hover:bg-amber-50 rounded-lg px-2 py-1.5 flex items-center gap-0.5 whitespace-nowrap">
          Comparar lojas <i className="ri-arrow-right-s-line" />
        </a>
      </div>

      {mostradas.length === 0 ? (
        <button onClick={() => setEscolher(true)} className="w-full text-left text-sm text-zinc-500 py-3 cursor-pointer hover:text-zinc-800">
          Nenhuma loja selecionada. <b className="text-amber-700">Escolher lojas</b>
        </button>
      ) : (
        <>
          {/* Total */}
          <div className="flex items-end gap-x-3 gap-y-1 flex-wrap pb-3 border-b border-zinc-100 md:border-0 md:pb-0">
            <span className="text-[28px] leading-none font-black tracking-tight text-zinc-900 tabular-nums md:hidden">{brl(total.faturamento)}</span>
            <span className="md:hidden"><Variacao pct={total.variacao} titulo={total.variacao === null ? 'Uma das lojas não tem base de comparação' : rotulo} /></span>
            <span className="text-xs text-zinc-500 pb-0.5 md:hidden">{total.pedidos} pedidos · {rotulo}</span>
          </div>

          {/* Celular: uma linha por loja */}
          <div className="md:hidden">
            {mostradas.map((l) => (
              <button key={l.tenantId} onClick={() => abrir(l)}
                className="w-full flex gap-2.5 items-start py-3 border-b border-zinc-100 last:border-0 text-left cursor-pointer active:bg-zinc-50">
                <PontoLoja cor={cores[l.tenantId]} className="mt-1.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[13.5px] font-black text-zinc-800 truncate">{l.nome}</span>
                    <EtiquetaDia loja={l} />
                  </div>
                  <p className="text-[11.5px] text-zinc-500 mt-0.5 leading-relaxed">
                    {l.atual.pedidos} ped · tíquete {brl(l.atual.ticket)} · <MetaTexto loja={l} /><br />
                    <AgoraTexto loja={l} />
                  </p>
                  <MetaBarra loja={l} cor={cores[l.tenantId]} />
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-base font-black text-zinc-900 tabular-nums">{brl(l.atual.faturamento, false)}</p>
                  <div className="mt-0.5"><Variacao pct={l.variacao} titulo={rotuloComparacao('hoje', l)} /></div>
                </div>
              </button>
            ))}
          </div>

          {/* Computador: cartões lado a lado, o primeiro é o total */}
          <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-3">
            <a href="/lojas"
              onClick={(e) => { if (cliqueParaNovaAba(e)) return; e.preventDefault(); navigate('/lojas'); }}
              className="rounded-xl bg-zinc-900 text-white p-3.5 flex flex-col cursor-pointer hover:bg-zinc-800 transition-colors">
              <span className="text-[13px] font-black">Todas as lojas</span>
              <span className="text-[22px] font-black tracking-tight tabular-nums mt-2">{brl(total.faturamento)}</span>
              <span className="text-[11.5px] text-zinc-300 mt-1.5 leading-relaxed">
                <Variacao pct={total.variacao} escuro titulo={total.variacao === null ? 'Uma das lojas não tem base de comparação' : undefined} /> {rotulo}<br />
                {total.pedidos} pedidos · tíquete {brl(total.ticket)}
              </span>
            </a>
            {mostradas.map((l) => (
              <button key={l.tenantId} onClick={() => abrir(l)}
                className="rounded-xl border border-zinc-200 bg-white p-3.5 text-left cursor-pointer hover:border-zinc-300 hover:-translate-y-px transition-all flex flex-col">
                <span className="flex items-center gap-1.5 min-w-0">
                  <PontoLoja cor={cores[l.tenantId]} />
                  <span className="text-[13px] font-black text-zinc-800 truncate flex-1">{l.nome}</span>
                  <EtiquetaDia loja={l} />
                </span>
                <span className="flex items-center gap-2 mt-2">
                  <span className="text-[20px] font-black tracking-tight text-zinc-900 tabular-nums">{brl(l.atual.faturamento)}</span>
                  <Variacao pct={l.variacao} titulo={rotuloComparacao('hoje', l)} />
                </span>
                <Mini loja={l} cor={cores[l.tenantId]} />
                <MetaBarra loja={l} cor={cores[l.tenantId]} />
                <span className="text-[11.5px] text-zinc-500 mt-2 leading-relaxed">
                  {l.atual.pedidos} pedidos · tíquete {brl(l.atual.ticket)} · <MetaTexto loja={l} /><br />
                  <AgoraTexto loja={l} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {(paradas.length > 0 || ocultas.length > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-3 text-xs text-zinc-400 font-semibold">
          {paradas.length > 0 && (
            <button onClick={() => setVerParadas((v) => !v)} className="inline-flex items-center gap-1 hover:text-zinc-600 cursor-pointer text-left">
              <i className={verParadas ? 'ri-arrow-up-s-line' : 'ri-add-line'} />
              {verParadas
                ? `${paradas.map((l) => l.nome).join(' · ')} — sem vendas em 30 dias`
                : `${paradas.length} ${paradas.length === 1 ? 'loja' : 'lojas'} sem vendas em 30 dias`}
            </button>
          )}
          {ocultas.length > 0 && (
            <button onClick={() => setEscolher(true)} className="inline-flex items-center gap-1 hover:text-zinc-600 cursor-pointer">
              <i className="ri-eye-off-line" /> {ocultas.length} {ocultas.length === 1 ? 'escondida' : 'escondidas'} por você
            </button>
          )}
        </div>
      )}

      {escolher && <EscolherLojasModal lojas={lojas} cores={cores} onOcultar={setOculta} onFechar={() => setEscolher(false)} />}
    </section>
  );
}
