import { PermissoesContext, usePermissoesState } from '@/hooks/usePermissoes';

interface Props { children: React.ReactNode; }

export function PermissoesProvider({ children }: Props) {
  const value = usePermissoesState();
  return (
    <PermissoesContext.Provider value={value}>
      {children}
    </PermissoesContext.Provider>
  );
}
