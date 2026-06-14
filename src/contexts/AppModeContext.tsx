import { createContext, useContext, useState, useCallback } from 'react';

export type AppMode =
  | 'modulos'
  | 'gestao'
  | 'pdv_caixa'
  | 'pdv_garcom'
  | 'pdv_delivery'
  | 'kds'
  | 'gestor_pedidos'
  | 'gestor_delivery';

interface AppModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const AppModeContext = createContext<AppModeContextValue | null>(null);

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(() => {
    const saved = localStorage.getItem('erpos_app_mode');
    return (saved as AppMode) ?? 'modulos';
  });

  const setMode = useCallback((m: AppMode) => {
    setModeState(m);
    localStorage.setItem('erpos_app_mode', m);
  }, []);

  return (
    <AppModeContext.Provider value={{ mode, setMode }}>
      {children}
    </AppModeContext.Provider>
  );
}

export function useAppMode(): AppModeContextValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error('useAppMode must be inside AppModeProvider');
  return ctx;
}
