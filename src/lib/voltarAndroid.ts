// Botão "voltar" (Android/app, e o voltar do navegador) — camadas por cima da tela.
//
// O app é uma WebView: o voltar nativo faz history.back(). Quem abre algo POR CIMA da tela (chat,
// modal, gaveta, folha, e em Tarefas até a troca de pasta/visão) precisa de uma entrada no
// histórico por camada; senão o voltar pula a tela inteira — e, sem entrada anterior, FECHA o app.
//
// Como funciona (2026-09-25, refeito): as camadas abertas ficam numa pilha e cada entrada que
// empurramos no histórico carrega o NÍVEL dela (`erposNivel` = 1, 2, 3…). Ninguém mexe no
// histórico direto: abrir/fechar só altera a pilha e agenda um `reconciliar()`, que roda depois
// de a tela terminar de atualizar e deixa o histórico com exatamente uma entrada por camada:
// - sobrou entrada (camada fechada pela tela: seta, X, escolher algo) → volta o que sobra;
// - faltou entrada (camada nova) → empurra.
// Voltar do usuário: o nível da entrada em que caiu diz quantas camadas ficam; fecha as de cima.
//
// POR QUE REFEITO: antes cada camada empurrava/limpava na hora. Fechar uma pela tela e abrir outra
// no mesmo clique (escolher pasta na folha, abrir uma ação pelo menu) fazia history.back() — que é
// assíncrono — rodar DEPOIS do pushState da nova, apagando a entrada nova. Sobrava uma camada sem
// entrada e o último voltar saía de tudo ("sai de tudo mesmo tendo camada antes", dono 2026-09-25).
//
// Nasceu em src/pages/tarefas/lib/mobile.ts, que hoje reexporta daqui.
import { useEffect, useRef } from 'react';

interface Camada { chave: string; fechar: () => void }

/** Camadas abertas, da mais externa (índice 0) para a mais interna. */
const pilha: Camada[] = [];
/** Um history.go(-n) nosso (limpeza) está a caminho: o popstate dele não é do usuário. */
let limpezaEmVoo = false;
let limpezaTimer = 0;
let agendado = false;
let aoSairDasCamadas: (() => void) | null = null;

const IGNORAR = '__erposVoltarDeLimpeza';

function nivelAtual(): number {
  const n = (window.history.state as { erposNivel?: unknown } | null)?.erposNivel;
  return typeof n === 'number' ? n : 0;
}

function terminarLimpeza() {
  limpezaEmVoo = false;
  window.clearTimeout(limpezaTimer);
  const depois = aoSairDasCamadas;
  aoSairDasCamadas = null;
  if (depois) depois();
  else reconciliar();
}

function reconciliar() {
  agendado = false;
  if (typeof window === 'undefined' || limpezaEmVoo) return;
  const alvo = pilha.length;
  const atual = nivelAtual();
  if (atual > alvo) {
    limpezaEmVoo = true;
    // Se o popstate não vier (ex.: jsdom, histórico no começo), destrava sozinho.
    limpezaTimer = window.setTimeout(terminarLimpeza, 400);
    window.history.go(alvo - atual);
    return;
  }
  for (let n = atual + 1; n <= alvo; n++) {
    window.history.pushState({ erposOverlay: pilha[n - 1].chave, erposNivel: n }, '');
  }
}

function agendar() {
  if (agendado) return;
  agendado = true;
  queueMicrotask(reconciliar);
}

if (typeof window !== 'undefined') {
  // Registrado ao carregar o módulo — antes de qualquer outro ouvinte de popstate das telas.
  window.addEventListener('popstate', (e) => {
    if (limpezaEmVoo) {
      (e as unknown as Record<string, boolean>)[IGNORAR] = true;
      terminarLimpeza();
      return;
    }
    // Voltar do usuário: ficam tantas camadas quanto o nível da entrada em que ele caiu.
    const ficam = nivelAtual();
    while (pilha.length > ficam) {
      const c = pilha.pop()!;
      c.fechar();
    }
    // Entrada sobrando (camada que sumiu sem limpar): o próximo reconciliar acerta.
    if (pilha.length < ficam) agendar();
  });
}

/** Quantas camadas estão abertas (para testes e depuração). */
export function camadasAbertas(): number {
  return pilha.length;
}

/**
 * Sai da tela deixando o histórico limpo: tira as entradas das camadas desta tela e só então
 * chama `depois` (ex.: navigate('/modulos')). Sem isso, as entradas ficavam para trás e o voltar
 * na tela seguinte "voltava" várias vezes para a mesma tela.
 */
export function sairDasCamadas(depois: () => void): void {
  const atual = typeof window === 'undefined' ? 0 : nivelAtual();
  pilha.length = 0;
  if (atual <= 0 || limpezaEmVoo) { depois(); return; }
  limpezaEmVoo = true;
  aoSairDasCamadas = depois;
  limpezaTimer = window.setTimeout(terminarLimpeza, 400);
  window.history.go(-atual);
}

/**
 * Faz o botão "voltar" fechar uma camada em vez de sair da tela (ou do app).
 *
 * @param aberto   enquanto true, a camada existe e o voltar chama `aoFechar`
 * @param aoFechar o que fechar (fechar pela tela também funciona: o histórico se acerta sozinho)
 * @param chave    nome da camada no history.state — só para depuração
 */
export function useVoltarFecha(aberto: boolean, aoFechar: () => void, chave = 'overlay'): void {
  // O callback fica numa ref de propósito: quem chama costuma passar uma arrow inline
  // (`() => setX(null)`), que muda a cada render.
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;

  useEffect(() => {
    if (!aberto) return;
    const camada: Camada = { chave, fechar: () => aoFecharRef.current() };
    pilha.push(camada);
    agendar();
    return () => {
      const i = pilha.indexOf(camada);
      // Fechou pela tela (não pelo voltar, que já tirou da pilha): o histórico se acerta.
      if (i >= 0) {
        pilha.splice(i, 1);
        agendar();
      }
    };
  }, [aberto, chave]);
}
