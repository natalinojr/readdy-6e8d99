import { useState } from 'react';
import { ChevronRight, ChevronDown, EyeOff, FolderInput, Plus, Trash2, Users, Share2, Settings } from 'lucide-react';
import { idsSubarvore, reordenarIrmas, type NoPasta } from '../lib/pastas';

/** Põe o texto inteiro como dica (title) só quando ele está cortado com "…". */
export function mostrarSeCortado(el: HTMLElement, texto: string) {
  el.title = el.scrollWidth > el.clientWidth ? texto : '';
}

interface ArvorePastasProps {
  nos: NoPasta[];
  selectedId: string | null;
  onSelecionar: (id: string) => void;
  onNovaSubpasta: (parentId: string) => void;
  /** Exclui a pasta junto com as subpastas e tarefas (quem chama confirma). */
  onExcluir?: (no: NoPasta) => void;
  /** Abre o compartilhamento da pasta. */
  onCompartilhar?: (no: NoPasta) => void;
  /** No celular a folha inteira é clicável e some ao selecionar — sem hover de "+". */
  compacto?: boolean;
  /** Arrastar muda a ordem entre pastas do mesmo nível (só no computador, só pastas minhas). */
  onReordenar?: (idsIrmasEmOrdem: string[]) => void;
  /** Arrastar para o meio de outra pasta põe dentro dela; para a borda de uma pasta de
   *  outro nível, muda de nível na posição (2026-09-29). paiId null = raiz. */
  onMover?: (listId: string, paiId: string | null, ordemIrmas?: string[]) => void;
  /** Botão "Mover para…" (abre o seletor de pasta — quem chama). */
  onPedirMover?: (no: NoPasta) => void;
  /** Engrenagem: configurações da pasta (nome, cor e atalhos) — só o dono. */
  onConfigurar?: (no: NoPasta) => void;
}

type Alvo = { id: string; posicao: 'antes' | 'depois' | 'dentro' };


