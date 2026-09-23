// Modelos de estrutura de pastas — a lógica pura mora em
// supabase/functions/_shared/modelo-estrutura.ts (a Edge task-write usa a mesma).
// Aqui fica só o que é do navegador: agrupamento/colunas guardados no localStorage.
export * from '../../../../supabase/functions/_shared/modelo-estrutura';
import { somarDias, type ExibicaoModelo } from '../../../../supabase/functions/_shared/modelo-estrutura';

const CHAVES = {
  agrupar: (id: string) => `erpos_tarefas_agrupar_${id}`,
  colunas: (id: string) => `erpos_tarefas_colunas_${id}`,
  ordem: (id: string) => `erpos_tarefas_ordem_${id}`,
  larguras: (id: string) => `erpos_tarefas_larguras_${id}`,
};

function ler<T>(chave: string, json: boolean): T | null {
  try {
    const bruto = localStorage.getItem(chave);
    if (bruto === null) return null;
    return (json ? JSON.parse(bruto) : bruto) as T;
  } catch {
    return null;
  }
}

/** Agrupamento/colunas de cada pasta, como estão neste navegador (vai junto no modelo). */
export function lerExibicaoPastas(ids: string[]): Record<string, ExibicaoModelo> {
  const r: Record<string, ExibicaoModelo> = {};
  for (const id of ids) {
    const e: ExibicaoModelo = {
      agrupar: ler<string>(CHAVES.agrupar(id), false),
      colunas: ler<string[]>(CHAVES.colunas(id), true),
      ordem: ler<string[]>(CHAVES.ordem(id), true),
      larguras: ler<Record<string, number>>(CHAVES.larguras(id), true),
    };
    if (e.agrupar || e.colunas || e.ordem || e.larguras) r[id] = e;
  }
  return r;
}

/** Grava no navegador a exibição das pastas criadas pelo modelo (ids já remapeados pela Edge). */
export function gravarExibicaoPastas(exibicao: Record<string, ExibicaoModelo> | null | undefined): void {
  if (!exibicao) return;
  try {
    for (const [id, e] of Object.entries(exibicao)) {
      if (e.agrupar) localStorage.setItem(CHAVES.agrupar(id), e.agrupar);
      if (e.colunas) localStorage.setItem(CHAVES.colunas(id), JSON.stringify(e.colunas));
      if (e.ordem) localStorage.setItem(CHAVES.ordem(id), JSON.stringify(e.ordem));
      if (e.larguras) localStorage.setItem(CHAVES.larguras(id), JSON.stringify(e.larguras));
    }
  } catch {
    /* sem localStorage — a pasta abre com a exibição padrão */
  }
}

/** "Dia 0", "Dia +3"… ou a data real quando já há uma data base. */
export function rotuloDia(dia: number, dataBase: string | null): string {
  if (!dataBase) return dia === 0 ? 'Dia 0' : `Dia ${dia > 0 ? '+' : ''}${dia}`;
  const [a, m, d] = somarDias(dataBase, dia).split('-');
  return `${d}/${m}${a !== dataBase.slice(0, 4) ? `/${a}` : ''}`;
}
