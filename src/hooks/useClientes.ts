import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
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
  email: string | null;
  cpf: string | null;
  dataNascimento: string | null;
  genero: string | null;
  notes: string | null;
  manualTags: string[];
  aceitaMarketing: boolean;
  /** Quando pediu para não receber mensagens (opt-out do CRM, customers.crm_opt_out_at). */
  optOut?: string | null;
  ultimoContato: string | null;
  primeiraVisita: string;
  ultimaVisita: string;
  totalVisitas: number;
  valorTotal: number;
  ticketMedio: number;
  itensFavoritos: string[];
  pedidos: PedidoCliente[];
  tags: string[];
}

// Campos editáveis do cadastro/CRM enviados ao customer-write.
export interface ClientePatch {
  name?: string;
  phone?: string;
  birth_date?: string | null;
  gender?: string | null;
  email?: string | null;
  cpf?: string | null;
  notes?: string | null;
  manual_tags?: string[];
  accepts_marketing?: boolean;
}

function computeTags(c: Omit<ClienteCRM, 'tags' | 'itensFavoritos' | 'pedidos'>): string[] {
  // Cliente cadastrado mas que nunca comprou não é "inativo"/"frequente" —
  // é um lead novo. Classificar por recência aqui distorceria o CRM.
  if (c.totalVisitas === 0) return ['novo'];

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
  // Só a resposta da última consulta vale: ao trocar de loja com uma consulta ainda
  // no ar, a lista da loja anterior não pode aparecer na nova.
  const seq = useRef(0);

  // `silencioso`: recarrega sem trocar a lista pelo spinner (depois de editar um cliente).
  const carregar = useCallback(async (silencioso?: boolean) => {
    if (!user?.tenantId) return;
    const minha = ++seq.current;
    if (!silencioso) setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('fn_get_customers_list', {
        p_tenant_id: user.tenantId,
      });
      if (minha !== seq.current) return;
      if (rpcError) throw rpcError;

      const lista: ClienteCRM[] = ((data as Record<string, unknown>[]) ?? []).map((c) => {
        const base = {
          id: c.id as string,
          nome: c.nome as string,
          celular: (c.celular as string) ?? '',
          email: (c.email as string) ?? null,
          cpf: (c.cpf as string) ?? null,
          dataNascimento: (c.dataNascimento as string) ?? null,
          genero: (c.genero as string) ?? null,
          notes: (c.notes as string) ?? null,
          manualTags: (c.manualTags as string[]) ?? [],
          aceitaMarketing: !!c.aceitaMarketing,
          optOut: (c.optOut as string) ?? null,
          ultimoContato: (c.ultimoContato as string) ?? null,
          primeiraVisita: c.primeiraVisita as string,
          ultimaVisita: c.ultimaVisita as string,
          totalVisitas: (c.totalVisitas as number) ?? 0,
          valorTotal: parseFloat(String(c.valorTotal ?? 0)),
          ticketMedio: parseFloat(String(c.ticketMedio ?? 0)),
        };
        return {
          ...base,
          itensFavoritos: (c.itensFavoritos as string[]) ?? [],
          pedidos: [],
          tags: computeTags(base),
        };
      });

      setClientes(lista);
    } catch (e) {
      if (minha !== seq.current) return;
      setError('Não consegui carregar os clientes. Confira a internet e tente de novo.');
      console.error(e);
    } finally {
      if (minha === seq.current) setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    setClientes([]);
    carregar();
  }, [carregar]);

  // Edita cadastro/CRM via Edge Function (respeita RLS multi-loja) e recarrega.
  const atualizarCliente = useCallback(async (customerId: string, patch: ClientePatch) => {
    if (!user?.tenantId) throw new Error('Sem loja ativa');
    const { data, error: invErr } = await invokeWithAuth('customer-write', {
      body: { action: 'update_customer', active_tenant_id: user.tenantId, customer_id: customerId, ...patch },
    });
    if (invErr) throw new Error(typeof invErr === 'string' ? invErr : JSON.stringify(invErr));
    const resp = data as { error?: string };
    if (resp?.error) throw new Error(mensagemDeErroCliente(resp.error));
    await carregar(true);
  }, [user?.tenantId, carregar]);

  // Marca clientes como contatados agora (anti-spam). Não recarrega a lista.
  const registrarContato = useCallback(async (customerIds: string[]) => {
    if (!user?.tenantId || customerIds.length === 0) return;
    try {
      await invokeWithAuth('customer-write', {
        body: { action: 'touch_contact', active_tenant_id: user.tenantId, customer_ids: customerIds },
      });
    } catch (e) {
      console.warn('[useClientes] registrarContato falhou (não bloqueante):', e);
    }
  }, [user?.tenantId]);

  return { clientes, loading, error, recarregar: carregar, atualizarCliente, registrarContato };
}

/** Erro do customer-write em português (o 23505 do banco = celular/CPF já usado por outro cliente). */
function mensagemDeErroCliente(erro: string): string {
  if (/23505|duplicate key|unique/i.test(erro)) {
    if (/cpf/i.test(erro)) return 'Já existe outro cliente com este CPF nesta loja.';
    return 'Já existe outro cliente com este celular nesta loja.';
  }
  return erro;
}

export function useClientePedidos(clienteId: string | null) {
  const { user } = useAuth();
  const [pedidos, setPedidos] = useState<PedidoCliente[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!clienteId || !user?.tenantId) return;
    let vivo = true;
    setLoading(true);
    setErro(null);

    supabase
      .rpc('fn_get_customer_orders', {
        p_tenant_id: user.tenantId,
        p_customer_id: clienteId,
      })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { setErro('Não consegui carregar os pedidos deste cliente.'); setPedidos([]); return; }
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
      .then(() => { if (vivo) setLoading(false); }, () => { if (vivo) { setErro('Não consegui carregar os pedidos deste cliente.'); setLoading(false); } });
    return () => { vivo = false; };
  }, [clienteId, user?.tenantId, tentativa]);

  return { pedidos, loading, erro, tentarDeNovo: () => setTentativa((t) => t + 1) };
}
