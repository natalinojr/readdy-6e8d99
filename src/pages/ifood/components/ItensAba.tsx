import { useEffect, useMemo, useRef, useState } from 'react';
import ExplicaLucro from './ExplicaLucro';
import { useSearchParams } from 'react-router-dom';
import { fetchCardapioIfood, type MenuLinha } from '@/lib/ifoodDashboard';
import { itensDoCardapio, itensDosPedidos, resumoItens, type ItemArea } from '@/lib/ifoodArea';
import { btn, brl, brlInteiro, CartaoAcao, Chips, Faixa, Nota, Vazio, type OpcaoChip } from '@/components/kit';
import { Folha } from '@/components/kit';
import type { AbaProps } from '../lib/tipos';
import {
  bloqueadoPorComplemento, classeMargem, descricaoLigacao, fatorDoPeriodo, fraseItens, listaDoChip, semFichaDe, type ChipItens,
} from '../lib/itensLogica';
import { rotuloPeriodo } from './PeriodoFolha';
import LigarFichaFolha, { type ItemFila } from './LigarFichaFolha';

// Itens e CMV (área iFood, 2026-10-05, protótipo docs/prototipos/ifood-proposta.html › Itens e CMV).
// Fonte: cada pedido do módulo Pedidos traz os itens na hora (itensDosPedidos); para os dias de antes,
// o relatório de Cardápio importado do Portal do Parceiro (itensDoCardapio, sobra pela média do período).

const diaBR = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const brlSinal = (v: number) => `${v < 0 ? '−' : ''}${brl(Math.abs(v))}`;
const pct = (m: number) => `${m < 0 ? '−' : ''}${Math.abs(m).toFixed(0)}%`;
const POR_PAGINA = 60;

type Fonte = 'pedidos' | 'cardapio';

const COR_SELO: Record<string, string> = {
  verde: 'bg-emerald-50 text-emerald-700', ambar: 'bg-amber-50 text-amber-700', vermelho: 'bg-red-50 text-red-600', sem: 'bg-zinc-100 text-zinc-500', aberto: 'bg-zinc-100 text-zinc-500',
};

function SeloMargem({ i, bloqueado }: { i: ItemArea; bloqueado: boolean }) {
  const c = classeMargem(i);
  const texto = c === 'sem' ? 'sem ficha' : c === 'aberto' ? (bloqueado ? 'falta complemento' : 'sem conta') : pct(i.margem ?? 0);
  return <span className={`text-[10.5px] font-extrabold rounded-md px-1.5 py-0.5 whitespace-nowrap ${COR_SELO[c]}`}>{texto}</span>;
}

