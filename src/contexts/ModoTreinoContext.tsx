import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

interface ModoTreinoContextType {
  isModoTreino: boolean;
}

const ModoTreinoContext = createContext<ModoTreinoContextType>({ isModoTreino: false });

export function ModoTreinoProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isModoTreino = useMemo(() => user?.modoTreino === true, [user]);

  return (
    <ModoTreinoContext.Provider value={{ isModoTreino }}>
      {children}
    </ModoTreinoContext.Provider>
  );
}

export function useModoTreino(): ModoTreinoContextType {
  return useContext(ModoTreinoContext);
}
