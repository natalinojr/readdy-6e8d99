import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface PedidoCliente {
  id: string;
  data: string;
  valor: number;
  itens: string[];
  mesa: string;
  origem: string;
}

export interface ClienteCRM {
  id: string;
  nome: string;
  celular: string;
  dataNascimento: string | null;
  genero: string | null;
  primeiraVisita: string;
  ultimaVisita: string;
  totalVisitas: number;
  valorTotal: number;
  ticketMedio: number;
  itensFavoritos: string[];
  pedidos: PedidoCliente[];
  tags: string[];
}

function computeTags(c: Omit<ClienteCRM, 'tags' | 'itensFavoritos' | 'pedidos'>): string[] {
  const tags: string[] = [];
  const diasSemVisita = Math.floor(
    (Date.now() - new Date(c.ultimaVisita).getTime()) / (1000 * 60 * 60 * 24),
  );
  const primeiraVisitaDias = Math.floor(
    (Date.now() - new Date(c.primeiraVisita).getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diasSemVisita > 30) tags.push('inativo');
  else if (c.totalVisitas >= 8) tags.push('vip');
  else if (c.totalVisitas >= 4) tags.push('frequente');
  if (primeiraVisitaDias <= 30) tags.push('novo');

  return tags.length > 0 ? tags : ['frequente'];
}

export function useClientes() {
  const { user } = useAuth();
  const [clientes, setClientes] = useState<ClienteCRM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('fn_get_customers_list', {
        p_tenant_id: user.tenantId,
      });
      if (rpcError) throw rpcError;

      const lista: ClienteCRM[] = ((data as Record<string, unknown>[]) ?? []).map((c) => {
        const base = {
          id: c.id as string,
          nome: c.nome as string,
          celular: (c.celular as string) ?? '',
          dataNascimento: (c.dataNascimento as string) ?? null,
          genero: (c.genero as string) ?? null,
          primeiraVisita: c.primeiraVisita as string,
          ultimaVisita: c.ultimaVisita as string,
          totalVisitas: (c.totalVisitas as number) ?? 0,
          valorTotal: parseFloat(String(c.valorTotal ?? 0)),
          ticketMedio: parseFloat(String(c.ticketMedio ?? 0)),
        };
        return {
          ...base,
          itensFavoritos: [],
          pedidos: [],
          tags: computeTags(base),
        };
      });

      setClientes(lista);
    } catch (e) {
      setError('Erro ao carregar clientes');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return { clientes, loading, error, recarregar: carregar };
}

export function useClientePedidos(clienteId: string | null) {
  const { user } = useAuth();
  const [pedidos, setPedidos] = useState<PedidoCliente[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clienteId || !user?.tenantId) return;
    setLoading(true);

    supabase
      .rpc('fn_get_customer_orders', {
        p_tenant_id: user.tenantId,
        p_customer_id: clienteId,
      })
      .then(({ data }) => {
        const lista: PedidoCliente[] = ((data as Record<string, unknown>[]) ?? []).map((p) => ({
          id: p.id as string,
          data: p.data as string,
          valor: parseFloat(String(p.valor ?? 0)),
          itens: (p.itens as string[]) ?? [],
          mesa: (p.mesa as string) ?? '—',
          origem: (p.origem as string) ?? '',
        }));
        setPedidos(lista);
      })
      .finally(() => setLoading(false));
  }, [clienteId, user?.tenantId]);

  return { pedidos, loading };
}
