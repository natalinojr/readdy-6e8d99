// Diálogos do sistema no lugar do confirm()/alert()/prompt() do navegador ("erpos.vercel.app diz…").
// Uso (em função async):
//   if (!(await confirmar({ titulo: 'Excluir este item?', mensagem: 'Não dá para desfazer.', perigo: true }))) return;
//   await avisar('Arquivo muito grande. Máx. 2MB.');
//   const motivo = await perguntar({ titulo: 'Motivo do cancelamento', opcional: true });  // null = cancelou
// O <DialogosHost /> é montado uma vez no App; sem ele (ex.: teste isolado) cai no nativo.
// Mesmo padrão de src/pages/contratacao/dialog.tsx, para o sistema todo (2026-09-25).
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Req {
  kind: 'confirm' | 'alert' | 'prompt';
  titulo: string;
  mensagem?: ReactNode;
  confirmarLabel: string;
  cancelarLabel: string;
  perigo: boolean;
  icone?: string;
  valorInicial?: string;
  placeholder?: string;
  opcional?: boolean;
  resolve: (v: boolean | string | null) => void;
}

let push: ((r: Req) => void) | null = null;

const textoDe = (t: string, m?: ReactNode) => (typeof m === 'string' && m ? `${t}\n\n${m}` : t);

export function confirmar(o: {
  titulo: string; mensagem?: ReactNode; confirmarLabel?: string; cancelarLabel?: string; perigo?: boolean; icone?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) { resolve(window.confirm(textoDe(o.titulo, o.mensagem))); return; }
    push({
      kind: 'confirm', titulo: o.titulo, mensagem: o.mensagem, confirmarLabel: o.confirmarLabel ?? 'Confirmar',
      cancelarLabel: o.cancelarLabel ?? 'Cancelar', perigo: !!o.perigo, icone: o.icone, resolve: (v) => resolve(v === true),
    });
  });
}

export function avisar(mensagem: ReactNode, o: { titulo?: string; erro?: boolean; icone?: string } = {}): Promise<void> {
  const titulo = o.titulo ?? (o.erro ? 'Não deu certo' : 'Aviso');
  return new Promise((resolve) => {
    if (!push) { window.alert(textoDe(titulo, mensagem)); resolve(); return; }
    push({
      kind: 'alert', titulo, mensagem, confirmarLabel: 'Entendi', cancelarLabel: '', perigo: !!o.erro, icone: o.icone,
      resolve: () => resolve(),
    });
  });
}

/** Pede um texto. Devolve null se cancelou; '' só quando `opcional`. */
export function perguntar(o: {
  titulo: string; mensagem?: ReactNode; valorInicial?: string; placeholder?: string; opcional?: boolean;
  confirmarLabel?: string; perigo?: boolean;
}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) { resolve(window.prompt(textoDe(o.titulo, o.mensagem), o.valorInicial ?? '')); return; }
    push({
      kind: 'prompt', titulo: o.titulo, mensagem: o.mensagem, confirmarLabel: o.confirmarLabel ?? 'Confirmar', cancelarLabel: 'Cancelar',
      perigo: !!o.perigo, valorInicial: o.valorInicial, placeholder: o.placeholder, opcional: o.opcional,
      resolve: (v) => resolve(typeof v === 'string' ? v : null),
    });
  });
}

export function DialogosHost() {
  const [fila, setFila] = useState<Req[]>([]);
  const [texto, setTexto] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    push = (r) => setFila((f) => [...f, r]);
    return () => { push = null; };
  }, []);

  const atual = fila[0] ?? null;
  const fechar = (v: boolean | string | null) => {
    if (!atual) return;
    atual.resolve(v);
    setFila((f) => f.slice(1));
  };
  const podeConfirmar = atual?.kind !== 'prompt' || atual.opcional || texto.trim().length > 0;
  const confirmarAtual = () => {
    if (!atual || !podeConfirmar) return;
    fechar(atual.kind === 'prompt' ? texto.trim() : true);
  };

  useEffect(() => {
    if (!atual) return;
    setTexto(atual.valorInicial ?? '');
    setTimeout(() => (atual.kind === 'prompt' ? inputRef.current?.focus() : btnRef.current?.focus()), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); fechar(atual.kind === 'confirm' ? false : null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual]);

  if (!atual) return null;

  const icone = atual.icone
    ?? (atual.kind === 'alert' ? (atual.perigo ? 'ri-error-warning-line' : 'ri-information-line')
      : atual.kind === 'prompt' ? 'ri-edit-line'
      : atual.perigo ? 'ri-delete-bin-6-line' : 'ri-question-line');
  const cor = atual.perigo ? 'text-red-500' : 'text-amber-500';
  const botao = atual.perigo ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600';
  const cancelar = () => fechar(atual.kind === 'confirm' ? false : null);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={atual.kind === 'alert' ? () => fechar(null) : cancelar} />
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-titulo"
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[dlgPop_.16s_ease-out]">
        <style>{'@keyframes dlgPop{from{opacity:0;transform:scale(.96) translateY(6px)}to{opacity:1;transform:none}}'}</style>
        <div className="p-6 text-center">
          <div className="w-14 h-14 mx-auto mb-4 flex items-center justify-center rounded-full bg-zinc-50">
            <i className={`${icone} text-2xl ${cor}`} />
          </div>
          <h3 id="dlg-titulo" className="text-base font-bold text-zinc-800 mb-2">{atual.titulo}</h3>
          {atual.mensagem && <div className="text-sm text-zinc-500 leading-relaxed whitespace-pre-line">{atual.mensagem}</div>}
          {atual.kind === 'prompt' && (
            <textarea ref={inputRef} value={texto} onChange={(e) => setTexto(e.target.value)} rows={3}
              placeholder={atual.placeholder ?? (atual.opcional ? 'Opcional' : '')}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmarAtual(); } }}
              className="mt-4 w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm text-left focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none" />
          )}
        </div>
        <div className="flex items-center gap-2 px-5 py-4 bg-zinc-50 border-t border-zinc-100">
          {atual.kind !== 'alert' && (
            <button onClick={cancelar}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-white hover:shadow-sm rounded-xl transition-all cursor-pointer">
              {atual.cancelarLabel}
            </button>
          )}
          <button ref={btnRef} onClick={atual.kind === 'alert' ? () => fechar(null) : confirmarAtual} disabled={!podeConfirmar}
            className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl text-white transition-all cursor-pointer disabled:opacity-50 ${botao}`}>
            {atual.confirmarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
