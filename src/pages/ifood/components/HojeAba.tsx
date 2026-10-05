import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { ifoodShipping, type IfoodShippingConfig } from '@/lib/ifoodShipping';
import { culpaCancelamento, fetchPedidosIfood, mediana, type PedidoIfood } from '@/lib/ifoodDashboard';
import { itensDosPedidos, resumoItens as resumirItens, type PedidoArea } from '@/lib/ifoodArea';
import { somarDias, todayBrasilia } from '@/lib/dateUtils';
import type { InsumoSituacao } from '@/lib/estoqueRegras';
import { useEstoqueSituacao } from '@/hooks/useEstoqueSituacao';
import { btn, brl, brlInteiro, CartaoAcao, Faixa, Nota, SecaoTitulo, Vazio } from '@/pages/estoque/components/ui/EstoqueUi';
import { useIfoodDados } from '../lib/useIfoodDados';
import { nomeLoja, type AbaProps } from '../lib/tipos';
import LinhaPedido, { LinhaPedidoTabela, situacaoDaArea } from './LinhaPedido';
import ExplicaLucro from './ExplicaLucro';

// Aba "Hoje" da área iFood (protótipo docs/prototipos/ifood-proposta.html, tela "Hoje"). Abre aqui:
// uma frase com o dia, a situação de cada loja, "Precisa de você" (cada cartão com o botão que resolve),
// a faixa de números e os pedidos de hoje. O ERPOS não mexe no cardápio do iFood: o aviso de insumo
// acabando só diz o que pausar no Gestor do iFood.

const TZ = 'America/Sao_Paulo';
const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const pct = (v: number) => `${Math.round(v)}%`;
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** "terça, 30/09" a partir de AAAA-MM-DD. */
function diaExtenso(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00-03:00`);
  const sem = d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: TZ });
  return `${sem}, ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

/** O iFood devolve data/hora em UTC sem o "Z": sem fuso o navegador leria como hora local. */
const utc = (iso: string) => (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);

/** Computador (≥1024px): tabela; celular: lista em grupos. */
function useTelaLarga(): boolean {
  const consulta = '(min-width: 1024px)';
  const [larga, setLarga] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches);
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const mudar = () => setLarga(mq.matches);
    mq.addEventListener('change', mudar);
    return () => mq.removeEventListener('change', mudar);
  }, []);
  return larga;
}

// ── Situação das lojas ────────────────────────────────────────────────────────

interface StatusOp { operation?: string; state?: string; message?: { title?: string; subtitle?: string } }
interface PausaIfood { id: string; description?: string; start: string; end: string }
interface Overview { status: StatusOp[] | null; interruptions: PausaIfood[] | null }
/** undefined = ainda lendo; null = o iFood não respondeu (módulo ainda não liberado). */
type SituacaoLoja = Overview | null | undefined;

function lerSituacao(o: Overview | null): { cor: 'verde' | 'ambar' | 'vermelha' | 'cinza'; titulo: string; sub: string | null } | null {
  if (!o || !o.status || o.status.length === 0) return null;
  const s = o.status.find((x) => x.operation === 'DELIVERY') ?? o.status[0];
  const agora = Date.now();
  const pausa = (o.interruptions ?? []).find((p) => new Date(utc(p.start)).getTime() <= agora && new Date(utc(p.end)).getTime() > agora);
  if (pausa) return { cor: 'ambar', titulo: `em pausa até ${hhmm(new Date(utc(pausa.end)))}`, sub: pausa.description ?? null };
  const sub = s.message?.subtitle ?? s.message?.title ?? null;
  if (s.state === 'OK') return { cor: 'verde', titulo: 'aberta no iFood', sub };
  if (s.state === 'WARNING') return { cor: 'ambar', titulo: 'aberta no iFood, com um alerta', sub };
  if (s.state === 'CLOSED') return { cor: 'cinza', titulo: 'fechada no iFood', sub };
  return { cor: 'vermelha', titulo: 'com problema no iFood', sub };
}

const COR_BOLA = { verde: 'bg-emerald-500', ambar: 'bg-amber-400', vermelha: 'bg-red-500', cinza: 'bg-zinc-300' };

