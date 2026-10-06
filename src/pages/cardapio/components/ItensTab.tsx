import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import type { Item } from '@/types/cardapio';
import ItemModal from './ItemModal';
import { extraMinimoGruposItem } from '@/lib/precoAPartirDe';
import { promoAtivaHoje } from '@/lib/promoUtils';
import ItemImage from '@/components/base/ItemImage';
import { SeloHorario } from '@/components/feature/HorarioExibicaoEditor';
import { resumoHorario, temHorario, type CanalHorario } from '@/lib/horarioExibicao';
import { usePermissoes } from '@/hooks/usePermissoes';
import { btn, brl, confirmar, CartaoAcao, Chips, Folha, MenuMais, SecaoTitulo, Vazio, Nota, Etiqueta } from '@/components/kit';
import {
  DICA_DISPONIBILIDADE, NOME_DISPONIBILIDADE, combinaBusca, comDisponibilidade, disponibilidadeDe, fraseMudanca,
  gruposDesfazer, lerPreco, ordenarItens, pendenciasCardapio, precisaConfirmar, rotuloPausa, temPrecoDeliveryProprio,
  type Disponibilidade, type MudancaLote, type ResumoItens,
} from '@/lib/cardapioLista';

// Lista de Itens do Cardápio no layout novo (2026-10-06). Computador = tabela; celular = cartões.
// Tudo que salva sem abrir o item (Ativo, Balcão · Os dois · Delivery, preço, Acabou hoje, lote) mostra a barra
// de baixo com o que aconteceu e Desfazer. SEM custo e margem (decisão do dono).
// Regras puras em src/lib/cardapioLista.ts.

const canaisDe = (item: Item): CanalHorario[] => {
  const d = disponibilidadeDe(item);
  return d === 'ambos' ? ['casa', 'delivery'] : [d];
};

type Filtro = 'todos' | 'semficha' | 'pausados' | 'fora' | 'inativos' | 'delivery';

/** Entrada por link (?item=<id>&ficha=1 ou ?busca=<nome>), vinda de fora do Cardápio — ex.: "Fazer ficha" do Estoque › CMV. */
export interface EntradaItens { itemId: string | null; ficha: boolean; busca: string | null }

interface Props {
  entrada?: EntradaItens | null;
  onEntradaUsada?: () => void;
  /** vendas 14 dias + quem tem ficha (useResumoItensCardapio); null = sem a leitura */
  resumo?: ResumoItens | null;
  onResumoMudou?: () => void;
  /** muda de valor = abrir "Novo item" (botão do cabeçalho) */
  novoItemSinal?: number;
  /** ⋯ › Mudar a ordem dos itens */
  ordenar?: boolean;
  onPararOrdenar?: () => void;
  onIrDestaques?: () => void;
}

