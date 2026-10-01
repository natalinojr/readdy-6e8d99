import { useEffect, useState } from 'react';

// Fundo escuro das janelas (modais e gavetas) do sistema: `fixed inset-0 bg-black/40`, `bg-zinc-900/20` etc.
const SELETOR = ['bg-black/', 'bg-zinc-900/', 'bg-zinc-950/', 'bg-slate-900/'].map((c) => `.fixed.inset-0[class*="${c}"]`).join(', ');

/**
 * true enquanto alguma janela com fundo escuro está aberta na tela. Usado pelos botões
 * flutuantes (assistente), que no celular ficavam por cima do "Salvar" do rodapé das janelas
 * (2026-09-30): com janela aberta eles somem (a janela fica dentro da página, numa camada abaixo deles, então não adianta só mudar o z-index).
 */
export function useJanelaAberta(): boolean {
  const [aberta, setAberta] = useState(false);
  useEffect(() => {
    let quadro = 0;
    const conferir = () => {
      quadro = 0;
      // Só conta a que está na tela (algumas telas deixam a janela montada e escondida).
      setAberta([...document.querySelectorAll(SELETOR)].some((el) => el.getClientRects().length > 0));
    };
    const obs = new MutationObserver(() => { if (!quadro) quadro = requestAnimationFrame(conferir); });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    conferir();
    return () => { obs.disconnect(); if (quadro) cancelAnimationFrame(quadro); };
  }, []);
  return aberta;
}
