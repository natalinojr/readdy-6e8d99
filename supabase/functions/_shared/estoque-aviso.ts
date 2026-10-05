// Aviso de estoque crítico para a equipe (2026-10-05): UM aviso por loja, só quando entra insumo novo.
// Lógica pura (sem import, roda no Deno e no Vite) usada pelo assistente-cron. A lista de insumos vem da
// regra única do estoque (SQL insumo_abaixo_minimo, a mesma de fn_estoque_situacao / estoqueRegras.ts) —
// aqui NUNCA se recalcula o que é "abaixo do mínimo", só se decide se vale avisar e como escrever.
//
// Política de repetição (decisão: não repetir sem novidade):
//   • avisa quando algum insumo ENTROU em crítico desde o último estado guardado da loja;
//   • não avisa quando só saiu insumo da lista (melhorou), nem quando a lista é a mesma de ontem —
//     o que continua crítico fica na caixa (pendência estoque_critico, que fecha sozinha quando normaliza)
//     e no selo do Estoque. Insumo que normaliza e volta a cair conta como novo e avisa de novo.

export interface InsumoCritico {
  id: string;
  nome: string;
  atual: number;
  minimo: number;
  unidade: string;
}

export interface DecisaoAvisoEstoque {
  avisar: boolean;
  /** Os que entraram em crítico desde o último estado */
  novos: InsumoCritico[];
  motivo: 'novos' | 'sem_novidade' | 'normalizou';
}

export const ROTA_COMPRAR = '/estoque?tab=inicio&ir=comprar';

/** `anteriores` = ids guardados no último estado da loja (undefined = nunca avisou). */
export function decidirAvisoEstoque(anteriores: string[] | undefined, atuais: InsumoCritico[]): DecisaoAvisoEstoque {
  if (!atuais.length) return { avisar: false, novos: [], motivo: 'normalizou' };
  const antes = new Set(anteriores ?? []);
  const novos = atuais.filter((i) => !antes.has(i.id));
  return novos.length ? { avisar: true, novos, motivo: 'novos' } : { avisar: false, novos: [], motivo: 'sem_novidade' };
}

/** Zerado/negativo primeiro, depois os novos, depois por nome. */
export function ordenarCriticos(atuais: InsumoCritico[], novos: InsumoCritico[]): InsumoCritico[] {
  const ehNovo = new Set(novos.map((i) => i.id));
  return [...atuais].sort((a, b) =>
    Number(b.atual <= 0) - Number(a.atual <= 0)
    || Number(ehNovo.has(b.id)) - Number(ehNovo.has(a.id))
    || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** "3 insumos acabando em Paranaguá: Barril Pilsen, Queijo, Tortilha" (até 3 nomes; o resto vira "e mais N"). */
export function resumoEstoque(loja: string, atuais: InsumoCritico[], novos: InsumoCritico[]): string {
  const lista = ordenarCriticos(atuais, novos);
  const n = lista.length;
  const nomes = lista.slice(0, 3).map((i) => i.nome);
  const resto = n - nomes.length;
  return `${n} ${n === 1 ? 'insumo acabando' : 'insumos acabando'} em ${loja}: ${nomes.join(', ')}${resto > 0 ? ` e mais ${resto}` : ''}`;
}

const fmt = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

/** Painel do aviso (mesmo formato do [painel] do chat): lista curta + botão que abre a lista de compras. */
export function painelEstoque(loja: string, atuais: InsumoCritico[], novos: InsumoCritico[]) {
  const lista = ordenarCriticos(atuais, novos);
  const ehNovo = new Set(novos.map((i) => i.id));
  return {
    t: 'Estoque acabando', s: loja,
    kpi: { p: { l: lista.length === 1 ? 'Insumo abaixo do mínimo' : 'Insumos abaixo do mínimo', v: String(lista.length) } },
    lin: [{
      t: novos.length && novos.length < lista.length ? `Novos hoje: ${novos.length}` : 'O que está acabando',
      i: [
        ...lista.slice(0, 15).map((i) => ({
          l: i.nome, v: `${fmt(i.atual)} ${i.unidade}`,
          d: `mín. ${fmt(i.minimo)}${ehNovo.has(i.id) && novos.length < lista.length ? ' · novo' : ''}`,
          st: (i.atual <= 0 ? 'perigo' : 'alerta') as 'perigo' | 'alerta',
        })),
        ...(lista.length > 15 ? [{ l: `… e mais ${lista.length - 15}` }] : []),
      ],
    }],
    bt: [{ l: 'Comprar', r: ROTA_COMPRAR, i: 'ri-shopping-cart-2-line' }],
  };
}
