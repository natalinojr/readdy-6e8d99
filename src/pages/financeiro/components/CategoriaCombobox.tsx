import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Seletor de categoria com busca: clica, digita parte do nome (ou do grupo da DRE) e escolhe
// com clique ou ↑/↓ + Enter. A lista abre em position: fixed (portal) para não ser cortada
// por tabelas com overflow; fecha ao clicar fora, rolar a página ou apertar Esc.

export interface ComboOption { id: string; label: string; sub?: string | null }

interface Props {
  value: string;
  options: ComboOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  buttonClassName?: string;
}

const PANEL_W = 288;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function CategoriaCombobox({ value, options, onChange, placeholder = 'Selecione…', disabled, buttonClassName = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
    // Perto do rodapé da tela, abre para cima
    const up = window.innerHeight - r.bottom < 320 && r.top > 320;
    setPos(up ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
    setQ('');
    setHi(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const escolher = (o: ComboOption) => {
    setOpen(false);
    btnRef.current?.focus();
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
        <div ref={panelRef} style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: PANEL_W, zIndex: 60 }}
          className="bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden text-zinc-800">
          <div className="p-2 border-b border-zinc-100">
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKey}
              placeholder="Digite para buscar a categoria…"
              className="w-full text-sm border border-zinc-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-400" />
          </div>
          <ul ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-xs text-zinc-400 text-center">Nenhuma categoria com “{q}”</li>
            ) : filtered.map((o, i) => (
              <li key={o.id} data-i={i} role="option" aria-selected={o.id === value}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => { e.preventDefault(); escolher(o); }}
                className={`px-3 py-1.5 cursor-pointer ${i === hi ? 'bg-amber-50' : ''}`}>
                <span className={`block text-sm ${o.id === value ? 'font-semibold text-violet-700' : ''}`}>{o.label}</span>
                {o.sub && <span className="block text-[11px] text-zinc-400">{o.sub}</span>}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
