import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

export type ModoFaturamento = 'calendario' | 'sessao';

interface ModoFaturamentoContextData {
  modo: ModoFaturamento;
  setModo: (m: ModoFaturamento) => void;
  toggle: () => void;
}

const ModoFaturamentoContext = createContext<ModoFaturamentoContextData | null>(null);

const STORAGE_KEY = 'erpos_modo_faturamento';

export function ModoFaturamentoProvider({ children }: { children: ReactNode }) {
  const [modo, setModoState] = useState<ModoFaturamento>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'sessao' || saved === 'calendario') return saved;
    } catch { /* ignore */ }
    return 'calendario';
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, modo); } catch { /* ignore */ }
  }, [modo]);

  const setModo = useCallback((m: ModoFaturamento) => setModoState(m), []);
  const toggle = useCallback(() => setModoState(m => m === 'calendario' ? 'sessao' : 'calendario'), []);

  return (
    <ModoFaturamentoContext.Provider value={{ modo, setModo, toggle }}>
      {children}
    </ModoFaturamentoContext.Provider>
  );
}

export function useModoFaturamento() {
  const ctx = useContext(ModoFaturamentoContext);
  if (!ctx) throw new Error('useModoFaturamento must be used within ModoFaturamentoProvider');
  return ctx;
}
