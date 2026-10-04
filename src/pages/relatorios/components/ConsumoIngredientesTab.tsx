import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useConsumoIngredientes, type ConsumoIngrediente } from '@/hooks/useConsumoIngredientes';
import { useEstoqueSituacao } from '@/hooks/useEstoqueSituacao';
import { useEstoqueTelaOpcional } from '@/pages/estoque/EstoqueTela';
import { useAuth } from '@/contexts/AuthContext';
import { todayBrasilia } from '@/lib/dateUtils';
import { fmtQtd, type InsumoSituacao } from '@/lib/estoqueRegras';
import {
  intervaloDoPreset, validarPeriodo, duraInfo, montarCsv,
  type DuraInfo, type PresetPeriodo,
} from '@/lib/consumoInsumos';
import {
  btn, Faixa, Chips, CartaoAcao, Vazio, Nota, Etiqueta, MenuMais, semAcento, brl, brlInteiro,
  type ItemFaixa, type OpcaoChip,
} from '@/pages/estoque/components/ui/EstoqueUi';
import Ajuda from '@/pages/estoque/components/inicio/Ajuda';
import FichasVendasPassadasModal from '@/pages/estoque/components/FichasVendasPassadasModal';
import ConsumoDetalheDia from './ConsumoDetalheDia';
import ConsumoCategoriasPanel from './ConsumoCategoriasPanel';
import ConsumoPorLanchePanel from './ConsumoPorLanchePanel';
import ConsumoPerdas from './ConsumoPerdas';

// Estoque › Custo › Consumo (layout novo, 2026-10-04): período no topo, faixa de números, quatro visões
// (insumo, categoria, prato, perdas). Esta peça também aparece fora do Estoque: lá não há ficha do insumo
// para abrir e a situação do estoque (dura/abaixo do mínimo) é buscada aqui mesmo.

type Pilula = 'insumo' | 'categoria' | 'prato' | 'perdas';
type Ordem = 'custo' | 'consumo' | 'dias';

interface Props {
  /** Não é mais usado: o período é escolhido na própria tela. Fica para não quebrar quem ainda passa. */
  periodo?: string;
}

/** Uma linha de "Por insumo": o consumo do período + a situação do estoque (regra única). */
interface Linha extends ConsumoIngrediente {
  /** Unidade no padrão do banco (g | kg | ml | L | unit), para fmtQtd */
  unBanco: string;
  sit: InsumoSituacao | null;
  estoque: number;
  dias: number | null;
  dura: DuraInfo | null;
  esgotado: boolean;
  abaixoMinimo: boolean;
  /** Acaba em 3 dias ou menos */
  critico: boolean;
}

const unidadeBanco = (u: string) => (u === 'l' ? 'L' : u === 'un' ? 'unit' : u);
const dataBR = (ymd: string) => ymd.split('-').reverse().join('/');

const COR_DURA: Record<DuraInfo['tom'], string> = {
  red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-700', zinc: 'text-zinc-400',
};
const TENDENCIA = {
  subindo: { texto: '↗ subindo', cor: 'text-red-500' },
  estavel: { texto: '→ igual', cor: 'text-zinc-400' },
  caindo: { texto: '↘ caindo', cor: 'text-emerald-600' },
} as const;

