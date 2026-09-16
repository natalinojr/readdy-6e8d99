// Botão "voltar" do Android dentro do app (2026-09-16).
//
// O app é uma WebView: o voltar nativo faz history.back(). Quem abre algo POR CIMA da tela (chat,
// modal, gaveta) sem mexer no histórico faz o voltar pular a tela inteira — e, se não houver
// entrada anterior, FECHA o app. Foi o que o dono viu com o chat do assistente aberto.
//
// A saída é empurrar uma entrada de histórico ao abrir e consumi-la no `popstate`.
//
// PEGADINHA das camadas aninhadas (painel → conversa): `popstate` é um evento do window, então
// TODOS os overlays abertos escutam o mesmo voltar e fechariam de uma vez. Por isso existe a pilha
// abaixo: cada camada aberta entra nela e só a do topo reage. Assim o voltar desfaz uma de cada
// vez — primeiro a conversa, depois o painel.
//
// Nasceu em src/pages/tarefas/lib/mobile.ts, que hoje reexporta daqui.
import { useEffect, useRef } from 'react';

/** Camadas abertas, da mais externa para a mais interna. */
const pilha: symbol[] = [];

/**
 * Faz o botão "voltar" fechar um overlay em vez de sair da tela (ou do app).
 *
 * @param aberto   enquanto true, o voltar chama `aoFechar` em vez de navegar
 * @param aoFechar o que fechar; fechar pela UI (X, backdrop) limpa a entrada empurrada
 * @param chave    nome da camada no history.state — só para depuração
 */
export function useVoltarFecha(aberto: boolean, aoFechar: () => void, chave = 'overlay'): void {
  // O callback fica numa ref de propósito: quem chama costuma passar uma arrow inline
  // (`() => setX(null)`), que muda a cada render. Se ele entrasse nas deps do efeito, cada render
  // empilharia uma entrada nova no histórico.
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;
  const id = useRef<symbol>(Symbol(chave));

  useEffect(() => {
    if (!aberto) return;
    const meuId = id.current;

    pilha.push(meuId);
    window.history.pushState({ erposOverlay: chave }, '');
    let fechadoPeloVoltar = false;

    const aoVoltar = () => {
      // Só a camada de cima responde a este voltar; as de baixo esperam o próximo.
      if (pilha[pilha.length - 1] !== meuId) return;
      pilha.pop();
      fechadoPeloVoltar = true;
      aoFecharRef.current();
    };
    window.addEventListener('popstate', aoVoltar);

    return () => {
      window.removeEventListener('popstate', aoVoltar);
      const i = pilha.lastIndexOf(meuId);
      if (i >= 0) pilha.splice(i, 1);
      // Fechou pela UI (X, backdrop): desfaz a entrada que empurramos.
      if (!fechadoPeloVoltar && window.history.state?.erposOverlay === chave) {
        window.history.back();
      }
    };
  }, [aberto, chave]);
}
