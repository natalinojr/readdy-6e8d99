/**
 * Regra de seleção de opções por grupo (min_selections / max_selections),
 * usada pelo totem (autoatendimento). Mesma regra do PDV caixa (OpcoesModal)
 * e do QR (CardapioMesaQR): máx 1 = troca a seleção; máx N>1 = permite até N
 * e bloqueia a (N+1)ª; obrigatório exige ao menos max(1, min).
 */

export interface GrupoSelecaoRegra {
  grupo: string;
  obrigatorio: boolean;
  minSelecao?: number | null;
  maxSelecao?: number | null;
}

/** Mínimo exigido: obrigatório = max(1, min); opcional = min (padrão 0). */
export function minExigidoGrupo(g: GrupoSelecaoRegra): number {
  const base = g.minSelecao != null && g.minSelecao > 0 ? g.minSelecao : 0;
  return g.obrigatorio ? Math.max(1, base) : base;
}

/** Máximo permitido: null/undefined = 1 (padrão do banco); <= 0 = sem limite. */
export function maxPermitidoGrupo(g: GrupoSelecaoRegra): number {
  if (g.maxSelecao == null) return 1;
  if (g.maxSelecao <= 0) return Infinity;
  return g.maxSelecao;
}

export interface ToggleResultado<T> {
  selecao: T[];
  /** true quando a opção não entrou porque o grupo já está no máximo (N>1). */
  bloqueado: boolean;
}

export function toggleOpcaoGrupo<T extends { nome: string }>(
  atual: T[],
  opcao: T,
  g: GrupoSelecaoRegra,
): ToggleResultado<T> {
  const max = maxPermitidoGrupo(g);
  const jaSelecionada = atual.some((o) => o.nome === opcao.nome);

  if (jaSelecionada) {
    // Escolha única obrigatória: tocar de novo mantém (comportamento de rádio).
    if (max === 1 && g.obrigatorio) return { selecao: atual, bloqueado: false };
    return { selecao: atual.filter((o) => o.nome !== opcao.nome), bloqueado: false };
  }
  if (max === 1) return { selecao: [opcao], bloqueado: false };
  if (atual.length >= max) return { selecao: atual, bloqueado: true };
  return { selecao: [...atual, opcao], bloqueado: false };
}

/** Primeiro grupo que ainda não atingiu o mínimo (ou null se todos ok). */
export function primeiroGrupoFaltando<G extends GrupoSelecaoRegra>(
  grupos: G[] | undefined,
  selecionadas: Record<string, unknown[] | undefined>,
): G | null {
  for (const g of grupos ?? []) {
    const min = minExigidoGrupo(g);
    if (min > 0 && (selecionadas[g.grupo]?.length ?? 0) < min) return g;
  }
  return null;
}

/**
 * Tradutor opcional. Sem ele a mensagem sai em português — é o que as telas do
 * ERP e os testes esperam. `rotulo` é o nome do grupo já no idioma do cliente:
 * sem isso o aviso saía metade em inglês e metade em português
 * ("Choose your second Burrito!!" na tela, "Escolha seu segundo Burrito!!" no
 * erro logo abaixo).
 */
type Tradutor = (chave: string, valores?: Record<string, unknown>) => string;

export function mensagemGrupoFaltando(g: GrupoSelecaoRegra, t?: Tradutor, rotulo?: string): string {
  const min = minExigidoGrupo(g);
  const grupo = rotulo ?? g.grupo;
  if (!t) return min > 1 ? `Escolha: ${grupo} (mínimo ${min})` : `Escolha: ${grupo}`;
  return min > 1 ? t('cliente.escolhaGrupoMin', { grupo, min }) : t('cliente.escolhaGrupo', { grupo });
}

export function mensagemMaximoAtingido(g: GrupoSelecaoRegra, t?: Tradutor, rotulo?: string): string {
  const max = maxPermitidoGrupo(g);
  const grupo = rotulo ?? g.grupo;
  if (!t) return `Máximo de ${max} opções em: ${grupo}`;
  return t('cliente.maximoOpcoes', { max, grupo });
}
