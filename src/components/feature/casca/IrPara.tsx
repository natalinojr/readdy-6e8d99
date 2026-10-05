// "Ir para…" (Ctrl K): janela de busca sobre o catálogo — só as telas que a pessoa vê, mais os produtos
// dela (Tarefas, Contratação, Notas). Apelidos: "caixa", "boleto", "contar", "vencidas"... (src/constants/telas.ts).
// ↑↓ escolhem, Enter abre, Esc fecha.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { GRUPOS, type Icone, type Produto, type Tela } from '@/constants/telas';
import { buscarTelas } from '@/lib/casca';

interface Item {
  id: string;
  rotulo: string;
  rota: string;
  icone: Icone;
  descricao: string;
  apelidos?: string[];
  onde: string;
}

const DESC_PRODUTO: Record<string, { descricao: string; apelidos: string[] }> = {
  tarefas: { descricao: 'o que a equipe precisa fazer, com prazo e responsável', apelidos: ['tarefa', 'checklist', 'prazo'] },
  contratacao: { descricao: 'currículos e entrevistas', apelidos: ['curriculo', 'entrevista', 'candidato', 'vaga'] },
  nfse: { descricao: 'emitir nota de serviço (NFS-e)', apelidos: ['nfs-e', 'nota de servico', 'emitir nota'] },
};

export default function IrPara({ telas, produtos, onFechar }: { telas: Tela[]; produtos: Produto[]; onFechar: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  const itens: Item[] = useMemo(() => {
    const grupo = Object.fromEntries(GRUPOS.map((g) => [g.id, g.rotulo]));
    return [
      ...telas.map((t) => ({ id: t.id, rotulo: t.rotulo, rota: t.rota, icone: t.icone, descricao: t.descricao, apelidos: t.apelidos, onde: grupo[t.grupo] })),
      ...produtos.filter((p) => p.id !== 'loja').map((p) => ({
        id: p.id, rotulo: p.rotulo, rota: p.rota, icone: p.icone, onde: 'Outro produto', ...DESC_PRODUTO[p.id],
      })),
    ];
  }, [telas, produtos]);

  const achados = useMemo(() => buscarTelas(q, itens), [q, itens]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const abrir = (it: Item | undefined) => {
    if (!it) return;
    onFechar();
    navigate(it.rota);
  };

  const tecla = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, achados.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); abrir(achados[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onFechar(); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center md:pt-[10vh] bg-[rgba(31,26,20,.45)]" onMouseDown={onFechar}>
      <div
        role="dialog"
        aria-label="Ir para"
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white w-full h-full md:h-auto md:max-h-[70vh] md:max-w-[560px] md:rounded-2xl flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 md:pt-4 border-b border-[#F3EEE6] flex-shrink-0">
          <Search size={20} className="text-[#C2700A] flex-shrink-0" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={tecla}
            placeholder="Para onde? Ex.: caixa, boleto, contar"
            className="flex-1 min-w-0 border-0 outline-none bg-transparent text-[17px] md:text-lg font-bold text-[#1F1A14] placeholder:text-[#9A9086] placeholder:font-semibold h-10"
            aria-label="Buscar tela"
          />
          <button
            type="button"
            onClick={onFechar}
            className="flex-shrink-0 rounded-lg px-2 py-1 text-[13px] md:text-[11px] font-extrabold text-[#C2700A] md:text-[#9A9086] md:border md:border-[#EEE6DA] md:bg-[#FAF7F2] cursor-pointer"
          >
            <span className="md:hidden">Fechar</span><span className="hidden md:inline">Esc</span>
          </button>
        </div>

        <div ref={lista} className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2">
          {achados.length === 0 ? (
            <div className="text-center px-4 py-9 text-[#5B5248]">
              <i className="ri-search-eye-line text-[34px] text-[#D9CFC1] block mb-1.5" />
              <b className="block text-[15px] font-extrabold text-[#1F1A14]">Nada para “{q.trim()}”</b>
              <p className="text-[12.5px] mt-1.5 leading-relaxed">Tente outra palavra. Se a tela existe mas o seu cargo não abre, ela também não aparece.</p>
            </div>
          ) : achados.map((it, i) => (
            <button
              key={it.id}
              type="button"
              data-i={i}
              onMouseEnter={() => setSel(i)}
              onClick={() => abrir(it)}
              className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left min-h-[52px] cursor-pointer ${
                i === sel ? 'bg-[#FFF4E0] shadow-[inset_3px_0_0_#F59E0B]' : 'hover:bg-[#FAF7F2]'
              }`}
            >
              <span className="w-8 h-8 rounded-[10px] bg-[#F4EFE7] text-[#5B5248] flex items-center justify-center flex-shrink-0">
                <it.icone size={16} />
              </span>
              <span className="flex-1 min-w-0">
                <b className="block text-[13.5px] font-extrabold text-[#1F1A14] truncate">{it.rotulo}</b>
                <small className="block text-[11.5px] text-[#9A9086] truncate">{it.onde} · {it.descricao}</small>
              </span>
              {i === sel && (
                <span className="hidden md:inline-flex items-center text-[11px] font-extrabold text-[#C2700A] border border-[#F7D9A6] rounded-md px-1.5 py-px bg-white">
                  <CornerDownLeft size={11} />
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="hidden md:flex border-t border-[#F3EEE6] px-4 py-2.5 text-xs text-[#9A9086] font-semibold gap-1.5 items-center bg-[#FBF8F3] flex-shrink-0">
          <kbd className="font-sans text-[11px] font-extrabold border border-[#EEE6DA] rounded-md px-1.5 bg-white text-[#5B5248]">↑</kbd>
          <kbd className="font-sans text-[11px] font-extrabold border border-[#EEE6DA] rounded-md px-1.5 bg-white text-[#5B5248]">↓</kbd>
          escolhem ·
          <kbd className="font-sans text-[11px] font-extrabold border border-[#EEE6DA] rounded-md px-1.5 bg-white text-[#5B5248]">Enter</kbd>
          abre · só aparecem as telas que o seu cargo abre
        </div>
      </div>
    </div>
  );
}
