// Folha "Em qual loja você vai trabalhar agora?" (casca nova, 2026-10-05) — a parte pura: monta e ordena os
// cartões das lojas da pessoa. Desenho aprovado: docs/prototipos/sistema-proposta.html › telas/casca.js › 'trocar-loja'.
// Ordem: quem mais precisa de você primeiro; empate → a que está aberta; depois o que vendeu hoje e o nome.
// Lojas escondidas pela pessoa (preferência do Comparar lojas) ficam recolhidas — menos a loja em que ela está.

export interface LojaDaPessoa {
  tenantId: string;
  nome: string;
  /** papel da pessoa na loja (frontend: admin, gerente, supervisao, caixa…) */
  role: string;
  /** modo treino da pessoa nesta loja (user_tenants.training_mode) */
  trainingMode: boolean;
  /** 'financeiro' = empresa sem PDV */
  kind?: string;
}

/** O que a leitura do Comparar lojas (fn_lojas_comparar, dia da loja) diz de cada loja. Ausente = a pessoa não vê o Dashboard dela. */
export interface LeituraLoja {
  aberta: boolean;
  /** hora (HH:MM, Brasília) em que o caixa abriu; null = sem caixa aberto */
  desde: string | null;
  faturamento: number;
  pedidos: number;
  oculta: boolean;
}

export interface CartaoLoja {
  tenantId: string;
  nome: string;
  cargo: string;
  aqui: boolean;
  teste: boolean;
  treino: boolean;
  semPdv: boolean;
  /** null = não sabemos (sem leitura da loja) */
  aberta: boolean | null;
  desde: string | null;
  faturamento: number | null;
  pedidos: number | null;
  precisam: number;
  oculta: boolean;
}

/** Testes PDV, lojas "demo" e quem está em modo treino na loja. */
export function ehLojaDeTeste(nome: string, trainingMode: boolean): boolean {
  if (trainingMode) return true;
  const n = nome.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return /\b(testes?|demo|demonstracao|homologacao)\b/.test(n);
}

export function ordenarCartoes<T extends Pick<CartaoLoja, 'precisam' | 'aberta' | 'faturamento' | 'nome'>>(cartoes: T[]): T[] {
  return [...cartoes].sort((a, b) => (b.precisam - a.precisam)
    || (Number(b.aberta === true) - Number(a.aberta === true))
    || ((b.faturamento ?? 0) - (a.faturamento ?? 0))
    || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function montarCartoesLoja(entrada: {
  lojas: LojaDaPessoa[];
  leituras: Map<string, LeituraLoja>;
  /** quantos cartões "Agora" da Hoje em cada loja */
  precisam: Map<string, number>;
  atualId: string | null | undefined;
  rotuloCargo: (role: string) => string;
  /** loja atual sem leitura do Comparar: o estado do caixa vem da sessão (SessaoContext) */
  estadoAtual?: { aberta: boolean; desde: string | null } | null;
}): { visiveis: CartaoLoja[]; escondidas: CartaoLoja[] } {
  const { lojas, leituras, precisam, atualId, rotuloCargo, estadoAtual } = entrada;
  const vistos = new Set<string>();
  const cartoes: CartaoLoja[] = [];
  for (const l of lojas) {
    if (vistos.has(l.tenantId)) continue;
    vistos.add(l.tenantId);
    const r = leituras.get(l.tenantId);
    const aqui = l.tenantId === atualId;
    const semLeituraAqui = !r && aqui && estadoAtual ? estadoAtual : null;
    cartoes.push({
      tenantId: l.tenantId,
      nome: l.nome,
      cargo: rotuloCargo(l.role),
      aqui,
      teste: ehLojaDeTeste(l.nome, l.trainingMode),
      treino: l.trainingMode,
      semPdv: l.kind === 'financeiro',
      aberta: r ? r.aberta : semLeituraAqui ? semLeituraAqui.aberta : null,
      desde: r ? r.desde : semLeituraAqui ? semLeituraAqui.desde : null,
      faturamento: r ? r.faturamento : null,
      pedidos: r ? r.pedidos : null,
      precisam: Math.max(0, precisam.get(l.tenantId) ?? 0),
      // A loja em que a pessoa está nunca fica escondida.
      oculta: !!r?.oculta && !aqui,
    });
  }
  const ordenados = ordenarCartoes(cartoes);
  return { visiveis: ordenados.filter((c) => !c.oculta), escondidas: ordenados.filter((c) => c.oculta) };
}

/** "R$ 1.340 hoje · 32 pedidos" — só quando a loja está aberta ou já vendeu no dia. */
export function linhaVendas(c: Pick<CartaoLoja, 'aberta' | 'faturamento' | 'pedidos'>): string | null {
  if (c.faturamento === null || c.pedidos === null) return null;
  if (c.aberta !== true && c.pedidos <= 0 && c.faturamento <= 0) return null;
  const rs = c.faturamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0, minimumFractionDigits: 0 });
  return `${rs} hoje · ${c.pedidos} ${c.pedidos === 1 ? 'pedido' : 'pedidos'}`;
}
