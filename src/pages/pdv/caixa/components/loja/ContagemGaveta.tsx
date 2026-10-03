// Contagem do dinheiro da gaveta — a mesma na abertura e no fechamento da loja (2026-10-03).
// "Contar cédulas" é o padrão (o dono quer que o operador conte de verdade); "Digitar o total"
// fica ao lado para quem conta na mão.

export const NOTAS = [200, 100, 50, 20, 10, 5, 2];
export const MOEDAS = [1, 0.5, 0.25, 0.1, 0.05];

export type Contagem = Record<string, number>;

export interface ValorContado {
  modo: 'cedulas' | 'digitar';
  contagem: Contagem;
  valor: string;
}

export const contagemVazia = (): ValorContado => ({ modo: 'cedulas', contagem: {}, valor: '' });

export const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export function somaContagem(c: Contagem): number {
  return Math.round(Object.entries(c).reduce((a, [k, q]) => a + Number(k) * (q || 0), 0) * 100) / 100;
}

/** "1.234,56" / "359,25" / "359.25" → número. NaN quando não dá para ler. */
export function lerValor(s: string): number {
  const t = s.trim().replace(/\s|R\$/g, '');
  if (!t) return NaN;
  const n = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return Number(n);
}

/** Valor contado, ou null enquanto a pessoa ainda não contou nada. */
export function valorDe(v: ValorContado): number | null {
  if (v.modo === 'cedulas') {
    return Object.values(v.contagem).some((q) => q > 0) ? somaContagem(v.contagem) : null;
  }
  const n = lerValor(v.valor);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

const rotulo = (v: number) => (v >= 1 ? `R$ ${v}` : `R$ ${v.toFixed(2).replace('.', ',')}`);

interface Props {
  estado: ValorContado;
  onChange: (v: ValorContado) => void;
  /** Foca o campo de valor ao trocar para "Digitar o total". */
  idCampo?: string;
}

export default function ContagemGaveta({ estado, onChange, idCampo = 'gaveta-total' }: Props) {
  const setQtd = (den: number, qtd: number) => {
    onChange({ ...estado, contagem: { ...estado.contagem, [den]: Math.max(0, Math.floor(qtd) || 0) } });
  };

  const linha = (den: number) => {
    const q = estado.contagem[den] ?? 0;
    return (
      <div key={den} className="flex items-center gap-2 px-3 py-1.5 border-t border-stone-100 first:border-t-0">
        <span className="w-16 text-[13px] font-bold text-zinc-700">{rotulo(den)}</span>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setQtd(den, q - 1)}
          className="w-8 h-8 rounded-lg bg-stone-100 hover:bg-stone-200 text-zinc-700 font-black cursor-pointer"
          aria-label={`Menos uma de ${rotulo(den)}`}
        >−</button>
        <input
          type="text"
          inputMode="numeric"
          value={q || ''}
          placeholder="0"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setQtd(den, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
          className="w-14 text-center text-sm font-black border border-stone-200 rounded-lg py-1.5 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          aria-label={`Quantidade de ${rotulo(den)}`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setQtd(den, q + 1)}
          className="w-8 h-8 rounded-lg bg-stone-100 hover:bg-stone-200 text-zinc-700 font-black cursor-pointer"
          aria-label={`Mais uma de ${rotulo(den)}`}
        >+</button>
        <span className={`flex-1 text-right text-xs font-bold ${q ? 'text-amber-700' : 'text-stone-300'}`}>
          {q ? fmtBRL(q * den) : '—'}
        </span>
      </div>
    );
  };

  return (
    <div>
      <div className="inline-flex bg-stone-100 rounded-xl p-1 mb-3">
        {([['cedulas', 'Contar cédulas'], ['digitar', 'Digitar o total']] as const).map(([m, txt]) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              onChange({ ...estado, modo: m });
              if (m === 'digitar') setTimeout(() => document.getElementById(idCampo)?.focus(), 30);
            }}
            className={`px-4 py-2 rounded-lg text-[13px] font-bold cursor-pointer transition-colors ${
              estado.modo === m ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {txt}
          </button>
        ))}
      </div>

      {estado.modo === 'cedulas' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([['Cédulas', NOTAS], ['Moedas', MOEDAS]] as const).map(([titulo, lista]) => (
            <div key={titulo} className="border border-stone-200 rounded-2xl overflow-hidden bg-white self-start">
              <p className="px-3 py-2 bg-stone-50 text-[11px] font-black text-stone-400 uppercase tracking-wider">{titulo}</p>
              {lista.map(linha)}
            </div>
          ))}
        </div>
      ) : (
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-black text-stone-400">R$</span>
          <input
            id={idCampo}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={estado.valor}
            onChange={(e) => onChange({ ...estado, valor: e.target.value.replace(/[^\d.,]/g, '') })}
            className="w-full pl-14 pr-4 py-3 text-3xl font-black border-2 border-stone-200 rounded-2xl text-zinc-900 focus:outline-none focus:border-amber-400"
          />
        </div>
      )}
    </div>
  );
}
