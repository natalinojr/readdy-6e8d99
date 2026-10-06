import { useOptionGroupTemplates, type OptionGroupTemplate } from '@/hooks/useOptionGroupTemplates';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import type {
  Item, GrupoOpcoes, OpcaoItem, PromocaoItem, FichaTecnicaItem, SubproducaoItem, ConfiguracaoDelivery,
  Categoria, ObservacaoGlobal,
} from '@/types/cardapio';
const mockDiasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
import type { EstacaoCozinha } from '../../../contexts/CardapioContext';
import FichaDoItem, { type FichaDoItemHandle } from './item/FichaDoItem';
import FichaRetroativaModal from './FichaRetroativaModal';
import { custoLinhaFicha } from '@/lib/unitConversion';
import { insumosDaOpcao, comInsumos } from '@/lib/opcaoInsumos';
import DeliveryTab from './DeliveryTab';
import FiscalFields from '@/components/feature/FiscalFields';
import type { ItemFiscal } from '@/lib/fiscal';
import HorarioExibicaoEditor from '@/components/feature/HorarioExibicaoEditor';
import { erroHorario, resumoHorario, temHorario, type HorarioExibicao } from '@/lib/horarioExibicao';
import ItemImage from '@/components/base/ItemImage';
import { uploadMenuImage, supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useProducao } from '@/contexts/ProducaoContext';
import { useCardapio } from '@/contexts/CardapioContext';
import type { Insumo } from '@/contexts/EstoqueContext';
import type { ProductionRecipe } from '@/types/estoque';
import { btn, confirmar, brl } from '@/components/kit';
import { ABAS_ITEM, abaNova, itemComMesmoNome, validarItem, type AbaItem, type ErroItem, type TabLocal } from './item/itemAbas';

export type { TabLocal } from './item/itemAbas';

// Busca sem diferenciar maiúscula/minúscula nem acento ("pao" acha "PÃO").
const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

// ── Unidades suportadas ────────────────────────────────────────────────────
const ALL_UNITS = ['g', 'kg', 'ml', 'l', 'un'];
// Complemento ligado ao estoque (dono, 2026-09-25): insumo em kg/L começa em g/mL e SEM quantidade —
// o '1' pronto virava 1 kg de bacon por adicional. A quantidade é obrigatória para salvar.
const unidadeConsumoInicial = (u: string | null | undefined) => {
  const k = String(u ?? '').toLowerCase();
  if (k === 'kg') return 'g';
  if (k === 'l') return 'ml';
  if (k === 'unit') return 'un';
  return k || 'un';
};

interface Props {
  item?: Item;
  categorias: Categoria[];
  obsGlobais: ObservacaoGlobal[];
  estacoes: EstacaoCozinha[];
  saving?: boolean;
  onSave: (item: Item) => void;
  onClose: () => void;
  /** Abre já nesta aba (ex.: link "Fazer ficha" do Estoque › CMV abre na Ficha Técnica → "Como é feito").
   *  Aceita os nomes antigos (info, producao, ficha, fiscal, delivery) e os novos. */
  abaInicial?: TabLocal;
}

const novosGrupo = (): GrupoOpcoes => ({
  id: `grp-${Date.now()}`,
  nome: '',
  obrigatorio: false,
  minSelecao: 0,
  maxSelecao: 1,
  ordem: 1,
  opcoes: [],
});

const novaOpcao = (): OpcaoItem => ({
  id: `opc-${Date.now()}`,
  nome: '',
  precoAdicional: 0,
  ativo: true,
  descricao: '',
});

const novaPromocao = (): PromocaoItem => ({
  id: `promo-${Date.now()}`,
  precoPromocional: 0,
  tipo: 'semanal',
  diasSemana: [],
  ativo: true,
});

const novaSubProducao = (estacaoNome = 'Grelha', estacaoId = ''): SubproducaoItem => ({
  id: `sp-${Date.now()}`,
  nome: '',
  estacao: estacaoNome,
  estacaoId: estacaoId || undefined,
  slaMinutos: 10,
});

// ── Peças visuais da janela (kit: âmbar com texto escuro, creme #FAF7F2, toque ≥ 44px) ──
const CAMPO = 'w-full min-h-[44px] border border-zinc-200 rounded-xl px-3 py-2.5 text-sm bg-white text-zinc-800 focus:outline-none focus:border-amber-400 transition-colors';
const ROTULO = 'block text-xs font-semibold text-zinc-600 mb-1.5';

function Chave({ ligado, onClick, cor = 'amber', rotulo }: { ligado: boolean; onClick: () => void; cor?: 'amber' | 'teal'; rotulo: string }) {
  const on = cor === 'teal' ? 'bg-teal-500' : 'bg-amber-500';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      onClick={onClick}
      className="flex-shrink-0 w-14 h-11 flex items-center justify-center cursor-pointer"
    >
      <span className={`relative w-11 h-6 rounded-full transition-colors ${ligado ? on : 'bg-zinc-300'}`}>
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${ligado ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  );
}

function Titulo({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <h4 className="flex items-center justify-between gap-2 text-[13px] font-extrabold text-zinc-900 mt-1 mb-2">
      <span className="flex items-center gap-2">{children}</span>
      {extra}
    </h4>
  );
}

