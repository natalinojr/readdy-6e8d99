import { createContext, useContext, useState, useCallback } from 'react';

interface EdicaoInfo {
  mesaNumero: number;
  iniciadaEm: number;
}

interface MesaEdicaoCtx {
  /** Mesa numbers currently being edited by the customer */
  edicoes: EdicaoInfo[];
  iniciarEdicao: (mesaNumero: number) => void;
  finalizarEdicao: (mesaNumero: number) => void;
  estaEmEdicao: (mesaNumero: number) => boolean;
}

const MesaEdicaoContext = createContext<MesaEdicaoCtx>({
  edicoes: [],
  iniciarEdicao: () => {},
  finalizarEdicao: () => {},
  estaEmEdicao: () => false,
});

export function MesaEdicaoProvider({ children }: { children: React.ReactNode }) {
  const [edicoes, setEdicoes] = useState<EdicaoInfo[]>([]);

  const iniciarEdicao = useCallback((mesaNumero: number) => {
    setEdicoes((prev) => {
      if (prev.some((e) => e.mesaNumero === mesaNumero)) return prev;
      return [...prev, { mesaNumero, iniciadaEm: Date.now() }];
    });
  }, []);

  const finalizarEdicao = useCallback((mesaNumero: number) => {
    setEdicoes((prev) => prev.filter((e) => e.mesaNumero !== mesaNumero));
  }, []);

  const estaEmEdicao = useCallback(
    (mesaNumero: number) => edicoes.some((e) => e.mesaNumero === mesaNumero),
    [edicoes]
  );

  return (
    <MesaEdicaoContext.Provider value={{ edicoes, iniciarEdicao, finalizarEdicao, estaEmEdicao }}>
      {children}
    </MesaEdicaoContext.Provider>
  );
}

export const useMesaEdicao = () => useContext(MesaEdicaoContext);
