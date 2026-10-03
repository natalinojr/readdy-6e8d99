// Quando o balão do assistente sai do caminho (2026-10-03). No celular ele cobria o "Salvar":
//   • janela aberta — já era assim desde 30/09 (useJanelaAberta);
//   • rolando a página para baixo — o Salvar costuma ficar no fim; volta ao rolar para cima ou no topo;
//   • teclado aberto num campo fora do chat (só tela de toque: no computador o teclado não cobre nada).
// Rolar ou digitar DENTRO do chat ([data-balao], na raiz do painel e da barra pequena) não conta.
// `aberto` = o chat está aberto: abrir/fechar zera o "rolando" e o "digitando" (o botão nunca volta
// escondido por algo que aconteceu lá dentro, nem por um campo que saiu da tela com o foco).
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useJanelaAberta } from '@/hooks/useJanelaAberta';

const NAO_DIGITA = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color', 'image']);

function campoFora(el: Element | null): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected || el.closest('[data-balao]')) return false;
  if (el instanceof HTMLInputElement) return !NAO_DIGITA.has(el.type);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable;
}

export function useBalaoEscondido(aberto = false): boolean {
  const janela = useJanelaAberta();
  const [rolando, setRolando] = useState(false);
  const [digitando, setDigitando] = useState(false);
  const { pathname } = useLocation();
  // Outra tela começa no topo: o balão volta.
  useEffect(() => { setRolando(false); }, [pathname]);
  useEffect(() => { setRolando(false); setDigitando(false); }, [aberto]);

  useEffect(() => {
    const ultimo = new WeakMap<Element, number>();
    const aoRolar = (e: Event) => {
      const alvo = e.target instanceof Document ? e.target.scrollingElement : e.target;
      if (!(alvo instanceof Element) || alvo.closest('[data-balao]')) return;
      const y = alvo.scrollTop;
      const y0 = ultimo.get(alvo) ?? 0;
      ultimo.set(alvo, y);
      if (y < 40) setRolando(false);
      else if (y > y0 + 6) setRolando(true);
      else if (y < y0 - 6) setRolando(false);
    };
    const toque = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const conferirFoco = () => setDigitando(toque && campoFora(document.activeElement));
    // O campo pode sair da tela com o foco sem "focusout" (janela que fecha): confere de novo no próximo toque.
    const depois = () => setTimeout(conferirFoco, 0);
    document.addEventListener('scroll', aoRolar, { capture: true, passive: true });
    document.addEventListener('focusin', conferirFoco);
    document.addEventListener('focusout', depois);
    document.addEventListener('pointerdown', depois);
    return () => {
      document.removeEventListener('scroll', aoRolar, { capture: true });
      document.removeEventListener('focusin', conferirFoco);
      document.removeEventListener('focusout', depois);
      document.removeEventListener('pointerdown', depois);
    };
  }, []);

  return janela || rolando || digitando;
}
