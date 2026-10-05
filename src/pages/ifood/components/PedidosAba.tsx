import { useEffect, useMemo, useState } from 'react';
import { valorDaBusca } from '@/lib/pedidosRegras';
import type { PedidoArea } from '@/lib/ifoodArea';
import { Chips, Faixa, MenuMais, Vazio, brl, semAcento, type OpcaoChip } from '@/pages/estoque/components/ui/EstoqueUi';
import { dateKeyBrasilia } from '@/lib/dateUtils';
import { nomeLoja, type AbaProps } from '../lib/tipos';
import LinhaPedido, { LinhaPedidoTabela, situacaoDaArea } from './LinhaPedido';
import DetalhePedidoIfood from './DetalhePedidoIfood';
import { rotuloPeriodo } from './PeriodoFolha';

// Aba Pedidos da área iFood (protótipo docs/prototipos/ifood-proposta.html): uma linha por pedido, com o
// que o cliente pediu, o desconto (loja × iFood), quanto o iFood ficou e quanto sobrou. No computador o
// pedido abre ao lado da lista; no celular abre a folha (a página cuida disso por abrirPedido).

type Filtro = 'todos' | 'andando' | 'prejuizo' | 'descontoLoja' | 'novos' | 'semFicha' | 'cancelados';

const soDinheiro = (v: number) => v.toFixed(2).replace('.', ',');
const celula = (v: string | number) => {
  const t = String(v);
  const seguro = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return `"${seguro.replace(/"/g, '""')}"`;
};

/** Frase do período: "hoje", "ontem", "nos últimos 7 dias", "em Setembro". */
function quando(periodo: string): string {
  if (periodo === 'Hoje') return 'hoje';
  if (periodo === 'Ontem') return 'ontem';
  if (periodo === '7 dias') return 'nos últimos 7 dias';
  if (periodo === '30 dias') return 'nos últimos 30 dias';
  if (periodo === 'Este mês') return 'este mês';
  return `em ${rotuloPeriodo(periodo)}`;
}