function LinhaLoja({ bola, titulo, sub, onClick, direita }: {
  bola?: 'verde' | 'ambar' | 'vermelha' | 'cinza' | 'apagada';
  titulo: ReactNode; sub?: ReactNode; onClick?: () => void; direita?: ReactNode;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <div className="flex items-center gap-3 bg-white border border-zinc-200 rounded-2xl px-3.5 py-2.5">
      <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={`flex items-center gap-3 flex-1 min-w-0 text-left ${onClick ? 'cursor-pointer' : ''}`}>
        {bola && <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${bola === 'apagada' ? 'border-2 border-zinc-300' : COR_BOLA[bola]}`} />}
        <span className="min-w-0 flex-1">
          <b className="block text-[13.5px] font-extrabold text-zinc-900 leading-snug">{titulo}</b>
          {sub && <span className="block text-[12px] text-zinc-500 leading-snug">{sub}</span>}
        </span>
      </Tag>
      {direita}
    </div>
  );
}

// ── Aba ───────────────────────────────────────────────────────────────────────

interface RepasseRow {
  data_repasse: string; esperado: number | string; depositos: number; recebido_inter: number | string; linhas_inter: number;
  detalhe?: { sem_conta?: boolean } | null;
}

export default function HojeAba({ tenantId, loja, lojas, acesso, dados, irPara, abrirPedido }: AbaProps) {
  const navigate = useNavigate();
  const telaLarga = useTelaLarga();
  const hoje = todayBrasilia();

  // ── Hoje (filtrado pela loja escolhida no topo)
  const pedidos = useMemo(() => dados.pedidos.filter((p) => !loja || p.loja === loja), [dados.pedidos, loja]);
  const validos = useMemo(() => pedidos.filter((p) => !p.cancelado), [pedidos]);
  const cancelados = useMemo(() => pedidos.filter((p) => p.cancelado), [pedidos]);
  const andando = useMemo(() => pedidos.filter((p) => situacaoDaArea(p).andando), [pedidos]);
  const feitos = useMemo(() => pedidos.filter((p) => !situacaoDaArea(p).andando), [pedidos]);

  const vendido = validos.reduce((s, p) => s + p.venda, 0);
  const comChega = validos.filter((p) => p.chega != null);
  const chega = comChega.reduce((s, p) => s + (p.chega ?? 0), 0);
  const vendidoComChega = comChega.reduce((s, p) => s + p.venda, 0);
  const sobraCompleta = validos.length > 0 && validos.every((p) => p.sobra != null);
  const sobra = validos.reduce((s, p) => s + (p.sobra ?? 0), 0);

  const promoLoja = validos.reduce((s, p) => s + p.promoLoja, 0);
  const promoIfood = validos.reduce((s, p) => s + p.promoIfood, 0);
  const comInfoCliente = validos.filter((p) => p.pedidosAntes != null);
  const novos = comInfoCliente.filter((p) => p.pedidosAntes === 0).length;
  const valorCancelado = cancelados.reduce((s, p) => s + (p.fin?.bruto || p.order?.subTotal || p.venda), 0);
  const minutosAteEntregar = useMemo(() => mediana(validos.map((p) => {
    const tl = p.order?.timeline;
    if (!tl?.CONCLUDED) return null;
    const ini = new Date(tl.PLACED ?? tl.CONFIRMED ?? p.at).getTime();
    const fim = new Date(tl.CONCLUDED).getTime();
    return Number.isFinite(ini) && Number.isFinite(fim) && fim > ini ? (fim - ini) / 60_000 : null;
  })), [validos]);

  // ── Situação das lojas (autorização dos pedidos + aberta/fechada no iFood)
  const [config, setConfig] = useState<IfoodShippingConfig | null | undefined>(undefined);
  const [situacoes, setSituacoes] = useState<Record<string, SituacaoLoja>>({});
  const chaveLojas = dados.lojas.map((l) => l.id).join(',');
  useEffect(() => {
    let vivo = true;
    setConfig(undefined);
    ifoodShipping<{ config: IfoodShippingConfig | null }>('get_config', tenantId).then((r) => { if (vivo) setConfig(r.success ? r.config ?? null : null); });
    return () => { vivo = false; };
  }, [tenantId]);

  const autorizada = (id: string) => !!config && config.order_enabled && (config.order_merchant_ids ?? []).includes(id);
  useEffect(() => {
    if (!config) return;
    let vivo = true;
    const ids = chaveLojas ? chaveLojas.split(',').filter(autorizada) : [];
    setSituacoes(Object.fromEntries(ids.map((id) => [id, undefined])));
    for (const id of ids) {
      ifoodShipping<{ status: StatusOp[] | null; interruptions: PausaIfood[] | null }>('merchant_overview', tenantId, { merchant_id: id }).then((r) => {
        if (!vivo) return;
        setSituacoes((s) => ({ ...s, [id]: r.success ? { status: r.status ?? null, interruptions: r.interruptions ?? null } : null }));
      });
    }
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, config, chaveLojas]);

  // ── Precisa de você: leitura de 30 dias
  const dados30 = useIfoodDados(tenantId, '30 dias');
  const pedidos30 = useMemo(() => dados30.pedidos.filter((p) => !loja || p.loja === loja), [dados30.pedidos, loja]);
  const itens30 = useMemo(() => itensDosPedidos(pedidos30, dados30.custos), [pedidos30, dados30.custos]);
  const resumo30 = useMemo(() => resumirItens(itens30), [itens30]);
  const fin30 = useMemo(() => dados30.fin.filter((p) => !loja || p.loja === loja), [dados30.fin, loja]);

  // c) Repasse da semana
  const [repasse, setRepasse] = useState<RepasseRow | null | undefined>(undefined);
  useEffect(() => {
    if (!acesso.financeiro) { setRepasse(null); return; }
    let vivo = true;
    setRepasse(undefined);
    (async () => {
      try {
        const { data, error } = await supabase.rpc('fin_ifood_repasses', { p_tenant: tenantId, p_from: somarDias(hoje, -10), p_to: hoje });
        if (!vivo) return;
        if (error) { setRepasse(null); return; }
        const linhas = ((data ?? []) as RepasseRow[]).filter((r) => r.data_repasse <= hoje).sort((a, b) => a.data_repasse.localeCompare(b.data_repasse));
        setRepasse(linhas[linhas.length - 1] ?? null);
      } catch { if (vivo) setRepasse(null); }
    })();
    return () => { vivo = false; };
  }, [tenantId, acesso.financeiro, hoje]);

  // e) Insumo acabando usado em item do iFood (mesma regra do Estoque: fn_estoque_situacao)
  const situacaoEstoque = useEstoqueSituacao({ ativo: acesso.itens });
  const [usos, setUsos] = useState<Array<{ insumo: InsumoSituacao; itens: string[] }> | undefined>(undefined);
  useEffect(() => {
    if (!acesso.itens) { setUsos([]); return; }
    const sit = situacaoEstoque.data;
    if (!sit) { setUsos(situacaoEstoque.error ? [] : undefined); return; }
    const baixos = sit.insumos.filter((i) => i.acompanha && (i.esgotado || i.abaixoMinimo));
    if (!baixos.length) { setUsos([]); return; }
    let vivo = true;
    (async () => {
      try {
        const links = await fetchAllRows<{ name: string; target_kind: string; menu_item_id: string | null; combo_id: string | null }>((f, t) =>
          supabase.from('ifood_item_links').select('name, target_kind, menu_item_id, combo_id')
            .eq('tenant_id', tenantId).eq('level', 'item').order('id').range(f, t));
        if (links.error) throw new Error(links.error.message);
        // Combo → itens do cardápio que o compõem.
        const comboIds = [...new Set(links.rows.map((l) => l.combo_id).filter((x): x is string => !!x))];
        const itensDoCombo = new Map<string, string[]>();
        for (const part of chunk(comboIds, 150)) {
          const { data } = await supabase.from('combo_items').select('combo_id, item_id').in('combo_id', part).is('deleted_at', null);
          for (const c of (data ?? []) as Array<{ combo_id: string; item_id: string }>) itensDoCombo.set(c.combo_id, [...(itensDoCombo.get(c.combo_id) ?? []), c.item_id]);
        }
        const menuItensDoLink = (l: { target_kind: string; menu_item_id: string | null; combo_id: string | null }): string[] =>
          l.target_kind === 'item' && l.menu_item_id ? [l.menu_item_id]
            : l.target_kind === 'combo' && l.combo_id ? itensDoCombo.get(l.combo_id) ?? [] : [];
        const todosItens = [...new Set(links.rows.flatMap(menuItensDoLink))];
        // item do cardápio → insumos da ficha
        const insumosDoItem = new Map<string, Set<string>>();
        for (const part of chunk(todosItens, 150)) {
          const { data, error } = await supabase.rpc('fn_get_item_ingredients_batch', { p_tenant_id: tenantId, p_item_ids: part });
          if (error) throw new Error(error.message);
          for (const r of (data ?? []) as Array<{ item_id: string; ingredient_id: string }>) {
            const s = insumosDoItem.get(r.item_id) ?? new Set<string>();
            s.add(r.ingredient_id);
            insumosDoItem.set(r.item_id, s);
          }
        }
        const baixosPorId = new Map(baixos.map((i) => [i.id, i]));
        const nomesPorInsumo = new Map<string, Set<string>>();
        for (const l of links.rows) {
          for (const itemId of menuItensDoLink(l)) {
            for (const ing of insumosDoItem.get(itemId) ?? []) {
              if (!baixosPorId.has(ing)) continue;
              const s = nomesPorInsumo.get(ing) ?? new Set<string>();
              s.add(l.name);
              nomesPorInsumo.set(ing, s);
            }
          }
        }
        if (!vivo) return;
        setUsos([...nomesPorInsumo.entries()]
          .map(([id, nomes]) => ({ insumo: baixosPorId.get(id)!, itens: [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')) }))
          .sort((a, b) => Number(b.insumo.esgotado) - Number(a.insumo.esgotado) || b.itens.length - a.itens.length));
      } catch { if (vivo) setUsos([]); }
    })();
    return () => { vivo = false; };
  }, [tenantId, acesso.itens, situacaoEstoque.data, situacaoEstoque.error]);

  // f) Loja que depende da promoção do iFood: 30 dias atuais × 30 anteriores
  const [anteriores, setAnteriores] = useState<PedidoIfood[] | null | undefined>(undefined);
  useEffect(() => {
    if (!acesso.dinheiro) { setAnteriores(null); return; }
    let vivo = true;
    setAnteriores(undefined);
    (async () => {
      try {
        const r = await fetchPedidosIfood(tenantId, `${somarDias(hoje, -59)}T00:00:00-03:00`, `${somarDias(hoje, -30)}T23:59:59-03:00`);
        if (vivo) setAnteriores(r.error ? null : r.pedidos);
      } catch { if (vivo) setAnteriores(null); }
    })();
    return () => { vivo = false; };
  }, [tenantId, acesso.dinheiro, hoje]);

  // ── Cartões ─────────────────────────────────────────────────────────────────
  const cartoes: ReactNode[] = [];

  // a) Itens sem ficha
  if (acesso.itens && resumo30.semFicha.length > 0) {
    const n = resumo30.semFicha.length;
    const faturadoSem = resumo30.semFicha.filter((i) => i.nivel === 'item').reduce((s, i) => s + i.faturado, 0);
    const parte = resumo30.faturado > 0 ? (faturadoSem / resumo30.faturado) * 100 : 0;
    const maior = resumo30.semFicha.find((i) => i.nivel === 'item') ?? resumo30.semFicha[0];
    cartoes.push(
      <CartaoAcao key="semficha" tom="prop" icone="ri-links-line"
        titulo={`${n} ${plural(n, 'item do iFood sem ficha', 'itens do iFood sem ficha')}`}
        direita={parte > 0 ? <span className="text-[13px] font-extrabold text-amber-700 whitespace-nowrap">{parte < 1 ? '<1%' : pct(parte)} das vendas</span> : undefined}
        acoes={<>
          {acesso.ligar && <button type="button" className={btn('p', 'sm')} onClick={() => irPara('itens', { ligar: '1' })}>Ligar à ficha</button>}
          <button type="button" className={btn('out', 'sm')} onClick={() => irPara('itens', { filtro: 'semficha' })}>Ver {n === 1 ? 'o item' : `os ${n}`}</button>
        </>}>
        Sem ficha não sei quanto custa a comida nem dou baixa no estoque. Em 30 dias o que mais vendeu sem ficha foi <b>{maior.nome}</b>.
      </CartaoAcao>,
    );
  }

  // b) Item que dá prejuízo (30 dias) e pedidos de hoje que deram prejuízo
  if (acesso.dinheiro) {
    const prej = [...resumo30.prejuizo].sort((a, b) => b.faturado - a.faturado).slice(0, 3);
    for (const it of prej) {
      cartoes.push(
        <CartaoAcao key={`prej-${it.chave}`} tom="alerta" icone="ri-coupon-3-line"
          titulo={`${it.nome} dá prejuízo`}
          direita={<span className="text-[13px] font-extrabold text-red-600 whitespace-nowrap">−{brl(Math.abs(it.sobraUnit ?? 0))}/un</span>}
          acoes={<>
            {acesso.itens && <button type="button" className={btn('out', 'sm')} onClick={() => irPara('itens', { item: it.chave })}>Ver a conta</button>}
            {it.precoEmpata != null && <span className="self-center text-[12.5px] font-bold text-zinc-500">Preço que empata: {brl(it.precoEmpata)}</span>}
          </>}>
          Vendeu <b>{it.qtd.toLocaleString('pt-BR')} em 30 dias</b>.{' '}
          {it.chegaUnit != null && it.custoUnit != null
            ? <>De {brl(it.precoMedio)} chegam {brl(it.chegaUnit)}; a comida custa {brl(it.custoUnit)}.</>
            : <>O preço médio é {brl(it.precoMedio)}.</>}
        </CartaoAcao>,
      );
    }
    for (const p of validos.filter((x) => x.sobra != null && x.sobra < -0.005).slice(0, 3)) {
      cartoes.push(
        <CartaoAcao key={`ped-${p.id}`} tom="alerta" icone="ri-error-warning-line"
          titulo={`${p.numero ? `#${p.numero}` : 'Um pedido'} deu prejuízo`}
          direita={<span className="text-[13px] font-extrabold text-red-600 whitespace-nowrap">−{brl(Math.abs(p.sobra ?? 0))}{p.estimado ? '*' : ''}</span>}
          acoes={<button type="button" className={btn('out', 'sm')} onClick={() => abrirPedido(p.id)}>Abrir o pedido</button>}>
          {p.promoLoja > 0.005 ? <>Desconto da loja {brl(p.promoLoja)}. </> : null}
          Chegam {p.chega != null ? brl(p.chega) : '—'} e a comida custa {p.comida != null ? brl(p.comida) : '—'}.
        </CartaoAcao>,
      );
    }
  }

  // c) Repasse da semana
  if (acesso.financeiro && repasse && !repasse.detalhe?.sem_conta) {
    const esp = Number(repasse.esperado) || 0;
    const rec = Number(repasse.recebido_inter) || 0;
    const dia = diaExtenso(repasse.data_repasse);
    if (esp > 1) {
      if (Math.abs(esp - rec) < 1) {
        if (hoje <= somarDias(repasse.data_repasse, 3)) {
          cartoes.push(
            <CartaoAcao key="repasse" tom="ok" icone="ri-bank-line" titulo={<>Caiu {brl(rec)} do iFood em {dia}, bateu com o banco ✓</>} />,
          );
        }
      } else if (repasse.data_repasse < hoje) {
        cartoes.push(
          <CartaoAcao key="repasse" tom="alerta" icone="ri-bank-line"
            titulo={<>Repasse de {dia}: o iFood disse {brl(esp)}, caiu {brl(rec)}</>}
            acoes={<button type="button" className={btn('out', 'sm')} onClick={() => irPara('dinheiro')}>Ver no Dinheiro</button>} />,
        );
      }
    }
  }

  // d) Cancelados que podem ter ressarcimento (só com motivo que não foi culpa da loja)
  if (acesso.financeiro) {
    const sem = fin30.filter((p) => p.cancelado && p.bruto > 0 && p.ajustes <= 0.005 && !!p.motivo && culpaCancelamento(p.motivo) !== 'loja');
    if (sem.length > 0) {
      const total = sem.reduce((s, p) => s + p.bruto, 0);
      cartoes.push(
        <CartaoAcao key="cancelados" tom="prop" icone="ri-refund-2-line"
          titulo={`${sem.length} ${plural(sem.length, 'pedido cancelado sem ressarcimento', 'pedidos cancelados sem ressarcimento')}`}
          direita={<span className="text-[13px] font-extrabold text-amber-700 whitespace-nowrap">{brl(total)}</span>}
          acoes={<button type="button" className={btn('out', 'sm')} onClick={() => irPara('dinheiro', { ver: 'cancelados' })}>Ver no Dinheiro</button>}>
          Não foi culpa da loja. Dá para pedir o ressarcimento no Portal do Parceiro (Pedidos › Contestar).
        </CartaoAcao>,
      );
    }
  }

  // e) Insumo acabando usado em item do iFood
  if (acesso.itens && usos) {
    for (const u of usos.slice(0, 3)) {
      const n = u.itens.length;
      const mostra = u.itens.slice(0, 3).join(', ');
      cartoes.push(
        <CartaoAcao key={`insumo-${u.insumo.id}`} tom="prop" icone="ri-error-warning-line"
          titulo={`${u.insumo.nome} ${u.insumo.esgotado ? 'acabou' : 'acabando'}`}
          direita={<span className="text-[12.5px] font-extrabold text-amber-700 whitespace-nowrap">usado em {n} {plural(n, 'item', 'itens')} do iFood</span>}
          acoes={<button type="button" className={btn('out', 'sm')} onClick={() => navigate('/estoque')}>Ver no estoque</button>}>
          {mostra}{n > 3 ? ` e mais ${n - 3}` : ''}. {u.insumo.esgotado ? 'Pause' : 'Se acabar, pause'} esses itens no Gestor do iFood.
        </CartaoAcao>,
      );
    }
  }

  // f) Loja que depende da promoção do iFood: avisa só a queda
  if (acesso.dinheiro && anteriores) {
    const parte = (lista: PedidoIfood[], id: string) => {
      const l = lista.filter((p) => p.loja === id && p.vendas > 0.005);
      const v = l.reduce((s, p) => s + p.vendas, 0);
      return { n: l.length, share: v > 0 ? l.reduce((s, p) => s + p.promoIfood, 0) / v : 0 };
    };
    for (const l of lojas.filter((x) => !loja || x.id === loja)) {
      const agora = parte(dados30.fin, l.id);
      const antes = parte(anteriores, l.id);
      if (agora.n >= 10 && antes.n >= 10 && agora.share >= 0.15 && agora.share < (antes.share * 2) / 3) {
        cartoes.push(
          <CartaoAcao key={`promo-${l.id}`} tom="prop" icone="ri-percent-line"
            titulo={`O iFood diminuiu a promoção da ${l.nome}`}
            acoes={acesso.resultados ? <button type="button" className={btn('out', 'sm')} onClick={() => irPara('resultados')}>Ver em Resultados</button> : undefined}>
            Pagava {pct(antes.share * 100)} das vendas, agora {pct(agora.share * 100)}.
          </CartaoAcao>,
        );
      }
    }
  }

  const lendoCartoes = dados30.carregando
    || (acesso.financeiro && repasse === undefined)
    || (acesso.itens && usos === undefined)
    || (acesso.dinheiro && anteriores === undefined);

  // ── Texto do topo ───────────────────────────────────────────────────────────
  const manchete = validos.length === 0 && cancelados.length === 0
    ? 'Nenhum pedido do iFood hoje ainda'
    : `Hoje no iFood: ${validos.length} ${plural(validos.length, 'pedido', 'pedidos')}, ${brlInteiro(vendido)}`;

  const linhasLojas = lojas.filter((l) => !loja || l.id === loja);
  const loadingTopo = dados.carregando && dados.pedidos.length === 0;

  if (loadingTopo) {
    return (
      <div className="space-y-4 animate-pulse" aria-busy="true">
        <div className="h-8 w-2/3 bg-zinc-100 rounded-xl" />
        <div className="h-4 w-1/2 bg-zinc-100 rounded-lg" />
        <div className="h-14 bg-zinc-100 rounded-2xl" />
        <div className="h-24 bg-zinc-100 rounded-2xl" />
        <div className="h-40 bg-zinc-100 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {dados.erro && <Nota className="!bg-red-50 !text-red-600">Não consegui ler tudo do iFood agora: {dados.erro}</Nota>}

      {/* Frase do dia */}
      <div>
        <h2 className="text-xl md:text-2xl font-extrabold text-zinc-900 tracking-tight">{manchete}</h2>
        {acesso.dinheiro && validos.length > 0 && (
          <p className="text-[13.5px] text-zinc-600 mt-1 leading-relaxed">
            {comChega.length > 0 && <>Chegam na loja uns <b>{brlInteiro(chega)}</b>{vendidoComChega > 0 ? ` (${pct((chega / vendidoComChega) * 100)})` : ''}. </>}
            {sobraCompleta
              ? <>Depois da comida, lucro bruto de uns <b>{brlInteiro(sobra)}</b> <ExplicaLucro />. </>
              : <>O lucro bruto aparece quando todos os itens tiverem ficha. </>}
            {andando.length > 0 && <>{andando.length} {plural(andando.length, 'pedido andando', 'pedidos andando')} agora.</>}
          </p>
        )}
        {!acesso.dinheiro && andando.length > 0 && (
          <p className="text-[13.5px] text-zinc-600 mt-1">{andando.length} {plural(andando.length, 'pedido andando', 'pedidos andando')} agora.</p>
        )}
      </div>

      {/* Situação das lojas */}
      {config && linhasLojas.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {linhasLojas.map((l) => {
            if (!autorizada(l.id)) {
              return (
                <LinhaLoja key={l.id} bola="apagada"
                  titulo={`${l.nome}: pedidos ainda não chegam aqui`}
                  sub="Falta autorizar essa loja"
                  direita={acesso.configurar ? <button type="button" className={btn('p', 'sm')} onClick={() => irPara('conexao')}>Autorizar</button> : undefined} />
              );
            }
            const sit = situacoes[l.id];
            const lida = sit === undefined ? null : lerSituacao(sit);
            if (sit === undefined) return <LinhaLoja key={l.id} titulo={l.nome} sub="Lendo a situação no iFood…" />;
            if (!lida) return <LinhaLoja key={l.id} titulo={l.nome} sub="A situação no iFood aparece quando o iFood liberar" />;
            return (
              <LinhaLoja key={l.id} bola={lida.cor} titulo={`${l.nome} ${lida.titulo}`} sub={lida.sub}
                onClick={() => irPara('loja')} direita={<i className="ri-arrow-right-s-line text-zinc-400" />} />
            );
          })}
        </div>
      )}

      {/* Precisa de você */}
      <div>
        <SecaoTitulo titulo="Precisa de você" n={cartoes.length > 0 ? cartoes.length : undefined} />
        {cartoes.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{cartoes}</div>
        ) : lendoCartoes ? (
          <div className="h-16 bg-zinc-100 rounded-2xl animate-pulse" aria-busy="true" />
        ) : (
          <CartaoAcao tom="ok" icone="ri-check-double-line" titulo="Nada para resolver no iFood agora" />
        )}
        {cartoes.length > 0 && lendoCartoes && <p className="text-[11px] text-zinc-400 mt-2 px-0.5">Ainda conferindo o resto…</p>}
      </div>

      {/* Números do dia */}
      {pedidos.length > 0 && (
        <Faixa itens={[
          { valor: validos.length, rotulo: plural(validos.length, 'pedido', 'pedidos') },
          { valor: brl(vendido), rotulo: 'vendido', tom: 'green' },
          { valor: validos.length ? brl(vendido / validos.length) : '—', rotulo: 'ticket médio' },
          { valor: minutosAteEntregar != null ? `${Math.round(minutosAteEntregar)} min` : '—', rotulo: 'até entregar (média)' },
          { valor: cancelados.length, rotulo: cancelados.length ? `cancelado${cancelados.length > 1 ? 's' : ''} · ${brl(valorCancelado)}` : 'cancelados', tom: cancelados.length ? 'red' : 'neutro' },
          { valor: `${brlInteiro(promoLoja)} · ${brlInteiro(promoIfood)}`, rotulo: 'descontos (loja · iFood)' },
          { valor: comInfoCliente.length ? `${novos} de ${comInfoCliente.length}` : '—', rotulo: 'clientes novos' },
        ]} />
      )}

      {/* Pedidos de hoje */}
      <div>
        <SecaoTitulo titulo="Pedidos de hoje"
          direita={<button type="button" onClick={() => irPara('pedidos')} className="text-[13px] font-extrabold text-amber-700 hover:text-amber-600 cursor-pointer">ver todos</button>} />
        {pedidos.length === 0 ? (
          <Vazio icone="ri-e-bike-2-line" titulo="Nenhum pedido do iFood hoje ainda">Quando chegar um pedido, ele aparece aqui na hora.</Vazio>
        ) : telaLarga ? (
          <TabelaHoje pedidos={pedidos} lojas={lojas} mostrarLoja={!loja && lojas.length > 1} dinheiro={acesso.dinheiro} onAbrir={abrirPedido} />
        ) : (
          <div className="space-y-3">
            {andando.length > 0 && (
              <GrupoLista titulo="Andando" n={andando.length} pedidos={andando} lojas={lojas} mostrarLoja={!loja && lojas.length > 1} dinheiro={acesso.dinheiro} onAbrir={abrirPedido} />
            )}
            {feitos.length > 0 && (
              <GrupoLista titulo="Feitos" n={feitos.length} pedidos={feitos.slice(0, 8)} lojas={lojas} mostrarLoja={!loja && lojas.length > 1} dinheiro={acesso.dinheiro} onAbrir={abrirPedido}
                rodape={feitos.length > 8 ? <button type="button" onClick={() => irPara('pedidos')} className={`${btn('ghost', 'sm')} w-full mt-1`}>Ver os outros {feitos.length - 8}</button> : undefined} />
            )}
          </div>
        )}
      </div>

      <Nota>
        Pedido e itens chegam na hora. Taxas, promoções e repasse chegam no dia seguinte; até lá a sobra é estimada pela média da loja (marcada com *).
      </Nota>
    </div>
  );
}

function GrupoLista({ titulo, n, pedidos, lojas, mostrarLoja, dinheiro, onAbrir, rodape }: {
  titulo: string; n: number; pedidos: PedidoArea[]; lojas: AbaProps['lojas']; mostrarLoja: boolean; dinheiro: boolean;
  onAbrir: (id: string) => void; rodape?: ReactNode;
}) {
  return (
    <div>
      <p className="text-[12px] font-extrabold uppercase tracking-wide text-zinc-400 mb-1.5 px-0.5">{titulo} <span className="text-zinc-500">{n}</span></p>
      <div className="bg-white border border-zinc-200 rounded-2xl px-3">
        {pedidos.map((p) => (
          <LinhaPedido key={p.id} p={p} onAbrir={onAbrir} mostrarDinheiro={dinheiro} nomeLoja={mostrarLoja ? nomeLoja(lojas, p.loja) : undefined} />
        ))}
      </div>
      {rodape}
    </div>
  );
}

function TabelaHoje({ pedidos, lojas, mostrarLoja, dinheiro, onAbrir }: {
  pedidos: PedidoArea[]; lojas: AbaProps['lojas']; mostrarLoja: boolean; dinheiro: boolean; onAbrir: (id: string) => void;
}) {
  const th = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-zinc-400 whitespace-nowrap';
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-zinc-50">
            <th className={th}>Nº</th>
            <th className={th}>Cliente</th>
            <th className={th}>Itens</th>
            <th className={th}>Situação</th>
            <th className={`${th} text-right`}>Venda</th>
            {dinheiro && <th className={`${th} text-right`}>Lucro bruto</th>}
          </tr>
        </thead>
        <tbody>
          {pedidos.map((p) => (
            <LinhaPedidoTabela key={p.id} p={p} onAbrir={onAbrir} mostrarDinheiro={dinheiro} nomeLoja={mostrarLoja ? nomeLoja(lojas, p.loja) : undefined} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
