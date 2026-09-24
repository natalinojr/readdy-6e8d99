// Ação rápida "Aprovar pedidos de pagamento" (2026-09-24): abre a lista de aprovação do módulo
// Recebimentos e pagamentos (/receber). Aprovado vira conta a pagar em aberto.
import { useEffect, useRef } from 'react';
import type { AcaoProps } from '../kit';

export default function AprovarPedidos({ irPara }: AcaoProps) {
  const foi = useRef(false);
  useEffect(() => {
    if (foi.current) return;
    foi.current = true;
    irPara('/receber?aprovar=1');
  }, [irPara]);
  return null;
}
