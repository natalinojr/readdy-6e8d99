import { useEffect, useState, type ReactNode } from 'react';

// Peças visuais da tela Delivery: as mesmas do Estoque novo (cartões, faixa de números, chips, ⋯) mais
// o que só o Delivery precisa (interruptor, campo de dinheiro com vírgula, linha com interruptor).
export {
  btn, Faixa, CartaoAcao, CartaoBarra, SecaoTitulo, Chips, Vazio, Nota, Etiqueta, MenuMais, semAcento, brl, brlInteiro,
  type ItemFaixa, type TomCartao, type OpcaoChip, type ItemMenu,
} from '../estoque/components/ui/EstoqueUi';
export { default as Folha } from '../estoque/components/inicio/Folha';

/** Interruptor liga/desliga (verde quando ligado). */
export function Interruptor({ ligado, onChange, rotulo, pequeno = false, disabled = false }: {
  ligado: boolean; onChange: (v: boolean) => void; rotulo: string; pequeno?: boolean; disabled?: boolean;
}) {
  const w = pequeno ? 'w-[38px] h-[23px]' : 'w-[46px] h-7';
  const bola = pequeno ? 'w-[17px] h-[17px]' : 'w-[22px] h-[22px]';
  const pos = ligado ? (pequeno ? 'translate-x-[18px]' : 'translate-x-[21px]') : 'translate-x-[3px]';
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} disabled={disabled}
      onClick={() => onChange(!ligado)}
      className={`relative flex-shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${w} ${ligado ? 'bg-emerald-600' : 'bg-zinc-300'}`}>
      <span className={`absolute top-1/2 -translate-y-1/2 left-0 rounded-full bg-white shadow transition-transform ${bola} ${pos}`} />
    </button>
  );
}

/** Linha "título + explicação + interruptor" (cartões de liga/desliga). */
export function LinhaInterruptor({ titulo, texto, ligado, onChange, disabled }: {
  titulo: ReactNode; texto?: ReactNode; ligado: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-extrabold text-zinc-900">{titulo}</p>
        {texto && <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{texto}</p>}
      </div>
      <Interruptor ligado={ligado} onChange={onChange} rotulo={typeof titulo === 'string' ? titulo : 'Ligar'} disabled={disabled} />
    </div>
  );
}

const paraTexto = (v: number, casas: number) => (v ? v.toFixed(casas).replace('.', ',') : '');
/**
 * Texto digitado → número. Ponto só é separador de milhar quando vem em grupos de 3 dígitos ("1.250", "1.250,00");
 * fora disso é decimal ("6.50" → 6,5; "2.5" → 2,5). A vírgula é sempre o decimal ("1,5"). Inválido → 0.
 * (O primeiro grupo não começa com 0: "0.500" é meio, não quinhentos.)
 */
export function deTexto(t: string): number {
  const x = t.trim();
  const milhar = /^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(x);
  const limpo = milhar || x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x;
  const n = Number(limpo);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Campo de número que aceita vírgula e deixa apagar para digitar outro (o `type=number` antigo virava 0 na
 * hora). Mostra o valor formatado quando perde o foco. `prefixo` "R$" / `sufixo` "min", "km", "%".
 */
export function CampoNumero({ valor, onChange, prefixo, sufixo, casas = 2, largura = 'w-16', rotulo, placeholder, disabled }: {
  valor: number; onChange: (n: number) => void; prefixo?: string; sufixo?: string; casas?: number;
  largura?: string; rotulo: string; placeholder?: string; disabled?: boolean;
}) {
  const [texto, setTexto] = useState(paraTexto(valor, casas));
  const [editando, setEditando] = useState(false);
  useEffect(() => { if (!editando) setTexto(paraTexto(valor, casas)); }, [valor, casas, editando]);
  return (
    <span className={`inline-flex items-center gap-1 h-9 px-2.5 rounded-xl border border-zinc-200 bg-white focus-within:border-amber-400 ${disabled ? 'opacity-60' : ''}`}>
      {prefixo && <span className="text-[11px] font-bold text-zinc-400">{prefixo}</span>}
      <input
        type="text" inputMode="decimal" aria-label={rotulo} placeholder={placeholder} disabled={disabled}
        value={texto}
        onFocus={() => setEditando(true)}
        onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ''); setTexto(t); onChange(deTexto(t)); }}
        onBlur={() => { setEditando(false); setTexto(paraTexto(deTexto(texto), casas)); }}
        className={`${largura} bg-transparent outline-none text-[13.5px] font-extrabold text-zinc-900 text-right tabular-nums`}
      />
      {sufixo && <span className="text-[11px] font-bold text-zinc-400">{sufixo}</span>}
    </span>
  );
}

/** Caixa de cópia: texto em fonte fixa + botão Copiar (avisa "Copiado"). */
export function CaixaCopiar({ texto, rotulo = 'Copiar', destaque = false }: { texto: string; rotulo?: string; destaque?: boolean }) {
  const [ok, setOk] = useState(false);
  const copiar = () => {
    navigator.clipboard.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1600); }).catch(() => {});
  };
  return (
    <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-1.5 py-1.5 min-w-0">
      <code className="flex-1 min-w-0 truncate text-xs text-zinc-600 font-mono">{texto}</code>
      <button type="button" onClick={copiar}
        className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-bold flex-shrink-0 cursor-pointer ${destaque ? 'bg-amber-500 hover:bg-amber-400 text-zinc-900' : 'bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700'}`}>
        <i className={ok ? 'ri-check-line' : 'ri-file-copy-line'} />{ok ? 'Copiado' : rotulo}
      </button>
    </div>
  );
}

/** Container de cada aba. */
export function PaginaDelivery({ children }: { children: ReactNode }) {
  return <div className="p-4 md:p-6 max-w-[1180px] mx-auto pb-32 space-y-4">{children}</div>;
}

/** Manchete + frase curta no topo de uma aba. */
export function Manchete({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div>
      <h2 className="text-[22px] md:text-[26px] font-extrabold text-zinc-900 leading-tight tracking-tight">{titulo}</h2>
      {children && <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed max-w-2xl">{children}</p>}
    </div>
  );
}

/** Duas colunas no computador, uma no celular. */
export function Colunas({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid gap-4 lg:grid-cols-2 lg:gap-6 items-start ${className}`}>{children}</div>;
}

/** Cartão branco simples. */
export function Cartao({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white border border-zinc-200 rounded-2xl px-4 py-3.5 ${className}`}>{children}</div>;
}

/** "Faltam 12 min", "há 2 h", "ontem" */
export function haQuanto(iso: string | null | undefined): string {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min)) return '';
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

/** (41) 99999-9999 a partir de dígitos (aceita 55 na frente). */
export function fmtTelefone(d: string | null | undefined): string {
  const x0 = (d ?? '').replace(/\D/g, '');
  const x = x0.length > 11 && x0.startsWith('55') ? x0.slice(2) : x0;
  if (x.length === 11) return `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}`;
  if (x.length === 10) return `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}`;
  return x0;
}
/** Número para wa.me (Brasil: põe 55 se vier sem). */
export const waNumero = (d: string) => { const x = d.replace(/\D/g, ''); return x.length <= 11 ? '55' + x : x; };
