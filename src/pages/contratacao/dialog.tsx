// Diálogos do módulo Contratação no lugar do confirm()/alert() do navegador.
// Uso: `if (!(await confirmar({ titulo, mensagem, perigo: true }))) return;` e `avisar('...')`.
// O <DialogHost /> é montado uma vez na página; sem ele, cai no diálogo nativo.
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Req {
  kind: 'confirm' | 'alert';
  titulo: string;
  mensagem: ReactNode;
  confirmarLabel: string;
  perigo: boolean;
  resolve: (ok: boolean) => void;
}

let push: ((r: Req) => void) | null = null;

export function confirmar(o: { titulo: string; mensagem: ReactNode; confirmarLabel?: string; perigo?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) { resolve(window.confirm(typeof o.mensagem === 'string' ? o.mensagem : o.titulo)); return; }
    push({ kind: 'confirm', titulo: o.titulo, mensagem: o.mensagem, confirmarLabel: o.confirmarLabel ?? 'Confirmar', perigo: !!o.perigo, resolve });
  });
}

export function avisar(mensagem: string, titulo = 'Não deu certo'): Promise<void> {
  return new Promise((resolve) => {
    if (!push) { window.alert(mensagem); resolve(); return; }
    push({ kind: 'alert', titulo, mensagem, confirmarLabel: 'Entendi', perigo: false, resolve: () => resolve() });
  });
}

export function DialogHost() {
  const [fila, setFila] = useState<Req[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    push = (r) => setFila((f) => [...f, r]);
    return () => { push = null; };
  }, []);

  const atual = fila[0] ?? null;
  const fechar = (ok: boolean) => {
    if (!atual) return;
    atual.resolve(ok);
    setFila((f) => f.slice(1));
  };

  useEffect(() => {
    if (!atual) return;
    btnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); fechar(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual]);

  if (!atual) return null;

  const icone = atual.kind === 'alert'
    ? { cls: 'bg-amber-100 text-amber-600', i: 'ri-error-warning-line' }
    : atual.perigo
      ? { cls: 'bg-red-100 text-red-600', i: 'ri-delete-bin-6-line' }
      : { cls: 'bg-rose-100 text-rose-600', i: 'ri-question-line' };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-[2px]" onClick={() => fechar(false)} />
      <div role="dialog" aria-modal="true" aria-labelledby="ct-dialog-title"
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-zinc-100 p-6 animate-[ctPop_.16s_ease-out]">
        <style>{'@keyframes ctPop{from{opacity:0;transform:scale(.96) translateY(6px)}to{opacity:1;transform:none}}'}</style>
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${icone.cls}`}>
          <i className={`${icone.i} text-2xl`} />
        </div>
        <h2 id="ct-dialog-title" className="text-lg font-black text-zinc-900 leading-tight">{atual.titulo}</h2>
        <div className="text-sm text-zinc-600 mt-1.5 leading-relaxed">{atual.mensagem}</div>
        <div className="flex gap-2 mt-6">
          {atual.kind === 'confirm' && (
            <button onClick={() => fechar(false)}
              className="flex-1 h-10 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer">
              Cancelar
            </button>
          )}
          <button ref={btnRef} onClick={() => fechar(true)}
            className={`flex-1 h-10 rounded-xl text-sm font-bold text-white cursor-pointer ${
              atual.perigo ? 'bg-red-600 hover:bg-red-500' : atual.kind === 'alert' ? 'bg-zinc-900 hover:bg-zinc-800' : 'bg-rose-600 hover:bg-rose-500'}`}>
            {atual.confirmarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
