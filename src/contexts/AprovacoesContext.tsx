import { createContext, useContext, useState, useCallback } from 'react';

export type TipoProblema = 'item_errado' | 'nao_chegou' | 'qualidade' | 'quantidade' | 'alergia' | 'outro';
export type ResolucaoDesejada = 'substituicao' | 'reembolso' | 'desconto' | 'registro';
export type StatusAprovacao = 'pendente' | 'aprovado' | 'rejeitado';

export interface ItemPedidoResumo {
  nome: string;
  quantidade: number;
  precoTotal: number;
  opcoes?: string[];
  observacoes?: string[];
}

export interface SolicitacaoAprovacao {
  id: string;
  tipo: 'problema_item' | 'desconto' | 'cancelamento';
  tipoProblema?: TipoProblema;
  resolucaoDesejada?: ResolucaoDesejada;
  mesaNome: string;
  garcomNome: string;
  itemNome: string;
  descricao: string;
  urgente: boolean;
  status: StatusAprovacao;
  criadoEm: string;
  criadoEmTs: number;
  resolvido?: string;
  resolvidoPor?: string;
  // Campos específicos para solicitações de desconto
  valorDesconto?: number;
  approvalId?: string;
  onApproved?: (approverName: string) => void;
  onDenied?: () => void;
  // Itens do pedido para contexto do gerente
  itensPedido?: ItemPedidoResumo[];
  totalPedido?: number;
}

interface AprovacoesContextValue {
  solicitacoes: SolicitacaoAprovacao[];
  addSolicitacao: (s: Omit<SolicitacaoAprovacao, 'id' | 'status' | 'criadoEm' | 'criadoEmTs'>) => void;
  aprovar: (id: string, resolvidoPor: string) => void;
  rejeitar: (id: string, resolvidoPor: string) => void;
  pendentesCount: number;
}

const AprovacoesContext = createContext<AprovacoesContextValue | null>(null);

export function AprovacoesProvider({ children }: { children: React.ReactNode }) {
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoAprovacao[]>([]);

  const addSolicitacao = useCallback((s: Omit<SolicitacaoAprovacao, 'id' | 'status' | 'criadoEm' | 'criadoEmTs'>) => {
    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setSolicitacoes((prev) => [
      {
        ...s,
        id: `apr-${Date.now()}`,
        status: 'pendente',
        criadoEm: agora,
        criadoEmTs: Date.now(),
      },
      ...prev,
    ]);
  }, []);

  const aprovar = useCallback((id: string, resolvidoPor: string) => {
    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setSolicitacoes((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          s.onApproved?.(resolvidoPor);
          return { ...s, status: 'aprovado', resolvido: agora, resolvidoPor };
        }
        return s;
      })
    );
  }, []);

  const rejeitar = useCallback((id: string, resolvidoPor: string) => {
    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setSolicitacoes((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          s.onDenied?.();
          return { ...s, status: 'rejeitado', resolvido: agora, resolvidoPor };
        }
        return s;
      })
    );
  }, []);

  const pendentesCount = solicitacoes.filter((s) => s.status === 'pendente').length;

  return (
    <AprovacoesContext.Provider value={{ solicitacoes, addSolicitacao, aprovar, rejeitar, pendentesCount }}>
      {children}
    </AprovacoesContext.Provider>
  );
}

export function useAprovacoes() {
  const ctx = useContext(AprovacoesContext);
  if (!ctx) throw new Error('useAprovacoes must be inside AprovacoesProvider');
  return ctx;
}
