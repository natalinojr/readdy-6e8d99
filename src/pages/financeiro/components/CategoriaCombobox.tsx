import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

// Seletor de categoria com busca: clica, digita parte do nome (ou do grupo da DRE) e escolhe
// com clique ou ↑/↓ + Enter. A lista abre em position: fixed (portal) para não ser cortada
// por tabelas com overflow; fecha ao clicar fora, rolar a página ou apertar Esc.
// Celular (2026-09-30): abre como painel no topo da tela, com fundo escuro. Antes o teclado que sobe
// ao focar a busca disparava resize/scroll e a lista fechava na hora — não dava para escolher nada.

export interface ComboOption { id: string; label: string; sub?: string | null }

interface Props {
  value: string;
  options: ComboOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  buttonClassName?: string;
  /** Ação no rodapé da lista (ex.: criar o que não existe). Recebe o texto digitado na busca. */
  onCreate?: (texto: string) => void;
  /** Rótulo da ação; recebe o texto digitado (pode vir vazio). */
  createLabel?: (texto: string) => string;
}

const PANEL_W = 288;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function CategoriaCombobox({ value, options, onChange, placeholder = 'Selecione…', disabled, buttonClassName = '', onCreate, createLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const words = norm(q.trim()).split(/\s+/).filter(Boolean);
    if (words.length === 0) return options;
    return options.filter((o) => {
      const h = norm(`${o.label} ${o.sub ?? ''}`);
      return words.every((w) => h.includes(w));
    });
  }, [q, options]);

  const abrir = () => {
    if (disabled || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const celular = window.innerWidth < 640 || window.matchMedia?.('(pointer: coarse)').matches === true;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
    // Perto do rodapé da tela, abre para cima
    const up = window.innerHeight - r.bottom < 320 && r.top > 320;
    // Desenha a lista ainda dentro do toque e põe o cursor na busca, para já sair digitando
    // (pedido do dono, 2026-09-30). O celular só abre o teclado se o foco vier no próprio toque.
    flushSync(() => {
      setSheet(celular);
      setPos(up ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
      setQ('');
      setHi(Math.max(0, options.findIndex((o) => o.id === value)));
      setOpen(true);
    });
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!open || sheet) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, sheet]);

  // Painel do celular: trava a rolagem da página por baixo enquanto está aberto
  useEffect(() => {
    if (!open || !sheet) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = antes; };
  }, [open, sheet]);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const escolher = (o: ComboOption) => {
    setOpen(false);
    if (!sheet) btnRef.current?.focus();
    if (o.id !== value) onChange(o.id);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[hi]; if (o) escolher(o); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
  };

  return (
    <>
      <button ref={btnRef} type="button" disabled={disabled}
        onClick={() => (open ? setOpen(false) : abrir())}
        title={selected ? [selected.label, selected.sub].filter(Boolean).join(' · ') : undefined}
        className={`inline-flex items-center justify-between gap-1 text-left disabled:opacity-50 ${buttonClassName}`}>
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <i className="ri-arrow-down-s-line flex-shrink-0" />
      </button>
      {open && pos && createPortal(
        <div className={sheet ? 'fixed inset-0 z-[70] bg-black/40 flex flex-col p-2 pt-3' : ''}
          onClick={sheet ? (e) => { if (e.target === e.currentTarget) setOpen(false); } : undefined}>
        <div ref={panelRef}
          style={sheet ? undefined : { position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: PANEL_W, zIndex: 60 }}
          className={`bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden text-zinc-800 ${sheet ? 'w-full max-h-[75dvh] flex flex-col' : ''}`}>
          <div className="p-2 border-b border-zinc-100 flex items-center gap-2">
            <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKey}
              placeholder={sheet ? 'Buscar…' : 'Digite para buscar a categoria…'}
              className={`w-full border border-zinc-200 rounded-lg focus:outline-none focus:border-amber-400 ${sheet ? 'text-base px-3 py-2' : 'text-sm px-2.5 py-1.5'}`} />
            {sheet && (
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar"
                className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer">
                <i className="ri-close-line text-xl" />
              </button>
            )}
          </div>
          <ul ref={listRef} role="listbox" className={`overflow-y-auto py-1 ${sheet ? 'flex-1 min-h-0' : 'max-h-64'}`}>
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-xs text-zinc-400 text-center">Nenhuma categoria com “{q}”</li>
            ) : filtered.map((o, i) => (
              <li key={o.id} data-i={i} role="option" aria-selected={o.id === value}
                onMouseEnter={sheet ? undefined : () => setHi(i)}
                onMouseDown={sheet ? undefined : (e) => { e.preventDefault(); escolher(o); }}
                onClick={sheet ? () => escolher(o) : undefined}
                className={`cursor-pointer ${sheet ? 'px-4 py-3 border-b border-zinc-50 active:bg-amber-50' : 'px-3 py-1.5'} ${i === hi && !sheet ? 'bg-amber-50' : ''}`}>
                <span className={`block text-sm ${o.id === value ? 'font-semibold text-violet-700' : ''}`}>{o.label}</span>
                {o.sub && <span className="block text-[11px] text-zinc-400">{o.sub}</span>}
              </li>
            ))}
          </ul>
          {onCreate && (
            <button type="button"
              onMouseDown={sheet ? undefined : (e) => { e.preventDefault(); const t = q.trim(); setOpen(false); onCreate(t); }}
              onClick={sheet ? () => { const t = q.trim(); setOpen(false); onCreate(t); } : undefined}
              className={`w-full flex items-center gap-1.5 px-3 ${sheet ? 'py-3' : 'py-2'} border-t border-zinc-100 text-left text-sm font-semibold text-emerald-700 hover:bg-emerald-50 cursor-pointer`}>
              <i className="ri-add-circle-line" />
              <span className="truncate">{createLabel ? createLabel(q.trim()) : (q.trim() ? `Criar “${q.trim()}”` : 'Criar novo')}</span>
            </button>
          )}
        </div>
        </div>,
        document.body,
      )}
    </>
  );
}