/** Acha por nº do iFood (inteiro ou final), cliente, item/complemento e valor — sem acento. */
function buscaIfood(p: PedidoArea, termo: string): boolean {
  const q = semAcento(termo).replace(/^#/, '');
  if (!q) return true;
  const valor = valorDaBusca(q);
  if (valor != null && [p.venda, p.order?.subTotal, p.order?.clientePagou].some((v) => v != null && Math.abs(v - valor) < 0.005)) return true;
  const num = (p.numero ?? '').toLowerCase();
  if (/^\d+$/.test(q) && num && (num === q || num.replace(/^0+/, '') === q.replace(/^0+/, '') || (q.length >= 3 && num.endsWith(q)))) return true;
  const campos: (string | null | undefined)[] = [
    /^\d+$/.test(q) ? null : p.numero, p.cliente, p.id,
    ...(p.order?.itens ?? []).flatMap((i) => [i.nome, ...i.complementos.map((c) => c.nome)]),
  ];
  return campos.some((c) => c != null && semAcento(String(c)).includes(q));
}

function useTelaGrande(): boolean {
  const q = '(min-width: 1024px)';
  const [grande, setGrande] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setGrande(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return grande;
}

function baixarPlanilha(lista: PedidoArea[], lojas: AbaProps['lojas'], periodo: string, dinheiro: boolean) {
  const cab = ['Nº do iFood', 'Data', 'Hora', 'Loja', 'Cliente', 'Cliente novo?', 'Itens', 'Venda (R$)', 'Desconto da loja (R$)', 'Desconto do iFood (R$)',
    ...(dinheiro ? ['Comissão e taxas (R$)', 'Chega na loja (R$)', 'Comida (R$)', 'Sobra (R$)', 'Estimado?'] : [])];
  const linhas = lista.map((p) => {
    const d = p.at.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const h = p.at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const itens = p.order ? p.order.itens.map((i) => `${i.qtd}x ${i.nome}`).join(' | ') : 'Itens não disponíveis';
    const novo = p.pedidosAntes == null ? '' : p.pedidosAntes <= 0 ? 'sim' : 'não';
    const v = (n: number | null) => (n == null ? '' : soDinheiro(n));
    return [
      p.numero ?? '', d, h, nomeLoja(lojas, p.loja), p.cliente ?? '', novo, itens, soDinheiro(p.venda), soDinheiro(p.promoLoja), soDinheiro(p.promoIfood),
      ...(dinheiro ? [v(p.comissaoETaxas), v(p.chega), v(p.comida), v(p.sobra), p.estimado ? 'sim' : 'não'] : []),
    ];
  });
  const csv = [cab, ...linhas].map((l) => l.map(celula).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pedidos-ifood_${periodo.replace(/\//g, '-').replace(/[\s→:]+/g, '_')}_${dateKeyBrasilia(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PedidosAba({ tenantId, loja, lojas, periodo, acesso, dados, abrirPedido }: AbaProps) {
  const grande = useTelaGrande();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);

  const todos = useMemo(() => dados.pedidos.filter((p) => !loja || p.loja === loja), [dados.pedidos, loja]);
  const validos = useMemo(() => todos.filter((p) => !p.cancelado), [todos]);
  const cancelados = todos.length - validos.length;

  const resumo = useMemo(() => {
    const vendido = validos.reduce((s, p) => s + p.venda, 0);
    return {
      n: validos.length,
      vendido,
      chega: validos.reduce((s, p) => s + (p.chega ?? 0), 0),
      semChega: validos.some((p) => p.chega == null),
      algumChega: validos.some((p) => p.chega != null),
      descLoja: validos.reduce((s, p) => s + p.promoLoja, 0),
      descIfood: validos.reduce((s, p) => s + p.promoIfood, 0),
      novos: validos.filter((p) => p.pedidosAntes === 0).length,
      ticket: validos.length ? vendido / validos.length : 0,
    };
  }, [validos]);

  const contagens = useMemo(() => ({
    andando: todos.filter((p) => !p.cancelado && situacaoDaArea(p).andando).length,
    prejuizo: acesso.dinheiro ? todos.filter((p) => p.sobra != null && p.sobra < -0.005).length : 0,
    descontoLoja: todos.filter((p) => p.promoLoja > 0.005).length,
    novos: todos.filter((p) => p.pedidosAntes === 0).length,
    semFicha: todos.filter((p) => !p.cancelado && p.semFicha.length > 0).length,
    cancelados,
  }), [todos, acesso.dinheiro, cancelados]);

  const opcoes: OpcaoChip<Filtro>[] = [
    { id: 'todos', rotulo: 'Todos', n: todos.length },
    ...([
      { id: 'andando', rotulo: 'Andando', n: contagens.andando, tom: 'amber' },
      { id: 'prejuizo', rotulo: 'Deram prejuízo', n: contagens.prejuizo, tom: 'red' },
      { id: 'descontoLoja', rotulo: 'Com desconto da loja', n: contagens.descontoLoja },
      { id: 'novos', rotulo: 'Clientes novos', n: contagens.novos },
      { id: 'semFicha', rotulo: 'Item sem ficha', n: contagens.semFicha },
      { id: 'cancelados', rotulo: 'Cancelados', n: contagens.cancelados },
    ] as OpcaoChip<Filtro>[]).filter((o) => (o.n ?? 0) > 0),
  ];
  // Filtro que zerou (ex.: último "andando" terminou) volta para Todos.
  useEffect(() => { if (filtro !== 'todos' && !opcoes.some((o) => o.id === filtro)) setFiltro('todos'); });

  const lista = useMemo(() => todos.filter((p) => {
    if (filtro === 'andando' && (p.cancelado || !situacaoDaArea(p).andando)) return false;
    if (filtro === 'prejuizo' && !(acesso.dinheiro && p.sobra != null && p.sobra < -0.005)) return false;
    if (filtro === 'descontoLoja' && p.promoLoja <= 0.005) return false;
    if (filtro === 'novos' && p.pedidosAntes !== 0) return false;
    if (filtro === 'semFicha' && (p.cancelado || p.semFicha.length === 0)) return false;
    if (filtro === 'cancelados' && !p.cancelado) return false;
    return buscaIfood(p, busca);
  }), [todos, filtro, busca, acesso.dinheiro]);

  const selecionado = useMemo(() => (aberto ? lista.find((p) => p.id === aberto) ?? null : null), [lista, aberto]);
  const multiLoja = !loja && lojas.length > 1;
  const aoAbrir = (id: string) => { if (grande) setAberto((a) => (a === id ? null : id)); else abrirPedido(id); };

  if (dados.carregando && todos.length === 0) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  const menu = (
    <MenuMais itens={[
      { rotulo: 'Baixar planilha', icone: 'ri-file-excel-2-line', onClick: () => baixarPlanilha(lista, lojas, periodo, acesso.dinheiro), oculto: lista.length === 0 },
      { rotulo: 'Atualizar agora', icone: 'ri-refresh-line', onClick: () => { dados.recarregar(); } },
    ]} />
  );

  if (todos.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0"><h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-zinc-900">Nenhum pedido do iFood neste período</h1></div>
          {menu}
        </div>
        <Vazio icone="ri-file-list-3-line" titulo="Nenhum pedido do iFood neste período">
          Troque o período lá em cima ou espere o próximo pedido chegar.
        </Vazio>
      </div>
    );
  }

  const tabela = (
    <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden min-w-0">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[11px] font-extrabold uppercase tracking-wide text-zinc-400">
            <th className="px-3 py-2">Nº</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Itens</th><th className="px-3 py-2">Situação</th>
            <th className="px-3 py-2 text-right">Venda</th>{acesso.dinheiro && <th className="px-3 py-2 text-right">Sobra</th>}
          </tr>
        </thead>
        <tbody>
          {lista.map((p) => (
            <LinhaPedidoTabela key={p.id} p={p} onAbrir={aoAbrir} mostrarDinheiro={acesso.dinheiro} nomeLoja={multiLoja ? nomeLoja(lojas, p.loja) : undefined} selecionado={p.id === aberto} />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-zinc-900">
            {resumo.n} pedido{resumo.n === 1 ? '' : 's'} {quando(periodo)}{cancelados > 0 ? ` · ${cancelados} cancelado${cancelados === 1 ? '' : 's'}` : ''}
          </h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">
            Cada pedido com o que o cliente pediu, o desconto (loja × iFood){acesso.dinheiro ? ', quanto o iFood ficou e quanto sobrou' : ''}.
          </p>
        </div>
        {menu}
      </div>

      <Faixa itens={[
        { valor: resumo.n, rotulo: 'pedidos' },
        { valor: brl(resumo.vendido), rotulo: 'vendido' },
        ...(acesso.dinheiro ? [{ valor: resumo.algumChega ? `${resumo.semChega ? '~' : ''}${brl(resumo.chega)}` : '—', rotulo: 'chega na loja', tom: 'green' as const }] : []),
        { valor: brl(resumo.descLoja), rotulo: 'descontos da loja', tom: resumo.descLoja > 0.005 ? 'amber' as const : 'neutro' as const },
        { valor: brl(resumo.descIfood), rotulo: 'descontos do iFood' },
        { valor: resumo.novos, rotulo: 'clientes novos' },
        { valor: brl(resumo.ticket), rotulo: 'ticket médio' },
      ]} />

      <div className="relative">
        <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nº do iFood, cliente, item ou valor…"
          className="w-full h-11 pl-10 pr-3 rounded-xl border border-zinc-200 bg-white text-[14px] focus:outline-none focus:border-amber-400" />
      </div>
      <Chips<Filtro> opcoes={opcoes} valor={filtro} onChange={setFiltro} />

      {lista.length === 0 ? (
        <Vazio icone="ri-search-line" titulo="Nenhum pedido assim">Tire o filtro ou mude a busca.</Vazio>
      ) : grande ? (
        <div className={selecionado ? 'grid gap-4 grid-cols-[minmax(0,1fr)_380px] items-start' : ''}>
          {tabela}
          {selecionado && (
            <div className="bg-white border border-zinc-200 rounded-2xl p-4 sticky top-2 max-h-[calc(100dvh-120px)] overflow-y-auto">
              <DetalhePedidoIfood p={selecionado} lojas={lojas} acesso={acesso} tenantId={tenantId} modo="painel"
                onFechar={() => setAberto(null)} onMudou={() => dados.recarregar()} />
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-2xl px-3">
          {lista.map((p) => (
            <LinhaPedido key={p.id} p={p} onAbrir={aoAbrir} mostrarDinheiro={acesso.dinheiro} nomeLoja={multiLoja ? nomeLoja(lojas, p.loja) : undefined} />
          ))}
        </div>
      )}

      {lista.some((p) => !p.order) && <p className="text-[11px] text-zinc-400 bg-zinc-50 rounded-xl px-3 py-2">Itens não disponíveis: pedido de antes de ligar os pedidos no ERPOS (só o dinheiro foi lido).</p>}
    </div>
  );
}
