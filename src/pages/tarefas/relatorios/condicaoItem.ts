/**
 * Item condicional: o item inteiro só aparece para quem responde pelo link se
 * um campo de escolha de OUTRO item tiver certa resposta (`item.show_if`).
 * Condição quebrada (item ou campo apagado) é ignorada — o item aparece.
 */
import type { ItemRel, ValorCampo } from './api';
import { camposVisiveis, respostasPossiveis, valoresAtuais } from './CamposResposta';

const valoresDo = (item: ItemRel): Record<string, ValorCampo> =>
  Object.fromEntries(Object.entries(valoresAtuais(item)).map(([k, v]) => [k, v.valor]));

/** Ids dos itens que aparecem com as respostas atuais (em cadeia: se o item de cima some, o de baixo também). */
export function itensVisiveis(itens: ItemRel[]): Set<string> {
  const porId = new Map(itens.map((i) => [i.id, i]));
  const memo = new Map<string, boolean>();
  const visivel = (it: ItemRel, caminho: Set<string>): boolean => {
    const pronto = memo.get(it.id);
    if (pronto !== undefined) return pronto;
    const s = it.show_if;
    let ok = true;
    const pai = s ? porId.get(s.item_id) : undefined;
    const campo = s && pai ? pai.fields?.find((f) => f.id === s.field_id) : undefined;
    // Ciclo (não deveria existir — a edge recusa) também é ignorado.
    if (s && pai && campo && !caminho.has(it.id)) {
      const valores = valoresDo(pai);
      const v = valores[s.field_id];
      ok = visivel(pai, new Set([...caminho, it.id]))
        && camposVisiveis(pai.fields ?? [], valores).some((c) => c.id === campo.id)
        && (Array.isArray(v) ? v.some((x) => s.values.includes(x)) : typeof v === 'string' && s.values.includes(v));
    }
    memo.set(it.id, ok);
    return ok;
  };
  return new Set(itens.filter((i) => visivel(i, new Set())).map((i) => i.id));
}

/** "2 · Tipo de evento — Pergunta = Festa ou Corporativo" para mostrar à equipe (null = sem condição válida). */
export function descreverCondicao(item: ItemRel, itens: ItemRel[]): { numero: number; titulo: string; pergunta: string; respostas: string } | null {
  const s = item.show_if;
  if (!s) return null;
  const i = itens.findIndex((x) => x.id === s.item_id);
  const campo = itens[i]?.fields?.find((f) => f.id === s.field_id);
  if (i < 0 || !campo) return null;
  const nomes = respostasPossiveis(campo).filter((o) => s.values.includes(o.id)).map((o) => o.label);
  return { numero: i + 1, titulo: itens[i].title, pergunta: campo.label, respostas: nomes.join(' ou ') };
}

/** Itens que este item pode usar de condição: outros itens com pergunta de escolha, sem fechar ciclo. */
export function candidatosCondicao(itemId: string | null, itens: ItemRel[]): ItemRel[] {
  const porId = new Map(itens.map((i) => [i.id, i]));
  const dependeDeMim = (it: ItemRel) => {
    let atual: ItemRel | undefined = it;
    for (let passo = 0; atual && passo < 50; passo++) {
      if (atual.id === itemId) return true;
      atual = atual.show_if ? porId.get(atual.show_if.item_id) : undefined;
    }
    return false;
  };
  return itens.filter((it) => it.id !== itemId
    && (it.fields ?? []).some((f) => f.type === 'escolha' || f.type === 'multipla' || f.type === 'sim_nao')
    && !(itemId && dependeDeMim(it)));
}