export default function ArvorePastas({ nos, selectedId, onSelecionar, onNovaSubpasta, onExcluir, onCompartilhar, compacto = false, onReordenar, onMover, onPedirMover, onConfigurar }: ArvorePastasProps) {
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set());
  // Arrasto em andamento: a pasta, o pai dela e ela + subpastas (onde não pode cair).
  const [arrasto, setArrasto] = useState<{ id: string; paiId: string | null; bloqueados: Set<string> } | null>(null);
  const [alvo, setAlvo] = useState<Alvo | null>(null);

  const fimArrasto = () => { setArrasto(null); setAlvo(null); };

  const alternar = (id: string) => {
    setRecolhidas((prev) => {
      const p = new Set(prev);
      if (p.has(id)) p.delete(id);
      else p.add(id);
      return p;
    });
  };

  const renderNo = (no: NoPasta, irmas: NoPasta[]): React.ReactNode => {
    const temFilhas = no.filhas.length > 0;
    const recolhida = recolhidas.has(no.id);
    const ativa = selectedId === no.id;
    // Sem "access" = resposta antiga do servidor, em que toda pasta era minha.
    const acesso = no.access ?? 'owner';
    const podeEditar = acesso === 'owner' || acesso === 'edit';
    // Símbolo de pasta compartilhada (2026-09-24): vale também o compartilhamento herdado da pasta
    // de cima (shared_count); servidor antigo sem shared_count cai no share_count (só os diretos).
    const pessoas = no.shared_count ?? no.share_count ?? 0;
    const compartilhada = acesso !== 'owner' || pessoas > 0;
    const foraDoCompartilhamento = acesso === 'owner' && !!no.share_excluded;
    const acaoCls = `shrink-0 rounded text-slate-300 ${compacto ? 'p-2.5 text-slate-400' : 'p-1.5'}`;
    const idsIrmas = irmas.map((i) => i.id);
    const podeArrastar = !!(onReordenar || onMover) && !compacto && acesso === 'owner';
    const arrastavel = podeArrastar && (!!onMover || irmas.length > 1);
    const mesmoNivel = !!arrasto && idsIrmas.includes(arrasto.id);
    // Alvo: pasta minha, fora da subárvore arrastada. Sem onMover, só as irmãs (reordenar).
    const ehAlvo = !!arrasto && acesso === 'owner' && !arrasto.bloqueados.has(no.id) && (!!onMover || mesmoNivel);
    const linha = alvo?.id === no.id ? alvo.posicao : null;

    return (
      <div key={no.id}>
        <div
          className={`group w-full flex items-center gap-1 text-sm ${compacto ? '' : 'pr-2'} ${
            ativa ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
          }`}
          style={{
            paddingLeft: `${16 + no.profundidade * 16}px`,
            // Linha azul onde a pasta vai cair; contorno = vai para dentro.
            boxShadow: linha === 'antes' ? 'inset 0 2px 0 #6366f1' : linha === 'depois' ? 'inset 0 -2px 0 #6366f1'
              : linha === 'dentro' ? 'inset 0 0 0 2px #6366f1' : undefined,
            opacity: arrasto?.id === no.id ? 0.4 : undefined,
          }}
          draggable={arrastavel}
          onDragStart={arrastavel ? (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', no.id); // Firefox só arrasta com dado
            setArrasto({ id: no.id, paiId: no.parent_list_id ?? null, bloqueados: idsSubarvore(no) });
          } : undefined}
          onDragEnd={arrastavel ? fimArrasto : undefined}
          onDragOver={ehAlvo ? (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const r = e.currentTarget.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            // Com onMover: quarto de cima = antes, de baixo = depois, meio = dentro.
            const posicao: Alvo['posicao'] = !onMover ? (y < 0.5 ? 'antes' : 'depois')
              : y < 0.25 ? 'antes' : y > 0.75 ? 'depois' : 'dentro';
            if (alvo?.id !== no.id || alvo.posicao !== posicao) setAlvo({ id: no.id, posicao });
          } : undefined}
          onDragLeave={ehAlvo ? () => setAlvo((a) => (a?.id === no.id ? null : a)) : undefined}
          onDrop={ehAlvo ? (e) => {
            e.preventDefault();
            const posicao = alvo?.id === no.id ? alvo.posicao : 'dentro';
            const a = arrasto!;
            fimArrasto();
            if (posicao === 'dentro') {
              if (no.id !== a.paiId) {
                onMover?.(a.id, no.id);
                setRecolhidas((prev) => { const p = new Set(prev); p.delete(no.id); return p; }); // mostra onde caiu
              }
              return;
            }
            const paiDestino = no.parent_list_id ?? null;
            const base = paiDestino === a.paiId ? idsIrmas : [...idsIrmas, a.id];
            const nova = reordenarIrmas(base, a.id, no.id, posicao);
            if (paiDestino === a.paiId) { if (nova.join() !== idsIrmas.join()) onReordenar?.(nova); }
            else onMover?.(a.id, paiDestino, nova);
          } : undefined}
          title={arrastavel ? (onMover ? 'Arraste para mudar a ordem ou solte em cima de outra pasta para pôr dentro dela' : 'Arraste para mudar a ordem') : undefined}
        >
          <button
            onClick={() => alternar(no.id)}
            className={`shrink-0 p-0.5 -ml-0.5 text-slate-300 hover:text-slate-500 ${temFilhas ? '' : 'invisible'}`}
            tabIndex={temFilhas ? 0 : -1}
          >
            {recolhida ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          <button onClick={() => onSelecionar(no.id)} className="flex-1 flex items-center gap-2 py-2 text-left min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: no.color }} />
            {/* Nome cortado: passar o mouse mostra inteiro (só quando não cabe). */}
            <span className="flex-1 truncate" onMouseEnter={(e) => mostrarSeCortado(e.currentTarget, no.name)}>{no.name}</span>
            {no.open_count > 0 && <span className="text-xs text-slate-400 shrink-0">{no.open_count}</span>}
          </button>
          {/* Tocar no símbolo mostra com quem a pasta está compartilhada (janela Compartilhar). */}
          {compartilhada && (
            <button
              onClick={(e) => { e.stopPropagation(); onCompartilhar?.(no); }}
              className={`shrink-0 flex items-center gap-0.5 rounded-md px-1 text-[10px] font-semibold text-indigo-500 hover:bg-indigo-50 ${compacto ? 'py-2' : 'py-1'}`}
              title={acesso === 'owner'
                ? `Compartilhada com ${pessoas} ${pessoas === 1 ? 'pessoa' : 'pessoas'} — ver quem`
                : `De ${no.owner_name ?? 'outra pessoa'} · ${acesso === 'edit' ? 'você pode editar' : 'só ver'} — ver quem tem acesso`}
              aria-label={`Pasta compartilhada: ver com quem`}
            >
              <Users size={12} />
              {acesso === 'owner' && pessoas > 0 && <span>{pessoas}</span>}
            </button>
          )}
          {foraDoCompartilhamento && (
            <span className="shrink-0 px-1 text-slate-400" title="Fora do compartilhamento: quem recebeu a pasta de cima não vê esta">
              <EyeOff size={12} />
            </span>
          )}
          {/* No computador as ações só ocupam lugar no hover — escondidas, o nome usa a largura toda. */}
          <div className={`items-center ${compacto ? 'flex mr-2' : 'hidden group-hover:flex group-focus-within:flex'}`}>
            {onConfigurar && acesso === 'owner' && (
              <button
                onClick={(e) => { e.stopPropagation(); onConfigurar(no); }}
                className={`${acaoCls} hover:text-indigo-500 hover:bg-indigo-50`}
                title="Configurações da pasta (nome, cor…)"
                aria-label="Configurações da pasta"
              >
                <Settings size={12} />
              </button>
            )}
            {onCompartilhar && (
              <button
                onClick={(e) => { e.stopPropagation(); onCompartilhar(no); }}
                className={`${acaoCls} hover:text-indigo-500 hover:bg-indigo-50`}
                title={acesso === 'owner' ? 'Compartilhar' : 'Quem tem acesso'}
              >
                <Share2 size={12} />
              </button>
            )}
            {/* Com a engrenagem, "Mover para…" fica dentro dela: um ícone a mais espremia o nome da pasta. */}
            {onPedirMover && !onConfigurar && acesso === 'owner' && (
              <button
                onClick={(e) => { e.stopPropagation(); onPedirMover(no); }}
                className={`${acaoCls} hover:text-indigo-500 hover:bg-indigo-50`}
                title="Mover para outra pasta"
                aria-label="Mover para outra pasta"
              >
                <FolderInput size={12} />
              </button>
            )}
            {podeEditar && (
              <button
                onClick={(e) => { e.stopPropagation(); onNovaSubpasta(no.id); }}
                className={`${acaoCls} hover:text-indigo-500 hover:bg-indigo-50`}
                title="Nova subpasta"
              >
                <Plus size={13} />
              </button>
            )}
            {onExcluir && acesso === 'owner' && (
              <button
                onClick={(e) => { e.stopPropagation(); onExcluir(no); }}
                className={`${acaoCls} hover:text-red-500 hover:bg-red-50`}
                title={temFilhas ? 'Excluir pasta e subpastas' : 'Excluir pasta'}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
        {!recolhida && temFilhas && no.filhas.map((filha) => renderNo(filha, no.filhas))}
      </div>
    );
  };

  return <div>{nos.map((no) => renderNo(no, nos))}</div>;
}
