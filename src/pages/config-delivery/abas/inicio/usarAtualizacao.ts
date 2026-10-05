import { useEffect, useRef } from 'react';

/**
 * Roda `fn` ao abrir e a cada `ms` enquanto a aba está montada e a tela visível; ao voltar para a tela
 * (celular desbloqueado, outra aba do navegador) atualiza na hora. `chave` reinicia tudo (ex.: troca de loja).
 */
export function useAtualizacao(fn: () => void | Promise<void>, ms: number, chave: unknown): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    void ref.current();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void ref.current(); }, ms);
    const voltou = () => { if (document.visibilityState === 'visible') void ref.current(); };
    document.addEventListener('visibilitychange', voltou);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', voltou); };
  }, [ms, chave]);
}
