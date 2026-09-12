import { useDreGroups, isGrupoDespesa } from '@/hooks/useDreGroups';

/**
 * Classificação DRE exigida na baixa de uma conta a pagar (decisão do dono,
 * 2026-09-12: não se dá baixa sem classificar). O `pay_bill` recusa a baixa de
 * conta sem `dre_category_id`, exceto compra (vai para o CMV pelos itens) e
 * folha (a DRE lê `hr_payroll`).
 *
 * Oferece as categorias de despesa da loja e, como quase nenhuma loja tem
 * categorias, também os grupos: escolher um grupo faz o backend reaproveitar ou
 * criar a categoria raiz com o nome dele (mesma regra do catálogo de compras).
 */

const GRUPO_PREFIX = 'grupo:';

interface Cat { id: string; name: string; group_type: string; parent_id?: string | null }

/** A conta precisa de classificação para ser baixada? */
export function precisaClassificarDRE(bill: unknown): boolean {
  const b = (bill ?? {}) as { dre_category_id?: string | null; reference_type?: string | null };
  if (b.dre_category_id) return false;
  return !['purchase', 'hr_payroll'].includes(String(b.reference_type ?? ''));
}

export function useDreEscolha() {
  const { allGroups } = useDreGroups();
  const grupos = allGroups.filter((g) => isGrupoDespesa(g.key));
  /** Traduz o valor do select no complemento do `pay` (id da categoria ou grupo). */
  const toPayload = (value: string) => {
    if (!value) return undefined;
    if (!value.startsWith(GRUPO_PREFIX)) return { dre_category_id: value };
    const key = value.slice(GRUPO_PREFIX.length);
    return { dre_group: key, dre_category_name: grupos.find((g) => g.key === key)?.label ?? key };
  };
  return { grupos, toPayload };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  categorias: Cat[];
}

export default function DreClassificacaoSelect({ value, onChange, categorias }: Props) {
  const { grupos } = useDreEscolha();
  // cost: aposentado, mas categorias antigas de custo ainda são subtraídas pela DRE
  const cats = categorias.filter((c) => isGrupoDespesa(c.group_type) || c.group_type === 'cost');
  const nomesCats = new Set(cats.map((c) => `${c.group_type}|${c.name.trim().toLowerCase()}`));
  const gruposSemRaiz = grupos.filter((g) => !nomesCats.has(`${g.key}|${g.label.trim().toLowerCase()}`));

  return (
    <div>
      <label className="text-xs font-semibold text-zinc-600 block mb-1">
        Classificação DRE *
        <span className="text-zinc-400 font-normal ml-1">(obrigatória para dar baixa)</span>
      </label>
      <select required value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full border border-amber-300 bg-amber-50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
        <option value="">Selecione…</option>
        {cats.length > 0 && (
          <optgroup label="Categorias">
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.parent_id ? '  └ ' : ''}{c.name}</option>
            ))}
          </optgroup>
        )}
        {gruposSemRaiz.length > 0 && (
          <optgroup label="Grupos">
            {gruposSemRaiz.map((g) => (
              <option key={g.key} value={`${GRUPO_PREFIX}${g.key}`}>{g.label}</option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