// ── Peças da linha ──────────────────────────────────────────────────────────
function Chave({ ligada, onClick, disabled, rotulo }: { ligada: boolean; onClick: () => void; disabled?: boolean; rotulo: string }) {
  return (
    <button type="button" role="switch" aria-checked={ligada} aria-label={rotulo} title={rotulo} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`relative flex-shrink-0 w-12 h-7 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${ligada ? 'bg-amber-500' : 'bg-zinc-300'}`}>
      <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-all ${ligada ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

function SeletorCanal({ item, onChange, disabled, largo }: { item: Item; onChange: (v: Disponibilidade) => void; disabled?: boolean; largo?: boolean }) {
  const atual = disponibilidadeDe(item);
  return (
    <div onClick={(e) => e.stopPropagation()} title="Balcão = caixa, totem, mesa e garçom"
      className={`inline-flex bg-zinc-100 rounded-xl p-0.5 ${largo ? 'flex w-full' : ''}`}>
      {(['casa', 'ambos', 'delivery'] as Disponibilidade[]).map((k) => (
        <button key={k} type="button" disabled={disabled} title={DICA_DISPONIBILIDADE[k]}
          onClick={() => onChange(k)}
          className={`min-h-[32px] px-2.5 rounded-[10px] text-[11.5px] font-bold whitespace-nowrap cursor-pointer disabled:opacity-50 ${largo ? 'flex-1' : ''} ${
            atual === k ? `bg-white shadow-sm ${k === 'delivery' ? 'text-amber-800' : 'text-zinc-900'}` : 'text-zinc-400 hover:text-zinc-700'}`}>
          {NOME_DISPONIBILIDADE[k]}
        </button>
      ))}
    </div>
  );
}

/** Preço da casa; tocar vira campo (Enter/sair salva, Esc cancela). O de delivery próprio fica no item. */
function PrecoNaLinha({ item, pode, onSalvar }: { item: Item; pode: boolean; onSalvar: (valor: number) => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const fechou = useRef(false);
  const deliveryProprio = temPrecoDeliveryProprio(item);
  const promo = item.promocoes.some((p) => p.ativo);
  // Preço vem das opções obrigatórias (ex.: base R$ 0,00): mostra "a partir de" (só exibição)
  const extra = extraMinimoGruposItem(item.gruposOpcoes);
  const efetivo = (promoAtivaHoje(item.promocoes)?.precoPromocional ?? item.preco) + extra;

  const abrir = () => {
    if (!pode) return;
    fechou.current = false;
    setTexto(item.preco.toFixed(2).replace('.', ','));
    setErro('');
    setEditando(true);
  };
  const terminar = (salvar: boolean) => {
    if (fechou.current) return;
    if (salvar) {
      const r = lerPreco(texto);
      if (!r.ok) { setErro(r.erro); return; }
      fechou.current = true;
      setEditando(false);
      if (Math.abs(r.valor - item.preco) >= 0.005) onSalvar(r.valor);
      return;
    }
    fechou.current = true;
    setEditando(false);
  };

  if (editando) {
    return (
      <div onClick={(e) => e.stopPropagation()} className="inline-flex flex-col items-end">
        <div className="inline-flex items-center gap-1 border-2 border-amber-400 rounded-xl px-2 bg-white">
          <span className="text-[12px] text-zinc-400 font-bold">R$</span>
          <input autoFocus inputMode="decimal" value={texto} aria-label={`Preço de ${item.nome}`}
            onChange={(e) => { setTexto(e.target.value); setErro(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); terminar(true); } if (e.key === 'Escape') { e.preventDefault(); terminar(false); } }}
            onBlur={() => { const r = lerPreco(texto); terminar(r.ok); }}
            onFocus={(e) => e.currentTarget.select()}
            className="w-20 h-9 text-right text-[14px] font-extrabold text-zinc-900 focus:outline-none tabular-nums" />
        </div>
        {erro ? <span className="text-[11px] text-red-600 font-semibold mt-0.5">{erro}</span>
          : <span className="text-[10.5px] text-zinc-400 mt-0.5">Enter salva · Esc cancela</span>}
      </div>
    );
  }
  return (
    <div className="inline-flex flex-col items-end" onClick={(e) => { if (pode) e.stopPropagation(); }}>
      <button type="button" onClick={abrir} disabled={!pode}
        title={pode ? 'Tocar para mudar o preço' : 'Você não tem permissão para mudar preço'}
        className={`text-[14.5px] font-extrabold tabular-nums text-zinc-900 rounded-lg px-1.5 py-0.5 ${pode ? 'cursor-pointer hover:bg-amber-50 border-b border-dashed border-zinc-300' : 'cursor-default'}`}>
        {extra > 0 && <span className="text-[10.5px] font-semibold text-zinc-400">a partir de </span>}
        {extra > 0 ? brl(efetivo) : brl(item.preco)}
      </button>
      {extra > 0 && (
        <span className="text-[10.5px] text-zinc-400 font-semibold whitespace-nowrap" title="Tocar no preço muda só o preço base do item; o resto vem das opções obrigatórias.">
          base {brl(item.preco)} + opções
        </span>
      )}
      {deliveryProprio && (
        <span className="text-[10.5px] text-zinc-400 font-semibold whitespace-nowrap" title={`O preço do delivery (${brl(Number(item.delivery?.preco))}) é próprio e muda na janela do item, em Delivery.`}>
          delivery tem preço próprio
        </span>
      )}
      {promo && <span className="text-[10.5px] text-red-500 font-bold">promoção ativa</span>}
    </div>
  );
}

function Marcar({ marcado, onClick, rotulo }: { marcado: boolean; onClick: () => void; rotulo: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={marcado} aria-label={rotulo} title={rotulo}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-6 h-6 flex-shrink-0 rounded-md border-2 flex items-center justify-center cursor-pointer ${marcado ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-300 hover:border-zinc-500'}`}>
      {marcado && <i className="ri-check-line text-sm" />}
    </button>
  );
}

interface Barra { id: number; texto: string; desfazer?: () => Promise<void> }

export default function ItensTab({ entrada, onEntradaUsada, resumo = null, onResumoMudou, novoItemSinal = 0, ordenar = false, onPararOrdenar, onIrDestaques }: Props = {}) {
  const {
    itens, setItens, categorias, obsGlobais, estacoes, destaques, salvarItem, excluirItem, reordenarItens,
    definirCanalCategoria, atualizarItensEmLote, saving, itemNoHorario, itemPausado,
  } = useCardapio();
  const { hasPermissao } = usePermissoes();
  const podePreco = hasPermissao('cardapio_alterar_preco');

  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [categoria, setCategoria] = useState('');
  const [modalItem, setModalItem] = useState<Item | null | undefined>(undefined);
  const [abaModal, setAbaModal] = useState<'ficha' | undefined>(undefined);
  const [duplicando, setDuplicando] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [folhaCategoria, setFolhaCategoria] = useState(false);
  const [barra, setBarra] = useState<Barra | null>(null);
  const timerBarra = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const itensRef = useRef(itens);
  itensRef.current = itens;

  const mostrar = (texto: string, desfazer?: () => Promise<void>) => {
    const id = Date.now();
    setBarra({ id, texto, desfazer });
    clearTimeout(timerBarra.current);
    timerBarra.current = setTimeout(() => setBarra((b) => (b?.id === id ? null : b)), 8000);
  };
  useEffect(() => () => clearTimeout(timerBarra.current), []);

  // Chegou por link: abre o item (na ficha técnica, se pedido); sem achar o item, a lista vem com a busca preenchida.
  useEffect(() => {
    if (!entrada) return;
    const alvo = entrada.itemId ? itens.find(i => i.id === entrada.itemId) : undefined;
    if (alvo) {
      setAbaModal(entrada.ficha ? 'ficha' : undefined);
      setModalItem(alvo);
    } else if (entrada.busca) {
      setBusca(entrada.busca);
    }
    onEntradaUsada?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrada]);

  // Botão "Novo item" do cabeçalho
  const ultimoSinal = useRef(novoItemSinal);
  useEffect(() => {
    if (novoItemSinal === ultimoSinal.current) return;
    ultimoSinal.current = novoItemSinal;
    setAbaModal(undefined);
    setModalItem(null);
  }, [novoItemSinal]);

  // Sincroniza modalItem com o array itens atualizado quando o cardapio recarrega
  useEffect(() => {
    if (modalItem?.id) {
      const updated = itens.find(i => i.id === modalItem.id);
      if (updated) setModalItem(updated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, modalItem?.id]);

  // Itens que sumiram (excluídos, troca de loja) saem da marcação.
  useEffect(() => {
    setMarcados((m) => {
      if (!m.size) return m;
      const ids = new Set(itens.map((i) => i.id));
      const novo = new Set([...m].filter((id) => ids.has(id)));
      return novo.size === m.size ? m : novo;
    });
  }, [itens]);

  const categoriaMap = useMemo(() => Object.fromEntries(categorias.map(c => [c.id, c.nome])), [categorias]);
  const vendas = resumo?.vendas ?? null;
  const semFicha = (i: Item) => !!resumo && !resumo.comFicha.has(i.id);
  const foraAgora = (i: Item) => canaisDe(i).some((c) => !itemNoHorario(i, c));

  // Selos do horário: o do item e, se a categoria tiver horário, o dela também.
  const selosHorario = (item: Item) => {
    const canais = canaisDe(item);
    const visivel = { casa: itemNoHorario(item, 'casa'), delivery: itemNoHorario(item, 'delivery') };
    const cat = categorias.find(c => c.id === item.categoriaId);
    return (
      <>
        <SeloHorario horario={item.horario} canais={canais} visivelPorCanal={visivel} />
        {cat && temHorario(cat.horario) && (
          <SeloHorario horario={cat.horario} canais={canais} visivelPorCanal={visivel} texto={`Categoria: ${resumoHorario(cat.horario, canais)}`} />
        )}
      </>
    );
  };

  // ── Contagens ──
  const ativos = itens.filter((i) => i.status === 'ativo');
  const n = {
    semficha: resumo ? ativos.filter(semFicha).length : 0,
    pausados: itens.filter(itemPausado).length,
    fora: itens.filter((i) => i.status === 'ativo' && foraAgora(i)).length,
    inativos: itens.filter((i) => i.status === 'inativo').length,
    delivery: itens.filter((i) => disponibilidadeDe(i) !== 'casa').length,
  };

  // ── Lista mostrada ──
  const lista = useMemo(() => {
    const L = itens.filter((i) => {
      if (categoria && i.categoriaId !== categoria) return false;
      if (busca && !combinaBusca(busca, i.nome, i.descricao, categoriaMap[i.categoriaId])) return false;
      if (filtro === 'semficha') return i.status === 'ativo' && semFicha(i);
      if (filtro === 'pausados') return itemPausado(i);
      if (filtro === 'fora') return i.status === 'ativo' && foraAgora(i);
      if (filtro === 'inativos') return i.status === 'inativo';
      if (filtro === 'delivery') return disponibilidadeDe(i) !== 'casa';
      return true;
    });
    return ordenar ? [...L].sort((a, b) => a.ordem - b.ordem) : ordenarItens(L, vendas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, categoria, busca, filtro, ordenar, vendas, resumo, categoriaMap, itemPausado, itemNoHorario]);

  const podeMover = ordenar && !busca && filtro === 'todos';
  const pendencias = useMemo(() => pendenciasCardapio(itens, destaques, resumo), [itens, destaques, resumo]);

  // ── Ações de uma linha ──
  const abrirItem = (item: Item, ficha = false) => { setAbaModal(ficha ? 'ficha' : undefined); setModalItem(item); };

  const handleSave = async (saved: Item) => {
    // Servidor recusou (ex.: nome repetido): a janela fica aberta com o que foi digitado.
    if (!(await salvarItem(saved))) return;
    setModalItem(undefined);
    setAbaModal(undefined);
    onResumoMudou?.(); // a ficha pode ter mudado
  };

  const salvarDe = async (id: string, mudar: (i: Item) => Item): Promise<boolean> => {
    const atual = itensRef.current.find((i) => i.id === id);
    if (!atual) return false;
    const novo = mudar(atual);
    setItens(prev => prev.map(i => (i.id === id ? novo : i))); // otimista; salvarItem reconcilia
    return salvarItem(novo);
  };

  const toggleStatus = async (item: Item) => {
    const ligar = item.status !== 'ativo';
    const ok = await salvarDe(item.id, (i) => ({ ...i, status: ligar ? 'ativo' : 'inativo' }));
    if (ok) mostrar(fraseMudanca({ tipo: 'ativo', valor: ligar }, [item.nome]), async () => {
      await salvarDe(item.id, (i) => ({ ...i, status: ligar ? 'inativo' : 'ativo' }));
    });
  };

  const setDisponibilidade = async (item: Item, val: Disponibilidade) => {
    const antes = disponibilidadeDe(item);
    if (antes === val) return;
    const ok = await salvarDe(item.id, (i) => comDisponibilidade(i, val));
    if (ok) mostrar(fraseMudanca({ tipo: 'canal', valor: val }, [item.nome]), async () => {
      await salvarDe(item.id, (i) => comDisponibilidade(i, antes));
    });
  };

  const salvarPreco = async (item: Item, valor: number) => {
    const antes = item.preco;
    const ok = await salvarDe(item.id, (i) => ({ ...i, preco: valor }));
    if (ok) mostrar(`Preço de ${item.nome}: ${brl(antes)} → ${brl(valor)}`, async () => {
      await salvarDe(item.id, (i) => ({ ...i, preco: antes }));
    });
  };

  const acabouHoje = async (item: Item) => {
    const pausar = !itemPausado(item);
    const m: MudancaLote = { tipo: 'pausa', valor: pausar };
    const ok = await atualizarItensEmLote([item.id], m);
    if (ok) mostrar(fraseMudanca(m, [item.nome]), async () => {
      await atualizarItensEmLote([item.id], { tipo: 'pausa', valor: !pausar });
    });
  };

  const handleDelete = async (item: Item) => {
    const ok = await confirmar({
      titulo: `Excluir ${item.nome}?`,
      mensagem: 'Ele sai do cardápio em todas as telas (PDV, garçom, totem, QR e delivery) e não dá para desfazer por aqui. As vendas que já aconteceram continuam nos relatórios. Para tirar só por um tempo, use a chave Ativo ou "Acabou hoje".',
      confirmarLabel: 'Excluir', perigo: true,
    });
    if (!ok) return;
    await excluirItem(item.id);
  };

  const handleDuplicar = async (item: Item) => {
    setDuplicando(item.id);
    try {
      const copia: Item = {
        ...item,
        id: `new-${Date.now()}`,
        nome: `${item.nome} (cópia)`,
        status: 'inativo', // começa inativo para revisão
        pausadoAte: null,
        pausadoMotivo: null,
        gruposOpcoes: item.gruposOpcoes.map(g => ({
          ...g,
          id: `new-g-${Date.now()}-${Math.random()}`,
          opcoes: g.opcoes.map(o => ({ ...o, id: `new-o-${Date.now()}-${Math.random()}` })),
        })),
        promocoes: [],
      };
      const ok = await salvarItem(copia);
      if (ok) mostrar(`Cópia de ${item.nome} criada (começa inativa, para revisar)`);
    } finally {
      setDuplicando(null);
    }
  };

  // Ordem do cardápio (⋯ › Mudar a ordem): troca com o vizinho; com categoria escolhida, só dentro dela.
  const mover = async (idx: number, dir: -1 | 1) => {
    if (!podeMover) return;
    const alvo = lista[idx];
    if (!alvo) return;
    const base = [...(categoria ? itens.filter(i => i.categoriaId === categoria) : itens)].sort((a, b) => a.ordem - b.ordem);
    const k = base.findIndex(i => i.id === alvo.id);
    const j = k + dir;
    if (k < 0 || j < 0 || j >= base.length) return;
    [base[k], base[j]] = [base[j], base[k]];
    await reordenarItens(base.map((item, i) => ({ id: item.id, sortOrder: i })));
  };

  // ── Lote ──
  const idsMostrados = lista.map((i) => i.id);
  const todosMarcados = idsMostrados.length > 0 && idsMostrados.every((id) => marcados.has(id));
  const alternarMarcado = (id: string) => setMarcados((m) => { const s = new Set(m); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const marcarTodos = () => setMarcados((m) => {
    const s = new Set(m);
    if (todosMarcados) idsMostrados.forEach((id) => s.delete(id)); else idsMostrados.forEach((id) => s.add(id));
    return s;
  });

  const perguntaLote = (m: MudancaLote, qtd: number, nomeCat?: string): { titulo: string; mensagem: ReactNode; confirmarLabel: string; perigo?: boolean } => {
    const quem = qtd === 1 ? 'o item marcado' : `os ${qtd} itens marcados`;
    if (m.tipo === 'ativo') return { titulo: `Desativar ${quem}?`, mensagem: 'Eles saem do totem, do QR, do delivery e do PDV na hora. Dá para desfazer na barra de baixo.', confirmarLabel: 'Desativar', perigo: true };
    if (m.tipo === 'canal') return { titulo: `Mudar onde ${quem} ${qtd === 1 ? 'aparece' : 'aparecem'}?`, mensagem: `Passam a aparecer ${m.valor === 'casa' ? 'só no balcão (caixa, totem, mesa e garçom)' : m.valor === 'delivery' ? 'só no delivery' : 'no balcão e no delivery'}.`, confirmarLabel: 'Mudar' };
    return { titulo: `Mover ${quem} para ${nomeCat ?? 'outra categoria'}?`, mensagem: 'No cardápio do cliente eles passam a aparecer nessa categoria.', confirmarLabel: 'Mover' };
  };

  /** Aplica a mudança em `ids` (pergunta antes se for o caso) e mostra a barra com Desfazer. */
  const aplicarLote = async (ids: string[], m: MudancaLote, opts: { limpar?: boolean } = {}) => {
    const antes = itensRef.current.filter((i) => ids.includes(i.id));
    if (!antes.length) return;
    const nomeCat = m.tipo === 'categoria' ? categoriaMap[m.valor] : undefined;
    if (precisaConfirmar(m) && !(await confirmar(perguntaLote(m, antes.length, nomeCat)))) return;
    const ok = await atualizarItensEmLote(antes.map((i) => i.id), m);
    if (!ok) return;
    if (opts.limpar !== false) setMarcados(new Set());
    const grupos = gruposDesfazer(antes, m);
    mostrar(fraseMudanca(m, antes.map((i) => i.nome), nomeCat), grupos.length ? async () => {
      for (const g of grupos) await atualizarItensEmLote(g.ids, g.mudanca);
    } : undefined);
  };

  // Atalho da categoria escolhida: canal (caminho antigo set_category_channel), ativar/desativar todos.
  const itensDaCategoria = categoria ? itens.filter((i) => i.categoriaId === categoria) : [];
  const canalDaCategoria = useMemo<Disponibilidade | null>(() => {
    if (!itensDaCategoria.length) return null;
    const p = disponibilidadeDe(itensDaCategoria[0]);
    return itensDaCategoria.every((i) => disponibilidadeDe(i) === p) ? p : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, categoria]);
  const canalNaCategoria = async (val: Disponibilidade) => {
    if (!categoria) return;
    const nome = categoriaMap[categoria] ?? 'categoria';
    const antes = itensDaCategoria;
    const ok = await confirmar({
      titulo: `Mudar os ${antes.length} itens de ${nome}?`,
      mensagem: `Todos passam a aparecer ${val === 'casa' ? 'só no balcão (caixa, totem, mesa e garçom)' : val === 'delivery' ? 'só no delivery' : 'no balcão e no delivery'}.`,
      confirmarLabel: 'Aplicar',
    });
    if (!ok) return;
    await definirCanalCategoria(categoria, val);
    const grupos = gruposDesfazer(antes, { tipo: 'canal', valor: val });
    mostrar(`${nome}: ${NOME_DISPONIBILIDADE[val].toLowerCase()} em todos os itens`, grupos.length ? async () => {
      for (const g of grupos) await atualizarItensEmLote(g.ids, g.mudanca);
    } : undefined);
  };

  // ── Textos ──
  const subLinha = (item: Item) => {
    const partes = [categoriaMap[item.categoriaId] ?? 'Sem categoria'];
    const q = vendas?.get(item.id);
    if (q) partes.push(`vendeu ${q.toLocaleString('pt-BR')} em 14 dias`);
    return partes.join(' · ');
  };
  const etiquetas = (item: Item) => (
    <>
      {itemPausado(item) && <Etiqueta tom="amber">{rotuloPausa(item.pausadoAte)}</Etiqueta>}
      {item.status === 'inativo' && <Etiqueta>Inativo</Etiqueta>}
      {semFicha(item) && item.status === 'ativo' && <Etiqueta tom="amber">sem ficha</Etiqueta>}
      {selosHorario(item)}
    </>
  );
  const botaoAcabou = (item: Item, cheio = false) => {
    const pz = itemPausado(item);
    return (
      <button type="button" disabled={saving}
        onClick={(e) => { e.stopPropagation(); acabouHoje(item); }}
        title={pz ? `${rotuloPausa(item.pausadoAte)}. Toque para voltar a vender agora.` : 'Some de todas as telas de venda até a loja abrir amanhã, e volta sozinho'}
        className={`${btn(pz ? 'p' : 'out', 'sm')} ${cheio ? 'w-full !min-h-[42px]' : ''}`}>
        {pz ? <><i className="ri-play-circle-line" />Voltar agora</> : <><i className="ri-pause-circle-line" />{cheio ? 'Acabou hoje' : 'Acabou'}</>}
      </button>
    );
  };
  const menuLinha = (item: Item) => (
    <MenuMais rotulo="Editar, duplicar, excluir" itens={[
      { rotulo: 'Editar o item', icone: 'ri-pencil-line', onClick: () => abrirItem(item) },
      { rotulo: duplicando === item.id ? 'Duplicando…' : 'Duplicar', icone: 'ri-file-copy-line', onClick: () => handleDuplicar(item) },
      { rotulo: 'Excluir', icone: 'ri-delete-bin-line', perigo: true, onClick: () => handleDelete(item) },
    ]} />
  );
  const setas = (idx: number) => (
    <div className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => mover(idx, -1)} disabled={!podeMover || idx === 0 || saving} title="Subir"
        className="w-7 h-6 flex items-center justify-center rounded hover:bg-zinc-100 disabled:opacity-30 cursor-pointer text-zinc-500"><i className="ri-arrow-up-s-line" /></button>
      <span className="text-[10px] font-bold text-zinc-300">{idx + 1}</span>
      <button type="button" onClick={() => mover(idx, 1)} disabled={!podeMover || idx === lista.length - 1 || saving} title="Descer"
        className="w-7 h-6 flex items-center justify-center rounded hover:bg-zinc-100 disabled:opacity-30 cursor-pointer text-zinc-500"><i className="ri-arrow-down-s-line" /></button>
    </div>
  );

  const vazio = (() => {
    if (filtro === 'inativos') return ['Nenhum item inativo', 'Desligue um item pela chave da lista: ele some do totem, do QR, do delivery e do PDV na hora.'];
    if (filtro === 'pausados') return ['Nenhum item pausado', 'Quando algo acabar, toque em "Acabou" na linha: o item some até a loja abrir amanhã e volta sozinho.'];
    if (filtro === 'semficha') return ['Todos os itens à venda têm ficha', 'Nada a fazer aqui.'];
    if (busca) return ['Nenhum item com esse nome', 'Tente outra palavra ou só um pedaço do nome.'];
    return ['Nenhum item aqui', 'Nada bate com esse filtro agora.'];
  })();

  const nMarcados = marcados.size;
  const nomeCatFiltro = categoria ? categoriaMap[categoria] : '';
  const tituloLista = ordenar ? 'na ordem do cardápio' : filtro === 'todos' && !categoria && !busca ? (vendas ? 'mais vendidos primeiro' : 'na ordem do cardápio') : 'filtrados';

  return (
    <div className="space-y-4">
      {/* Manchete */}
      <div>
        <p className="text-lg md:text-xl font-extrabold text-zinc-900 leading-snug">
          {ativos.length.toLocaleString('pt-BR')} {ativos.length === 1 ? 'item à venda' : 'itens à venda'}
          {resumo && n.semficha > 0 && <span className="text-amber-600"> · {n.semficha} sem ficha</span>}
        </p>
        <p className="text-[13px] text-zinc-500 mt-0.5">
          {pendencias.length ? <b className="text-zinc-700">{pendencias.length} {pendencias.length > 1 ? 'coisas precisam' : 'coisa precisa'} de você.</b> : 'Tudo em ordem.'}
          {n.pausados > 0 && ` ${n.pausados} ${n.pausados > 1 ? 'itens pausados' : 'item pausado'} até amanhã.`}
          {n.inativos > 0 && ` ${n.inativos} ${n.inativos > 1 ? 'inativos' : 'inativo'}.`}
        </p>
      </div>

      {/* Precisa de você */}
      {pendencias.length > 0 && (
        <div>
          <SecaoTitulo titulo="Precisa de você" n={pendencias.length} />
          <div className="grid gap-2 md:grid-cols-2">
            {pendencias.map((p, k) => {
              if (p.tipo === 'ficha') {
                return (
                  <CartaoAcao key={k} tom="alerta" icone="ri-file-warning-line"
                    titulo={`${p.item.nome} é o ${p.posicao === 1 ? 'que mais vende' : `${p.posicao}º que mais vende`} (${p.vendidos.toLocaleString('pt-BR')} em 14 dias) e está sem ficha técnica`}
                    acoes={<>
                      <button className={btn('p', 'sm')} onClick={() => abrirItem(p.item, true)}>Fazer a ficha</button>
                      {p.outros > 0 && <button className={btn('out', 'sm')} onClick={() => { setFiltro('semficha'); setCategoria(''); setBusca(''); }}>Ver os sem ficha</button>}
                    </>}>
                    Sem a ficha, o estoque não baixa quando ele vende.
                    {p.outros > 0 && ` Mais ${p.outros} entre os ${10} mais vendidos ${p.outros > 1 ? 'estão' : 'está'} sem ficha.`}
                  </CartaoAcao>
                );
              }
              if (p.tipo === 'destaque_zero') {
                return (
                  <CartaoAcao key={k} tom="alerta" icone="ri-star-line"
                    titulo={`O destaque mostra ${p.destaque.itemNome} por R$ 0,00`}
                    acoes={<button className={btn('p', 'sm')} onClick={() => onIrDestaques?.()}>Corrigir</button>}>
                    É o preço que o cliente vê no destaque; o item está a {brl(p.precoItem)}.
                  </CartaoAcao>
                );
              }
              const um = p.destaques.length === 1 ? p.destaques[0] : null;
              return (
                <CartaoAcao key={k} tom="prop" icone="ri-star-line"
                  titulo={um ? `O destaque mostra ${um.destaque.itemNome} por ${brl(Number(um.destaque.customPrice))}` : `${p.destaques.length} destaques com preço diferente do item`}
                  acoes={<button className={btn('p', 'sm')} onClick={() => onIrDestaques?.()}>Corrigir</button>}>
                  {um ? `O item está a ${brl(um.precoItem)}. Se não for de propósito, deixe o destaque com o preço do item.`
                    : p.destaques.map((d) => `${d.destaque.itemNome}: ${brl(Number(d.destaque.customPrice))} (item ${brl(d.precoItem)})`).join(' · ')}
                </CartaoAcao>
              );
            })}
          </div>
        </div>
      )}

      {/* Os itens */}
      <div>
        <SecaoTitulo titulo="Os itens" sub={tituloLista} />
        {ordenar && (
          <div className="mb-2 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[12.5px] text-amber-900">
            <i className="ri-arrow-up-down-line" />
            <span className="flex-1">{podeMover ? 'Use as setas para mudar a ordem no totem, no QR e no delivery.' : 'Para mudar a ordem, limpe a busca e o filtro (a categoria pode ficar).'}</span>
            <button className={btn('out', 'sm')} onClick={() => onPararOrdenar?.()}>Pronto</button>
          </div>
        )}
        <div className="flex items-center gap-2 border border-zinc-200 rounded-xl px-3 bg-white h-[42px]">
          <i className="ri-search-line text-zinc-400" />
          <input className="flex-1 text-sm focus:outline-none bg-transparent" placeholder="Buscar item… (pode ser um pedaço do nome)"
            value={busca} onChange={(e) => setBusca(e.target.value)} />
          {busca && <button onClick={() => setBusca('')} className="text-zinc-400 hover:text-zinc-600 cursor-pointer" aria-label="Limpar busca"><i className="ri-close-line" /></button>}
        </div>
        <div className="flex gap-2 mt-2 items-center flex-wrap md:flex-nowrap">
          <Chips<Filtro> className="flex-1 min-w-0" valor={filtro} onChange={setFiltro} opcoes={[
            { id: 'todos', rotulo: 'Todos' },
            ...(resumo ? [{ id: 'semficha' as Filtro, rotulo: 'Sem ficha', n: n.semficha, tom: n.semficha ? 'amber' as const : undefined }] : []),
            { id: 'pausados', rotulo: 'Pausados', n: n.pausados },
            { id: 'fora', rotulo: 'Fora do horário agora', n: n.fora },
            { id: 'inativos', rotulo: 'Inativos', n: n.inativos },
            { id: 'delivery', rotulo: 'No delivery', n: n.delivery },
          ]} />
          <label className={`flex-none inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-full border text-[12.5px] font-bold cursor-pointer ${categoria ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700'}`}>
            <i className="ri-layout-grid-line" />
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria"
              className={`bg-transparent focus:outline-none cursor-pointer pr-1 max-w-[180px] ${categoria ? 'text-white' : ''}`}>
              <option value="" className="text-zinc-900">Categoria</option>
              {categorias.map((c) => <option key={c.id} value={c.id} className="text-zinc-900">{c.nome}{c.ativo ? '' : ' (desligada)'}</option>)}
            </select>
          </label>
        </div>

        {/* Atalho da categoria escolhida */}
        {categoria && (
          <div className="mt-2 flex flex-wrap gap-1.5 items-center bg-white border border-zinc-200 rounded-2xl px-3 py-2">
            <span className="text-[12.5px] text-zinc-600 flex-1 min-w-[200px]"><i className="ri-stack-line text-amber-600 mr-1" />Aplicar a todos os {itensDaCategoria.length} itens de <b className="text-zinc-900">{nomeCatFiltro}</b>:</span>
            {(['casa', 'ambos', 'delivery'] as Disponibilidade[]).map((k) => (
              <button key={k} disabled={saving} title={DICA_DISPONIBILIDADE[k]} onClick={() => canalNaCategoria(k)}
                className={`h-8 px-3 rounded-full border text-[12px] font-bold cursor-pointer disabled:opacity-50 ${canalDaCategoria === k ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'}`}>
                {NOME_DISPONIBILIDADE[k]}
              </button>
            ))}
            <button disabled={saving} onClick={() => aplicarLote(itensDaCategoria.map((i) => i.id), { tipo: 'ativo', valor: true }, { limpar: false })}
              className="h-8 px-3 rounded-full border border-zinc-200 bg-white text-[12px] font-bold text-zinc-700 cursor-pointer disabled:opacity-50">Ativar todos</button>
            <button disabled={saving} onClick={() => aplicarLote(itensDaCategoria.map((i) => i.id), { tipo: 'ativo', valor: false }, { limpar: false })}
              className="h-8 px-3 rounded-full border border-red-200 bg-white text-[12px] font-bold text-red-600 cursor-pointer disabled:opacity-50">Desativar todos</button>
          </div>
        )}

        {lista.length === 0 ? (
          <div className="mt-3"><Vazio icone="ri-search-line" titulo={vazio[0]}>{vazio[1]}</Vazio></div>
        ) : (
          <>
            {/* Computador: tabela */}
            <div className="hidden md:block mt-3 bg-white border border-zinc-200 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b border-zinc-100 text-[11px] font-bold text-zinc-400 uppercase tracking-wide">
                  <tr>
                    <th className="pl-4 pr-1 py-2.5 w-10"><Marcar marcado={todosMarcados} onClick={marcarTodos} rotulo={todosMarcados ? 'Desmarcar os mostrados' : 'Marcar todos os mostrados'} /></th>
                    <th className="px-2 py-2.5 text-left">Ativo</th>
                    {ordenar && <th className="px-2 py-2.5 text-center">Ordem</th>}
                    <th className="px-2 py-2.5 text-left">Item</th>
                    <th className="px-2 py-2.5 text-right">Preço</th>
                    <th className="px-2 py-2.5 text-left" title="Balcão = caixa, totem, mesa e garçom">Onde aparece</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {lista.map((item, idx) => {
                    const pz = itemPausado(item);
                    return (
                      <tr key={item.id} onClick={() => abrirItem(item)}
                        className={`cursor-pointer transition-colors ${marcados.has(item.id) ? 'bg-amber-50/60' : pz ? 'bg-amber-50/30 hover:bg-amber-50/60' : 'hover:bg-zinc-50'} ${item.status === 'inativo' ? 'text-zinc-400' : ''}`}>
                        <td className="pl-4 pr-1 py-2.5"><Marcar marcado={marcados.has(item.id)} onClick={() => alternarMarcado(item.id)} rotulo={`Marcar ${item.nome}`} /></td>
                        <td className="px-2 py-2.5"><Chave ligada={item.status === 'ativo'} disabled={saving} onClick={() => toggleStatus(item)} rotulo={item.status === 'ativo' ? `Desativar ${item.nome}` : `Ativar ${item.nome}`} /></td>
                        {ordenar && <td className="px-2 py-1">{setas(idx)}</td>}
                        <td className="px-2 py-2.5 w-full max-w-0">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-zinc-100 ${item.status === 'inativo' || pz ? 'opacity-50 grayscale' : ''}`}>
                              <ItemImage src={item.fotoUrl} alt={item.nome} className="w-full h-full" />
                            </div>
                            <div className="min-w-0">
                              <p className={`font-bold truncate ${item.status === 'inativo' ? 'text-zinc-400' : 'text-zinc-900'}`}>{item.nome}</p>
                              <p className="text-[11.5px] text-zinc-400 truncate">{subLinha(item)}</p>
                              <div className="flex items-center gap-1 flex-wrap mt-0.5">{etiquetas(item)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-right"><PrecoNaLinha item={item} pode={podePreco} onSalvar={(v) => salvarPreco(item, v)} /></td>
                        <td className="px-2 py-2.5"><SeletorCanal item={item} disabled={saving} onChange={(v) => setDisponibilidade(item, v)} /></td>
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">{botaoAcabou(item)}{menuLinha(item)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Celular: cartões */}
            <div className="md:hidden mt-3 space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Marcar marcado={todosMarcados} onClick={marcarTodos} rotulo={todosMarcados ? 'Desmarcar os mostrados' : 'Marcar todos os mostrados'} />
                <span className="text-[12px] text-zinc-500 font-semibold">{todosMarcados ? 'Desmarcar' : 'Marcar'} os {lista.length} mostrados</span>
              </div>
              {lista.map((item, idx) => {
                const pz = itemPausado(item);
                return (
                  <div key={item.id} onClick={() => abrirItem(item)}
                    className={`bg-white border rounded-2xl p-3 cursor-pointer ${marcados.has(item.id) ? 'border-amber-400 bg-amber-50/40' : pz ? 'border-amber-200' : 'border-zinc-200'}`}>
                    <div className="flex items-start gap-2.5">
                      <div className="pt-1"><Marcar marcado={marcados.has(item.id)} onClick={() => alternarMarcado(item.id)} rotulo={`Marcar ${item.nome}`} /></div>
                      {ordenar && setas(idx)}
                      <div className={`w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-zinc-100 ${item.status === 'inativo' || pz ? 'opacity-50 grayscale' : ''}`}>
                        <ItemImage src={item.fotoUrl} alt={item.nome} className="w-full h-full" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-[14.5px] leading-snug ${item.status === 'inativo' ? 'text-zinc-400' : 'text-zinc-900'}`}>{item.nome}</p>
                        <p className="text-[11.5px] text-zinc-400">{subLinha(item)}</p>
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">{etiquetas(item)}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {menuLinha(item)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <PrecoNaLinha item={item} pode={podePreco} onSalvar={(v) => salvarPreco(item, v)} />
                    </div>
                    {pz && <div className="mt-2 text-[12px] bg-amber-50 text-amber-900 rounded-xl px-3 py-2"><b>{rotuloPausa(item.pausadoAte)}</b> · volta sozinho quando a loja abrir.</div>}
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>{botaoAcabou(item, true)}</div>
                    <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <label className="flex items-center gap-2 text-[12.5px] font-bold text-zinc-600 flex-shrink-0">
                        <Chave ligada={item.status === 'ativo'} disabled={saving} onClick={() => toggleStatus(item)} rotulo={item.status === 'ativo' ? `Desativar ${item.nome}` : `Ativar ${item.nome}`} />
                        {item.status === 'ativo' ? 'Ativo' : 'Inativo'}
                      </label>
                      <div className="flex-1 min-w-0"><SeletorCanal largo item={item} disabled={saving} onChange={(v) => setDisponibilidade(item, v)} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <Nota className="mt-3">
          "Acabou hoje" tira o item de todas as telas de venda (caixa, garçom, totem, mesa, QR e delivery) até a loja abrir amanhã e volta sozinho.
          A chave liga e desliga o item; Balcão · Os dois · Delivery muda onde ele aparece (balcão = caixa, totem, mesa e garçom). Tudo salva na hora,
          as telas abertas atualizam sozinhas e a barra de baixo tem Desfazer.{vendas ? ' A ordem é a dos mais vendidos nos últimos 14 dias; a ordem do cardápio do cliente muda no ⋯ › Mudar a ordem dos itens.' : ''}
        </Nota>
      </div>

      {/* Barras de baixo: o que aconteceu (Desfazer) e a dos marcados */}
      {(barra || nMarcados > 0) && (
        <div className="fixed bottom-3 left-0 right-0 z-40 px-3 pointer-events-none flex flex-col items-center gap-2">
          {barra && (
            <div className="pointer-events-auto max-w-[640px] w-full bg-zinc-900 text-white rounded-2xl pl-4 pr-2 py-2 flex items-center gap-2 shadow-2xl">
              <i className="ri-check-line text-emerald-400 text-lg" />
              <span className="flex-1 text-[13px] font-bold leading-snug">{barra.texto}</span>
              {barra.desfazer && (
                <button className="text-amber-400 font-extrabold text-[13px] px-2 min-h-[36px] cursor-pointer disabled:opacity-50" disabled={saving}
                  onClick={async () => { const f = barra.desfazer; setBarra(null); if (f) { await f(); mostrar('Desfeito'); } }}>Desfazer</button>
              )}
              <button className="text-zinc-400 px-1 cursor-pointer" aria-label="Fechar" onClick={() => setBarra(null)}><i className="ri-close-line" /></button>
            </div>
          )}
          {nMarcados > 0 && (
            <div className="pointer-events-auto max-w-[980px] w-full bg-white border border-zinc-200 rounded-2xl shadow-2xl px-3 py-2 flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
              <span className="text-[13px] font-extrabold text-zinc-900 whitespace-nowrap pr-1">{nMarcados} {nMarcados > 1 ? 'marcados' : 'marcado'}</span>
              <button className={btn('out', 'sm')} disabled={saving} onClick={() => aplicarLote([...marcados], { tipo: 'ativo', valor: true })}>Ativar</button>
              <button className={btn('perigo', 'sm')} disabled={saving} onClick={() => aplicarLote([...marcados], { tipo: 'ativo', valor: false })}>Desativar</button>
              <span className="w-px h-6 bg-zinc-200 flex-shrink-0" />
              {(['casa', 'ambos', 'delivery'] as Disponibilidade[]).map((k) => (
                <button key={k} className={btn('out', 'sm')} disabled={saving} title={DICA_DISPONIBILIDADE[k]} onClick={() => aplicarLote([...marcados], { tipo: 'canal', valor: k })}>{NOME_DISPONIBILIDADE[k]}</button>
              ))}
              <span className="w-px h-6 bg-zinc-200 flex-shrink-0" />
              <button className={btn('out', 'sm')} disabled={saving} onClick={() => aplicarLote([...marcados], { tipo: 'pausa', valor: true })}><i className="ri-pause-circle-line" />Acabou hoje</button>
              <button className={btn('out', 'sm')} disabled={saving} onClick={() => setFolhaCategoria(true)}>Mudar categoria</button>
              <button className={btn('ghost', 'sm')} onClick={() => setMarcados(new Set())}>Limpar</button>
            </div>
          )}
        </div>
      )}

      <Folha aberta={folhaCategoria} titulo="Mudar categoria" subtitulo={`${nMarcados} ${nMarcados > 1 ? 'itens marcados vão' : 'item marcado vai'} para a categoria escolhida`} onFechar={() => setFolhaCategoria(false)}>
        <div className="flex flex-wrap gap-1.5">
          {categorias.map((c) => (
            <button key={c.id} className={btn('out', 'sm')} disabled={saving}
              onClick={async () => { setFolhaCategoria(false); await aplicarLote([...marcados], { tipo: 'categoria', valor: c.id }); }}>
              {c.nome}{c.ativo ? '' : ' (desligada)'}
            </button>
          ))}
        </div>
      </Folha>

      {modalItem !== undefined && (
        <ItemModal
          key={modalItem?.id ?? 'new-item'}
          item={modalItem ?? undefined}
          categorias={categorias}
          obsGlobais={obsGlobais}
          estacoes={estacoes}
          saving={saving}
          onSave={handleSave}
          onClose={() => { setModalItem(undefined); setAbaModal(undefined); onResumoMudou?.(); }}
          abaInicial={abaModal}
        />
      )}
    </div>
  );
}
