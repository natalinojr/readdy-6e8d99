// Guarda de saída global: telas com mudança não salva registram uma função que diz quantas pendências têm;
// quem navega por botão (trocar de loja, Perfil, Sair, Voltar aos módulos) chama `await podeSair()` antes.
// Os links (<a href>) a tela trata sozinha (ver config-delivery/page.tsx); fechar/recarregar a aba é o
// `beforeunload` da própria tela. Sem pendência, `podeSair()` devolve true na hora, sem perguntar nada.
import { confirmar } from '@/components/base/Dialogos';

export interface PendenciaSaida {
  /** Quantas coisas ainda não foram salvas. 0 = nada a perder. */
  pendente: number;
  /** Frase pronta para o aviso ("3 mudanças ainda não foram salvas no Delivery."). */
  mensagem: string;
}
export type GuardaSaida = () => PendenciaSaida | null;

const guardas = new Set<GuardaSaida>();
let perguntando: Promise<boolean> | null = null;

/** Registra uma guarda. Devolve a função que a remove (chame ao desmontar a tela ou quando não houver mais pendência). */
export function registrarGuardaSaida(fn: GuardaSaida): () => void {
  guardas.add(fn);
  return () => { guardas.delete(fn); };
}

/** O que há para perder agora, de todas as guardas registradas (as que devolvem null ou 0 não contam). */
export function pendenciasDeSaida(): PendenciaSaida[] {
  const lista: PendenciaSaida[] = [];
  for (const g of guardas) {
    let p: PendenciaSaida | null = null;
    try { p = g(); } catch { p = null; }
    if (p && p.pendente > 0) lista.push(p);
  }
  return lista;
}

/**
 * true = pode sair (nada pendente, ou a pessoa confirmou "Sair sem salvar").
 * Duas chamadas ao mesmo tempo (duplo toque) dividem a mesma pergunta.
 */
export async function podeSair(): Promise<boolean> {
  const pendencias = pendenciasDeSaida();
  if (pendencias.length === 0) return true;
  if (!perguntando) {
    perguntando = confirmar({
      titulo: 'Sair sem salvar?',
      mensagem: pendencias.map((p) => p.mensagem).join(' '),
      confirmarLabel: 'Sair sem salvar',
      perigo: true,
    }).finally(() => { perguntando = null; });
  }
  return perguntando;
}