export default function ItensAba({ tenantId, loja, lojas, periodo, acesso, dados }: AbaProps) {
  const [params, setParams] = useSearchParams();
  const [chip, setChip] = useState<ChipItens>('vendidos');
  const [fonteEscolhida, setFonteEscolhida] = useState<Fonte | null>(null);
  const [cardapio, setCardapio] = useState<MenuLinha[] | null>(null);
  const [carregandoCardapio, setCarregandoCardapio] = useState(false);
  const [itemAberto, setItemAberto] = useState<string | null>(null);
  const [ligar, setLigar] = useState<{ fila: ItemFila[]; indice: number; troca: boolean } | null>(null);
  const [mostrar, setMostrar] = useState(POR_PAGINA);

  const fromDia = dados.from.slice(0, 10);
  const toDia = dados.to.slice(0, 10);
  const lojaShort = loja ? lojas.find((l) => l.id === loja)?.short ?? null : null;

  // Pedidos do módulo Pedidos da loja escolhida. Pedido de teste fica fora, a não ser que a loja só tenha
  // pedido de teste (a loja de testes, onde é o único jeito de conferir a tela).
  const pedidosLoja = useMemo(() => {
    const daLoja = dados.pedidos.filter((p) => !loja || p.loja === loja);
    const soTeste = daLoja.every((p) => !p.order || p.order.teste);
    return soTeste ? daLoja : daLoja.filter((p) => !p.order?.teste);
  }, [dados.pedidos, loja]);
  const itensPedidos = useMemo(() => itensDosPedidos(pedidosLoja, dados.custos), [pedidosLoja, dados.custos]);

  // Dias do período antes do primeiro pedido com itens: só o relatório importado cobre.
  const primeiroDia = useMemo(() => {
    let min: string | null = null;
    for (const p of pedidosLoja) {
      if (!p.order || p.order.itens.length === 0) continue;
      const d = diaBR(p.order.at);
      if (!min || d < min) min = d;
    }
    return min;
  }, [pedidosLoja]);
  const faltaHistorico = !primeiroDia || primeiroDia > fromDia;

  useEffect(() => {
    if (!faltaHistorico) { setCardapio(null); return; }
    let vivo = true;
    setCarregandoCardapio(true);
    fetchCardapioIfood(tenantId, fromDia, toDia)
      .then((r) => { if (vivo) setCardapio(r.linhas); })
      .catch(() => { if (vivo) setCardapio([]); })
      .finally(() => { if (vivo) setCarregandoCardapio(false); });
    return () => { vivo = false; };
  }, [faltaHistorico, tenantId, fromDia, toDia]);

  const linhasCardapio = useMemo(
    () => (cardapio ?? []).filter((l) => !loja || !lojaShort || l.merchant_short === lojaShort),
    [cardapio, loja, lojaShort],
  );
  const temCardapio = linhasCardapio.length > 0;
  const temPedidos = itensPedidos.length > 0;
  const fonte: Fonte = fonteEscolhida === 'cardapio' && temCardapio ? 'cardapio'
    : fonteEscolhida === 'pedidos' ? 'pedidos'
    : temPedidos ? 'pedidos' : temCardapio ? 'cardapio' : 'pedidos';
  const mostrarSeletor = faltaHistorico && temCardapio;
  const periodoCardapio = useMemo(() => {
    if (!linhasCardapio.length) return null;
    let a = linhasCardapio[0].period_start, b = linhasCardapio[0].period_end;
    for (const l of linhasCardapio) { if (l.period_start < a) a = l.period_start; if (l.period_end > b) b = l.period_end; }
    return { de: a, ate: b };
  }, [linhasCardapio]);

  // Quanto chega de cada R$ 1 vendido no período (só para o relatório de Cardápio, que não traz a taxa de cada pedido).
  const fatorPeriodo = useMemo(() => {
    const fin = dados.fin.length ? dados.fin : dados.fin30;
    return fatorDoPeriodo(fin, loja);
  }, [dados.fin, dados.fin30, loja]);

  const itens = useMemo(
    () => (fonte === 'cardapio' ? itensDoCardapio(linhasCardapio, dados.custos, fatorPeriodo) : itensPedidos),
    [fonte, linhasCardapio, dados.custos, fatorPeriodo, itensPedidos],
  );
  const resumo = useMemo(() => resumoItens(itens), [itens]);
  const semFicha = useMemo(() => semFichaDe(itens, dados.custos), [itens, dados.custos]);
  const semFichaVendas = semFicha.filter((i) => i.nivel === 'item').reduce((s, i) => s + i.faturado, 0);
  const lista = useMemo(() => listaDoChip(itens, chip, dados.custos), [itens, chip, dados.custos]);
  const maxFat = lista.reduce((m, i) => Math.max(m, i.faturado), 0);
  const totalFat = lista.reduce((s, i) => s + i.faturado, 0);

  useEffect(() => { setMostrar(POR_PAGINA); }, [chip, fonte, loja, periodo]);

  // ── Vindo da URL: ?filtro=semficha|prejuizo, ?item=<chave>, ?ligar=1 ──
  const filtroUrl = params.get('filtro');
  useEffect(() => {
    if (filtroUrl === 'semficha' || filtroUrl === 'prejuizo') setChip(filtroUrl);
  }, [filtroUrl]);

  const itemUrl = params.get('item');
  const ligarUrl = params.get('ligar');
  const pronto = !dados.carregando && !carregandoCardapio;
  const tratado = useRef('');
  useEffect(() => {
    if (!pronto || (!itemUrl && !ligarUrl)) return;
    const sig = `${itemUrl ?? ''}|${ligarUrl ?? ''}`;
    if (tratado.current === sig) return;
    tratado.current = sig;
    const alvo = itemUrl ? itens.find((i) => i.chave === itemUrl) ?? null : null;
    if (ligarUrl && acesso.ligar) {
      if (alvo) abrirLigar(alvo); else if (semFicha.length) abrirLigar(semFicha[0]);
    } else if (alvo) {
      setItemAberto(alvo.chave);
    }
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete('item'); p.delete('ligar'); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, itemUrl, ligarUrl]);

  const abrirLigar = (it: ItemArea) => {
    const pos = semFicha.findIndex((s) => s.chave === it.chave);
    setItemAberto(null);
    setLigar(pos >= 0 ? { fila: semFicha.slice(), indice: pos, troca: false } : { fila: [it], indice: 0, troca: true });
  };

  const aberto = itemAberto ? itens.find((i) => i.chave === itemAberto) ?? null : null;
  const verDinheiro = acesso.dinheiro;

  if (dados.carregando && !dados.pedidos.length && !itens.length) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  const frase = fraseItens({ de100: resumo.de100, prejuizo: resumo.prejuizo.length, semFicha: semFicha.length, itensVendidos: resumo.itensVendidos, dinheiro: verDinheiro });
  const rotuloPer = rotuloPeriodo(periodo).toLowerCase();

  const todosChips: OpcaoChip<ChipItens>[] = [
    { id: 'vendidos', rotulo: 'Mais vendidos' },
    { id: 'prejuizo', rotulo: 'Dão prejuízo', n: resumo.prejuizo.length, tom: resumo.prejuizo.length ? 'red' : undefined },
    { id: 'semficha', rotulo: 'Sem ficha', n: semFicha.length, tom: semFicha.length ? 'amber' : undefined },
    { id: 'pior', rotulo: 'Menor lucro' },
    { id: 'complementos', rotulo: 'Complementos' },
  ];
  const opcoesChip = todosChips.filter((o) => verDinheiro || (o.id !== 'prejuizo' && o.id !== 'pior'));

  const faixa = [
    { valor: resumo.itensVendidos.toLocaleString('pt-BR'), rotulo: `itens vendidos · ${rotuloPer}` },
    { valor: `${resumo.cobertura.toFixed(0)}%`, rotulo: 'das vendas com ficha', tom: resumo.cobertura >= 90 ? 'green' as const : 'amber' as const },
    ...(verDinheiro ? [
      { valor: resumo.de100 ? `${resumo.de100.comida.toFixed(0)}%` : '—', rotulo: 'comida (CMV)' },
      { valor: resumo.de100 ? `${resumo.de100.sobra.toFixed(0)}%` : '—', rotulo: 'lucro bruto médio', tom: resumo.de100 ? (resumo.de100.sobra < 0 ? 'red' as const : 'green' as const) : undefined },
    ] : []),
  ];

  if (!itens.length) {
    return (
      <div className="space-y-4">
        {mostrarSeletor && <SeletorFonte fonte={fonte} onChange={setFonteEscolhida} periodoCardapio={periodoCardapio} primeiroDia={primeiroDia} />}
        <Vazio icone="ri-restaurant-line" titulo="Ainda não há itens para mostrar neste período">
          Os itens chegam sozinhos, de cada pedido do iFood, a partir de agora. Para os dias de antes, importe o relatório de Cardápio do Portal do Parceiro.
        </Vazio>
      </div>
    );
  }

  const mostrados = lista.slice(0, mostrar);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-extrabold text-zinc-900 leading-tight">{frase.manchete}{verDinheiro && <> <ExplicaLucro item /></>}</h2>
        <p className="text-[13px] text-zinc-500 mt-1">{frase.sub}</p>
      </div>

      <Faixa itens={faixa} />

      {mostrarSeletor && <SeletorFonte fonte={fonte} onChange={setFonteEscolhida} periodoCardapio={periodoCardapio} primeiroDia={primeiroDia} />}

      {semFicha.length > 0 && (
        <CartaoAcao tom="prop" icone="ri-links-line" titulo={`${semFicha.length === 1 ? '1 item sem ficha' : `${semFicha.length} itens sem ficha`}${semFichaVendas > 0.005 ? ` · ${brlInteiro(semFichaVendas)} em vendas` : ''}`}
          acoes={<>
            {acesso.ligar && <button type="button" className={`${btn('p', 'sm')} max-w-full`} title={semFicha[0].nome} onClick={() => abrirLigar(semFicha[0])}><span className="truncate">Ligar o 1º ({semFicha[0].nome})</span></button>}
            {chip !== 'semficha' && <button type="button" className={btn('out', 'sm')} onClick={() => setChip('semficha')}>Ver {semFicha.length === 1 ? 'o item' : `os ${semFicha.length}`}</button>}
          </>}>
          {acesso.ligar
            ? 'Ligue cada item do iFood ao item do seu cardápio (ele já tem ficha). Combo que só existe no iFood: monte o custo com os insumos.'
            : 'Peça a um gerente para ligar cada item do iFood ao item do cardápio: sem a ficha, o lucro bruto fica em aberto.'}
        </CartaoAcao>
      )}

      <Chips<ChipItens> opcoes={opcoesChip} valor={chip} onChange={(v) => setChip(v)} />

      {lista.length === 0 ? (
        <Vazio icone="ri-restaurant-line" titulo={chip === 'prejuizo' ? 'Nenhum item dá prejuízo' : chip === 'semficha' ? 'Todos os itens têm ficha' : 'Nada para mostrar aqui'}>
          {chip === 'prejuizo' ? 'Nos itens com ficha, todos dão lucro bruto depois do iFood e da comida.' : undefined}
        </Vazio>
      ) : (
        <>
          {chip === 'complementos' && <Nota>O valor dos complementos já está dentro do preço do item; aqui eles aparecem à parte só para você ligar à ficha.</Nota>}

          {/* Celular: ranking */}
          <div className="lg:hidden bg-white border border-zinc-200 rounded-2xl px-3">
            {mostrados.map((i, k) => (
              <button key={i.chave} type="button" onClick={() => setItemAberto(i.chave)} className="w-full text-left flex gap-3 items-start py-3 border-t border-zinc-100 first:border-t-0 cursor-pointer">
                <span className="w-6 text-center text-[13px] font-extrabold text-zinc-300 pt-0.5 tabular-nums">{k + 1}</span>
                <span className="flex-1 min-w-0">
                  <b className="block text-[14px] font-extrabold text-zinc-900 leading-snug">{i.nome}</b>
                  <span className="block text-[11.5px] text-zinc-500 mt-0.5">
                    {i.nivel === 'complemento' && i.grupo ? `${i.grupo} · ` : ''}{i.qtd.toLocaleString('pt-BR')} vendidos · {brl(i.faturado)} · preço {brl(i.precoMedio)}
                    {i.custoUnit != null ? ` · comida ${brl(i.custoUnit)}` : ''}
                  </span>
                  <span className="block h-1.5 w-28 rounded-full bg-zinc-100 mt-1.5 overflow-hidden" title={totalFat > 0 ? `${((i.faturado / totalFat) * 100).toFixed(0)}% do total` : undefined}>
                    <span className="block h-full bg-amber-400 rounded-full" style={{ width: `${maxFat > 0 ? Math.max(3, (i.faturado / maxFat) * 100) : 0}%` }} />
                  </span>
                </span>
                <span className="text-right flex-none">
                  {verDinheiro ? (
                    <>
                      <b className={`block text-[14px] font-extrabold tabular-nums ${i.sobraUnit == null ? 'text-zinc-300' : i.sobraUnit < 0 ? 'text-red-600' : 'text-zinc-900'}`}>
                        {i.sobraUnit == null ? '?' : brlSinal(i.sobraUnit)}<small className="font-semibold text-zinc-400 text-[11px]">{i.sobraUnit == null ? '' : '/un'}</small>
                      </b>
                      <span className="block mt-1"><SeloMargem i={i} bloqueado={bloqueadoPorComplemento(i, dados.custos)} /></span>
                      {i.fatorMedio && i.sobraUnit != null && <span className="block text-[10px] text-zinc-400 mt-0.5">*média do período</span>}
                    </>
                  ) : (
                    <span className={`text-[10.5px] font-extrabold rounded-md px-1.5 py-0.5 ${i.custoUnit == null ? COR_SELO.sem : COR_SELO.verde}`}>{i.custoUnit == null ? 'sem ficha' : 'com ficha'}</span>
                  )}
                  {acesso.ligar && i.custoUnit == null && !bloqueadoPorComplemento(i, dados.custos) && (
                    <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); abrirLigar(i); }} className="block mt-1 text-[11.5px] font-bold text-amber-700 underline">Ligar</span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {/* Computador: tabela */}
          <div className="hidden lg:block bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-400 bg-zinc-50/60">
                <tr>
                  <th className="text-left font-bold px-3 py-2.5 w-10">#</th>
                  <th className="text-left font-bold px-3 py-2.5">Item</th>
                  <th className="text-right font-bold px-3 py-2.5">Vendidos</th>
                  <th className="text-right font-bold px-3 py-2.5">Faturado</th>
                  <th className="text-right font-bold px-3 py-2.5">Preço médio</th>
                  <th className="text-right font-bold px-3 py-2.5">Comida/un</th>
                  {verDinheiro && <th className="text-right font-bold px-3 py-2.5">Lucro bruto/un</th>}
                  <th className="text-left font-bold px-3 py-2.5">{verDinheiro ? 'Margem' : 'Ficha'}</th>
                  <th className="text-left font-bold px-3 py-2.5 w-32">Participação</th>
                </tr>
              </thead>
              <tbody>
                {mostrados.map((i, k) => (
                  <tr key={i.chave} onClick={() => setItemAberto(i.chave)} className="cursor-pointer hover:bg-amber-50/40">
                    <td className="px-3 py-2.5 border-t border-zinc-100 text-[13px] font-extrabold text-zinc-300 tabular-nums">{k + 1}</td>
                    <td className="px-3 py-2.5 border-t border-zinc-100">
                      <b className="text-[13.5px] text-zinc-900">{i.nome}</b>
                      {i.nivel === 'complemento' && i.grupo && <small className="block text-[11px] text-zinc-400">{i.grupo}</small>}
                    </td>
                    <td className="px-3 py-2.5 border-t border-zinc-100 text-right tabular-nums">{i.qtd.toLocaleString('pt-BR')}</td>
                    <td className="px-3 py-2.5 border-t border-zinc-100 text-right tabular-nums">{brl(i.faturado)}</td>
                    <td className="px-3 py-2.5 border-t border-zinc-100 text-right tabular-nums">{brl(i.precoMedio)}</td>
                    <td className="px-3 py-2.5 border-t border-zinc-100 text-right tabular-nums">{i.custoUnit == null ? <span className="text-zinc-300">—</span> : brl(i.custoUnit)}</td>
                    {verDinheiro && (
                      <td className={`px-3 py-2.5 border-t border-zinc-100 text-right tabular-nums font-bold ${i.sobraUnit != null && i.sobraUnit < 0 ? 'text-red-600' : ''}`}>
                        {i.sobraUnit == null ? <span className="text-zinc-300 font-normal">—</span> : brlSinal(i.sobraUnit)}
                        {i.fatorMedio && i.sobraUnit != null && <small className="block text-[10px] font-normal text-zinc-400">*média do período</small>}
                      </td>
                    )}
                    <td className="px-3 py-2.5 border-t border-zinc-100 whitespace-nowrap">
                      {verDinheiro
                        ? <SeloMargem i={i} bloqueado={bloqueadoPorComplemento(i, dados.custos)} />
                        : <span className={`text-[10.5px] font-extrabold rounded-md px-1.5 py-0.5 ${i.custoUnit == null ? COR_SELO.sem : COR_SELO.verde}`}>{i.custoUnit == null ? 'sem ficha' : 'com ficha'}</span>}
                      {acesso.ligar && i.custoUnit == null && !bloqueadoPorComplemento(i, dados.custos) && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); abrirLigar(i); }} className="ml-2 text-[12px] font-bold text-amber-700 hover:underline cursor-pointer">Ligar</button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 border-t border-zinc-100">
                      <span className="block h-1.5 rounded-full bg-zinc-100 overflow-hidden" title={totalFat > 0 ? `${((i.faturado / totalFat) * 100).toFixed(0)}% do total` : undefined}>
                        <span className="block h-full bg-amber-400 rounded-full" style={{ width: `${maxFat > 0 ? Math.max(3, (i.faturado / maxFat) * 100) : 0}%` }} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lista.length > mostrar && (
            <div className="flex justify-center"><button type="button" className={btn('out', 'sm')} onClick={() => setMostrar((m) => m + POR_PAGINA)}>Mostrar mais ({lista.length - mostrar})</button></div>
          )}
        </>
      )}

      {dados.erro && <Nota>Não deu para ler todos os custos agora ({dados.erro}). Os itens aparecem, mas a sobra pode estar incompleta.</Nota>}
      <Nota>
        <b>De onde vêm os números:</b>{' '}
        {fonte === 'cardapio' && periodoCardapio
          ? `itens do relatório de Cardápio importado do Portal do Parceiro (${ddmm(periodoCardapio.de)} a ${ddmm(periodoCardapio.ate)}). Ele não traz a taxa de cada pedido, então a sobra usa a média do período (*).`
          : 'cada pedido do iFood traz os itens na hora, e o lucro bruto usa o que chegou de cada pedido depois das taxas (estimado pela média da loja até o iFood fechar, no dia seguinte).'}
        {' '}A comida vem da ficha atual do item no estoque. Conta gerencial: não entra na DRE.
      </Nota>

      <Folha aberta={!!aberto} titulo="Conta do item" subtitulo={aberto?.nome} onFechar={() => setItemAberto(null)}
        rodape={aberto && acesso.ligar ? (
          <button type="button" className={`${btn(aberto.custoUnit == null ? 'p' : 'out')} flex-1`} onClick={() => abrirLigar(aberto)}>
            {aberto.tipoLigacao || aberto.custoUnit != null ? 'Trocar a ligação' : 'Ligar à ficha'}
          </button>
        ) : undefined}>
        {aberto && <ContaDoItem i={aberto} dinheiro={verDinheiro} bloqueado={bloqueadoPorComplemento(aberto, dados.custos)} />}
      </Folha>

      <LigarFichaFolha
        tenantId={tenantId}
        aberta={!!ligar && acesso.ligar}
        fila={ligar?.fila ?? []}
        indice={ligar?.indice ?? 0}
        troca={ligar?.troca}
        onFechar={() => setLigar(null)}
        // a folha já refez os custos (cache novo); aqui recarrega pedidos e dinheiro
        onLigou={() => { dados.recarregar(); }}
      />
    </div>
  );
}

function SeletorFonte({ fonte, onChange, periodoCardapio, primeiroDia }: {
  fonte: Fonte; onChange: (f: Fonte) => void; periodoCardapio: { de: string; ate: string } | null; primeiroDia: string | null;
}) {
  const opcoes: Array<{ id: Fonte; rotulo: string }> = [
    { id: 'pedidos', rotulo: 'Pedidos (automático)' },
    { id: 'cardapio', rotulo: `Relatório de Cardápio importado${periodoCardapio ? ` (${ddmm(periodoCardapio.de)} a ${ddmm(periodoCardapio.ate)})` : ''}` },
  ];
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl px-3 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-zinc-400">Fonte</span>
        <div className="flex gap-1 bg-zinc-100 rounded-xl p-0.5 flex-wrap">
          {opcoes.map((o) => (
            <button key={o.id} type="button" onClick={() => onChange(o.id)}
              className={`px-3 h-8 rounded-[10px] text-[12.5px] font-bold cursor-pointer ${fonte === o.id ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'}`}>{o.rotulo}</button>
          ))}
        </div>
      </div>
      <p className="text-[11.5px] text-zinc-400 mt-1.5">
        {primeiroDia ? `Os pedidos com itens começam em ${ddmm(primeiroDia)}; antes disso só o relatório importado cobre.` : 'Ainda não há pedido com itens neste período; o relatório importado cobre os dias de antes.'}
      </p>
    </div>
  );
}

