import { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCardapio } from '@/contexts/CardapioContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { supabase } from '@/lib/supabase';
import { todayBrasilia } from '@/lib/dateUtils';
import { custoLinhaFicha } from '@/lib/unitConversion';
import { useCmvReport, useCmvMensal, esquecerCmvMensal, type CmvReportData } from '@/hooks/useCmvReport';
import {
  faixaCmv, resumoCmv, tituloSemFicha, semFichaQueMaisVendem, fichasParaConferir, ordenarPor, lerLinhaCmv,
  descreverPeriodo, rotaDaFicha, montarCsvCmv, evolucaoMensal, normalizarNome,
  podeAplicarFichas, COBERTURA_MINIMA_PCT, CMV_BOM_ATE, CMV_ATENCAO_ATE,
  type FaixaCmv, type LinhaCmv, type ResumoCmv, type OrdenacaoCmv, type DescricaoPeriodo, type MotivoConferir,
} from '@/lib/cmvRegras';
import FichasVendasPassadasModal from './FichasVendasPassadasModal';
import {
  btn, CartaoAcao, CartaoBarra, Chips, Faixa, Nota, Pagina, SecaoTitulo, Vazio, brl, brlInteiro,
  type OpcaoChip, type TomNumero,
} from './ui/EstoqueUi';

// Estoque › Custo › CMV e fichas (layout novo, 2026-10-04): começa pelo que dá para resolver — fazer a ficha
// dos pratos que mais vendem e conferir ficha com custo estranho — e só depois vêm os números (vendido × por prato).
// "CMV" = quanto do preço de venda vai em ingrediente. Só vale para os pratos COM ficha técnica.
// Números do "Vendido (realizado)": RPC fn_get_cmv_report (custo gravado na venda); a conta está em src/lib/cmvRegras.ts.

type SubTab = 'teorico' | 'realizado';
type FiltroFicha = 'todos' | 'com' | 'sem';

const PERIODOS = [
  { key: 'Hoje', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'Mês', label: 'Este mês' },
  { key: '3m', label: '3 meses' },
];

const ORDENACOES: { id: OrdenacaoCmv; label: string }[] = [
  { id: 'receita_desc', label: 'Mais vendidos' },
  { id: 'cmv_desc', label: 'Maior CMV' },
  { id: 'cmv_asc', label: 'Menor CMV' },
  { id: 'margem_desc', label: 'Maior margem' },
  { id: 'nome', label: 'Nome' },
];

