// Ação rápida: pedidos atrasados agora (só leitura).
// Fonte: KDSContext (mesma lista do Gestor de Pedidos: RPC fn_get_kds_orders da sessão aberta).
// Regras copiadas do Gestor de Pedidos:
//  - status do pedido derivado dos itens/unidades (gestor-pedidos/page.tsx › derivePedidoStatus);
//  - ATRASADO = não cancelado, status novo/preparo e aberto há mais de 20 min (page.tsx ›
//    pedidosAtrasados; GestorKanbanView › isAtrasado);
//  - delivery do link (plataforma 'propria') com prazo da faixa (orders.delivery_sla_min /
//    delivery_route_min): preparo atrasado e entrega atrasada (GestorKanbanView).
// Resposta em PAINEL (2026-09-18): contagem em destaque + lista dos pedidos atrasados (motivo em vermelho).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useKDS } from '@/contexts/KDSContext';
import type { KDSItem, KDSItemStatus, KDSPedido } from '@/types/kds';
import { Roteiro, useRoteiro, Fim, horaBR, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas } from '../painel';

const LIMITE_MIN = 20;

function statusItem(item: KDSItem): KDSItemStatus {
  if (item.unidades && item.unidades.length > 0) {
    const s = item.unidades.map((u) => u.status);
    if (s.every((x) => x === 'entregue')) return 'entregue';
    if (s.every((x) => x === 'pronto' || x === 'entregue')) return 'pronto';
    if (s.some((x) => x === 'preparo' || x === 'pronto')) return 'preparo';
    return 'novo';
  }
  return item.status;
}

function statusPedido(p: KDSPedido): KDSPedido['status'] {
  if (p.status === 'em_rota') return 'em_rota';
  const cozinha = p.itens.filter((i) => !i.semPreparo && !i.skip_kds).map(statusItem);
  const todos = p.itens.map(statusItem);
  const base = cozinha.length > 0 ? cozinha : todos;
  if (base.every((s) => s === 'entregue')) return 'entregue';
  if (base.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
  if (cozinha.length > 0 && base.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
  return 'novo';
}

const ORIGEM: Record<string, string> = { caixa: 'Caixa', garcom: 'Garçom', mesa: 'Mesa', autoatendimento: 'Totem', delivery: 'Delivery' };
const STATUS: Record<string, string> = { novo: 'na fila', preparo: 'em preparo', pronto: 'pronto', em_rota: 'em rota', entregue: 'entregue' };

function destino(p: KDSPedido): string {
  if (p.destino === 'mesa') return p.mesaNumero != null ? `Mesa ${p.mesaNumero}` : (p.nomeCliente ?? 'Mesa');
  if (p.destino === 'senha') return `Senha ${p.participantToken ?? p.senha ?? ''}`.trim();
  if (p.destino === 'nome' || p.destino === 'delivery') return p.nomeCliente ?? p.participantName ?? '';
  return 'Balcão';
}

export default function PedidosAtrasados({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { pedidos, loading, reloadOrders } = useKDS();
  const { baloes, bot, painel } = useRoteiro();
  const [passo, setPasso] = useState<'carregando' | 'fim'>('carregando');
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    (async () => {
      bot(`*Loja: ${user?.loja || 'loja ativa'}*`);
      if (!user?.tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
      await reloadOrders().catch(() => { /* usa a lista que já está na memória */ });
      setPasso('fim');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Monta a resposta quando a lista estiver pronta
  const respondeu = useRef(false);
  useEffect(() => {
    if (passo !== 'fim' || loading || respondeu.current || !user?.tenantId) return;
    respondeu.current = true;
    (async () => {
      const agora = Date.now();
      const abertos = pedidos
        .filter((p) => !p.isCancelled)
        .map((p) => ({ p, status: statusPedido(p), min: Math.floor((agora - p.criadoEm) / 60000) }))
        .filter((x) => x.status !== 'entregue');

      // Prazo por faixa dos deliveries do link (mesma leitura do GestorKanbanView)
      const idsLink = abertos.filter((x) => (x.p.origem === 'delivery' || x.p.destino === 'delivery') && x.p.deliveryPlatform === 'propria').map((x) => x.p.id);
      const sla: Record<string, { rota: number; total: number }> = {};
      if (idsLink.length) {
        const { data } = await supabase.from('orders').select('id, delivery_route_min, delivery_sla_min').in('id', idsLink);
        for (const r of (data ?? []) as { id: string; delivery_route_min: number | null; delivery_sla_min: number | null }[]) {
          if (r.delivery_sla_min != null && r.delivery_sla_min > 0) sla[r.id] = { rota: r.delivery_route_min ?? 0, total: r.delivery_sla_min };
        }
      }

      const linhas: { min: number; label: string; detalhe: string }[] = [];
      for (const { p, status, min } of abertos) {
        const motivos: string[] = [];
        if ((status === 'novo' || status === 'preparo') && min > LIMITE_MIN) motivos.push(`${min} min sem ficar pronto`);
        const s = sla[p.id];
        if (s) {
          const prazoPreparo = p.criadoEm + Math.max(0, s.total - (s.rota + 5)) * 60000;
          const prazoEntrega = p.criadoEm + s.total * 60000;
          if (agora > prazoEntrega) motivos.push(`passou do prazo de entrega (${horaBR(new Date(prazoEntrega).toISOString())})`);
          else if (agora > prazoPreparo && status !== 'pronto' && status !== 'em_rota') motivos.push(`passou do prazo de preparo (${horaBR(new Date(prazoPreparo).toISOString())})`);
        }
        if (!motivos.length) continue;
        const dest = destino(p);
        linhas.push({
          min,
          label: `#${p.numero} · ${ORIGEM[p.origem] ?? p.origem}${dest ? ` · ${dest}` : ''}`,
          detalhe: `entrou ${horaBR(new Date(p.criadoEm).toISOString())} · ${STATUS[status] ?? status} · ${motivos.join('; ')}`,
        });
      }

      if (!pedidos.length) {
        bot('Nenhum pedido na sessão aberta (ou não há sessão aberta).');
      } else if (!linhas.length) {
        bot(`✅ Nenhum pedido atrasado.\n${abertos.length} em aberto agora.`);
      } else {
        linhas.sort((a, b) => b.min - a.min);
        const mostra = linhas.slice(0, 15);
        painel(
          <Painel titulo="Pedidos atrasados" subtitulo={`atraso = mais de ${LIMITE_MIN} min sem ficar pronto, ou prazo do delivery vencido`}
            rodape={linhas.length > mostra.length ? `+${linhas.length - mostra.length} no Gestor de Pedidos` : undefined}>
            <Kpis principal={{ label: 'Atrasados', valor: String(linhas.length) }} outros={[{ label: 'Em aberto agora', valor: String(abertos.length) }]} />
            <Linhas itens={mostra.map((l) => ({ label: l.label, detalhe: l.detalhe, status: l.min > LIMITE_MIN * 2 ? ('perigo' as const) : ('alerta' as const) }))} />
          </Painel>,
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passo, loading]);

  return (
    <Roteiro titulo="Pedidos atrasados" icone="ri-alarm-warning-line" cor="bg-orange-50 text-orange-600" baloes={baloes}
      carregando={passo === 'carregando' || (passo === 'fim' && !respondeu.current && !!user?.tenantId)}
      textoCarregando="Olhando os pedidos…" onFechar={onFechar}>
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Gestor de Pedidos', onClick: () => irPara('/gestor-pedidos') }]} />
      )}
    </Roteiro>
  );
}