function ContaDoItem({ i, dinheiro, bloqueado }: { i: ItemArea; dinheiro: boolean; bloqueado: boolean }) {
  const Linha = ({ rot, valor, sub, tom }: { rot: import('react').ReactNode; valor: string; sub?: string; tom?: 'red' | 'green' }) => (
    <div className="flex items-start justify-between gap-3 py-2.5 border-t border-zinc-100 first:border-t-0">
      <div className="min-w-0"><p className="text-[13.5px] text-zinc-700">{rot}</p>{sub && <p className="text-[11.5px] text-zinc-400 mt-0.5">{sub}</p>}</div>
      <b className={`text-[14px] font-extrabold tabular-nums whitespace-nowrap ${tom === 'red' ? 'text-red-600' : tom === 'green' ? 'text-emerald-700' : 'text-zinc-900'}`}>{valor}</b>
    </div>
  );
  const complemento = i.nivel === 'complemento';
  return (
    <div className="pb-2">
      <p className="text-xs text-zinc-500">
        {complemento ? `Complemento${i.grupo ? ` · ${i.grupo}` : ''}` : 'Item do iFood'} · vendeu {i.qtd.toLocaleString('pt-BR')} · {brl(i.faturado)}
      </p>
      <div className="mt-2">
        <Linha rot={complemento ? 'Preço médio no iFood' : 'Preço médio no iFood'} valor={brl(i.precoMedio)} />
        {dinheiro && !complemento && (
          <Linha rot="Chega na loja" valor={i.chegaUnit == null ? '—' : brl(i.chegaUnit)}
            sub={i.fator == null ? 'ainda sem o fechamento do iFood' : `de cada R$ 100, chegam R$ ${(i.fator * 100).toFixed(0)}${i.fatorMedio ? ' (média do período)' : ''}`} />
        )}
        <Linha rot="Comida" valor={i.custoUnit == null ? 'sem ficha' : brl(i.custoUnit)}
          sub={i.custoUnit == null
            ? (bloqueado ? 'a ficha do item existe, mas falta a de um complemento que cobra à parte' : 'ligue o item à ficha para entrar na conta')
            : descricaoLigacao(i)} />
        {dinheiro && !complemento && (
          <>
            <Linha rot={<>Lucro bruto por unidade <ExplicaLucro item /></>} valor={i.sobraUnit == null ? '—' : brlSinal(i.sobraUnit)} tom={i.sobraUnit == null ? undefined : i.sobraUnit < 0 ? 'red' : 'green'} />
            <Linha rot="Margem" valor={i.margem == null ? '—' : pct(i.margem)} tom={i.margem == null ? undefined : i.margem < 0 ? 'red' : 'green'} />
          </>
        )}
      </div>
      {complemento && <p className="text-[11.5px] text-zinc-400 mt-2">O valor do complemento já está dentro do preço do item; a conta do lucro bruto é feita no item.</p>}
      {dinheiro && !complemento && (i.precoEmpata != null || i.precoMesmoBalcao != null) && (
        <div className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-3 space-y-1.5">
          {i.precoEmpata != null && <p className="text-[13px] text-zinc-800">Preço que empata (lucro bruto zero): <b>{brl(i.precoEmpata)}</b></p>}
          {i.precoMesmoBalcao != null && (
            <p className="text-[13px] text-zinc-800">Para dar o mesmo lucro bruto do balcão: <b>{brl(i.precoMesmoBalcao)}</b>{i.precoBalcao != null ? <span className="text-zinc-500"> (balcão {brl(i.precoBalcao)})</span> : null}</p>
          )}
          <p className="text-[11.5px] text-zinc-500 leading-snug">É só uma sugestão: o preço do iFood muda no Portal do Parceiro, o ERPOS não altera.</p>
        </div>
      )}
    </div>
  );
}
