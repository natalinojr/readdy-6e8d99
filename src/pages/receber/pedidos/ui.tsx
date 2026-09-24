// Peças de formulário dos pedidos de pagamento (mesmo visual do Receber mercadoria).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { normalizar } from '../api';
import type { Categoria } from './api';

export const cls = 'mt-1.5 w-full bg-white border-2 border-zinc-100 focus:border-amber-400 rounded-2xl px-4 py-3.5 text-base outline-none';

export function Rotulo({ children, dica }: { children: ReactNode; dica?: string }) {
  return (
    <div className="px-1">
      <label className="text-sm font-semibold text-zinc-700">{children}</label>
      {dica && <p className="text-xs text-zinc-400">{dica}</p>}
    </div>
  );
}

export function Texto({ label, dica, valor, onValor, placeholder, multilinha, inputMode }: {
  label: string; dica?: string; valor: string; onValor: (v: string) => void; placeholder?: string; multilinha?: boolean;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel';
}) {
  return (
    <div>
      <Rotulo dica={dica}>{label}</Rotulo>
      {multilinha
        ? <textarea rows={2} value={valor} onChange={(e) => onValor(e.target.value)} placeholder={placeholder} className={cls} />
        : <input value={valor} inputMode={inputMode} onChange={(e) => onValor(e.target.value)} placeholder={placeholder} className={cls} />}
    </div>
  );
}

/** "12,50" / "1.234,5" / "12.5" → número (NaN se vazio/errado). */
export function lerValor(s: string): number {
  const t = s.trim().replace(/\s|R\$/g, '');
  if (!t) return NaN;
  const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export function Valor({ label, valor, onValor }: { label: string; valor: string; onValor: (v: string) => void }) {
  return (
    <div>
      <Rotulo>{label}</Rotulo>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 mt-0.5 text-zinc-400 font-semibold">R$</span>
        <input value={valor} inputMode="decimal" onChange={(e) => onValor(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0,00" className={`${cls} pl-11 text-lg font-bold`} />
      </div>
    </div>
  );
}

export function Chips({ opcoes, valor, onValor }: { opcoes: { v: string; label: string }[]; valor: string | string[]; onValor: (v: string) => void }) {
  const ativos = Array.isArray(valor) ? valor : [valor];
  return (
    <div className="flex flex-wrap gap-2">
      {opcoes.map((o) => (
        <button key={o.v} type="button" onClick={() => onValor(o.v)}
          className={`px-3.5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer ${ativos.includes(o.v) ? 'bg-amber-500 text-white' : 'bg-white border border-zinc-200 text-zinc-600'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Lista de categorias de despesa com busca (poucas dezenas; cabe na tela). */
export function Categorias({ categorias, valor, onValor, dica }: { categorias: Categoria[] | null; valor: string | null; onValor: (id: string) => void; dica?: string }) {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const escolhida = categorias?.find((c) => c.id === valor);
  const lista = useMemo(() => {
    const q = normalizar(busca);
    return (categorias ?? []).filter((c) => !q || normalizar(c.nome).includes(q));
  }, [categorias, busca]);
  return (
    <div>
      <Rotulo dica={dica}>Classificação (no que foi o gasto)</Rotulo>
      {!aberto ? (
        <button type="button" onClick={() => setAberto(true)} className={`${cls} text-left flex items-center justify-between cursor-pointer`}>
          <span className={escolhida ? 'text-zinc-800' : 'text-zinc-400'}>{escolhida?.nome ?? (categorias ? 'Escolher…' : 'Carregando…')}</span>
          <i className="ri-arrow-down-s-line text-xl text-zinc-400" />
        </button>
      ) : (
        <div className="mt-1.5 bg-white border-2 border-amber-300 rounded-2xl overflow-hidden">
          <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar (ex.: limpeza, manutenção)" className="w-full px-4 py-3 text-base outline-none border-b border-zinc-100" />
          <div className="max-h-64 overflow-y-auto">
            {lista.map((c) => (
              <button key={c.id} type="button" onClick={() => { onValor(c.id); setAberto(false); setBusca(''); }}
                className={`w-full text-left px-4 py-3 text-sm border-b border-zinc-50 cursor-pointer ${c.id === valor ? 'bg-amber-50 font-semibold text-amber-800' : 'text-zinc-700 active:bg-zinc-50'}`}>
                {c.nome}
              </button>
            ))}
            {lista.length === 0 && <p className="px-4 py-4 text-sm text-zinc-400">Nada com esse nome.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Foto (câmera) ou PDF do comprovante. */
export function Comprovante({ arquivo, onArquivo, obrigatorio }: { arquivo: File | null; onArquivo: (f: File | null) => void; obrigatorio?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const url = useMemo(() => (arquivo && arquivo.type.startsWith('image/') ? URL.createObjectURL(arquivo) : null), [arquivo]);
  return (
    <div>
      <Rotulo dica={obrigatorio ? 'Obrigatório: cupom, recibo ou nota do que foi pago' : 'Recibo, orçamento ou conversa (opcional)'}>Foto do comprovante</Rotulo>
      <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; if (f) onArquivo(f); }} />
      {arquivo ? (
        <div className="mt-1.5 flex items-center gap-3 bg-white border-2 border-emerald-200 rounded-2xl p-2.5">
          {url ? <img src={url} alt="" className="w-14 h-14 object-cover rounded-xl" /> : <div className="w-14 h-14 rounded-xl bg-zinc-100 flex items-center justify-center"><i className="ri-file-pdf-2-line text-2xl text-red-500" /></div>}
          <p className="flex-1 min-w-0 text-sm text-emerald-700 font-semibold">Comprovante anexado</p>
          <button type="button" onClick={() => input.current?.click()} className="px-3 py-2 text-sm font-semibold text-zinc-600 cursor-pointer">Trocar</button>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} className="mt-1.5 w-full py-5 rounded-2xl border-2 border-dashed border-zinc-300 text-zinc-600 font-semibold flex items-center justify-center gap-2 cursor-pointer active:bg-zinc-100">
          <i className="ri-camera-line text-2xl" /> Tirar foto
        </button>
      )}
    </div>
  );
}

export function Enviar({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-zinc-100 px-4 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
      <button onClick={onClick} disabled={disabled} className="w-full py-4 rounded-2xl bg-amber-500 active:bg-amber-600 disabled:bg-zinc-200 disabled:text-zinc-400 text-white text-base font-bold cursor-pointer">
        {children}
      </button>
    </div>
  );
}
