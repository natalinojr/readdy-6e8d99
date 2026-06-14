import { useMemo, useEffect, useState, useCallback } from 'react';
import { useKDS } from '@/contexts/KDSContext';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { KDSPedido } from '@/types/kds';
import type { DestinoInfo } from '@/contexts/PDVContext';

export interface PedidoAgrupado {
  id: string;
  numero: number;
  numeroStr: string;
  total: number;
  criadoEm: number;
  itens: { nome: string; quantidade: number; preco: number }[];
  isCarrinho: boolean;
  destino?: 'mesa' | 'senha' | 'nome' | 'delivery' | 'hora';
  mesaNumero?: number;
  senha?: string;
  nomeCliente?: string;
  /** Senha do participante em pedidos de QR code universal (mesa sem número físico) */
  participantToken?: string | null;
}

function normalizarSenha(s: string | undefined): string {
  return (s ?? '').trim().toUpperCase();
}

function normalizarNome(s: string | undefined): string {
  return (s ?? '').trim().toUpperCase();
}

function normalizarTexto(s: string | undefined): string {
  return (s ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function usePedidosAgrupados(destino: DestinoInfo | null, carrinho: { nome: string; quantidade: number; precoTotal: number }[], totalCarrinho: number) {
  const { pedidos: kdsPedidos, reloadOrders: reloadKDS } = useKDS();
  const { user } = useAuth();
  const [pedidosDoBanco, setPedidosDoBanco] = useState<KDSPedido[]>([]);
  const [carregando, setCarregando] = useState(false);

  // Busca direta do banco como fallback quando o KDS pode estar desatualizado
  const buscarDoBanco = useCallback(async () => {
    if (!user?.tenantId) return;
    setCarregando(true);
    let cancelado = false;

    try {
      const { data, error } = await supabase.rpc('fn_get_kds_orders', {
        p_tenant_id: user.tenantId,
        p_session_id: null,
      });
      if (error || !data || cancelado) {
        if (error) console.warn('[usePedidosAgrupados] fn_get_kds_orders error:', error.message);
        return;
      }
      const orders = data as Array<{
        id: string;
        number?: string | null;
        status?: string | null;
        destination_type?: string | null;
        destination_name?: string | null;
        table_number?: number | null;
        customer_name?: string | null;
        is_paid?: boolean | null;
        total_amount?: number | null;
        created_at?: string | null;
        items?: Array<{
          item_name: string;
          quantity: number;
          item_price?: number | null;
        }>;
      }>;
      const mapeados: KDSPedido[] = orders.map((o) => {
        const destType = (o.destination_type ?? '').trim().toLowerCase();
        const destName = (o.destination_name ?? '').trim();
        let pedidoDestino: KDSPedido['destino'] = 'hora';
        let mesaNumero: number | undefined;
        let nomeCliente: string | undefined;
        let senha: string | undefined;

        if (destType === 'table' || destType === 'mesa') {
          pedidoDestino = 'mesa';
          mesaNumero = o.table_number ?? undefined;
          if (destName && !/^Mesa\s*\d*$/i.test(destName)) {
            nomeCliente = destName;
          }
        } else if (destType === 'password' || destType === 'senha') {
          pedidoDestino = 'senha';
          senha = destName || undefined;
        } else if (destType === 'name' || destType === 'nome') {
          pedidoDestino = 'nome';
          nomeCliente = destName || undefined;
        } else if (destType === 'delivery') {
          pedidoDestino = 'delivery';
          nomeCliente = destName || undefined;
        } else if (!destType && destName) {
          if (/^[A-Z]-\d+$/i.test(destName) || /^\d+$/.test(destName)) {
            pedidoDestino = 'senha';
            senha = destName;
          } else {
            pedidoDestino = 'nome';
            nomeCliente = destName;
          }
        }

        return {
          id: o.id,
          numero: parseInt((o.number ?? '').replace(/\D/g, '').slice(-4), 10) || 0,
          numeroStr: o.number ?? '',
          status: (o.status ?? 'novo') as KDSPedido['status'],
          destino: pedidoDestino,
          mesaNumero,
          nomeCliente,
          senha,
          origem: 'caixa',
          criadoEm: o.created_at ? new Date(o.created_at).getTime() : Date.now(),
          itens: (o.items ?? []).map((i) => ({
            id: `${o.id}-${i.item_name}`,
            nome: i.item_name,
            quantidade: i.quantity,
            item_price: i.item_price ?? 0,
            estacao: 'Cozinha',
            slaMinutos: 12,
            status: 'novo',
            entroKdsEm: Date.now(),
          })),
          totalAmount: o.total_amount ?? 0,
          isPaid: !!(o.is_paid),
          isCancelled: o.status === 'cancelled',
        } as KDSPedido;
      });
      if (!cancelado) {
        setPedidosDoBanco(mapeados);
      }
    } catch (e) {
      console.warn('[usePedidosAgrupados] buscarDoBanco error:', e);
    } finally {
      if (!cancelado) setCarregando(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    buscarDoBanco();
  }, [buscarDoBanco]);

  // Usa a união dos pedidos do KDS + do banco (remove duplicados)
  const todosPedidos = useMemo(() => {
    const map = new Map<string, KDSPedido>();
    for (const p of kdsPedidos) map.set(p.id, p);
    for (const p of pedidosDoBanco) {
      if (!map.has(p.id)) map.set(p.id, p);
    }
    return Array.from(map.values());
  }, [kdsPedidos, pedidosDoBanco]);

  const pedidosRelacionados = useMemo(() => {
    if (!destino) return [];

    const naoPagos = todosPedidos.filter((p) => {
      if (p.isPaid) return false;
      if (p.isCancelled) return false;
      if (p.status === 'cancelled') return false;

      // Match por destino
      if (destino.tipo === 'mesa' && destino.mesaNumero != null) {
        return p.destino === 'mesa' && p.mesaNumero === destino.mesaNumero;
      }
      if (destino.tipo === 'senha') {
        const match = p.destino === 'senha' && normalizarSenha(p.senha) === normalizarSenha(destino.senha);
        if (match) {
          console.log('[usePedidosAgrupados] Match senha:', normalizarSenha(p.senha), '===', normalizarSenha(destino.senha));
        }
        return match;
      }
      if (destino.tipo === 'nome') {
        return p.destino === 'nome' && normalizarNome(p.nomeCliente) === normalizarNome(destino.nomeCliente);
      }
      if (destino.tipo === 'delivery') {
        return p.destino === 'delivery' && normalizarNome(p.nomeCliente) === normalizarNome(destino.nomeCliente);
      }
      return false;
    });

    console.log('[usePedidosAgrupados] Encontrados', naoPagos.length, 'pedidos relacionados para', destino.tipo, destino.tipo === 'mesa' ? destino.mesaNumero : destino.tipo === 'senha' ? destino.senha : destino.nomeCliente);

    return naoPagos.map((p): PedidoAgrupado => ({
      id: p.id,
      numero: p.numero,
      numeroStr: p.numeroStr,
      total: p.totalAmount,
      criadoEm: p.criadoEm,
      itens: p.itens.map((i) => ({
        nome: i.nome,
        quantidade: i.quantidade,
        preco: i.item_price,
      })),
      isCarrinho: false,
      destino: p.destino,
      mesaNumero: p.mesaNumero,
      senha: p.senha,
      nomeCliente: p.nomeCliente,
      participantToken: p.participantToken,
    }));
  }, [todosPedidos, destino]);

  const carrinhoComoPedido: PedidoAgrupado | null = useMemo(() => {
    if (carrinho.length === 0) return null;
    return {
      id: 'carrinho-atual',
      numero: 0,
      numeroStr: 'NOVO',
      total: totalCarrinho,
      criadoEm: Date.now(),
      itens: carrinho.map((i) => ({
        nome: i.nome,
        quantidade: i.quantidade,
        preco: i.precoTotal,
      })),
      isCarrinho: true,
    };
  }, [carrinho, totalCarrinho]);

  const todosPedidosAbertos = useMemo(() => {
    const naoPagos = todosPedidos.filter((p) => {
      if (p.isPaid) return false;
      if (p.isCancelled) return false;
      if (p.status === 'cancelled') return false;
      return true;
    });

    return naoPagos.map((p): PedidoAgrupado => ({
      id: p.id,
      numero: p.numero,
      numeroStr: p.numeroStr,
      total: p.totalAmount,
      criadoEm: p.criadoEm,
      itens: p.itens.map((i) => ({
        nome: i.nome,
        quantidade: i.quantidade,
        preco: i.item_price,
      })),
      isCarrinho: false,
      destino: p.destino,
      mesaNumero: p.mesaNumero,
      senha: p.senha,
      nomeCliente: p.nomeCliente,
      participantToken: p.participantToken,
    }));
  }, [todosPedidos]);

  return { pedidosRelacionados, todosPedidosAbertos, carrinhoComoPedido, reloadOrders: buscarDoBanco, carregando };
}