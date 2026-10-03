// Ação rápida "Lançar (o que aconteceu?)" (2026-10-03): abre o começo único de lançamento (/lancar),
// o mesmo do botão Lançar do Financeiro. Cada resposta leva à tela que já existe.
import { useEffect, useRef } from 'react';
import type { AcaoProps } from '../kit';

export default function LancarAlgo({ irPara }: AcaoProps) {
  const foi = useRef(false);
  useEffect(() => {
    if (foi.current) return;
    foi.current = true;
    irPara('/lancar');
  }, [irPara]);
  return null;
}