function Cartao({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white border border-zinc-200 rounded-2xl p-4 ${className}`}>{children}</div>;
}

/** Seção que abre e fecha (Avançado). Fechada mostra só o resumo. */
function Sanfona({ titulo, resumo, aberta, onToggle, children }: { titulo: string; resumo: string; aberta: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl">
      <button type="button" onClick={onToggle} aria-expanded={aberta} className="w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left cursor-pointer">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-zinc-900">{titulo}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{resumo}</p>
        </div>
        <i className={`ri-arrow-down-s-line text-xl text-zinc-400 transition-transform ${aberta ? 'rotate-180' : ''}`} />
      </button>
      {aberta && <div className="px-4 pb-4 pt-1 border-t border-zinc-100">{children}</div>}
    </div>
  );
}

export default function ItemModal({ item, categorias, obsGlobais, estacoes, saving, onSave, onClose, abaInicial }: Props) {
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  const podeAlterarPreco = hasPermissao('cardapio_alterar_preco');
  const { insumos } = useEstoque();
  const { recipes, getBatchesByRecipeId } = useProducao();
  const { itens: itensCardapio } = useCardapio();
  const [tab, setTab] = useState<AbaItem>(abaNova(abaInicial));
  const [nome, setNome] = useState(item?.nome ?? '');
  const [descricao, setDescricao] = useState(item?.descricao ?? '');
  const [preco, setPreco] = useState(String(item?.preco ?? ''));
  const [categoriaId, setCategoriaId] = useState(item?.categoriaId ?? categorias[0]?.id ?? '');
  const [sla, setSla] = useState(String(item?.slaMinutos ?? '10'));
  const [fotoUrl, setFotoUrl] = useState(item?.fotoUrl ?? '');
  const [status, setStatus] = useState<'ativo' | 'inativo'>(item?.status ?? 'ativo');
  const [semPreparo, setSemPreparo] = useState(item?.semPreparo ?? false);
  const [somenteDelivery, setSomenteDelivery] = useState(item?.somenteDelivery ?? false);
  const [grupos, setGrupos] = useState<GrupoOpcoes[]>(item?.gruposOpcoes ?? []);
  const [promocoes, setPromocoes] = useState<PromocaoItem[]>(item?.promocoes ?? []);
  const [obs, setObs] = useState<string[]>(item?.observacoesPadrao ?? []);
  const [novaObs, setNovaObs] = useState('');
  const [fichas, setFichas] = useState<FichaTecnicaItem[]>(item?.fichaTecnica ?? []);
  const [fichasCount, setFichasCount] = useState(item?.fichaTecnica?.length ?? 0);
  const [subproducao, setSubproducao] = useState<SubproducaoItem[]>(item?.subproducao ?? []);
  const primeiraEstacao = estacoes[0];
  const [producaoDividida, setProducaoDividida] = useState((item?.subproducao?.length ?? 0) > 0);
  const [deliveryConfig, setDeliveryConfig] = useState<ConfiguracaoDelivery | undefined>(item?.delivery);
  const [fiscal, setFiscal] = useState<ItemFiscal>(item?.fiscal ?? {});
  const [horario, setHorario] = useState<HorarioExibicao>(item?.horario ?? null);
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Ficha técnica: componente sempre montado (rascunho não some ao trocar de aba); grava pelo Salvar único.
  const fichaRef = useRef<FichaDoItemHandle>(null);
  const [fichaSuja, setFichaSuja] = useState(false);
  const [salvandoFicha, setSalvandoFicha] = useState(false);
  // Depois de gravar a ficha: pergunta desde quando ela vale para as vendas já feitas, e só então salva o item
  // (salvar o item fecha a janela).
  const [perguntarVendas, setPerguntarVendas] = useState(false);
  const itemPendente = useRef<Item | null>(null);
  const [erro, setErro] = useState<ErroItem | null>(null);
  const [abrirFiscal, setAbrirFiscal] = useState(abaInicial === 'fiscal');
  const [abrirDelivery, setAbrirDelivery] = useState(abaInicial === 'delivery');
  const abasRef = useRef<Partial<Record<AbaItem, HTMLButtonElement | null>>>({});
  const corpoRef = useRef<HTMLDivElement>(null);

  // Sincroniza todos os estados quando o item prop muda (abre/fecha modal)
  // Usa JSON.stringify para detectar mudanças de conteúdo, não apenas de referência
  useEffect(() => {
    console.log('[ItemModal] Syncing item:', item?.id, 'subproducao:', item?.subproducao);
    setNome(item?.nome ?? '');
    setDescricao(item?.descricao ?? '');
    setPreco(String(item?.preco ?? ''));
    setCategoriaId(item?.categoriaId ?? categorias[0]?.id ?? '');
    setSla(String(item?.slaMinutos ?? '10'));
    setFotoUrl(item?.fotoUrl ?? '');
    setStatus(item?.status ?? 'ativo');
    setSemPreparo(item?.semPreparo ?? false);
    setSomenteDelivery(item?.somenteDelivery ?? false);
    setGrupos(item?.gruposOpcoes ?? []);
    setPromocoes(item?.promocoes ?? []);
    setObs(item?.observacoesPadrao ?? []);
    setFichas(item?.fichaTecnica ?? []);
    setFichasCount(item?.fichaTecnica?.length ?? 0);
    setSubproducao(item?.subproducao ?? []);
    setProducaoDividida((item?.subproducao?.length ?? 0) > 0);
    setDeliveryConfig(item?.delivery);
    setFiscal(item?.fiscal ?? {});
    setHorario(item?.horario ?? null);
    setTab('basico');
    setNovaObs('');
    setUploadError(null);
    setErro(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item ? JSON.stringify({ id: item.id, subproducao: item.subproducao, nome: item.nome, descricao: item.descricao, preco: item.preco, categoriaId: item.categoriaId, slaMinutos: item.slaMinutos, fotoUrl: item.fotoUrl, status: item.status, semPreparo: item.semPreparo, somenteDelivery: item.somenteDelivery, gruposOpcoes: item.gruposOpcoes, promocoes: item.promocoes, observacoesPadrao: item.observacoesPadrao, fichaTecnica: item.fichaTecnica, delivery: item.delivery, fiscal: item.fiscal, horario: item.horario }) : 'undefined', categorias[0]?.id]); // só o id da 1ª categoria (item novo): recarregar o cardápio cria arrays novos e zerava o rascunho

  // Abre na aba pedida: roda DEPOIS do efeito acima (que sempre volta para 'basico') e só ao abrir o modal.
  useEffect(() => { if (abaInicial) setTab(abaNova(abaInicial)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Celular: a aba ativa fica centralizada na faixa rolável; o conteúdo volta para o topo.
  useEffect(() => {
    abasRef.current[tab]?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    if (corpoRef.current) corpoRef.current.scrollTop = 0;
  }, [tab]);

  const slaCalculado = producaoDividida && subproducao.length > 0
    ? subproducao.reduce((acc, s) => acc + (s.slaMinutos || 0), 0)
    : null;

  useEffect(() => {
    if (slaCalculado !== null) setSla(String(slaCalculado));
  }, [slaCalculado]);

  const handleFotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.tenantId) return;
    setUploadingFoto(true);
    setUploadError(null);
    const { url, error } = await uploadMenuImage(file, user.tenantId, item?.id);
    setUploadingFoto(false);
    if (error || !url) {
      setUploadError(error?.message ?? 'Erro ao fazer upload da imagem');
      return;
    }
    setFotoUrl(url);
    // Reset input so same file can be re-selected if needed
    if (fotoInputRef.current) fotoInputRef.current.value = '';
  };

  const addGrupo = () => setGrupos(g => [...g, novosGrupo()]);
  const addGrupoCompleto = (grupo: GrupoOpcoes) => setGrupos(g => [...g, grupo]);
  const removeGrupo = (id: string) => setGrupos(g => g.filter(x => x.id !== id));
  const updateGrupo = (id: string, patch: Partial<GrupoOpcoes>) =>
    setGrupos(g => g.map(x => x.id === id ? { ...x, ...patch } : x));
  const addOpcao = (grupoId: string) =>
    setGrupos(g => g.map(x => x.id === grupoId ? { ...x, opcoes: [...x.opcoes, novaOpcao()] } : x));
  const removeOpcao = (grupoId: string, opcId: string) =>
    setGrupos(g => g.map(x => x.id === grupoId ? { ...x, opcoes: x.opcoes.filter(o => o.id !== opcId) } : x));
  const updateOpcao = (grupoId: string, opcId: string, patch: Partial<OpcaoItem>) =>
    setGrupos(g => g.map(x => x.id === grupoId ? {
      ...x,
      opcoes: x.opcoes.map(o => o.id === opcId ? { ...o, ...patch } : o),
    } : x));
  const moverOpcao = (grupoId: string, opcId: string, direction: 'up' | 'down') =>
    setGrupos(g => g.map(x => {
      if (x.id !== grupoId) return x;
      const idx = x.opcoes.findIndex(o => o.id === opcId);
      if (idx < 0) return x;
      if (direction === 'up' && idx === 0) return x;
      if (direction === 'down' && idx === x.opcoes.length - 1) return x;
      const newOpcoes = [...x.opcoes];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      [newOpcoes[idx], newOpcoes[swapIdx]] = [newOpcoes[swapIdx], newOpcoes[idx]];
      return { ...x, opcoes: newOpcoes };
    }));

  const addPromocao = () => setPromocoes(p => [...p, novaPromocao()]);
  const removePromocao = (id: string) => setPromocoes(p => p.filter(x => x.id !== id));
  const updatePromocao = (id: string, patch: Partial<PromocaoItem>) =>
    setPromocoes(p => p.map(x => x.id === id ? { ...x, ...patch } : x));
  const toggleDia = (promoId: string, dia: number) =>
    setPromocoes(p => p.map(x => {
      if (x.id !== promoId) return x;
      const dias = x.diasSemana.includes(dia) ? x.diasSemana.filter(d => d !== dia) : [...x.diasSemana, dia];
      return { ...x, diasSemana: dias };
    }));

  const addSubParte = () => setSubproducao(s => [...s, novaSubProducao(primeiraEstacao?.nome ?? 'Grelha', primeiraEstacao?.id ?? '')]);
  const removeSubParte = (id: string) => setSubproducao(s => s.filter(x => x.id !== id));
  const updateSubParte = (id: string, patch: Partial<SubproducaoItem>) =>
    setSubproducao(s => s.map(x => x.id === id ? { ...x, ...patch } : x));

  const handleToggleSemPreparo = (val: boolean) => {
    setSemPreparo(val);
    if (val) {
      setProducaoDividida(false);
      setSubproducao([]);
    }
  };

  const handleToggleProducaoDividida = (val: boolean) => {
    setProducaoDividida(val);
    if (!val) setSubproducao([]);
    else if (subproducao.length === 0) setSubproducao([novaSubProducao(primeiraEstacao?.nome ?? 'Grelha', primeiraEstacao?.id ?? '')]);
  };

  const addObs = () => {
    if (!novaObs.trim()) return;
    setObs(o => [...o, novaObs.trim()]);
    setNovaObs('');
  };

  // Onde o item aparece (3 opções), mapeado pros flags existentes:
  //  - 'delivery' → somenteDelivery (oculto no presencial; visível no delivery)
  //  - 'casa'     → delivery_config.ativo=false (oculto no delivery; visível no presencial)
  //  - 'ambos'    → padrão (visível em tudo)
  const disponibilidade: 'ambos' | 'delivery' | 'casa' =
    somenteDelivery ? 'delivery' : (deliveryConfig?.ativo === false ? 'casa' : 'ambos');
  const setDisponibilidade = (val: 'ambos' | 'delivery' | 'casa') => {
    if (val === 'delivery') {
      setSomenteDelivery(true);
      setDeliveryConfig(d => ({ ...(d ?? { ativo: true }), ativo: true }));
    } else if (val === 'casa') {
      setSomenteDelivery(false);
      setDeliveryConfig(d => ({ ...(d ?? { ativo: false }), ativo: false }));
    } else {
      setSomenteDelivery(false);
      setDeliveryConfig(d => ({ ...(d ?? { ativo: true }), ativo: true }));
    }
  };

  const mesmoNome = itemComMesmoNome(nome, itensCardapio, item?.id);

  const irParaErro = (e: ErroItem) => {
    setErro(e);
    setTab(e.aba);
    if (e.campo) {
      const campo = e.campo;
      setTimeout(() => {
        const el = document.getElementById(campo);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (el instanceof HTMLInputElement) el.focus();
      }, 80);
    }
  };

  const handleSave = async () => {
    if (saving || salvandoFicha) return;
    const semQtd = grupos.flatMap(g => g.opcoes.filter(o => insumosDaOpcao(o).some(x => !(Number(x.quantidade) > 0))).map(o => o.nome || 'opção sem nome'));
    const falha = validarItem({ nome, preco, erroHorario: erroHorario(horario), opcoesSemQuantidade: semQtd });
    if (falha) {
      if (falha.campo === 'item-preco' && !podeAlterarPreco) falha.texto += ' Seu perfil não pode alterar preços: peça a quem pode.';
      irParaErro(falha);
      return;
    }
    if (mesmoNome) {
      const cat = categorias.find(c => c.id === mesmoNome.categoriaId)?.nome;
      const ok = await confirmar({
        titulo: 'Já existe um item com esse nome',
        mensagem: `"${mesmoNome.nome}"${cat ? ` (${cat})` : ''} já está no cardápio. Salvar mesmo assim? Se não, a janela continua aberta e nada do que você digitou se perde.`,
        confirmarLabel: 'Salvar mesmo assim',
        cancelarLabel: 'Voltar e mudar o nome',
      });
      if (!ok) {
        irParaErro({ aba: 'basico', campo: 'item-nome', texto: `Já existe um item chamado "${mesmoNome.nome}". Mude o nome ou salve mesmo assim.` });
        return;
      }
    }
    setErro(null);
    const saved: Item = {
      id: item?.id ?? `item-${Date.now()}`,
      categoriaId,
      nome,
      descricao,
      preco: parseFloat(preco),
      fotoUrl,
      slaMinutos: parseInt(sla, 10),
      status,
      semPreparo: semPreparo || undefined,
      somenteDelivery: somenteDelivery || undefined,
      gruposOpcoes: grupos,
      promocoes,
      observacoesPadrao: obs,
      fichaTecnica: fichas,
      subproducao: producaoDividida && subproducao.length > 0 ? subproducao : undefined,
      delivery: deliveryConfig,
      fiscal,
      horario,
    };
    // 1) Ficha técnica (só se mudou). Se falhar, a janela fica aberta com tudo o que foi digitado.
    if (fichaRef.current?.temMudanca()) {
      setSalvandoFicha(true);
      const r = await fichaRef.current.salvar();
      setSalvandoFicha(false);
      if (!r.ok) {
        irParaErro({ aba: 'feito', texto: `A ficha técnica não foi salva (${r.erro ?? 'erro desconhecido'}). O item também não foi salvo. Nada do que você digitou se perdeu: confira e toque em Salvar de novo.` });
        return;
      }
      // Ficha nova gravada: admin/gerente decide desde quando vale para as vendas já feitas; o item salva ao fechar.
      if (user?.tenantId && item?.id && (user.perfil === 'admin' || user.perfil === 'gerente')) {
        itemPendente.current = saved;
        setPerguntarVendas(true);
        return;
      }
    }
    // 2) Item (mesmo caminho de sempre: onSave → salvarItem do Cardápio, que avisa se der erro).
    onSave(saved);
  };

  const fecharPerguntaVendas = () => {
    setPerguntarVendas(false);
    const pend = itemPendente.current;
    itemPendente.current = null;
    if (pend) onSave(pend);
  };

  const fechar = async () => {
    if (fichaRef.current?.temMudanca()) {
      const sair = await confirmar({
        titulo: 'Sair sem salvar a ficha técnica?',
        mensagem: 'Você mexeu na ficha técnica e ainda não salvou. Se sair agora, essas mudanças se perdem.',
        confirmarLabel: 'Sair sem salvar',
        cancelarLabel: 'Continuar editando',
        perigo: true,
      });
      if (!sair) return;
    }
    onClose();
  };

  const estacoesUsadas = subproducao.map(s => s.estacao);
  const hasDuplicateEstacao = estacoesUsadas.length !== new Set(estacoesUsadas).size;
  const categoriaAtual = categorias.find(c => c.id === categoriaId);
  const ocupado = !!saving || salvandoFicha;

  const contagem: Partial<Record<AbaItem, number>> = {
    opcoes: grupos.length,
    promocoes: promocoes.length,
    observacoes: obs.length,
  };

  const resumoFiscal = fiscal.ncm
    ? `NCM ${fiscal.ncm} só deste item.`
    : `Herda da categoria "${categoriaAtual?.nome ?? ''}"${categoriaAtual?.fiscal?.ncm ? ` (NCM ${categoriaAtual.fiscal.ncm})` : ' (sem NCM próprio)'} e, depois, do padrão da loja.`;
  const proprioDelivery = [
    deliveryConfig?.preco != null ? `preço ${brl(deliveryConfig.preco)}` : null,
    deliveryConfig?.descricao ? 'descrição' : null,
    deliveryConfig?.embalagem ? 'embalagem' : null,
    deliveryConfig?.slaMinutos ? `tempo ${deliveryConfig.slaMinutos} min` : null,
    deliveryConfig?.quantidadeMinima || deliveryConfig?.quantidadeMaxima ? 'quantidade' : null,
  ].filter(Boolean);
  const resumoDelivery = disponibilidade === 'casa'
    ? 'Este item não aparece no delivery ("Só balcão", no Básico).'
    : proprioDelivery.length
    ? `Próprio do delivery: ${proprioDelivery.join(', ')}.`
    : 'Usa o mesmo preço e a mesma descrição da casa.';

  const subtitulo = item
    ? `${categoriaAtual?.nome ?? 'Sem categoria'} · ${brl(parseFloat(preco) || 0)}${status === 'inativo' ? ' · inativo' : ''}`
    : 'Preencha o básico; o resto pode ficar para depois';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-stretch sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-[#FAF7F2] w-full h-[100dvh] sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl flex flex-col shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 bg-white sm:rounded-t-2xl flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-[17px] font-extrabold text-zinc-900 leading-snug truncate">
              {item ? (nome || item.nome || 'Editar item') : (nome || 'Novo item')}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{subtitulo}</p>
          </div>
          <button
            onClick={fechar}
            aria-label="Fechar"
            className="w-11 h-11 flex-shrink-0 flex items-center justify-center text-zinc-500 bg-zinc-100 hover:bg-zinc-200 rounded-full transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Abas (roláveis no celular; a ativa fica no meio) */}
        <div className="bg-white border-b border-zinc-200 flex-shrink-0">
          <div className="flex gap-1 px-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
            {ABAS_ITEM.map(a => {
              const n = contagem[a.id];
              const ativa = tab === a.id;
              const comErro = erro?.aba === a.id;
              return (
                <button
                  key={a.id}
                  ref={el => { abasRef.current[a.id] = el; }}
                  role="tab"
                  aria-selected={ativa}
                  onClick={() => setTab(a.id)}
                  className={`flex items-center gap-1.5 min-h-[44px] px-3 text-[13px] font-bold border-b-[3px] transition-colors cursor-pointer whitespace-nowrap ${
                    ativa ? 'border-amber-500 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  {a.rotulo}
                  {n ? <span className="text-[11px] font-bold px-1.5 rounded-full bg-zinc-100 text-zinc-600">{n}</span> : null}
                  {a.id === 'feito' && fichasCount > 0 && (
                    <span className="text-[11px] font-bold px-1.5 rounded-full bg-zinc-100 text-zinc-600" title="Insumos na ficha técnica">{fichasCount}</span>
                  )}
                  {a.id === 'feito' && semPreparo && <span className="w-1.5 h-1.5 rounded-full bg-teal-500" title="Entrega direta" />}
                  {a.id === 'feito' && !semPreparo && producaoDividida && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Produção dividida" />}
                  {a.id === 'feito' && fichaSuja && <span className="text-[10px] font-bold text-amber-700" title="Ficha com mudança não salva">•</span>}
                  {a.id === 'avancado' && status === 'inativo' && <span className="text-[10px] font-bold px-1.5 rounded-full bg-red-50 text-red-600">inativo</span>}
                  {comErro && <i className="ri-error-warning-fill text-red-500 text-sm" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Conteúdo */}
        <div ref={corpoRef} className="flex-1 overflow-y-auto p-4 sm:p-5">

          {erro && erro.aba === tab && erro.aba !== 'opcoes' && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700" role="alert">
              <i className="ri-error-warning-line text-base mt-0.5" />
              <span className="flex-1">{erro.texto}</span>
              <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso" className="w-8 h-8 -mr-1 -mt-1 flex items-center justify-center text-red-400 hover:text-red-600 cursor-pointer">
                <i className="ri-close-line" />
              </button>
            </div>
          )}

          {/* ── BÁSICO ── */}
          {tab === 'basico' && (
            <div className="space-y-4">
              <div>
                <label className={ROTULO} htmlFor="item-nome">Nome do item *</label>
                <input
                  id="item-nome"
                  className={CAMPO}
                  placeholder="Ex: X-Burguer Clássico"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                />
                {mesmoNome && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-1.5">
                    <i className="ri-alert-line mr-1" />
                    Já existe um item chamado "{mesmoNome.nome}"{categorias.find(c => c.id === mesmoNome.categoriaId) ? ` em ${categorias.find(c => c.id === mesmoNome.categoriaId)!.nome}` : ''}.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={ROTULO} htmlFor="item-preco">Preço (R$) *</label>
                  <input
                    id="item-preco"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    disabled={!podeAlterarPreco}
                    title={!podeAlterarPreco ? 'Seu perfil não pode alterar preços' : undefined}
                    className={`${CAMPO} disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed`}
                    placeholder="0,00"
                    value={preco}
                    onChange={e => setPreco(e.target.value)}
                  />
                  {!podeAlterarPreco && (
                    <p className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
                      <i className="ri-lock-line" /> Sem permissão para alterar preço
                    </p>
                  )}
                </div>
                <div>
                  <label className={ROTULO} htmlFor="item-categoria">Categoria</label>
                  <select
                    id="item-categoria"
                    className={`${CAMPO} cursor-pointer`}
                    value={categoriaId}
                    onChange={e => setCategoriaId(e.target.value)}
                  >
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
              </div>

              {/* Onde o item aparece: balcão, delivery ou ambos */}
              <div>
                <label className={ROTULO}>Onde este item aparece</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'ambos', label: 'Balcão e delivery', icon: 'ri-restaurant-2-line' },
                    { key: 'casa', label: 'Só balcão', icon: 'ri-home-4-line' },
                    { key: 'delivery', label: 'Só delivery', icon: 'ri-e-bike-2-line' },
                  ] as const).map(opt => {
                    const sel = disponibilidade === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        aria-pressed={sel}
                        onClick={() => setDisponibilidade(opt.key)}
                        className={`flex flex-col items-center justify-center gap-1 min-h-[64px] px-1 py-2.5 rounded-xl border text-xs font-bold transition-colors text-center cursor-pointer ${
                          sel ? 'bg-amber-50 border-amber-400 text-zinc-900' : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300'
                        }`}
                      >
                        <i className={opt.icon + ' text-lg'} />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-zinc-500 mt-1.5">
                  {disponibilidade === 'delivery'
                    ? 'Aparece só no delivery — oculto no caixa, garçom, mesa e autoatendimento.'
                    : disponibilidade === 'casa'
                    ? 'Aparece só nos canais presenciais (caixa, garçom, mesa, autoatendimento) — oculto no delivery.'
                    : 'Aparece em todos os canais — presencial e delivery.'}
                  {' '}Balcão = caixa, totem, mesa e garçom.
                </p>
              </div>

              <div>
                <label className={ROTULO}>Foto</label>
                <div className="flex items-start gap-3">
                  <div className="w-20 h-20 rounded-xl overflow-hidden border border-zinc-200 bg-white flex-shrink-0">
                    <ItemImage src={fotoUrl} alt={nome || 'Novo Item'} className="w-full h-full" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => !uploadingFoto && fotoInputRef.current?.click()}
                        disabled={uploadingFoto}
                        className={btn('out')}
                      >
                        {uploadingFoto ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-zinc-400/30 border-t-zinc-500 rounded-full animate-spin" />
                            Enviando...
                          </>
                        ) : (
                          <>
                            <i className="ri-upload-2-line text-sm" />
                            Anexar foto
                          </>
                        )}
                      </button>
                      {fotoUrl && !uploadingFoto && (
                        <button type="button" onClick={() => setFotoUrl('')} className={btn('ghost')}>
                          <span className="text-red-600">Remover foto</span>
                        </button>
                      )}
                    </div>
                    <input
                      className={CAMPO}
                      placeholder="ou cole o link: https://..."
                      value={fotoUrl.startsWith('data:') ? '' : fotoUrl}
                      onChange={e => setFotoUrl(e.target.value)}
                    />
                    {uploadError && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <i className="ri-error-warning-line" />
                        {uploadError}
                      </p>
                    )}
                    <input
                      ref={fotoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={handleFotoUpload}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className={ROTULO} htmlFor="item-descricao">Descrição</label>
                <textarea
                  id="item-descricao"
                  className={`${CAMPO} resize-none`}
                  rows={3}
                  placeholder="Descreva os ingredientes e características do item..."
                  value={descricao}
                  onChange={e => setDescricao(e.target.value)}
                />
              </div>

              {/* Horário em que o item aparece no cardápio do cliente */}
              <div id="item-horario-cardapio">
                <label className={ROTULO}>Horário no cardápio</label>
                <HorarioExibicaoEditor
                  value={horario}
                  onChange={setHorario}
                  canais={disponibilidade === 'ambos' ? ['casa', 'delivery'] : [disponibilidade]}
                  ajuda="Fora desses horários o item some do cardápio do cliente (delivery, mesa/QR e autoatendimento). Cada horário pode valer para casa e delivery ou só para um deles. No caixa, garçom e PDV delivery ele continua, marcado como fora do horário."
                />
                {(() => {
                  const cat = categoriaAtual;
                  if (!cat || !temHorario(cat.horario)) return null;
                  return (
                    <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1.5 mt-2">
                      <i className="ri-information-line mr-1" />
                      A categoria "{cat.nome}" só aparece {resumoHorario(cat.horario, disponibilidade === 'ambos' ? ['casa', 'delivery'] : [disponibilidade])}. O item precisa estar no horário dele e no da categoria.
                    </p>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ── COMO É FEITO: ficha técnica + produção + tempo de preparo ── */}
          {/* A ficha fica montada o tempo todo (escondida fora desta aba) para não perder o rascunho. */}
          <div className={tab === 'feito' ? 'mb-5' : 'hidden'}>
            <Titulo extra={<span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">custo do item</span>}>
              Ficha técnica
            </Titulo>
            <Cartao>
              <FichaDoItem
                key={item?.id ?? 'novo'}
                ref={fichaRef}
                itemId={item?.id}
                onCountChange={setFichasCount}
                onSujaChange={setFichaSuja}
              />
            </Cartao>
          </div>

          {tab === 'feito' && (
            <div className="space-y-4">
              <Titulo>Produção</Titulo>

              {/* ── Entrega Direta ── */}
              <div className={`flex items-start gap-3 p-4 rounded-2xl border transition-colors ${semPreparo ? 'bg-teal-50 border-teal-200' : 'bg-white border-zinc-200'}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-bold text-zinc-900">Entrega direta, sem preparo</p>
                    {semPreparo && (
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-teal-100 text-teal-700 border border-teal-200 rounded-full">
                        ATIVO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Ative para itens que <strong>não precisam de preparo na cozinha</strong>. Ao chegar no KDS, o item pula direto para <strong>Pronto</strong>, aguardando apenas a entrega.
                  </p>
                  <p className="text-xs text-teal-700 mt-1.5 font-medium">
                    Ex: Refrigerante, Água Mineral, Bebidas embaladas, Itens pré-prontos.
                  </p>
                </div>
                <Chave ligado={semPreparo} cor="teal" rotulo="Entrega direta, sem preparo" onClick={() => handleToggleSemPreparo(!semPreparo)} />
              </div>

              {semPreparo && (
                <div className="flex items-start gap-2.5 p-3 bg-teal-50 border border-teal-100 rounded-xl">
                  <i className="ri-arrow-right-circle-line text-teal-500 text-base flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-teal-700 mb-1">Como funciona no KDS:</p>
                    <ul className="space-y-0.5 text-xs text-teal-700">
                      <li>• Ao entrar no KDS, o item já aparece como <strong>PRONTO</strong></li>
                      <li>• Operadores veem o badge <strong>&quot;ENTREGA DIRETA&quot;</strong> no card</li>
                      <li>• Pedidos mistos: itens sem preparo ficam prontos enquanto os outros são preparados</li>
                      <li>• Estoque é deduzido normalmente na entrega</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* ── Produção dividida (bloqueada se semPreparo) ── */}
              <div className={semPreparo ? 'opacity-40 pointer-events-none select-none' : ''}>
                <div className="flex items-start gap-3 p-4 bg-white rounded-2xl border border-zinc-200">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-zinc-900">Produção dividida em estações</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Ative quando este item exige produção em mais de uma estação da cozinha.
                      O item só fica pronto quando <strong>todas as partes</strong> estiverem concluídas.
                    </p>
                    <p className="text-xs text-amber-700 mt-1.5 font-medium">
                      Ex: Hambúrguer (Grelha) + Batata inclusa (Frituras) — cada estação vê e controla sua parte.
                    </p>
                    {semPreparo && (
                      <p className="text-xs text-zinc-400 mt-1 italic">Indisponível quando &quot;Entrega Direta&quot; está ativo.</p>
                    )}
                  </div>
                  <Chave ligado={producaoDividida} rotulo="Produção dividida em estações" onClick={() => handleToggleProducaoDividida(!producaoDividida)} />
                </div>

                {producaoDividida && (
                  <div className="space-y-3 mt-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-zinc-800">Partes da produção</h4>
                      {hasDuplicateEstacao && (
                        <span className="text-xs text-amber-700 flex items-center gap-1">
                          <i className="ri-alert-line" />
                          Estação duplicada
                        </span>
                      )}
                    </div>

                    {subproducao.map((parte, idx) => (
                      <div key={parte.id} className="bg-white border border-zinc-200 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                            Parte {idx + 1}
                          </span>
                          <button
                            onClick={() => removeSubParte(parte.id)}
                            aria-label={`Remover parte ${idx + 1}`}
                            className="w-11 h-11 -mr-2 flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-xl cursor-pointer transition-colors"
                          >
                            <i className="ri-delete-bin-line text-base" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="sm:col-span-2">
                            <label className={ROTULO}>Nome da parte *</label>
                            <input
                              className={CAMPO}
                              placeholder="Ex: Hambúrguer, Batata Frita, Molho..."
                              value={parte.nome}
                              onChange={e => updateSubParte(parte.id, { nome: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className={ROTULO}>Estação *</label>
                            <select
                              className={`${CAMPO} cursor-pointer`}
                              value={parte.estacaoId ?? estacoes.find(e => e.nome === parte.estacao)?.id ?? ''}
                              onChange={e => {
                                const estId = e.target.value;
                                const estNome = estacoes.find(e => e.id === estId)?.nome ?? '';
                                updateSubParte(parte.id, { estacaoId: estId || undefined, estacao: estNome });
                              }}
                            >
                              {estacoes.map(est => (
                                <option key={est.id} value={est.id}>{est.nome}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={ROTULO}>Tempo desta parte (min)</label>
                            <input
                              type="number"
                              min="1"
                              inputMode="numeric"
                              className={CAMPO}
                              value={parte.slaMinutos}
                              onChange={e => updateSubParte(parte.id, { slaMinutos: parseInt(e.target.value, 10) || 1 })}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <i className="ri-map-pin-2-line text-amber-600 text-sm" />
                          <span className="text-xs text-zinc-500">
                            Aparecerá no KDS da estação{' '}
                            <strong className="text-zinc-800">{parte.estacao || '—'}</strong>
                            {parte.slaMinutos > 0 && (
                              <> com SLA de <strong>{parte.slaMinutos} min</strong></>
                            )}
                          </span>
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={addSubParte}
                      className="w-full min-h-[48px] border-2 border-dashed border-zinc-200 hover:border-amber-300 hover:bg-amber-50 text-zinc-500 hover:text-zinc-800 text-sm font-bold py-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <i className="ri-add-line" /> Adicionar parte
                    </button>

                    {subproducao.length >= 2 && (
                      <div className="bg-white border border-zinc-200 rounded-xl p-3 flex items-start gap-2">
                        <i className="ri-information-line text-sm text-zinc-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-zinc-600 font-medium">Como funciona no KDS:</p>
                          <ul className="mt-1 space-y-0.5">
                            {subproducao.map((p, i) => (
                              <li key={p.id} className="text-xs text-zinc-500 flex items-center gap-1.5">
                                <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                                Estação <strong>{p.estacao || '—'}</strong> vê e controla &quot;{p.nome || 'sem nome'}&quot;
                              </li>
                            ))}
                            <li className="text-xs text-amber-800 font-medium flex items-center gap-1.5 mt-1">
                              <i className="ri-check-double-line" />
                              Item só fica PRONTO quando todas as partes estiverem prontas
                            </li>
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!producaoDividida && !semPreparo && (
                  <p className="text-xs text-zinc-500 mt-2 px-1">
                    <i className="ri-tools-line mr-1 text-zinc-400" />
                    Produção simples — uma única estação: a da categoria do item.
                  </p>
                )}
              </div>

              {/* Tempo de preparo (SLA) */}
              <div>
                <label className={ROTULO} htmlFor="item-sla">
                  Tempo de preparo — SLA (minutos)
                  {semPreparo && (
                    <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded-full border border-teal-100">
                      Entrega Direta
                    </span>
                  )}
                  {slaCalculado !== null && !semPreparo && (
                    <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-800 rounded-full border border-amber-200">
                      Calculado automaticamente
                    </span>
                  )}
                </label>
                <input
                  id="item-sla"
                  type="number"
                  inputMode="numeric"
                  className={`${CAMPO} max-w-[160px] ${(slaCalculado !== null || semPreparo) ? 'bg-zinc-50 text-zinc-400 cursor-default' : ''}`}
                  placeholder="10"
                  value={semPreparo ? 0 : slaCalculado !== null ? slaCalculado : sla}
                  readOnly={slaCalculado !== null || semPreparo}
                  onChange={e => { if (slaCalculado === null && !semPreparo) setSla(e.target.value); }}
                />
                {semPreparo && (
                  <p className="text-[11px] text-teal-600 mt-1">Sem preparo — entregue diretamente</p>
                )}
                {slaCalculado !== null && !semPreparo && (
                  <p className="text-[11px] text-zinc-400 mt-1">
                    Soma: {subproducao.map(s => `${s.slaMinutos}min`).join(' + ')} = {slaCalculado}min
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── OPÇÕES ── */}
          {tab === 'opcoes' && (
            <OpcoesTab
              grupos={grupos}
              insumos={insumos}
              recipes={recipes}
              produtos={itensCardapio}
              getBatchesByRecipeId={getBatchesByRecipeId}
              onAddGrupo={addGrupo}
              onAddGrupoCompleto={addGrupoCompleto}
              onRemoveGrupo={removeGrupo}
              onUpdateGrupo={updateGrupo}
              onAddOpcao={addOpcao}
              onRemoveOpcao={removeOpcao}
              onUpdateOpcao={updateOpcao}
              onMoveOpcao={moverOpcao}
              erro={erro?.aba === 'opcoes' ? erro.texto : null}
              itemId={item?.id}
              itemNome={nome || item?.nome}
              vinculosSalvos={JSON.stringify(vinculosOpcoes(item?.gruposOpcoes ?? [])) === JSON.stringify(vinculosOpcoes(grupos))}
            />
          )}

          {/* ── PROMOÇÕES ── */}
          {tab === 'promocoes' && (
            <div className="space-y-3">
              <Titulo>Promoções deste item</Titulo>
              {promocoes.length === 0 && (
                <p className="text-xs text-zinc-500 bg-white border border-zinc-200 rounded-2xl px-4 py-3">
                  <b className="text-zinc-800">Nenhuma promoção.</b> Preço especial por dia da semana ou numa data.
                </p>
              )}
              {promocoes.map(promo => (
                <div key={promo.id} className="bg-white border border-zinc-200 rounded-2xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Tipo da promoção"
                        className={`${CAMPO} !w-auto cursor-pointer`}
                        value={promo.tipo}
                        onChange={e => updatePromocao(promo.id, { tipo: e.target.value as 'semanal' | 'pontual' })}
                      >
                        <option value="semanal">Semanal</option>
                        <option value="pontual">Pontual</option>
                      </select>
                      <div className="flex items-center gap-1.5 min-h-[44px] border border-zinc-200 rounded-xl px-3 bg-white">
                        <span className="text-zinc-400 text-xs">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          aria-label="Preço na promoção"
                          className="w-24 focus:outline-none text-sm bg-transparent"
                          placeholder="Preço promo"
                          value={promo.precoPromocional || ''}
                          onChange={e => updatePromocao(promo.id, { precoPromocional: parseFloat(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Chave ligado={promo.ativo} rotulo="Promoção ativa" onClick={() => updatePromocao(promo.id, { ativo: !promo.ativo })} />
                      <button
                        onClick={() => removePromocao(promo.id)}
                        aria-label="Excluir promoção"
                        className="w-11 h-11 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer rounded-xl transition-colors"
                      >
                        <i className="ri-delete-bin-line text-base" />
                      </button>
                    </div>
                  </div>
                  {promo.tipo === 'semanal' ? (
                    <div className="flex gap-1.5 flex-wrap">
                      {mockDiasSemana.map((dia, idx) => (
                        <button
                          key={idx}
                          onClick={() => toggleDia(promo.id, idx)}
                          aria-pressed={promo.diasSemana.includes(idx)}
                          className={`min-h-[44px] min-w-[48px] px-3 text-xs font-bold rounded-full cursor-pointer transition-colors whitespace-nowrap ${
                            promo.diasSemana.includes(idx) ? 'bg-amber-500 text-zinc-900' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                          }`}
                        >
                          {dia}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs text-zinc-500 mb-1.5 block">Data específica</label>
                      <input
                        type="date"
                        className={`${CAMPO} !w-auto`}
                        value={promo.dataEspecifica ?? ''}
                        onChange={e => updatePromocao(promo.id, { dataEspecifica: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={addPromocao}
                className="w-full min-h-[48px] border-2 border-dashed border-zinc-200 hover:border-amber-300 hover:bg-amber-50 text-zinc-500 hover:text-zinc-800 text-sm font-bold py-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <i className="ri-add-line" /> Nova promoção
              </button>
            </div>
          )}

          {/* ── OBSERVAÇÕES ── */}
          {tab === 'observacoes' && (
            <div className="space-y-5">
              <div>
                <Titulo>Pedidos especiais só deste item</Titulo>
                <p className="text-xs text-zinc-500 mb-2">Aparecem como opção exclusiva ao lançar este item</p>
                <div className="flex gap-2 mb-3">
                  <input
                    className={`${CAMPO} flex-1`}
                    placeholder="Ex: Sem cebola, Pão sem glúten..."
                    value={novaObs}
                    onChange={e => setNovaObs(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addObs()}
                  />
                  <button onClick={addObs} className={btn('p')}>
                    Adicionar
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {obs.length === 0 && (
                    <p className="text-xs text-zinc-400 italic">Nenhuma obs. específica cadastrada</p>
                  )}
                  {obs.map((o, i) => (
                    <span key={i} className="flex items-center gap-1 bg-white border border-zinc-200 text-zinc-800 text-xs font-semibold pl-3 rounded-full">
                      {o}
                      <button
                        onClick={() => setObs(arr => arr.filter((_, j) => j !== i))}
                        aria-label={`Tirar "${o}"`}
                        className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                      >
                        <i className="ri-close-line" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="border-t border-zinc-200 pt-4">
                <Titulo extra={<span className="text-[11px] bg-amber-50 text-amber-800 px-2 py-0.5 rounded-full font-bold">Aparecem em todos os itens</span>}>
                  As que valem para todos os itens
                </Titulo>
                <p className="text-xs text-zinc-500 mb-3">
                  Gerenciadas na aba <strong>Obs. Globais</strong> do cardápio. Aparecem automaticamente como opção neste e em todos os outros itens.
                </p>
                <div className="flex flex-wrap gap-2">
                  {obsGlobais.filter(o => o.ativo).map(o => (
                    <span key={o.id} className="flex items-center gap-1.5 bg-zinc-100 text-zinc-600 text-xs px-3 py-1.5 rounded-full">
                      <i className="ri-global-line text-zinc-400" />
                      {o.texto}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── AVANÇADO: estado do item, nota fiscal, delivery próprio ── */}
          {tab === 'avancado' && (
            <div className="space-y-3">
              <Titulo>Estado do item</Titulo>
              <div className="flex items-center gap-3 bg-white border border-zinc-200 rounded-2xl px-4 py-3">
                <div className="flex-1">
                  <p className="text-sm font-bold text-zinc-900">Ativo no cardápio</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {status === 'ativo'
                      ? 'Ativo: aparece para vender.'
                      : 'Inativo: some para o cliente e para a venda, mas o item e a ficha continuam guardados.'}
                  </p>
                </div>
                <Chave ligado={status === 'ativo'} rotulo="Ativo no cardápio" onClick={() => setStatus(status === 'ativo' ? 'inativo' : 'ativo')} />
              </div>

              <Titulo>Nota fiscal</Titulo>
              <Sanfona titulo="NCM e tributação" resumo={resumoFiscal} aberta={abrirFiscal} onToggle={() => setAbrirFiscal(v => !v)}>
                <FiscalFields
                  scope="item"
                  value={fiscal}
                  onChange={setFiscal}
                  heranca={(() => {
                    const cat = categoriaAtual;
                    const catNcm = cat?.fiscal?.ncm;
                    return catNcm ? `da categoria "${cat?.nome}" (NCM ${catNcm}) e, depois, do padrão da loja` : `da categoria "${cat?.nome ?? ''}" (sem NCM próprio) e, depois, do padrão da loja`;
                  })()}
                />
              </Sanfona>

              <Titulo>Delivery</Titulo>
              <Sanfona titulo="Preço e descrição só no delivery" resumo={resumoDelivery} aberta={abrirDelivery} onToggle={() => setAbrirDelivery(v => !v)}>
                <DeliveryTab
                  config={deliveryConfig}
                  precoBase={parseFloat(preco) || 0}
                  slaBase={parseInt(sla, 10) || 10}
                  descricaoBase={descricao}
                  onChange={setDeliveryConfig}
                />
              </Sanfona>
            </div>
          )}
        </div>

        {/* Rodapé: um Salvar só (item + ficha técnica) */}
        <div className="flex gap-2 px-4 sm:px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-white border-t border-zinc-200 sm:rounded-b-2xl flex-shrink-0">
          <button onClick={fechar} disabled={ocupado} className={`${btn('out')} flex-1 min-h-[48px]`}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={ocupado} className={`${btn('p')} flex-1 min-h-[48px]`}>
            {ocupado && <span className="w-3.5 h-3.5 border-2 border-zinc-900/20 border-t-zinc-900 rounded-full animate-spin" />}
            {salvandoFicha ? 'Salvando a ficha...' : saving ? 'Salvando...' : item ? 'Salvar' : 'Criar item'}
          </button>
        </div>
      </div>

      {perguntarVendas && item?.id && user?.tenantId && (
        <FichaRetroativaModal tenantId={user.tenantId} itemId={item.id} itemNome={nome || item.nome || 'Item'} onFechar={fecharPerguntaVendas} />
      )}
    </div>
  );
}

// ── Sub-componente da aba Opções (para não poluir o principal) ──────────────

interface OpcoesTabProps {
  grupos: GrupoOpcoes[];
  insumos: Insumo[];
  recipes: ProductionRecipe[];
  /** itens do cardápio: a opção pode apontar para um produto inteiro */
  produtos: Item[];
  getBatchesByRecipeId: (recipeId: string) => Array<{ unitCost: number }>;
  onAddGrupo: () => void;
  onAddGrupoCompleto?: (grupo: GrupoOpcoes) => void;
  onRemoveGrupo: (id: string) => void;
  onUpdateGrupo: (id: string, patch: Partial<GrupoOpcoes>) => void;
  onAddOpcao: (grupoId: string) => void;
  onRemoveOpcao: (grupoId: string, opcId: string) => void;
  onUpdateOpcao: (grupoId: string, opcId: string, patch: Partial<OpcaoItem>) => void;
  onMoveOpcao: (grupoId: string, opcId: string, direction: 'up' | 'down') => void;
  erro?: string | null;
  itemId?: string;
  itemNome?: string;
  /** true quando os vínculos com o estoque na tela são os mesmos que estão salvos */
  vinculosSalvos?: boolean;
}

// Vínculos das opções com o estoque (para saber se há mudança não salva)
const vinculosOpcoes = (gs: GrupoOpcoes[]) =>
  gs.flatMap(g => g.opcoes.flatMap(o => [
    ...insumosDaOpcao(o).map(x => [o.id, x.ingredientId, Number(x.quantidade ?? 0), x.unidade ?? '']),
    ...(o.linkedItemId ? [[o.id, `produto:${o.linkedItemId}`, 0, '']] : []),
  ])).map(v => v.join('|')).sort();

function OpcoesTab({
  grupos, insumos, recipes, produtos, getBatchesByRecipeId,
  onAddGrupo, onAddGrupoCompleto, onRemoveGrupo, onUpdateGrupo,
  onAddOpcao, onRemoveOpcao, onUpdateOpcao, onMoveOpcao,
  erro, itemId, itemNome, vinculosSalvos,
}: OpcoesTabProps) {
  const { user } = useAuth();
  const [aplicarVendas, setAplicarVendas] = useState(false);
  // O cardápio carrega as fichas vazias: quantos insumos cada produto tem na ficha vem direto do banco.
  const [fichaPorItem, setFichaPorItem] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    if (!user?.tenantId) return;
    let vivo = true;
    (async () => {
      const m = new Map<string, number>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('item_ingredients').select('item_id').eq('tenant_id', user.tenantId!).order('id').range(from, from + 999);
        if (error) return;
        for (const r of (data ?? []) as Array<{ item_id: string }>) m.set(r.item_id, (m.get(r.item_id) ?? 0) + 1);
        if (!data || data.length < 1000) break;
      }
      if (vivo) setFichaPorItem(m);
    })();
    return () => { vivo = false; };
  }, [user?.tenantId]);
  const temVinculo = grupos.some(g => g.opcoes.some(o => insumosDaOpcao(o).length > 0 || !!o.linkedItemId));
  const podeAplicar = !!itemId && !itemId.startsWith('item-') && (user?.perfil === 'admin' || user?.perfil === 'gerente');
  const [openVinculo, setOpenVinculo] = useState<string | null>(null);
  const [vinculoTab, setVinculoTab] = useState<'ingredient' | 'production' | 'product'>('ingredient');
  const [buscaInsumo, setBuscaInsumo] = useState('');
  // O que sai de uma produção aparece só na aba "Produção", uma vez por receita.
  const insumosUsoFinal = insumos.filter(
    (ins) => ins.usageType !== 'production' && !recipes.some((r) => r.outputIngredientId === ins.id),
  );
  const {
    templates, loading: loadingTemplates, saving: savingTemplate,
    saveTemplate, deleteTemplate, updateTemplate, applyTemplate,
  } = useOptionGroupTemplates();
  const [showLoadTemplate, setShowLoadTemplate] = useState(false);
  const [saveTemplateGrupoId, setSaveTemplateGrupoId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [showGerenciarTemplates, setShowGerenciarTemplates] = useState(false);
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null);
  const [editTemplateName, setEditTemplateName] = useState('');
  const [editTemplateGrupo, setEditTemplateGrupo] = useState<GrupoOpcoes | null>(null);

  const getRecipeUnitCost = (recipeId: string): number => {
    const batches = getBatchesByRecipeId(recipeId);
    if (batches.length === 0) return 0;
    return batches.reduce((s, b) => s + b.unitCost, 0) / batches.length;
  };

  const handleSaveTemplate = async () => {
    if (!saveTemplateGrupoId || !templateName.trim()) return;
    const grupo = grupos.find((g) => g.id === saveTemplateGrupoId);
    if (!grupo) return;
    const ok = await saveTemplate(templateName.trim(), grupo);
    if (ok) {
      setSaveTemplateGrupoId(null);
      setTemplateName('');
    }
  };

  const handleApplyTemplate = (template: OptionGroupTemplate) => {
    const novoGrupo = applyTemplate(template);
    if (onAddGrupoCompleto) {
      onAddGrupoCompleto(novoGrupo);
    } else {
      onAddGrupo();
    }
    setShowLoadTemplate(false);
  };

  const handleStartEditTemplate = (template: OptionGroupTemplate) => {
    const grupo: GrupoOpcoes = {
      id: template.id,
      nome: template.name,
      obrigatorio: template.isRequired,
      minSelecao: template.minSelections,
      maxSelecao: template.maxSelections,
      ordem: 1,
      opcoes: template.templateData.map((td) => ({
        id: `opc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        nome: td.nome,
        precoAdicional: td.precoAdicional,
        ativo: true,
        descricao: td.descricao,
        ingredientId: td.ingredientId ?? null,
        productionRecipeId: td.productionRecipeId ?? null,
        consumptionQuantity: td.consumptionQuantity,
        consumptionUnit: td.consumptionUnit,
        source: td.source,
      })),
    };
    setEditTemplateId(template.id);
    setEditTemplateName(template.name);
    setEditTemplateGrupo(grupo);
  };

  const handleConfirmEditTemplate = async () => {
    if (!editTemplateId || !editTemplateName.trim() || !editTemplateGrupo) return;
    const ok = await updateTemplate(editTemplateId, editTemplateName.trim(), editTemplateGrupo);
    if (ok) {
      setEditTemplateId(null);
      setEditTemplateName('');
      setEditTemplateGrupo(null);
    }
  };

  // Opção com vários insumos (2026-09-26): escolher no painel ACRESCENTA à lista da opção
  const acrescentarInsumo = (grupoId: string, opcId: string, novo: { ingredientId: string; productionRecipeId: string | null; unidade: string; source: 'ingredient' | 'production' }) => {
    const opc = grupos.find(g => g.id === grupoId)?.opcoes.find(o => o.id === opcId);
    if (!opc) return;
    const atual = insumosDaOpcao(opc);
    if (!atual.some(x => x.ingredientId === novo.ingredientId)) {
      onUpdateOpcao(grupoId, opcId, comInsumos([...atual, { ...novo, quantidade: undefined, unidade: unidadeConsumoInicial(novo.unidade) }]));
    }
    setOpenVinculo(null);
    setBuscaInsumo('');
  };
  const vincularInsumo = (grupoId: string, opcId: string, insumo: Insumo) =>
    acrescentarInsumo(grupoId, opcId, { ingredientId: insumo.id, productionRecipeId: null, unidade: insumo.unidade, source: 'ingredient' });
  // Produto inteiro (2026-10-06): a opção segue a ficha técnica atual dele; uma opção liga a um produto só
  const vincularProduto = (grupoId: string, opcId: string, produto: Item) => {
    onUpdateOpcao(grupoId, opcId, { linkedItemId: produto.id });
    setOpenVinculo(null);
    setBuscaInsumo('');
  };
  const vincularProducao = (grupoId: string, opcId: string, recipe: ProductionRecipe) => {
    if (!recipe.outputIngredientId) return;
    acrescentarInsumo(grupoId, opcId, { ingredientId: recipe.outputIngredientId, productionRecipeId: recipe.id, unidade: recipe.unit, source: 'production' });
  };
  const alterarInsumo = (grupoId: string, opcId: string, ingredientId: string, patch: { quantidade?: number; unidade?: string }) => {
    const opc = grupos.find(g => g.id === grupoId)?.opcoes.find(o => o.id === opcId);
    if (!opc) return;
    onUpdateOpcao(grupoId, opcId, comInsumos(insumosDaOpcao(opc).map(x => x.ingredientId === ingredientId ? { ...x, ...patch } : x)));
  };
  const removerInsumo = (grupoId: string, opcId: string, ingredientId: string) => {
    const opc = grupos.find(g => g.id === grupoId)?.opcoes.find(o => o.id === opcId);
    if (!opc) return;
    onUpdateOpcao(grupoId, opcId, comInsumos(insumosDaOpcao(opc).filter(x => x.ingredientId !== ingredientId)));
  };
  const nomeDoInsumo = (x: { ingredientId: string; productionRecipeId?: string | null }) =>
    (x.productionRecipeId ? recipes.find(r => r.id === x.productionRecipeId)?.name : undefined)
    ?? insumos.find(i => i.id === x.ingredientId)?.nome ?? 'Insumo';

  return (
    <div className="space-y-4">
      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">{erro}</div>
      )}
      {temVinculo && podeAplicar && user?.tenantId && (
        <div className="flex flex-wrap items-center gap-2 bg-amber-50/60 border border-amber-100 rounded-lg px-3 py-2 text-[11px] text-amber-800">
          <i className="ri-history-line" />
          <span className="flex-1 min-w-[180px]">
            {vinculosSalvos
              ? 'Opções ligadas ao estoque dão baixa nas próximas vendas. Para as vendas já feitas:'
              : 'Salve o item para que os vínculos com o estoque valham; depois dá para aplicar nas vendas já feitas.'}
          </span>
          <button type="button" disabled={!vinculosSalvos} onClick={() => setAplicarVendas(true)}
            className="px-2.5 py-1 rounded-md bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-40 cursor-pointer">
            Aplicar nas vendas já feitas
          </button>
        </div>
      )}
      {aplicarVendas && itemId && user?.tenantId && (
        <FichaRetroativaModal tenantId={user.tenantId} itemId={itemId} itemNome={itemNome ?? 'Item'} onFechar={() => setAplicarVendas(false)} />
      )}
      {/* ── Barra de Templates ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowLoadTemplate(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          <i className="ri-stack-line" />
          Usar Template
          {templates.length > 0 && (
            <span className="text-[10px] bg-orange-200 text-orange-700 px-1.5 py-0.5 rounded-full font-bold">
              {templates.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setShowGerenciarTemplates(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          <i className="ri-settings-3-line" />
          Gerenciar Templates
        </button>
      </div>

      {/* ── Modal: Usar Template ── */}
      {showLoadTemplate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-md flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h4 className="text-sm font-semibold text-gray-800">Usar Template de Grupo</h4>
              <button
                onClick={() => setShowLoadTemplate(false)}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer transition-colors"
              >
                <i className="ri-close-line text-lg" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {loadingTemplates && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!loadingTemplates && templates.length === 0 && (
                <div className="text-center py-8">
                  <div className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-xl mx-auto mb-2">
                    <i className="ri-stack-line text-gray-400 text-lg" />
                  </div>
                  <p className="text-xs text-gray-500">Nenhum template salvo ainda</p>
                  <p className="text-xs text-gray-400 mt-1">Crie um grupo de opções e clique em "Salvar como Template"</p>
                </div>
              )}
              {!loadingTemplates && templates.length > 0 && (
                <div className="space-y-2">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleApplyTemplate(t)}
                      className="w-full text-left p-3 border border-gray-100 rounded-xl hover:border-orange-300 hover:bg-orange-50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 flex items-center justify-center bg-orange-100 rounded-lg">
                            <i className="ri-list-check-2 text-orange-600 text-sm" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{t.name}</p>
                            <p className="text-xs text-gray-400">
                              {t.templateData.length} opção(ões)
                              {t.isRequired && <span className="text-orange-500 ml-1">· Obrigatório</span>}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs font-medium text-orange-600">Adicionar</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Salvar Template ── */}
      {saveTemplateGrupoId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-4">
            <h4 className="text-sm font-semibold text-gray-800 mb-3">Salvar como Template</h4>
            <p className="text-xs text-gray-500 mb-3">
              Dê um nome para este grupo de opções para reutilizá-lo em outros itens.
            </p>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 mb-4"
              placeholder="Ex: Ponto da Carne, Tamanhos, Adicionais..."
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveTemplate()}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setSaveTemplateGrupoId(null); setTemplateName(''); }}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={!templateName.trim() || savingTemplate}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
              >
                {savingTemplate && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Salvar Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Gerenciar Templates ── */}
      {showGerenciarTemplates && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl w-full max-w-md flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h4 className="text-sm font-semibold text-gray-800">Templates Salvos</h4>
              <button
                onClick={() => setShowGerenciarTemplates(false)}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer transition-colors"
              >
                <i className="ri-close-line text-lg" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {loadingTemplates && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!loadingTemplates && templates.length === 0 && (
                <div className="text-center py-8">
                  <div className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-xl mx-auto mb-2">
                    <i className="ri-stack-line text-gray-400 text-lg" />
                  </div>
                  <p className="text-xs text-gray-500">Nenhum template salvo</p>
                </div>
              )}
              {!loadingTemplates && templates.length > 0 && (
                <div className="space-y-2">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between p-3 border border-gray-100 rounded-xl"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 flex items-center justify-center bg-orange-100 rounded-lg flex-shrink-0">
                          <i className="ri-list-check-2 text-orange-600 text-sm" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                          <p className="text-xs text-gray-400">
                            {t.templateData.length} opção(ões)
                            {t.isRequired && <span className="text-orange-500 ml-1">· Obrigatório</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleStartEditTemplate(t)}
                          disabled={savingTemplate}
                          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg cursor-pointer transition-colors disabled:opacity-40"
                        >
                          <i className="ri-pencil-line text-sm" />
                        </button>
                        <button
                          onClick={() => deleteTemplate(t.id)}
                          disabled={savingTemplate}
                          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg cursor-pointer transition-colors flex-shrink-0 disabled:opacity-40"
                        >
                          <i className="ri-delete-bin-line text-sm" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Editar Template ── */}
      {editTemplateId && editTemplateGrupo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h4 className="text-sm font-semibold text-gray-800">Editar Template</h4>
              <button
                onClick={() => { setEditTemplateId(null); setEditTemplateName(''); setEditTemplateGrupo(null); }}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer transition-colors"
              >
                <i className="ri-close-line text-lg" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Nome do Template</label>
                <input
                  autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                  placeholder="Ex: Ponto da Carne, Tamanhos, Adicionais..."
                  value={editTemplateName}
                  onChange={(e) => setEditTemplateName(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editTemplateGrupo.obrigatorio}
                    onChange={(e) => setEditTemplateGrupo(g => g ? { ...g, obrigatorio: e.target.checked } : null)}
                    className="accent-orange-500"
                  />
                  <span className="text-gray-600">Obrigatório</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-600">Mín</span>
                  <input
                    type="number"
                    min="0"
                    className="w-12 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-400"
                    value={editTemplateGrupo.minSelecao}
                    onChange={(e) => setEditTemplateGrupo(g => g ? { ...g, minSelecao: parseInt(e.target.value, 10) } : null)}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-600">Máx</span>
                  <input
                    type="number"
                    min="1"
                    className="w-12 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-400"
                    value={editTemplateGrupo.maxSelecao}
                    onChange={(e) => setEditTemplateGrupo(g => g ? { ...g, maxSelecao: parseInt(e.target.value, 10) } : null)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-600">Opções</p>
                {editTemplateGrupo.opcoes.map((opc, idx) => (
                  <div key={opc.id} className="border border-gray-100 rounded-lg p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                        placeholder="Nome da opção"
                        value={opc.nome}
                        onChange={(e) => setEditTemplateGrupo(g => g ? {
                          ...g,
                          opcoes: g.opcoes.map((o, i) => i === idx ? { ...o, nome: e.target.value } : o),
                        } : null)}
                      />
                      <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                        <span className="text-gray-400 text-xs">+R$</span>
                        <input
                          type="number"
                          step="0.01"
                          className="w-16 focus:outline-none text-sm"
                          value={opc.precoAdicional}
                          onChange={(e) => setEditTemplateGrupo(g => g ? {
                            ...g,
                            opcoes: g.opcoes.map((o, i) => i === idx ? { ...o, precoAdicional: parseFloat(e.target.value) } : o),
                          } : null)}
                        />
                      </div>
                      <button
                        onClick={() => setEditTemplateGrupo(g => g ? {
                          ...g,
                          opcoes: g.opcoes.filter((_, i) => i !== idx),
                        } : null)}
                        className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 cursor-pointer rounded transition-colors"
                      >
                        <i className="ri-close-line text-sm" />
                      </button>
                    </div>
                    <input
                      className="w-full border border-gray-100 rounded-md px-2.5 py-1.5 text-xs text-gray-500 focus:outline-none focus:border-gray-300 focus:text-gray-700 placeholder-gray-300 transition-colors"
                      placeholder="Descrição (opcional)"
                      value={opc.descricao ?? ''}
                      onChange={(e) => setEditTemplateGrupo(g => g ? {
                        ...g,
                        opcoes: g.opcoes.map((o, i) => i === idx ? { ...o, descricao: e.target.value } : o),
                      } : null)}
                    />
                  </div>
                ))}
                <button
                  onClick={() => setEditTemplateGrupo(g => g ? {
                    ...g,
                    opcoes: [...g.opcoes, { id: `opc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, nome: '', precoAdicional: 0, ativo: true, descricao: '' }],
                  } : null)}
                  className="text-xs text-orange-500 hover:text-orange-600 font-medium flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <i className="ri-add-line" /> Adicionar opção
                </button>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-gray-100">
              <button
                onClick={() => { setEditTemplateId(null); setEditTemplateName(''); setEditTemplateGrupo(null); }}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmEditTemplate}
                disabled={!editTemplateName.trim() || savingTemplate}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
              >
                {savingTemplate && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Grupos de Opções ── */}
      {grupos.map((grp) => (
        <div key={grp.id} className="border border-gray-100 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <input
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
              placeholder="Nome do grupo (ex: Ponto da carne)"
              value={grp.nome}
              onChange={e => onUpdateGrupo(grp.id, { nome: e.target.value })}
            />
            <button
              onClick={() => setSaveTemplateGrupoId(grp.id)}
              title="Salvar como Template"
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-bookmark-line text-sm" />
            </button>
            <button
              onClick={() => onRemoveGrupo(grp.id)}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-delete-bin-line text-sm" />
            </button>
          </div>
          <div className="flex items-center gap-4 mb-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={grp.obrigatorio}
                onChange={e => onUpdateGrupo(grp.id, { obrigatorio: e.target.checked })}
                className="accent-orange-500"
              />
              <span className="text-gray-600">Obrigatório</span>
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-600">Mín</span>
              <input
                type="number"
                min="0"
                className="w-12 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-400"
                value={grp.minSelecao}
                onChange={e => onUpdateGrupo(grp.id, { minSelecao: parseInt(e.target.value, 10) })}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-600">Máx</span>
              <input
                type="number"
                min="1"
                className="w-12 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-orange-400"
                value={grp.maxSelecao}
                onChange={e => onUpdateGrupo(grp.id, { maxSelecao: parseInt(e.target.value, 10) })}
              />
            </div>
          </div>
          <div className="space-y-2">
            {grp.opcoes.map((opc, oi) => (
              <div key={opc.id} className="border border-gray-100 rounded-lg p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => onMoveOpcao(grp.id, opc.id, 'up')}
                      disabled={oi === 0}
                      className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default"
                      title="Mover para cima"
                    >
                      <i className="ri-arrow-up-line text-xs" />
                    </button>
                    <button
                      onClick={() => onMoveOpcao(grp.id, opc.id, 'down')}
                      disabled={oi === grp.opcoes.length - 1}
                      className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default"
                      title="Mover para baixo"
                    >
                      <i className="ri-arrow-down-line text-xs" />
                    </button>
                  </div>
                  <input
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                    placeholder="Nome da opção"
                    value={opc.nome}
                    onChange={e => onUpdateOpcao(grp.id, opc.id, { nome: e.target.value })}
                  />
                  <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <span className="text-gray-400 text-xs">+R$</span>
                    <input
                      type="number"
                      step="0.01"
                      className="w-16 focus:outline-none text-sm"
                      value={opc.precoAdicional}
                      onChange={e => onUpdateOpcao(grp.id, opc.id, { precoAdicional: parseFloat(e.target.value) })}
                    />
                  </div>
                  <button
                    onClick={() => onRemoveOpcao(grp.id, opc.id)}
                    className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 cursor-pointer rounded transition-colors"
                  >
                    <i className="ri-close-line text-sm" />
                  </button>
                </div>

                {/* Descrição da opção */}
                <div className="flex items-center gap-1.5">
                  <i className="ri-file-text-line text-gray-300 text-xs flex-shrink-0" />
                  <input
                    className="flex-1 border border-gray-100 rounded-md px-2.5 py-1.5 text-xs text-gray-500 focus:outline-none focus:border-gray-300 focus:text-gray-700 placeholder-gray-300 transition-colors"
                    placeholder="Descrição (ex: Pão brioche artesanal, Molho especial da casa...)"
                    value={opc.descricao ?? ''}
                    onChange={e => onUpdateOpcao(grp.id, opc.id, { descricao: e.target.value })}
                  />
                  {(opc.descricao && opc.descricao.trim()) && (
                    <button
                      onClick={() => onUpdateOpcao(grp.id, opc.id, { descricao: '' })}
                      className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-gray-500 cursor-pointer rounded transition-colors flex-shrink-0"
                    >
                      <i className="ri-close-line text-xs" />
                    </button>
                  )}
                </div>

                {/* Produto vinculado (2026-10-06) */}
                {opc.linkedItemId && (() => {
                  const prod = produtos.find(p => p.id === opc.linkedItemId);
                  const nIns = fichaPorItem?.get(opc.linkedItemId!) ?? 0;
                  return (
                    <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 flex flex-wrap items-center gap-2">
                      <i className="ri-restaurant-line text-sky-600 text-sm" />
                      <span className="text-xs font-medium text-sky-800 min-w-[90px] flex-1 truncate">
                        Produto: {prod?.nome ?? 'produto removido'}
                      </span>
                      {!prod
                        ? <span className="text-[10px] text-red-500">não encontrei esse produto</span>
                        : fichaPorItem && nIns === 0
                          ? <span className="text-[10px] text-red-500">o produto está sem ficha técnica — nada sai do estoque</span>
                          : fichaPorItem
                            ? <span className="text-[10px] text-sky-700" title="Baixa e custo seguem a ficha técnica atual do produto">ficha atual · {nIns} {nIns === 1 ? 'insumo' : 'insumos'}</span>
                            : null}
                      <button
                        onClick={() => onUpdateOpcao(grp.id, opc.id, { linkedItemId: null })}
                        className="text-[10px] text-sky-600 hover:text-red-500 font-medium cursor-pointer whitespace-nowrap transition-colors"
                      >
                        Remover
                      </button>
                    </div>
                  );
                })()}
                {/* Vínculo com estoque — um ou mais insumos (2026-09-26) */}
                {insumosDaOpcao(opc).length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1.5">
                    {insumosDaOpcao(opc).map(x => {
                      const ins = insumos.find(i => i.id === x.ingredientId);
                      const q = Number(x.quantidade);
                      const custo = ins && q > 0 ? custoLinhaFicha(q, x.unidade || 'un', ins.unidade, ins.precoUnitario) : null;
                      return (
                        <div key={x.ingredientId} className="flex flex-wrap items-center gap-2">
                          <i className={`${x.source === 'production' ? 'ri-flask-line' : 'ri-archive-line'} text-amber-600 text-sm`} />
                          <span className="text-xs font-medium text-amber-800 min-w-[90px] flex-1 truncate">
                            {x.source === 'production' ? 'Produção: ' : ''}{nomeDoInsumo(x)}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            placeholder="?"
                            className={`w-16 border rounded px-1.5 py-0.5 text-[11px] text-amber-800 focus:outline-none focus:border-amber-400 bg-white ${q > 0 ? 'border-amber-200' : 'border-red-400'}`}
                            value={x.quantidade ?? ''}
                            onChange={e => alterarInsumo(grp.id, opc.id, x.ingredientId, { quantidade: e.target.value === '' ? undefined : (parseFloat(e.target.value) || 0) })}
                          />
                          <select
                            value={x.unidade || 'un'}
                            onChange={e => alterarInsumo(grp.id, opc.id, x.ingredientId, { unidade: e.target.value })}
                            className="border border-amber-200 rounded px-1.5 py-0.5 text-[11px] text-amber-800 focus:outline-none focus:border-amber-400 bg-white cursor-pointer"
                          >
                            {ALL_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          {custo === null
                            ? <span className="text-[10px] text-red-500">informe quanto sai</span>
                            : <span className="text-[10px] text-amber-700" title="Quantidade × preço atual do insumo">custo {custo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: custo > 0 && custo < 0.1 ? 4 : 2 })}</span>}
                          <button
                            onClick={() => removerInsumo(grp.id, opc.id, x.ingredientId)}
                            className="text-[10px] text-amber-600 hover:text-red-500 font-medium cursor-pointer whitespace-nowrap transition-colors"
                          >
                            Remover
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={() => {
                    setOpenVinculo(openVinculo === `${grp.id}-${opc.id}` ? null : `${grp.id}-${opc.id}`);
                    setVinculoTab('ingredient');
                    setBuscaInsumo('');
                  }}
                  className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-amber-600 font-medium cursor-pointer transition-colors"
                >
                  <i className={openVinculo === `${grp.id}-${opc.id}` ? 'ri-close-line' : (insumosDaOpcao(opc).length || opc.linkedItemId) ? 'ri-add-line' : 'ri-link-m'} />
                  {openVinculo === `${grp.id}-${opc.id}` ? 'Fechar' : (insumosDaOpcao(opc).length || opc.linkedItemId) ? 'Adicionar outro insumo ou produto' : 'Vincular ao estoque'}
                </button>

                {/* Painel de seleção de insumo/produção */}
                {openVinculo === `${grp.id}-${opc.id}` && (
                  <div className="border border-amber-200 rounded-xl p-3 bg-amber-50/40 space-y-2">
                    <div className="flex items-center gap-1 bg-white rounded-lg p-1 border border-gray-100">
                      <button
                        onClick={() => setVinculoTab('ingredient')}
                        className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${vinculoTab === 'ingredient' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                      >
                        Insumos
                      </button>
                      <button
                        onClick={() => setVinculoTab('production')}
                        className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${vinculoTab === 'production' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                      >
                        Produção
                      </button>
                      <button
                        onClick={() => setVinculoTab('product')}
                        className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${vinculoTab === 'product' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                      >
                        Produtos
                      </button>
                    </div>
                    <div className="relative">
                      <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs" />
                      <input
                        autoFocus
                        className="w-full pl-7 pr-3 py-1.5 border border-zinc-200 rounded-lg text-xs focus:outline-none focus:border-amber-400 bg-white"
                        placeholder="Buscar..."
                        value={buscaInsumo}
                        onChange={e => setBuscaInsumo(e.target.value)}
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                      {vinculoTab === 'product' ? (
                        (() => {
                          const lista = produtos
                            .filter(p => p.id !== itemId && semAcento(p.nome).includes(semAcento(buscaInsumo)))
                            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
                          if (lista.length === 0) return <p className="text-xs text-zinc-400 text-center py-2">Nenhum produto encontrado</p>;
                          return lista.map(p => (
                            <button
                              key={p.id}
                              onClick={() => vincularProduto(grp.id, opc.id, p)}
                              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs rounded-lg hover:bg-white cursor-pointer transition-colors text-left"
                            >
                              <span className="text-zinc-700 font-medium truncate">{p.nome}</span>
                              <span className="text-[10px] text-zinc-400 whitespace-nowrap">
                                {!fichaPorItem ? '' : (fichaPorItem.get(p.id) ?? 0) > 0 ? `${fichaPorItem.get(p.id)} na ficha` : 'sem ficha'}
                              </span>
                            </button>
                          ));
                        })()
                      ) : vinculoTab === 'ingredient' ? (
                        insumosUsoFinal.filter(ins =>
                          semAcento(ins.nome).includes(semAcento(buscaInsumo))
                        ).length === 0 ? (
                          <p className="text-xs text-zinc-400 text-center py-2">
                            {insumos.length === 0 ? 'Nenhum insumo cadastrado' : 'Nenhum insumo encontrado'}
                          </p>
                        ) : (
                          insumosUsoFinal.filter(ins =>
                            semAcento(ins.nome).includes(semAcento(buscaInsumo))
                          ).map(ins => (
                            <button
                              key={ins.id}
                              onClick={() => vincularInsumo(grp.id, opc.id, ins)}
                              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg hover:bg-white cursor-pointer transition-colors text-left"
                            >
                              <span className="text-zinc-700 font-medium">{ins.nome}</span>
                              <span className="text-[10px] text-zinc-400">
                                {ins.precoUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/{ins.unidade}
                              </span>
                            </button>
                          ))
                        )
                      ) : (
                        recipes.filter(r =>
                          r.outputIngredientId &&
                          semAcento(r.name).includes(semAcento(buscaInsumo))
                        ).length === 0 ? (
                          <p className="text-xs text-zinc-400 text-center py-2">
                            {recipes.length === 0 ? 'Nenhuma produção cadastrada' : 'Nenhum produto encontrado'}
                          </p>
                        ) : (
                          recipes.filter(r =>
                            r.outputIngredientId &&
                            semAcento(r.name).includes(semAcento(buscaInsumo))
                          ).map(recipe => {
                            const unitCost = getRecipeUnitCost(recipe.id);
                            return (
                              <button
                                key={recipe.id}
                                onClick={() => vincularProducao(grp.id, opc.id, recipe)}
                                className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg hover:bg-white cursor-pointer transition-colors text-left"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded">PROD</span>
                                  <span className="text-zinc-700 font-medium">{recipe.name}</span>
                                </div>
                                <span className="text-[10px] text-zinc-400">
                                  {unitCost > 0
                                    ? `${unitCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/${recipe.unit}`
                                    : `Sem custo · ${recipe.unit}`}
                                </span>
                              </button>
                            );
                          })
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => onAddOpcao(grp.id)}
            className="mt-2 text-xs text-orange-500 hover:text-orange-600 font-medium flex items-center gap-1 cursor-pointer transition-colors"
          >
            <i className="ri-add-line" /> Adicionar opção
          </button>
        </div>
      ))}
      <button
        onClick={onAddGrupo}
        className="w-full border-2 border-dashed border-gray-200 hover:border-orange-300 hover:bg-orange-50 text-gray-500 hover:text-orange-500 text-sm font-medium py-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
      >
        <i className="ri-add-line" /> Novo Grupo de Opções
      </button>
    </div>
  );
}