const OPCOES_PERIODO: OpcaoChip<PresetPeriodo>[] = [
  { id: '7d', rotulo: '7 dias' },
  { id: '30d', rotulo: '30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'custom', rotulo: 'Período' },
];

const campo = 'h-10 px-3 rounded-xl border border-zinc-200 bg-white text-[13px] font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30';

/** Tela larga (tabela) × celular (cartões). Só uma das duas fica montada, para o "dia a dia" não carregar em dobro. */
function useTelaLarga() {
  const consulta = '(min-width: 768px)';
  const temMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [larga, setLarga] = useState(() => temMedia && window.matchMedia(consulta).matches);
  useEffect(() => {
    if (!temMedia) return;
    const m = window.matchMedia(consulta);
    const f = () => setLarga(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [temMedia]);
  return larga;
}

/** Pílulas (segmented): Por insumo · Por categoria · Por prato · Perdas. */
function Pilulas<T extends string>({ opcoes, valor, onChange }: { opcoes: OpcaoChip<T>[]; valor: T; onChange: (v: T) => void }) {
  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
      <div className="inline-flex gap-1 p-1 bg-zinc-100 rounded-xl">
        {opcoes.map((o) => (
          <button key={o.id} type="button" onClick={() => onChange(o.id)}
            className={`min-h-[34px] px-3.5 rounded-lg text-[12.5px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
              o.id === valor ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
            {o.rotulo}
            {o.n != null && o.n > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-[10px] font-extrabold rounded-full px-1.5 py-0.5 align-middle">{o.n}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

const TIPOS_SAIDA: Array<{ chave: keyof ConsumoIngrediente['porTipo']; rotulo: string; cor: string }> = [
  { chave: 'vendas', rotulo: 'Vendas', cor: 'text-amber-700 bg-amber-50' },
  { chave: 'producao', rotulo: 'Produção', cor: 'text-sky-700 bg-sky-50' },
  { chave: 'perda', rotulo: 'Perda', cor: 'text-red-600 bg-red-50' },
  { chave: 'ajuste', rotulo: 'Ajuste', cor: 'text-zinc-600 bg-zinc-100' },
  { chave: 'transferencia', rotulo: 'Transferência', cor: 'text-violet-600 bg-violet-50' },
];

/** De onde saiu o que foi usado (venda, produção, perda...). */
function Saidas({ item }: { item: Linha }) {
  const partes = TIPOS_SAIDA.filter((t) => Number(item.porTipo[t.chave] ?? 0) > 0);
  if (!partes.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {partes.map((t) => (
        <span key={t.chave} className={`inline-block px-1.5 py-0.5 rounded-md text-[10.5px] font-bold ${t.cor}`}>
          {t.rotulo}: {fmtQtd(Number(item.porTipo[t.chave]), item.unBanco)}
        </span>
      ))}
    </div>
  );
}

function Etiquetas({ item }: { item: Linha }) {
  return (
    <>
      {item.semCadastro && <Etiqueta tom="amber">Sem cadastro</Etiqueta>}
      {item.esgotado && <Etiqueta tom="red">Zerado</Etiqueta>}
      {item.critico && <Etiqueta tom="red">Crítico</Etiqueta>}
      {item.abaixoMinimo && <Etiqueta tom="amber">Abaixo do mínimo</Etiqueta>}
    </>
  );
}

interface LinhaProps {
  item: Linha;
  aberto: boolean;
  onAlternar: () => void;
  /** Dentro do Estoque: abre a ficha do insumo. Fora: undefined (linha não clicável). */
  onAbrir?: () => void;
  de: string;
  ate: string;
}

function fundoDaLinha(item: Linha, aberto: boolean) {
  if (aberto) return 'bg-amber-50/40';
  if (item.esgotado || item.critico) return 'bg-red-50/40';
  if (item.semCadastro) return 'bg-amber-50/30';
  return '';
}

/** Celular: o cartão da linha. */
function LinhaCartao({ item, aberto, onAlternar, onAbrir, de, ate }: LinhaProps) {
  const usou = item.totalConsumido > 0;
  return (
    <div className={`px-3.5 py-3 ${fundoDaLinha(item, aberto)}`}>
      <div className="flex items-start gap-3">
        <div className={`flex-1 min-w-0 ${onAbrir ? 'cursor-pointer' : ''}`} onClick={onAbrir}
          role={onAbrir ? 'button' : undefined} tabIndex={onAbrir ? 0 : undefined}
          onKeyDown={onAbrir ? (e) => { if (e.key === 'Enter') onAbrir(); } : undefined}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[14.5px] font-extrabold text-zinc-900 leading-snug">{item.nome}</span>
            <Etiquetas item={item} />
          </div>
          <p className="text-[12.5px] text-zinc-500 mt-0.5 leading-relaxed">
            {usou ? <>usou {fmtQtd(item.totalConsumido, item.unBanco)}</> : <>não saiu no período</>}
            {item.semCadastro ? (
              <> · sem cadastro ativo</>
            ) : (
              <>
                {' · '}tem {fmtQtd(item.estoque, item.unBanco)}
                {item.sit && !item.sit.acompanha && <> · não conta estoque</>}
                {item.dura && <> · <span className={`font-bold ${COR_DURA[item.dura.tom]}`}>{item.dura.longo}</span></>}
              </>
            )}
          </p>
          <Saidas item={item} />
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[14.5px] font-extrabold text-zinc-900 tabular-nums">{brl(item.custoTotal)}</p>
          {item.tendencia && (
            <p className={`text-[11.5px] font-bold ${TENDENCIA[item.tendencia].cor}`}>{TENDENCIA[item.tendencia].texto}</p>
          )}
        </div>
      </div>
      {usou && (
        <button type="button" onClick={onAlternar} className={`${btn('ghost', 'sm')} mt-1 -ml-3`}>
          <i className={aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
          {aberto ? 'Esconder o dia a dia' : 'Ver o dia a dia'}
        </button>
      )}
      {aberto && (
        <div className="mt-2 -mx-3.5 -mb-3">
          <ConsumoDetalheDia ingredientId={item.id} ingredientUnit={item.unidade} dateFrom={de} dateTo={ate} />
        </div>
      )}
    </div>
  );
}

/** Computador: a linha da tabela (e o dia a dia embaixo, quando aberto). */
function LinhaTabela({ item, aberto, onAlternar, onAbrir, de, ate }: LinhaProps) {
  const usou = item.totalConsumido > 0;
  const tend = item.tendencia ? TENDENCIA[item.tendencia] : null;
  const contaSit = item.sit ? `Tem ${fmtQtd(item.estoque, item.unBanco)}${item.sit.consumoDia ? ` ÷ usa ${fmtQtd(item.sit.consumoDia, item.unBanco)} por dia` : ''}` : undefined;
  return (
    <Fragment>
      <tr className={`${fundoDaLinha(item, aberto)} ${onAbrir ? 'cursor-pointer hover:bg-zinc-50' : ''}`} onClick={onAbrir}>
        <td className="pl-3 pr-1 py-2 w-9" onClick={(e) => e.stopPropagation()}>
          {usou && (
            <button type="button" onClick={onAlternar} aria-label={aberto ? 'Esconder o dia a dia' : 'Ver o dia a dia'}
              title={aberto ? 'Esconder o dia a dia' : 'Ver o dia a dia'}
              className={`w-[30px] h-[30px] inline-flex items-center justify-center rounded-lg border cursor-pointer ${aberto ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50'}`}>
              <i className={aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            </button>
          )}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`font-bold ${item.semCadastro ? 'text-amber-800' : 'text-zinc-900'}`}>{item.nome}</span>
            <Etiquetas item={item} />
          </div>
          <Saidas item={item} />
        </td>
        <td className="px-3 py-2 text-right text-zinc-700 tabular-nums whitespace-nowrap">
          {usou ? fmtQtd(item.totalConsumido, item.unBanco) : <span className="text-zinc-300">—</span>}
        </td>
        <td className="px-3 py-2 text-right font-bold text-zinc-900 tabular-nums whitespace-nowrap">{brl(item.custoTotal)}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
          {item.semCadastro ? (
            <span className="text-zinc-400">—</span>
          ) : (
            <span className={item.esgotado || item.abaixoMinimo ? 'text-red-600 font-bold' : 'text-zinc-600'}>{fmtQtd(item.estoque, item.unBanco)}</span>
          )}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {item.dura ? <span title={contaSit} className={`font-bold ${COR_DURA[item.dura.tom]}`}>{item.dura.curto}</span> : <span className="text-zinc-300">—</span>}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {tend ? <span className={`text-xs font-bold ${tend.cor}`}>{tend.texto}</span> : <span className="text-zinc-300">—</span>}
        </td>
      </tr>
      {aberto && (
        <tr>
          <td colSpan={7} className="p-0">
            <ConsumoDetalheDia ingredientId={item.id} ingredientUnit={item.unidade} dateFrom={de} dateTo={ate} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export default function ConsumoIngredientesTab(_props: Props) {
  const { user } = useAuth();
  const ctx = useEstoqueTelaOpcional();
  // Dentro do Estoque a situação vem da tela (uma busca só); fora dela, busca aqui.
  const proprio = useEstoqueSituacao({ ativo: !ctx });
  const situacao = ctx ? ctx.situacao : proprio.data;

  const hoje = todayBrasilia();
  const [preset, setPreset] = useState<PresetPeriodo>('30d');
  const [intervalo, setIntervalo] = useState(() => intervaloDoPreset('30d', todayBrasilia()));
  // Campos De/Até do "Período": podem ficar inválidos por um instante; a consulta só muda quando estão certos
  const [de, setDe] = useState(() => intervalo.from);
  const [ate, setAte] = useState(() => intervalo.to);
  const erroPeriodo = preset === 'custom' ? validarPeriodo(de, ate, hoje) : null;

  const [pilula, setPilula] = useState<Pilula>('insumo');
  const [filtro, setFiltro] = useState('');
  const [cat, setCat] = useState('');
  const [forn, setForn] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('custo');
  const [soAbaixo, setSoAbaixo] = useState(false);
  const [mostrarSemUso, setMostrarSemUso] = useState(false);
  const [expand, setExpand] = useState<Set<string>>(new Set());
  const [fichasAberto, setFichasAberto] = useState(false);
  const larga = useTelaLarga();

  const { dados, resumo, loading, error, aviso, reload } = useConsumoIngredientes(intervalo.from, intervalo.to);

  const recarregarTudo = useCallback(() => {
    reload();
    if (ctx) void ctx.recarregarSituacao();
    else proprio.reload();
  }, [reload, ctx, proprio.reload]);

  const escolherPeriodo = (p: PresetPeriodo) => {
    setPreset(p);
    if (p === 'custom') return; // começa pelo período que já estava na tela
    const r = intervaloDoPreset(p, todayBrasilia());
    setIntervalo(r);
    setDe(r.from);
    setAte(r.to);
  };
  const mudarDatas = (novoDe: string, novoAte: string) => {
    setDe(novoDe);
    setAte(novoAte);
    if (!validarPeriodo(novoDe, novoAte, todayBrasilia())) setIntervalo({ from: novoDe, to: novoAte });
  };

  const sitPorId = useMemo(() => new Map((situacao?.insumos ?? []).map((i) => [i.id, i])), [situacao]);

  const linhas = useMemo<Linha[]>(() => dados.map((d) => {
    const sit = d.semCadastro ? null : sitPorId.get(d.id) ?? null;
    const dias = sit?.diasRestantes ?? null;
    const dura = sit
      ? duraInfo({ acompanha: sit.acompanha, esgotado: sit.esgotado, diasRestantes: sit.diasRestantes, abaixoMinimo: sit.abaixoMinimo, vaiFaltar: sit.vaiFaltar })
      : null;
    return {
      ...d,
      unBanco: unidadeBanco(d.unidade),
      sit,
      estoque: sit ? sit.estoque : d.estoqueAtual,
      dias,
      dura,
      esgotado: !!sit && sit.esgotado,
      abaixoMinimo: !!sit && sit.abaixoMinimo,
      critico: !!sit && sit.acompanha && !sit.esgotado && dias !== null && dias <= 3,
    };
  }), [dados, sitPorId]);

  const cats = useMemo(
    () => ['', ...Array.from(new Set(dados.filter((d) => !d.semCadastro).map((d) => d.categoria).filter(Boolean)))],
    [dados],
  );
  const forns = useMemo(
    () => ['', ...Array.from(new Set(dados.filter((d) => !d.semCadastro).map((d) => d.fornecedor).filter((f) => f && f !== '—'))).sort()],
    [dados],
  );

  const q = semAcento(filtro);
  const filtrados = useMemo(() => {
    // Por padrão só os insumos que saíram; a busca, o "abaixo do mínimo" e o botão "mostrar todos" trazem os outros
    const incluiSemUso = mostrarSemUso || !!q || soAbaixo;
    const r = linhas.filter((l) => {
      if (soAbaixo && !l.abaixoMinimo) return false;
      if (cat && (l.semCadastro || l.categoria !== cat)) return false;
      if (forn && (l.semCadastro || l.fornecedor !== forn)) return false;
      if (q && !semAcento(l.nome).includes(q) && !semAcento(l.fornecedor).includes(q)) return false;
      if (!incluiSemUso && l.totalConsumido <= 0) return false;
      return true;
    });
    const chaveDias = (l: Linha) => (l.esgotado ? -1 : l.dias ?? 1e9);
    return r.sort((a, b) => {
      if (a.semCadastro !== b.semCadastro) return a.semCadastro ? 1 : -1;
      if (ordem === 'custo') return b.custoTotal - a.custoTotal;
      if (ordem === 'consumo') return b.totalConsumido - a.totalConsumido;
      return chaveDias(a) - chaveDias(b);
    });
  }, [linhas, cat, forn, q, ordem, soAbaixo, mostrarSemUso]);

  const orfas = useMemo(() => dados.filter((d) => d.semCadastro).length, [dados]);
  const semUso = useMemo(() => linhas.filter((l) => !l.semCadastro && l.totalConsumido <= 0).length, [linhas]);
  const qtdAbaixo = useMemo(() => linhas.filter((l) => l.abaixoMinimo).length, [linhas]);
  const qtdPerdas = useMemo(() => dados.filter((d) => !d.semCadastro && d.porTipo.perda > 0).length, [dados]);
  const temFiltro = !!(q || cat || forn || soAbaixo);

  const alternar = useCallback(
    (id: string) => setExpand((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    [],
  );

  // "Aplicar fichas nas vendas passadas": mesma regra de quem pode (admin e Supervisor; o backend confere de novo)
  const podeAplicarFichas = !!user?.tenantId && ['admin', 'gerente'].includes(String(user.perfil));

  const baixarCsv = () => {
    const cab = [
      'Insumo', 'Categoria', 'Fornecedor', 'Unidade', 'Usou', 'Custo (R$)', 'Vendas', 'Produção', 'Perdas', 'Ajustes',
      'Transferências', 'Tem', 'Mínimo', 'Usa por dia', 'Dura (dias)', 'Tendência', 'Situação',
    ];
    const rotuloTendencia = { subindo: 'subindo', estavel: 'igual', caindo: 'caindo' } as const;
    const linhasCsv = filtrados.map((l) => [
      l.nome, l.semCadastro ? '' : l.categoria, l.fornecedor === '—' ? '' : l.fornecedor,
      l.unBanco === 'unit' ? 'un' : l.unBanco,
      l.totalConsumido, Math.round(l.custoTotal * 100) / 100,
      l.porTipo.vendas, l.porTipo.producao, l.porTipo.perda, l.porTipo.ajuste, l.porTipo.transferencia,
      l.semCadastro ? null : l.estoque, l.semCadastro ? null : (l.sit?.minimo ?? l.minimo),
      l.sit?.consumoDia ?? null, l.dias == null ? null : Math.round(l.dias * 10) / 10,
      l.tendencia ? rotuloTendencia[l.tendencia] : '',
      l.semCadastro ? 'Sem cadastro' : l.esgotado ? 'Zerado' : l.abaixoMinimo ? 'Abaixo do mínimo' : '',
    ]);
    const blob = new Blob(['﻿' + montarCsv(cab, linhasCsv)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consumo-insumos_${intervalo.from}_a_${intervalo.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const abaixoMinimo = situacao?.totais.abaixoMinimo ?? null;
  const faixaPrincipal: ItemFaixa[] = resumo ? [
    {
      valor: resumo.insumosUsados, rotulo: 'Insumos usados',
      ajuda: 'Quantos insumos tiveram alguma saída do estoque no período (venda, produção, perda ou saída manual).',
    },
    {
      valor: brlInteiro(resumo.totalConsumidoValor), rotulo: 'Custo do que saiu',
      ajuda: 'O que saiu do estoque no período (vendas pela ficha, produção, perdas, saídas manuais e contagem que achou a menos) vezes o preço atual de cada insumo.',
    },
    {
      valor: resumo.totalVendasValor == null ? '—' : brlInteiro(resumo.totalVendasValor), rotulo: 'Vendas',
      ajuda: 'Faturamento do período: pedidos que valeram, sem cancelados nem de treino.',
    },
    {
      valor: abaixoMinimo ?? '—', rotulo: 'Abaixo do mínimo', tom: abaixoMinimo ? 'red' : 'neutro',
      ajuda: 'O mesmo número do Início do Estoque: insumos com estoque igual ou abaixo do mínimo hoje. Não depende do período. Na lista "Por insumo" dá para filtrar só esses.',
    },
  ] : [];
  const faixaCustos: ItemFaixa[] = resumo ? [
    { valor: brl(resumo.custoVendas), rotulo: 'Custo das vendas', tom: 'amber' },
    { valor: brl(resumo.custoProducao), rotulo: 'Custo da produção' },
    { valor: brl(resumo.custoPerda), rotulo: 'Custo das perdas', tom: resumo.custoPerda > 0 ? 'red' : 'neutro', onClick: () => setPilula('perdas') },
  ] : [];

  const opcoesPilula: OpcaoChip<Pilula>[] = [
    { id: 'insumo', rotulo: 'Por insumo' },
    { id: 'categoria', rotulo: 'Por categoria' },
    { id: 'prato', rotulo: 'Por prato' },
    { id: 'perdas', rotulo: 'Perdas', n: qtdPerdas },
  ];

  const mostrarConteudo = !loading && !error;

  return (
    <div className="space-y-4">
      {/* Período + menu */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 overflow-hidden">
            <Chips opcoes={OPCOES_PERIODO} valor={preset} onChange={escolherPeriodo} />
          </div>
          <MenuMais itens={[
            { rotulo: 'Atualizar os números', icone: 'ri-refresh-line', onClick: recarregarTudo },
            { rotulo: 'Aplicar fichas nas vendas passadas', icone: 'ri-history-line', onClick: () => setFichasAberto(true), oculto: !podeAplicarFichas },
          ]} />
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-bold text-zinc-500" htmlFor="consumo-de">De</label>
            <input id="consumo-de" type="date" value={de} max={hoje} onChange={(e) => mudarDatas(e.target.value, ate)} className={campo} />
            <label className="text-xs font-bold text-zinc-500" htmlFor="consumo-ate">até</label>
            <input id="consumo-ate" type="date" value={ate} min={de} max={hoje} onChange={(e) => mudarDatas(de, e.target.value)} className={campo} />
          </div>
        )}
        {erroPeriodo && <p className="text-xs font-semibold text-red-600">{erroPeriodo} Os números abaixo continuam do período anterior.</p>}
        <p className="text-[11.5px] text-zinc-400 px-0.5">
          Mostrando de {dataBR(intervalo.from)} a {dataBR(intervalo.to)}
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="ml-2 text-sm text-zinc-400">Lendo o consumo…</span>
        </div>
      )}

      {!loading && error && (
        <CartaoAcao tom="alerta" icone="ri-error-warning-line" titulo={error}
          acoes={<button type="button" onClick={recarregarTudo} className={btn('dark', 'sm')}>Tentar de novo</button>}>
          O período e os filtros continuam como estão.
        </CartaoAcao>
      )}

      {mostrarConteudo && aviso && (
        <CartaoAcao tom="prop" icone="ri-alert-line" titulo="Os números podem estar incompletos">{aviso}</CartaoAcao>
      )}

      {mostrarConteudo && dados.length === 0 && (
        <Vazio icone="ri-archive-line" titulo="Nenhum dado de consumo"
          acao={<button type="button" onClick={recarregarTudo} className={btn('p', 'sm')}>Atualizar</button>}>
          Não há insumos nem movimentos de estoque neste período.
        </Vazio>
      )}

      {mostrarConteudo && resumo && dados.length > 0 && (
        <>
          <Faixa itens={faixaPrincipal} />
          <Faixa itens={faixaCustos} />

          {orfas > 0 && (
            <CartaoAcao tom="prop" icone="ri-error-warning-line"
              titulo={`${orfas} insumo${orfas > 1 ? 's' : ''} com saída, mas sem cadastro ativo`}>
              Há movimentos de estoque apontando para insumos removidos ou que não estão cadastrados. Eles aparecem no fim da lista, sem custo.
            </CartaoAcao>
          )}

          <Pilulas opcoes={opcoesPilula} valor={pilula} onChange={(v) => setPilula(v)} />

          {pilula === 'categoria' && <ConsumoCategoriasPanel dados={dados} loading={loading} />}
          {pilula === 'prato' && <ConsumoPorLanchePanel dateFrom={intervalo.from} dateTo={intervalo.to} />}
          {pilula === 'perdas' && <ConsumoPerdas dados={dados} loading={loading} />}

          {pilula === 'insumo' && (
            <div className="space-y-3">
              {/* Busca e filtros */}
              <div className="space-y-2">
                <div className="relative">
                  <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input type="text" placeholder="Buscar insumo ou fornecedor" value={filtro} onChange={(e) => setFiltro(e.target.value)}
                    className={`${campo} w-full pl-9 font-normal`} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={cat} onChange={(e) => setCat(e.target.value)} className={`${campo} max-w-[180px]`} aria-label="Categoria">
                    {cats.map((c) => <option key={c} value={c}>{c || 'Todas as categorias'}</option>)}
                  </select>
                  <select value={forn} onChange={(e) => setForn(e.target.value)} className={`${campo} max-w-[180px]`} aria-label="Fornecedor">
                    {forns.map((f) => <option key={f} value={f}>{f || 'Todos os fornecedores'}</option>)}
                  </select>
                  <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} className={campo} aria-label="Ordem">
                    <option value="custo">Maior custo</option>
                    <option value="consumo">Mais usado</option>
                    <option value="dias">Acaba primeiro</option>
                  </select>
                  {(qtdAbaixo > 0 || soAbaixo) && (
                    <button type="button" onClick={() => setSoAbaixo((v) => !v)} aria-pressed={soAbaixo}
                      className={`inline-flex items-center gap-1 h-8 px-3 rounded-full border text-[12.5px] font-bold cursor-pointer whitespace-nowrap ${
                        soAbaixo ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-red-50 border-red-200 text-red-700'}`}>
                      Abaixo do mínimo <span className="opacity-70">{qtdAbaixo}</span>
                    </button>
                  )}
                  <span className="flex-1" />
                  <span className="text-xs text-zinc-400">{filtrados.length} insumo{filtrados.length === 1 ? '' : 's'}</span>
                  <button type="button" onClick={baixarCsv} disabled={!filtrados.length} className={btn('out', 'sm')}>
                    <i className="ri-download-2-line" />CSV
                  </button>
                </div>
              </div>

              {soAbaixo && !q && !cat && !forn && abaixoMinimo != null && filtrados.length < abaixoMinimo && (
                <Nota>
                  O Início do Estoque conta {abaixoMinimo}; aqui entram só os insumos de consumo (os produzidos na cozinha ficam de fora).
                </Nota>
              )}

              {filtrados.length === 0 ? (
                temFiltro ? (
                  <Vazio icone="ri-search-line" titulo="Nenhum insumo com esse filtro"
                    acao={<button type="button" className={btn('out', 'sm')}
                      onClick={() => { setFiltro(''); setCat(''); setForn(''); setSoAbaixo(false); }}>Limpar filtros</button>} />
                ) : (
                  <Vazio icone="ri-archive-line" titulo="Nada saiu do estoque neste período"
                    acao={semUso > 0 ? <button type="button" className={btn('out', 'sm')} onClick={() => setMostrarSemUso(true)}>Ver todos os insumos</button> : undefined}>
                    Escolha outro período para ver o consumo.
                  </Vazio>
                )
              ) : larga ? (
                <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-zinc-200 text-[11.5px] text-zinc-500">
                          <th className="w-9" />
                          <th className="px-3 py-2.5 text-left font-bold">Insumo</th>
                          <th className="px-3 py-2.5 text-right font-bold">Usou</th>
                          <th className="px-3 py-2.5 text-right font-bold">Custo</th>
                          <th className="px-3 py-2.5 text-right font-bold">Tem</th>
                          <th className="px-3 py-2.5 text-right font-bold whitespace-nowrap">
                            Dura{' '}
                            <Ajuda titulo="Dura">
                              Quanto tempo o que tem em estoque dura, no ritmo dos últimos dias: o que tem ÷ o que usa por dia.
                              É a mesma conta do Início do Estoque{situacao?.janelaDias ? ` (média dos últimos ${Math.round(situacao.janelaDias)} dias de venda)` : ''}.
                              Fica em branco quando a loja ainda tem pouco histórico.
                            </Ajuda>
                          </th>
                          <th className="px-3 py-2.5 text-right font-bold whitespace-nowrap">
                            Tendência{' '}
                            <Ajuda titulo="Tendência">
                              Compara a segunda metade do período escolhido com a primeira. ↗ subindo: usou mais de 20% a mais.
                              ↘ caindo: mais de 20% a menos. → igual: variação menor que isso. Fica em branco com menos de
                              4 dias de período ou quando o insumo não saiu na primeira metade. O dia de hoje não entra (ainda não terminou).
                            </Ajuda>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {filtrados.map((item) => (
                          <LinhaTabela key={item.id} item={item} aberto={expand.has(item.id)} onAlternar={() => alternar(item.id)}
                            onAbrir={ctx && !item.semCadastro ? () => ctx.abrirFicha(item.id) : undefined}
                            de={intervalo.from} ate={intervalo.to} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden divide-y divide-zinc-100">
                  {filtrados.map((item) => (
                    <LinhaCartao key={item.id} item={item} aberto={expand.has(item.id)} onAlternar={() => alternar(item.id)}
                      onAbrir={ctx && !item.semCadastro ? () => ctx.abrirFicha(item.id) : undefined}
                      de={intervalo.from} ate={intervalo.to} />
                  ))}
                </div>
              )}

              {!temFiltro && semUso > 0 && filtrados.length > 0 && (
                <button type="button" onClick={() => setMostrarSemUso((v) => !v)} className={btn('ghost', 'sm')}>
                  {mostrarSemUso ? 'Esconder os insumos que não saíram' : `Mostrar também os ${semUso} insumos que não saíram`}
                </button>
              )}

              <Nota>
                Usou = o que saiu do estoque no período. Dura = o que tem ÷ o que usa por dia (a mesma conta do Início do Estoque).
                Tendência = segunda metade do período contra a primeira.
              </Nota>
            </div>
          )}
        </>
      )}

      {fichasAberto && user?.tenantId && (
        <FichasVendasPassadasModal tenantId={user.tenantId} onFechar={() => setFichasAberto(false)} onAplicado={recarregarTudo} />
      )}
    </div>
  );
}