// ── Formatação e a régua de cores (uma só: até 30% verde · 30–35% âmbar · acima de 35% vermelho) ──
const pct = (v: number | null | undefined, casas = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(casas).replace('.', ',')}%`);
const qtd = (q: number) => q.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const COR_TEXTO: Record<FaixaCmv, string> = { bom: 'text-emerald-700', atencao: 'text-amber-600', revisar: 'text-red-600' };
const COR_CHIP: Record<FaixaCmv, string> = { bom: 'text-emerald-700 bg-emerald-50', atencao: 'text-amber-700 bg-amber-50', revisar: 'text-red-600 bg-red-50' };
const COR_BARRA: Record<FaixaCmv, string> = { bom: 'bg-emerald-500', atencao: 'bg-amber-400', revisar: 'bg-red-500' };
const TOM_FAIXA: Record<FaixaCmv, TomNumero> = { bom: 'green', atencao: 'amber', revisar: 'red' };

function CmvChip({ valor }: { valor: number }) {
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold ${COR_CHIP[faixaCmv(valor)]}`}>{pct(valor)}</span>;
}
function BarraCmv({ valor, className = 'w-20 h-2' }: { valor: number; className?: string }) {
  return (
    <div className={`${className} bg-zinc-100 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full ${COR_BARRA[faixaCmv(valor)]}`} style={{ width: `${Math.max(0, Math.min(valor, 100))}%` }} />
    </div>
  );
}
function LegendaCmv({ className = '' }: { className?: string }) {
  const itens: Array<[string, string]> = [
    ['bg-emerald-500', `até ${CMV_BOM_ATE}% bom`],
    ['bg-amber-400', `${CMV_BOM_ATE}–${CMV_ATENCAO_ATE}% atenção`],
    ['bg-red-500', `acima de ${CMV_ATENCAO_ATE}% revisar`],
  ];
  return (
    <div className={`flex items-center gap-x-3.5 gap-y-1 flex-wrap text-[12px] text-zinc-500 ${className}`}>
      {itens.map(([cor, texto]) => <span key={texto} className="inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${cor}`} />{texto}</span>)}
    </div>
  );
}

const Carregando = ({ texto }: { texto: string }) => (
  <div className="bg-white border border-zinc-200 rounded-2xl py-10 text-center">
    <div className="w-6 h-6 mx-auto mb-2 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
    <span className="text-zinc-400 text-sm">{texto}</span>
  </div>
);

// ── Período (vale para o topo e para a tabela) ──────────────────────────────────────────
function BarraPeriodo({ periodo, onPeriodo, onAtualizar, carregando }: {
  periodo: string; onPeriodo: (p: string) => void; onAtualizar: () => void; carregando: boolean;
}) {
  const [abrirCustom, setAbrirCustom] = useState(false);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const ehCustom = periodo.startsWith('custom:');
  const rotuloCustom = (() => {
    if (!ehCustom) return 'Período';
    const [, a, b] = periodo.split(':');
    return `${a.slice(8, 10)}/${a.slice(5, 7)} a ${b.slice(8, 10)}/${b.slice(5, 7)}`;
  })();
  const invertido = !!de && !!ate && de > ate;
  const opcoes: OpcaoChip<string>[] = [...PERIODOS.map((p) => ({ id: p.key, rotulo: p.label })), { id: 'custom', rotulo: rotuloCustom }];

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 overflow-hidden">
          <Chips<string> opcoes={opcoes} valor={ehCustom ? 'custom' : periodo}
            onChange={(v) => { if (v === 'custom') setAbrirCustom((a) => !a); else { setAbrirCustom(false); onPeriodo(v); } }} />
        </div>
        <button type="button" onClick={onAtualizar} className={btn('out', 'sm')} title="Atualizar">
          <i className={`ri-refresh-line text-sm ${carregando ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>
      {abrirCustom && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input type="date" value={de} max={todayBrasilia()} onChange={(e) => setDe(e.target.value)}
            className="h-10 text-sm border border-zinc-200 bg-white rounded-xl px-3 focus:outline-none focus:border-amber-400" />
          <span className="text-xs text-zinc-400">até</span>
          <input type="date" value={ate} max={todayBrasilia()} onChange={(e) => setAte(e.target.value)}
            className="h-10 text-sm border border-zinc-200 bg-white rounded-xl px-3 focus:outline-none focus:border-amber-400" />
          <button type="button" disabled={!de || !ate || invertido} className={btn('p', 'sm')}
            onClick={() => { onPeriodo(`custom:${de}:${ate}`); setAbrirCustom(false); }}>
            Aplicar
          </button>
          {invertido && <span className="text-xs text-red-600">A data inicial vem depois da final.</span>}
        </div>
      )}
    </div>
  );
}

// ── Topo: falta ficha ──────────────────────────────────────────────────────────────────
function AvisoSemFicha({ resumo, linhas, desc, podeFicha, podeAplicar, onFicha, onVerSemFicha, onAplicar }: {
  resumo: ResumoCmv; linhas: LinhaCmv[]; desc: DescricaoPeriodo; podeFicha: boolean; podeAplicar: boolean;
  onFicha: (l: LinhaCmv) => void; onVerSemFicha: () => void; onAplicar: () => void;
}) {
  const cobertura = resumo.coberturaReceitaPct ?? 0;
  const top = semFichaQueMaisVendem(linhas, 4);
  return (
    <CartaoAcao tom="alerta" icone="ri-file-warning-line" titulo={tituloSemFicha(cobertura, desc.frase)}
      acoes={<>
        <button type="button" className={btn('out', 'sm')} onClick={onVerSemFicha}>Ver os {resumo.semFicha} sem ficha</button>
        {podeAplicar && <button type="button" className={btn('out', 'sm')} onClick={onAplicar}>Depois de fazer: aplicar nas vendas passadas</button>}
      </>}>
      <p>
        <b className="text-zinc-800">{brlInteiro(resumo.receitaSemFicha)} de {brlInteiro(resumo.receitaTotal)}</b> {desc.frase} ({Math.round(100 - cobertura)}%) foram de pratos sem ficha técnica.
        {' '}Sem ficha, a venda <b className="text-zinc-800">não baixa o estoque</b> e o CMV parece menor do que é.
      </p>
      {top.length > 0 && (
        <div className="mt-2.5 bg-white border border-red-100 rounded-xl px-3 divide-y divide-zinc-100">
          {top.map((l) => (
            <div key={l.chave} className="flex items-center gap-2 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-bold text-zinc-800 truncate">{l.item_name}</p>
                <p className="text-[11.5px] text-zinc-400">{qtd(l.qtd_vendida)} vendidos · {brl(l.receita_total)}</p>
              </div>
              {podeFicha && <button type="button" className={btn('p', 'sm')} onClick={() => onFicha(l)}>Fazer ficha</button>}
            </div>
          ))}
        </div>
      )}
      {!podeFicha && <p className="mt-2 text-[11.5px] text-zinc-500">Para fazer a ficha, peça a quem edita o Cardápio.</p>}
    </CartaoAcao>
  );
}

// ── Topo: CMV do período ───────────────────────────────────────────────────────────────
function CartaoCmvPeriodo({ resumo, desc }: { resumo: ResumoCmv; desc: DescricaoPeriodo }) {
  const faixa = resumo.cmvPct == null ? null : faixaCmv(resumo.cmvPct);
  return (
    <div>
      <SecaoTitulo titulo={desc.titulo}
        ajuda={<>CMV é quanto do preço de venda vai em ingrediente. Se um prato vende por R$ 40 e leva R$ 12 de ingredientes, o CMV dele é 30%.</>} />
      <div className="bg-white border border-zinc-200 rounded-2xl p-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="min-w-0">
            <p className={`text-[20px] sm:text-2xl font-extrabold leading-tight tabular-nums ${faixa ? COR_TEXTO[faixa] : 'text-zinc-400'}`}>{pct(resumo.cmvPct)}</p>
            <p className="text-[11.5px] font-bold text-zinc-400">CMV dos pratos com ficha</p>
          </div>
          <div className="min-w-0">
            <p className="text-[20px] sm:text-2xl font-extrabold leading-tight tabular-nums text-zinc-900">{resumo.comFicha} / {resumo.pratos}</p>
            <p className="text-[11.5px] font-bold text-zinc-400">pratos vendidos com ficha</p>
          </div>
          <div className="min-w-0">
            <p className="text-[20px] sm:text-2xl font-extrabold leading-tight tabular-nums text-zinc-900 truncate">{brlInteiro(resumo.receitaComFicha)}</p>
            <p className="text-[11.5px] font-bold text-zinc-400">receita com ficha</p>
          </div>
        </div>
        <LegendaCmv className="mt-3" />
        <p className="text-[12.5px] text-zinc-500 leading-relaxed mt-1.5">
          <b className="text-zinc-800">Este número só vale para os pratos com ficha</b>; os sem ficha ficam de fora da conta, para não baixar a média.
        </p>
        {resumo.cmvPct == null && <p className="text-[12.5px] text-amber-700 mt-1.5">Nenhum prato com ficha foi vendido {desc.frase}: ainda não dá para calcular o CMV.</p>}
      </div>
    </div>
  );
}

// ── Topo: ficha para conferir ──────────────────────────────────────────────────────────
function FichasConferir({ linhas, resumo, desc, podeFicha, onFicha }: {
  linhas: LinhaCmv[]; resumo: ResumoCmv; desc: DescricaoPeriodo; podeFicha: boolean; onFicha: (l: LinhaCmv) => void;
}) {
  const [todas, setTodas] = useState(false);
  const lista = useMemo(() => fichasParaConferir(linhas), [linhas]);
  const visiveis = todas ? lista : lista.slice(0, 4);

  const detalhe = (l: LinhaCmv, motivo: MotivoConferir) => {
    const custoUn = l.qtd_vendida > 0 ? l.custo_total / l.qtd_vendida : 0;
    const precoUn = l.qtd_vendida > 0 ? l.receita_total / l.qtd_vendida : 0;
    if (motivo === 'custo_zero') return <>custo {brl(0)} · <em className="not-italic font-extrabold text-amber-700">algum insumo sem preço, ou venda de antes da ficha</em></>;
    if (motivo === 'custo_maior') return <>custo {brl(custoUn)} · preço {brl(precoUn)} · <em className="not-italic font-extrabold text-red-600">custo maior que o preço</em></>;
    return <>custo {brl(custoUn)} · preço {brl(precoUn)} · <em className="not-italic font-extrabold text-red-600">CMV {pct(l.cmv_pct, 0)}</em></>;
  };

  return (
    <div>
      <SecaoTitulo titulo="Ficha para conferir" n={lista.length} tomN={lista.length ? 'amber' : 'zinc'}
        ajuda={<>Pratos com ficha e custo estranho: custo maior que o preço, custo zero (algum insumo está sem preço) ou CMV acima de 50%. Abra a ficha e confira as quantidades e os preços dos insumos.</>} />
      {resumo.comFicha === 0 ? (
        <CartaoBarra cor="zinc"><p className="text-[13px] text-zinc-500">Nenhum prato com ficha foi vendido {desc.frase}: não há ficha para conferir.</p></CartaoBarra>
      ) : lista.length === 0 ? (
        <CartaoBarra cor="green">
          <p className="text-[13.5px] font-bold text-zinc-800">Nenhuma ficha com custo estranho {desc.frase}</p>
          <p className="text-[11.5px] text-zinc-400 mt-0.5">Conferi: CMV acima de 50%, custo maior que o preço e custo zero.</p>
        </CartaoBarra>
      ) : (
        <CartaoBarra cor="amber">
          <div className="divide-y divide-zinc-100">
            {visiveis.map(({ linha, motivo }) => (
              <div key={linha.chave} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-bold text-zinc-800 truncate">{linha.item_name}</p>
                  <p className="text-[11.5px] text-zinc-500 leading-snug">{detalhe(linha, motivo)}</p>
                </div>
                {podeFicha && <button type="button" className={btn('out', 'sm')} onClick={() => onFicha(linha)}>Abrir ficha</button>}
              </div>
            ))}
          </div>
          {lista.length > 4 && (
            <button type="button" className={`${btn('ghost', 'sm')} mt-2`} onClick={() => setTodas((t) => !t)}>
              {todas ? 'Mostrar menos' : `Ver as ${lista.length}`}
            </button>
          )}
          {!podeFicha && <p className="mt-2 text-[11.5px] text-zinc-500">Para abrir a ficha, peça a quem edita o Cardápio.</p>}
        </CartaoBarra>
      )}
    </div>
  );
}

// ── Gráfico CMV mensal (últimos 12 meses) ──────────────────────────────────────────────
function GraficoCmvMensal({ versao }: { versao: number }) {
  const { dados, falhas, loading, recarregar } = useCmvMensal(versao);
  const [ativo, setAtivo] = useState<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  // Toque numa barra mostra o valor; tocar fora fecha
  useEffect(() => {
    if (!ativo) return;
    const fora = (e: Event) => { if (!raiz.current?.contains(e.target as Node)) setAtivo(null); };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [ativo]);

  // Os meses lidos (e os que falharam), do mais antigo ao atual
  const meses = useMemo(() => [...new Set([...dados.map((d) => d.mes), ...falhas])].sort(), [dados, falhas]);
  const cabecalho = (
    <div>
      <h3 className="text-sm font-extrabold text-zinc-900">Evolução do CMV — últimos 12 meses</h3>
      <p className="text-xs text-zinc-400">Custo ÷ venda dos pratos com ficha, mês a mês</p>
    </div>
  );

  if (loading && dados.length === 0) return <Carregando texto="Carregando histórico..." />;

  if (dados.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-red-200 p-5">
        {cabecalho}
        <p className="text-sm text-red-600 mt-3">Não consegui ler o histórico dos últimos 12 meses. Confira a internet e tente de novo.</p>
        <button type="button" onClick={recarregar} className={`${btn('dark', 'sm')} mt-3`}>Tentar de novo</button>
      </div>
    );
  }

  const semVenda = dados.every((d) => d.receitaTotal === 0);
  const semFichaNenhum = !semVenda && dados.every((d) => d.cmv_pct == null);
  if (semVenda || semFichaNenhum) {
    return (
      <Vazio icone="ri-bar-chart-line" titulo={semVenda ? 'Sem vendas nos últimos 12 meses' : 'Nenhum mês com prato que tenha ficha'}>
        {semVenda ? 'Quando houver vendas, o CMV de cada mês aparece aqui.' : 'Faça a ficha dos pratos que mais vendem para ver o CMV mês a mês.'}
      </Vazio>
    );
  }

  const valores = dados.map((d) => d.cmv_pct).filter((v): v is number => v != null);
  const maxCmv = Math.max(...valores, 50);
  const CHART_H = 120;
  const mesLabel = (mes: string) => new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const mesLongo = (mes: string) => new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const ev = evolucaoMensal(dados);
  const primeiroComCmv = dados.find((d) => d.cmv_pct != null);

  return (
    <div ref={raiz} className="bg-white rounded-2xl border border-zinc-200 p-4 md:p-5">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        {cabecalho}
        <LegendaCmv />
      </div>

      <div className="relative" style={{ height: CHART_H + 32 }}>
        {[0, CMV_BOM_ATE, CMV_ATENCAO_ATE, 50].map((p) => {
          if (p > maxCmv + 5) return null;
          const y = CHART_H - (p / maxCmv) * CHART_H;
          return (
            <div key={p} className="absolute left-0 right-0 flex items-center gap-1" style={{ top: y }}>
              <span className="text-[9px] text-zinc-400 w-7 text-right flex-shrink-0 -mt-0.5">{p}%</span>
              <div className={`flex-1 border-t ${p === CMV_BOM_ATE ? 'border-emerald-300 border-dashed' : p === CMV_ATENCAO_ATE ? 'border-red-300 border-dashed' : 'border-zinc-100'}`} />
            </div>
          );
        })}

        <div className="absolute left-8 right-0 top-0" style={{ height: CHART_H }}>
          <div className="flex items-end gap-1 h-full">
            {meses.map((mes, i) => {
              const d = dados.find((x) => x.mes === mes);
              const falhou = falhas.includes(mes);
              const valor = d?.cmv_pct ?? null;
              const altura = valor == null ? 4 : Math.max((valor / maxCmv) * CHART_H, 4);
              const cor = valor == null ? (falhou ? 'bg-red-100' : 'bg-zinc-200') : COR_BARRA[faixaCmv(valor)];
              const aberto = ativo === mes;
              // tooltip alinhado para não sair da caixa nas pontas
              const lado = i < 3 ? 'left-0 items-start' : i > meses.length - 4 ? 'right-0 items-end' : 'left-1/2 -translate-x-1/2 items-center';
              const alternar = () => setAtivo((a) => (a === mes ? null : mes));
              // A coluna inteira recebe o toque (barra de 4 px é difícil de acertar no celular)
              return (
                <div key={mes} role="button" tabIndex={0}
                  aria-label={`${mesLongo(mes)}: ${falhou ? 'não consegui ler' : valor == null ? 'sem CMV' : `CMV ${pct(valor)}`}`}
                  onClick={alternar}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } }}
                  className="flex-1 flex flex-col items-center justify-end group relative h-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded">
                  <div className={`absolute ${aberto ? 'flex' : 'hidden group-hover:flex'} flex-col z-10 pointer-events-none ${lado}`} style={{ bottom: altura + 4 }}>
                    <div className="bg-zinc-800 text-white text-[10px] rounded-lg px-2 py-1.5 whitespace-nowrap shadow-lg">
                      <p className="font-bold capitalize">{mesLongo(mes)}</p>
                      {falhou ? <p className="text-red-300">Não consegui ler este mês</p>
                        : d && valor != null ? (<>
                          <p>CMV {pct(valor)}</p>
                          <p className="text-zinc-400">Venda com ficha: {brl(d.receitaComFicha)}</p>
                          {d.coberturaPct != null && <p className="text-zinc-400">{Math.round(d.coberturaPct)}% da venda tem ficha</p>}
                        </>)
                        : <p className="text-zinc-400">{d && d.receitaTotal > 0 ? 'Sem prato com ficha' : 'Sem vendas'}</p>}
                    </div>
                  </div>
                  <div className={`w-full rounded-t-md transition-all ${cor} ${i === meses.length - 1 || aberto ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`}
                    style={{ height: altura }} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="absolute left-8 right-0" style={{ top: CHART_H + 4 }}>
          <div className="flex gap-1">
            {meses.map((mes) => (
              <div key={mes} className="flex-1 text-center">
                <span className={`text-[9px] ${falhas.includes(mes) ? 'text-red-500 font-bold' : 'text-zinc-400'}`}>{mesLabel(mes)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {falhas.length > 0 && (
        <div className="mt-3 flex items-center gap-2 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <p className="text-xs text-amber-800 flex-1 min-w-0">Não consegui ler {falhas.length === 1 ? '1 mês' : `${falhas.length} meses`} ({falhas.map(mesLabel).join(', ')}): ele aparece sem barra.</p>
          <button type="button" onClick={recarregar} className={btn('out', 'sm')}>Tentar de novo</button>
        </div>
      )}

      {ev.mediaPct != null && (
        <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center gap-3 flex-wrap">
          {ev.deltaPp != null && primeiroComCmv && (
            <div className="flex items-center gap-1.5">
              <i className={`${ev.deltaPp <= 0 ? 'ri-arrow-down-line text-emerald-500' : 'ri-arrow-up-line text-red-500'} text-sm`} />
              <span className={`text-xs font-bold ${ev.deltaPp <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {ev.deltaPp > 0 ? '+' : ''}{ev.deltaPp.toFixed(1).replace('.', ',')} pontos
              </span>
              <span className="text-xs text-zinc-400">desde {mesLabel(primeiroComCmv.mes)}</span>
            </div>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[10px] text-zinc-400">Média dos meses:</span>
            <span className={`text-xs font-bold ${COR_TEXTO[faixaCmv(ev.mediaPct)]}`}>{pct(ev.mediaPct)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Vendido (realizado) ────────────────────────────────────────────────────────────────
function CmvRealizado({ data, resumo, filtro, onFiltro, versaoGrafico, podeFicha, onFicha, esconderAvisoSem }: {
  data: CmvReportData; resumo: ResumoCmv; filtro: FiltroFicha; onFiltro: (f: FiltroFicha) => void;
  versaoGrafico: number; podeFicha: boolean; onFicha: (l: LinhaCmv) => void; esconderAvisoSem: boolean;
}) {
  const [ordenacao, setOrdenacao] = useState<OrdenacaoCmv>('receita_desc');
  const [busca, setBusca] = useState('');
  const linhas = data.linhas;

  // Filtro e busca só mudam o que aparece na tabela; os totais (cartões, rodapé, CSV) são sempre do período todo.
  const visiveis = useMemo(() => {
    const q = normalizarNome(busca);
    const base = linhas.filter((l) => (filtro === 'todos' || (filtro === 'com' ? l.tem_ficha : !l.tem_ficha)) && (!q || normalizarNome(l.item_name).includes(q)));
    return ordenarPor(base, ordenacao, lerLinhaCmv);
  }, [linhas, filtro, busca, ordenacao]);
  const filtrando = visiveis.length !== linhas.length;

  const exportarCSV = () => {
    if (linhas.length === 0) return;
    // O CSV leva o período todo, na ordem escolhida, com o mesmo rodapé da tela
    const csv = montarCsvCmv(ordenarPor(linhas, ordenacao, lerLinhaCmv), resumo);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cmv_realizado_${data.periodo_de}_${data.periodo_ate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const opcoesFiltro: OpcaoChip<FiltroFicha>[] = [
    { id: 'todos', rotulo: 'Todos', n: resumo.pratos },
    { id: 'com', rotulo: 'Com ficha', n: resumo.comFicha },
    { id: 'sem', rotulo: 'Sem ficha', n: resumo.semFicha, tom: resumo.semFicha > 0 ? 'amber' : undefined },
  ];
  const faixaGeral = resumo.cmvPct == null ? 'neutro' : TOM_FAIXA[faixaCmv(resumo.cmvPct)];

  return (
    <div className="space-y-4">
      <Faixa itens={[
        { valor: brl(resumo.receitaTotal), rotulo: 'receita do período', ajuda: `Venda de todos os pratos, com e sem ficha. ${resumo.pratos} pratos vendidos.` },
        { valor: brl(resumo.custoComFicha), rotulo: 'custo total (CMV)', ajuda: `Custo gravado nas vendas dos ${resumo.comFicha} pratos com ficha técnica.` },
        { valor: pct(resumo.cmvPct), rotulo: 'CMV realizado', tom: faixaGeral, ajuda: 'Custo ÷ receita, só dos pratos com ficha. Prato sem ficha não tem custo conhecido e fica de fora.' },
        { valor: brl(resumo.margemComFicha), rotulo: 'margem bruta', tom: resumo.margemComFicha >= 0 ? 'green' : 'red', ajuda: 'Receita − custo direto, só dos pratos com ficha.' },
      ]} />

      <GraficoCmvMensal versao={versaoGrafico} />

      {resumo.semFicha > 0 && !esconderAvisoSem && (
        <Nota className="flex items-center gap-2 flex-wrap">
          <span className="flex-1 min-w-0"><b>{resumo.semFicha} prato{resumo.semFicha > 1 ? 's' : ''}</b> vendido{resumo.semFicha > 1 ? 's' : ''} sem ficha técnica: o custo {resumo.semFicha > 1 ? 'deles' : 'dele'} não entra no CMV.</span>
          <button type="button" className={btn('out', 'sm')} onClick={() => onFiltro('sem')}>Ver só os sem ficha</button>
        </Nota>
      )}

      {linhas.length === 0 ? (
        <Vazio icone="ri-bar-chart-grouped-line" titulo="Sem vendas no período">Escolha outro período para ver o CMV vendido.</Vazio>
      ) : (
        <div id="cmv-tabela" className="space-y-3 scroll-mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item vendido..."
                className="w-full h-10 rounded-xl border border-zinc-200 pl-9 pr-3 text-sm bg-white text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400" />
            </div>
            <select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as OrdenacaoCmv)} aria-label="Ordenar por"
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer">
              {ORDENACOES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button type="button" onClick={exportarCSV} className={`${btn('out', 'sm')} ml-auto`}>
              <i className="ri-download-line text-sm" /> Exportar CSV
            </button>
          </div>
          <Chips<FiltroFicha> opcoes={opcoesFiltro} valor={filtro} onChange={onFiltro} />
          {filtrando && <p className="text-[11px] text-zinc-400 px-1">Mostrando {visiveis.length} de {linhas.length} pratos. Os totais são sempre do período todo.</p>}

          {visiveis.length === 0 ? (
            <Vazio icone="ri-search-line" titulo="Nenhum item encontrado">Mude a busca ou o filtro.</Vazio>
          ) : (
            <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
              {/* Computador: tabela */}
              <div className="hidden md:block overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                <table className="w-full text-xs">
                  <thead className="border-b border-zinc-200">
                    <tr>
                      <th className="pl-5 pr-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Item</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Qtd vendida</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Receita</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Custo total</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">CMV %</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Margem R$</th>
                      <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Margem %</th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 w-28">Barra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100/80">
                    {visiveis.map((l) => (
                      <tr key={l.chave} className="hover:bg-zinc-50 transition-colors">
                        <td className="pl-5 pr-4 py-3">
                          <p className="font-medium text-zinc-800 truncate max-w-[240px]" title={l.item_name}>{l.item_name}</p>
                          {l.categoria && <p className="text-[10px] text-zinc-400">{l.categoria}</p>}
                          {!l.tem_ficha && (
                            <p className="text-[10px] text-amber-600 italic">
                              Sem ficha técnica
                              {podeFicha && <> · <button type="button" className="not-italic font-bold text-amber-700 hover:underline cursor-pointer" onClick={() => onFicha(l)}>Fazer ficha</button></>}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center"><span className="font-semibold text-zinc-700">{qtd(l.qtd_vendida)}</span></td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-800">{brl(l.receita_total)}</td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-zinc-600">{l.tem_ficha ? brl(l.custo_total) : <span className="text-zinc-300">—</span>}</td>
                        <td className="px-4 py-3 text-center">{l.tem_ficha ? <CmvChip valor={l.cmv_pct} /> : <span className="text-zinc-300">—</span>}</td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                          {l.tem_ficha ? <span className={`font-bold ${l.margem_bruta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{brl(l.margem_bruta)}</span> : <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">{l.tem_ficha ? <span className="font-semibold text-zinc-700">{pct(l.margem_pct)}</span> : <span className="text-zinc-300">—</span>}</td>
                        <td className="px-4 py-3">{l.tem_ficha ? <BarraCmv valor={l.cmv_pct} /> : <span className="text-zinc-300 text-[10px]">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Totais do período todo: só os pratos com ficha entram na conta */}
                  <tfoot>
                    {resumo.comFicha > 0 && (
                      <tr className="bg-zinc-50 border-t-2 border-zinc-200">
                        <td className="pl-5 pr-4 py-3 font-bold text-zinc-900 text-xs">Total do período ({resumo.comFicha} pratos com ficha)</td>
                        <td className="px-4 py-3 text-center font-bold text-zinc-700">{qtd(resumo.qtdComFicha)}</td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-bold text-zinc-900">{brl(resumo.receitaComFicha)}</td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-bold text-zinc-900">{brl(resumo.custoComFicha)}</td>
                        <td className="px-4 py-3 text-center">{resumo.cmvPct != null && <CmvChip valor={resumo.cmvPct} />}</td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-bold text-emerald-700">{brl(resumo.margemComFicha)}</td>
                        <td className="px-4 py-3 text-center font-bold text-zinc-700">{pct(resumo.margemPct)}</td>
                        <td />
                      </tr>
                    )}
                    {resumo.semFicha > 0 && (
                      <tr className="bg-amber-50/50 border-t border-zinc-200">
                        <td className="pl-5 pr-4 py-2.5 text-xs text-amber-800">Sem ficha ({resumo.semFicha} pratos) — fora do CMV</td>
                        <td className="px-4 py-2.5 text-center font-semibold text-zinc-600">{qtd(resumo.qtdSemFicha)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-700">{brl(resumo.receitaSemFicha)}</td>
                        <td colSpan={5} />
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>

              {/* Celular: cartões */}
              <div className="md:hidden divide-y divide-zinc-100/80">
                {visiveis.map((l) => (
                  <div key={l.chave} className="p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-zinc-800 truncate">{l.item_name}</p>
                        {l.categoria && <p className="text-[10px] text-zinc-400">{l.categoria}</p>}
                        {!l.tem_ficha && <p className="text-[10px] text-amber-600 italic">Sem ficha técnica</p>}
                      </div>
                      {l.tem_ficha ? <span className="flex-shrink-0"><CmvChip valor={l.cmv_pct} /></span> : podeFicha
                        ? <button type="button" className={`${btn('p', 'sm')} flex-shrink-0`} onClick={() => onFicha(l)}>Fazer ficha</button>
                        : <span className="text-zinc-300 text-[10px]">—</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div><p className="text-[10px] text-zinc-400">Receita</p><p className="text-xs font-bold text-zinc-800">{brl(l.receita_total)}</p></div>
                      <div><p className="text-[10px] text-zinc-400">Custo</p><p className="text-xs font-bold text-zinc-700">{l.tem_ficha ? brl(l.custo_total) : '—'}</p></div>
                      <div>
                        <p className="text-[10px] text-zinc-400">Margem</p>
                        <p className={`text-xs font-bold ${l.tem_ficha ? (l.margem_bruta >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-zinc-300'}`}>{l.tem_ficha ? brl(l.margem_bruta) : '—'}</p>
                      </div>
                      <div><p className="text-[10px] text-zinc-400">Qtd vendida</p><p className="text-xs font-bold text-zinc-700">{qtd(l.qtd_vendida)}</p></div>
                    </div>
                    {l.tem_ficha && <BarraCmv valor={l.cmv_pct} className="w-full h-1.5" />}
                  </div>
                ))}
                {/* Totais do período todo */}
                {resumo.comFicha > 0 && (
                  <div className="p-3 bg-zinc-50 border-t-2 border-zinc-200">
                    <p className="text-xs font-bold text-zinc-700 mb-2">Total do período — {resumo.comFicha} pratos com ficha</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div><p className="text-[10px] text-zinc-400">Receita</p><p className="text-xs font-bold text-zinc-800">{brl(resumo.receitaComFicha)}</p></div>
                      <div><p className="text-[10px] text-zinc-400">Custo</p><p className="text-xs font-bold text-zinc-800">{brl(resumo.custoComFicha)}</p></div>
                      <div><p className="text-[10px] text-zinc-400">CMV</p>{resumo.cmvPct != null ? <CmvChip valor={resumo.cmvPct} /> : <p className="text-xs">—</p>}</div>
                      <div><p className="text-[10px] text-zinc-400">Margem bruta</p><p className="text-xs font-bold text-emerald-700">{brl(resumo.margemComFicha)} ({pct(resumo.margemPct)})</p></div>
                      <div><p className="text-[10px] text-zinc-400">Qtd total</p><p className="text-xs font-bold text-zinc-700">{qtd(resumo.qtdComFicha)}</p></div>
                    </div>
                  </div>
                )}
                {resumo.semFicha > 0 && (
                  <div className="px-3 py-2.5 bg-amber-50/50 text-xs text-amber-800">
                    Sem ficha ({resumo.semFicha} pratos), fora do CMV: <b>{qtd(resumo.qtdSemFicha)}</b> vendidos · <b>{brl(resumo.receitaSemFicha)}</b>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Por prato (teórico) ────────────────────────────────────────────────────────────────

interface ItemCMVTeorico {
  id: string;
  nome: string;
  preco: number;
  custo: number;
  cmvPct: number;
  margemBruta: number;
  margemPct: number;
  temFicha: boolean;
}

function NumeroComNome({ valor, rotulo, nome, cor = 'text-zinc-900' }: { valor: string; rotulo: string; nome?: string; cor?: string }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-2.5 min-w-0">
      <p className={`text-xl font-extrabold leading-tight tabular-nums ${cor}`}>{valor}</p>
      <p className="text-[11px] font-semibold text-zinc-400">{rotulo}</p>
      {nome && <p className="text-[12px] text-zinc-600 truncate" title={nome}>{nome}</p>}
    </div>
  );
}

function CmvTeorico() {
  const { itensAtivos, loading: loadingCardapio } = useCardapio();
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [ordenacao, setOrdenacao] = useState<OrdenacaoCmv>('cmv_desc');
  const [busca, setBusca] = useState('');
  const [fichaMap, setFichaMap] = useState<Map<string, number>>(new Map());
  const [loadingFicha, setLoadingFicha] = useState(false);
  const [erroFicha, setErroFicha] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  // Custo de cada prato pela ficha de hoje: RPC (passa por cima do RLS com segurança) e, se falhar, leitura direta.
  const itemIdsKey = itensAtivos.map((i) => i.id).sort().join(',');
  useEffect(() => {
    if (!tenantId || !itemIdsKey) return;
    const itemIds = itemIdsKey.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (itemIds.length === 0) return;
    let vivo = true;
    setLoadingFicha(true);
    setErroFicha(null);
    (async () => {
      try {
        const map = new Map<string, number>();
        const { data: rows, error } = await supabase.rpc('fn_get_item_ingredients_batch', { p_tenant_id: tenantId, p_item_ids: itemIds });
        if (!error) {
          // A RPC devolve linhas planas: { item_id, quantity, unit, unit_price, ingredient_unit }
          for (const row of (rows ?? []) as Array<{ item_id: string; quantity: number; unit?: string | null; unit_price?: number; ingredient_unit?: string | null }>) {
            map.set(row.item_id, (map.get(row.item_id) ?? 0) + custoLinhaFicha(row.quantity, row.unit, row.ingredient_unit, Number(row.unit_price ?? 0)));
          }
        } else {
          console.error('[CmvTeorico] fn_get_item_ingredients_batch:', error);
          const { data: alt, error: err2 } = await supabase
            .from('item_ingredients')
            .select('item_id, quantity, unit, ingredients!inner(unit_price, unit)')
            .in('item_id', itemIds)
            .eq('tenant_id', tenantId);
          if (err2) throw err2;
          for (const row of (alt ?? []) as unknown as Array<{ item_id: string; quantity: number; unit: string | null; ingredients: { unit_price: number; unit: string | null } | Array<{ unit_price: number; unit: string | null }> | null }>) {
            const ing = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
            map.set(row.item_id, (map.get(row.item_id) ?? 0) + custoLinhaFicha(row.quantity, row.unit, ing?.unit, Number(ing?.unit_price ?? 0)));
          }
        }
        if (vivo) setFichaMap(map);
      } catch (e) {
        // Sem ler a ficha, todo prato pareceria "sem ficha": melhor dizer que não deu
        console.error('[CmvTeorico]', e);
        if (vivo) { setFichaMap(new Map()); setErroFicha('Não consegui ler as fichas técnicas. Confira a internet e tente de novo.'); }
      } finally {
        if (vivo) setLoadingFicha(false);
      }
    })();
    return () => { vivo = false; };
  }, [tenantId, itemIdsKey, tentativa]);

  const loading = loadingCardapio || loadingFicha;

  const itensCMV: ItemCMVTeorico[] = useMemo(() => {
    return itensAtivos.map((item) => {
      const custo = fichaMap.get(item.id) ?? 0;
      const temFicha = fichaMap.has(item.id);
      const cmvPct = item.preco > 0 && temFicha ? (custo / item.preco) * 100 : 0;
      const margemBruta = item.preco - custo;
      const margemPct = item.preco > 0 ? (margemBruta / item.preco) * 100 : 0;
      return { id: item.id, nome: item.nome, preco: item.preco, custo, cmvPct, margemBruta, margemPct, temFicha };
    });
  }, [itensAtivos, fichaMap]);

  const itensFiltrados = useMemo(() => {
    const q = normalizarNome(busca);
    const base = q ? itensCMV.filter((i) => normalizarNome(i.nome).includes(q)) : itensCMV;
    // Ficha com custo zero (insumo sem preço) conta como sem custo conhecido: nunca vai para o topo de margem/CMV
    return ordenarPor(base, ordenacao, (i) => ({ nome: i.nome, temFicha: i.temFicha && i.custo > 0, cmvPct: i.cmvPct, margemPct: i.margemPct, receita: i.preco }));
  }, [itensCMV, busca, ordenacao]);

  // Os cartões são do cardápio todo (a busca não mexe neles) e só contam prato com custo conhecido
  const comFicha = itensCMV.filter((i) => i.temFicha && i.preco > 0 && i.custo > 0);
  const avgCMV = comFicha.length > 0 ? comFicha.reduce((s, i) => s + i.cmvPct, 0) / comFicha.length : null;
  const melhorMargem = comFicha.length > 0 ? comFicha.reduce((m, i) => (i.margemPct > m.margemPct ? i : m)) : null;
  const piorCMV = comFicha.length > 0 ? comFicha.reduce((m, i) => (i.cmvPct > m.cmvPct ? i : m)) : null;
  const totalComFicha = itensCMV.filter((i) => i.temFicha).length;

  if (loading) return <div className="py-14 text-center"><div className="w-6 h-6 mx-auto border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (erroFicha) return (
    <CartaoAcao tom="alerta" icone="ri-error-warning-line" titulo="Não consegui calcular o CMV por prato"
      acoes={<button type="button" className={btn('dark', 'sm')} onClick={() => setTentativa((t) => t + 1)}>Tentar de novo</button>}>
      {erroFicha}
    </CartaoAcao>
  );
  if (itensAtivos.length === 0) return (
    <Vazio icone="ri-pie-chart-2-line" titulo="Nenhum item no cardápio">Cadastre itens no cardápio para calcular o CMV.</Vazio>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <NumeroComNome valor={pct(avgCMV)} rotulo="CMV médio teórico" cor={avgCMV == null ? 'text-zinc-400' : COR_TEXTO[faixaCmv(avgCMV)]}
          nome={`${totalComFicha} de ${itensCMV.length} itens com ficha`} />
        <NumeroComNome valor={melhorMargem ? pct(melhorMargem.margemPct) : '—'} rotulo="Melhor margem" cor="text-emerald-700" nome={melhorMargem?.nome} />
        <NumeroComNome valor={piorCMV ? pct(piorCMV.cmvPct) : '—'} rotulo="Maior CMV (atenção)" cor={piorCMV ? COR_TEXTO[faixaCmv(piorCMV.cmvPct)] : 'text-zinc-400'} nome={piorCMV?.nome} />
      </div>
      <LegendaCmv className="px-1" />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item..."
            className="w-full h-10 rounded-xl border border-zinc-200 pl-9 pr-3 text-sm bg-white text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400" />
        </div>
        <select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as OrdenacaoCmv)} aria-label="Ordenar por"
          className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer">
          {ORDENACOES.filter((o) => o.id !== 'receita_desc').map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>

      {itensFiltrados.length === 0 ? (
        <Vazio icone="ri-search-line" titulo="Nenhum item encontrado">Mude a busca.</Vazio>
      ) : (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          {/* Computador: tabela */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-zinc-200">
                <tr>
                  <th className="pl-5 pr-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Item</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Preço Venda</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Custo</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">CMV %</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Margem Bruta</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Margem %</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Barra CMV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100/80">
                {itensFiltrados.map((item) => (
                  <tr key={item.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="pl-5 pr-4 py-3">
                      <p className="font-medium text-zinc-800 truncate max-w-[240px]" title={item.nome}>{item.nome}</p>
                      {!item.temFicha && <p className="text-[10px] text-zinc-400 italic">Sem ficha técnica</p>}
                      {item.temFicha && item.custo === 0 && <p className="text-[10px] text-amber-600 italic">Custo zero: algum insumo está sem preço</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-800">{brl(item.preco)}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-zinc-600">{item.temFicha ? brl(item.custo) : <span className="text-zinc-300">—</span>}</td>
                    <td className="px-4 py-3 text-center">{item.temFicha ? <CmvChip valor={item.cmvPct} /> : <span className="text-zinc-300">—</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                      {item.temFicha ? <span className={`font-bold ${item.margemBruta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{brl(item.margemBruta)}</span> : <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">{item.temFicha ? <span className="font-semibold text-zinc-700">{pct(item.margemPct)}</span> : <span className="text-zinc-300">—</span>}</td>
                    <td className="px-4 py-3">{item.temFicha ? <BarraCmv valor={item.cmvPct} className="w-28 h-2" /> : <span className="text-zinc-300 text-[10px]">sem dados</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Celular: cartões */}
          <div className="md:hidden divide-y divide-zinc-100/80">
            {itensFiltrados.map((item) => (
              <div key={item.id} className="p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-800 truncate">{item.nome}</p>
                    {!item.temFicha && <p className="text-[10px] text-zinc-400 italic">Sem ficha técnica</p>}
                    {item.temFicha && item.custo === 0 && <p className="text-[10px] text-amber-600 italic">Custo zero: algum insumo está sem preço</p>}
                  </div>
                  {item.temFicha ? <span className="flex-shrink-0"><CmvChip valor={item.cmvPct} /></span> : <span className="text-zinc-300 text-[10px]">—</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-[10px] text-zinc-400">Preço</p><p className="text-xs font-bold text-zinc-800">{brl(item.preco)}</p></div>
                  <div><p className="text-[10px] text-zinc-400">Custo</p><p className="text-xs font-bold text-zinc-700">{item.temFicha ? brl(item.custo) : '—'}</p></div>
                  <div>
                    <p className="text-[10px] text-zinc-400">Margem</p>
                    <p className={`text-xs font-bold ${item.temFicha ? (item.margemBruta >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-zinc-300'}`}>{item.temFicha ? brl(item.margemBruta) : '—'}</p>
                  </div>
                </div>
                {item.temFicha && <div className="mt-2"><BarraCmv valor={item.cmvPct} className="w-full h-1.5" /></div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Aba principal ──────────────────────────────────────────────────────────────────────

export default function CmvTab() {
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  const navigate = useNavigate();
  const { itens, combos, categorias } = useCardapio();
  const { data, loading, error, load } = useCmvReport();

  const [periodo, setPeriodo] = useState('30d');
  const [subTab, setSubTab] = useState<SubTab>('realizado');
  const [filtro, setFiltro] = useState<FiltroFicha>('todos');
  const [versao, setVersao] = useState(0); // sobe para o gráfico de 12 meses ler de novo
  const [aplicarAberto, setAplicarAberto] = useState(false);

  useEffect(() => { load(periodo); }, [periodo, load]);

  const podeFicha = hasPermissao('cardapio_editar'); // sem isso o Cardápio não abre
  const podeAplicar = podeAplicarFichas(user?.perfil);

  // Ligação prato vendido → item do cardápio (o relatório só traz o nome)
  const refsItens = useMemo(() => {
    const nomeCat = new Map(categorias.map((c) => [c.id, c.nome]));
    return itens.map((i) => ({ id: i.id, nome: i.nome, categoria: nomeCat.get(i.categoriaId) ?? '', ativo: i.status === 'ativo' }));
  }, [itens, categorias]);
  const nomesCombos = useMemo(() => combos.map((c) => c.nome), [combos]);
  const abrirFicha = (l: LinhaCmv) => navigate(rotaDaFicha(l.item_name, l.categoria, refsItens, nomesCombos, l.item_id));

  const linhas = useMemo(() => data?.linhas ?? [], [data]);
  const resumo = useMemo(() => resumoCmv(linhas), [linhas]);
  const desc = data ? descreverPeriodo(data.periodo, data.periodo_de, data.periodo_ate) : null;
  const mostrarAviso = !!data && resumo.coberturaReceitaPct != null && resumo.coberturaReceitaPct < COBERTURA_MINIMA_PCT;

  const atualizar = () => { esquecerCmvMensal(); load(periodo); setVersao((v) => v + 1); };
  const verSemFicha = () => {
    setSubTab('realizado');
    setFiltro('sem');
    setTimeout(() => document.getElementById('cmv-tabela')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const pilulas: Array<[SubTab, string]> = [['realizado', 'Vendido (realizado)'], ['teorico', 'Por prato (teórico)']];

  return (
    <Pagina>
      <BarraPeriodo periodo={periodo} onPeriodo={setPeriodo} onAtualizar={atualizar} carregando={loading} />

      {loading && <Carregando texto="Calculando o CMV do período..." />}

      {!loading && error && (
        <CartaoAcao tom="alerta" icone="ri-error-warning-line" titulo="Não consegui ler o CMV"
          acoes={<button type="button" className={btn('dark', 'sm')} onClick={() => load(periodo)}>Tentar de novo</button>}>
          {error}
        </CartaoAcao>
      )}

      {/* Sem venda no período: quem avisa é a aba "Vendido (realizado)", logo abaixo */}
      {!loading && !error && data && desc && linhas.length > 0 && (
        <>
          {mostrarAviso && (
            <AvisoSemFicha resumo={resumo} linhas={linhas} desc={desc} podeFicha={podeFicha} podeAplicar={podeAplicar}
              onFicha={abrirFicha} onVerSemFicha={verSemFicha} onAplicar={() => setAplicarAberto(true)} />
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
            <CartaoCmvPeriodo resumo={resumo} desc={desc} />
            <FichasConferir linhas={linhas} resumo={resumo} desc={desc} podeFicha={podeFicha} onFicha={abrirFicha} />
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-zinc-100 p-1 rounded-xl max-w-full overflow-x-auto scrollbar-hide">
          {pilulas.map(([id, rotulo]) => (
            <button key={id} type="button" onClick={() => setSubTab(id)}
              className={`h-9 px-3.5 rounded-lg text-[13px] font-bold whitespace-nowrap cursor-pointer transition-colors ${subTab === id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
              {rotulo}
            </button>
          ))}
        </div>
        {/* Com o aviso de falta de ficha na tela, o mesmo botão já está dentro dele */}
        {podeAplicar && !mostrarAviso && (
          <button type="button" className={`${btn('out', 'sm')} ml-auto`} onClick={() => setAplicarAberto(true)}>
            <i className="ri-history-line" /> Aplicar fichas nas vendas passadas
          </button>
        )}
      </div>

      <Nota>
        {subTab === 'realizado'
          ? 'Vendido (realizado) soma as vendas do período com o custo que ficou gravado em cada uma. Prato sem ficha técnica fica de fora da conta do CMV.'
          : 'Por prato (teórico) mostra o custo de uma unidade de cada prato do cardápio, pela ficha de hoje, sem olhar quanto vendeu.'}
      </Nota>

      {subTab === 'realizado' && !loading && !error && data && (
        <CmvRealizado data={data} resumo={resumo} filtro={filtro} onFiltro={setFiltro} versaoGrafico={versao}
          podeFicha={podeFicha} onFicha={abrirFicha} esconderAvisoSem={mostrarAviso} />
      )}
      {subTab === 'teorico' && <CmvTeorico />}

      {aplicarAberto && user?.tenantId && (
        <FichasVendasPassadasModal tenantId={user.tenantId} onFechar={() => setAplicarAberto(false)}
          onAplicado={() => { esquecerCmvMensal(); load(periodo); setVersao((v) => v + 1); }} />
      )}
    </Pagina>
  );
}
