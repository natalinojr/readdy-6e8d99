import { useEffect, useState } from 'react';

/** Computador (≥ 1024 px, o `lg` do Tailwind, o mesmo ponto em que `<Colunas>` vira duas colunas). */
export default function useTelaGrande(): boolean {
  const consulta = '(min-width: 1024px)';
  const [grande, setGrande] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches);
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const aoMudar = () => setGrande(mq.matches);
    mq.addEventListener('change', aoMudar);
    aoMudar();
    return () => mq.removeEventListener('change', aoMudar);
  }, []);
  return grande;
}
