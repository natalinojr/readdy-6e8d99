import { mascaraCpfCnpj, soDigitos, erroCpfCnpj, tipoDoc } from '@/lib/cpfCnpj';

interface Props {
  /** Só os dígitos (o componente cuida da máscara). */
  value: string;
  /** Recebe só os dígitos. */
  onChange: (digitos: string) => void;
  label?: string | null;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Aparece abaixo do campo quando não há erro. */
  hint?: string;
  onEnter?: () => void;
  /** Visual compacto (usado no caixa, onde o espaço é curto). */
  compact?: boolean;
}

/**
 * Campo de CPF/CNPJ do consumidor para a nota fiscal. Máscara progressiva
 * (CPF até 11 dígitos, CNPJ a partir do 12º) e validação do dígito verificador.
 */
export default function CpfCnpjInput({
  value, onChange, label = 'CPF/CNPJ na nota', placeholder = '000.000.000-00',
  className = '', autoFocus, disabled, hint, onEnter, compact,
}: Props) {
  const digitos = soDigitos(value);
  const erro = erroCpfCnpj(digitos);
  const tipo = tipoDoc(digitos);
  const ok = tipo !== null && !erro;

  const base = compact
    ? 'w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2'
    : 'w-full text-sm border rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none';
  const cor = erro
    ? 'border-red-300 focus:ring-red-200 focus:border-red-400'
    : ok
      ? 'border-emerald-300 focus:ring-emerald-200 focus:border-emerald-400'
      : 'border-zinc-200 focus:ring-amber-400 focus:border-amber-400';

  return (
    <div className={className}>
      {label ? (
        <label className={compact
          ? 'flex items-center justify-between text-[10px] font-semibold text-zinc-500 mb-1 uppercase tracking-wide'
          : 'flex items-center justify-between text-[11px] font-semibold text-zinc-600 mb-1'}>
          <span>{label}</span>
          {ok ? <span className="text-emerald-600 font-bold normal-case">{tipo} ok</span> : null}
        </label>
      ) : null}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        value={mascaraCpfCnpj(digitos)}
        onChange={(e) => onChange(soDigitos(e.target.value).slice(0, 14))}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter && !erro) onEnter(); }}
        placeholder={placeholder}
        className={`${base} ${cor}`}
      />
      {erro ? <p className="text-[10px] text-red-500 mt-1">{erro}</p>
        : hint ? <p className="text-[10px] text-zinc-400 mt-1">{hint}</p> : null}
    </div>
  );
}
