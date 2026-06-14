import { useOptionGroupTemplates, type OptionGroupTemplate } from '@/hooks/useOptionGroupTemplates';
import { useState, useEffect, useRef } from 'react';
import type {
  Item, GrupoOpcoes, OpcaoItem, PromocaoItem, FichaTecnicaItem, SubproducaoItem, ConfiguracaoDelivery,
  Categoria, ObservacaoGlobal,
} from '@/types/cardapio';
const mockDiasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
import type { EstacaoCozinha } from '../../../contexts/CardapioContext';
import FichaTecnicaTab from './FichaTecnicaTab';
import DeliveryTab from './DeliveryTab';
import ItemImage from '@/components/base/ItemImage';
import { uploadMenuImage } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useProducao } from '@/contexts/ProducaoContext';
import type { Insumo } from '@/contexts/EstoqueContext';
import type { ProductionRecipe } from '@/types/estoque';

// ── Unidades suportadas ────────────────────────────────────────────────────
const ALL_UNITS = ['g', 'kg', 'ml', 'l', 'un'];

interface Props {
  item?: Item;
  categorias: Categoria[];
  obsGlobais: ObservacaoGlobal[];
  estacoes: EstacaoCozinha[];
  saving?: boolean;
  onSave: (item: Item) => void;
  onClose: () => void;
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

type TabLocal = 'info' | 'producao' | 'opcoes' | 'promocoes' | 'observacoes' | 'ficha' | 'delivery';

export default function ItemModal({ item, categorias, obsGlobais, estacoes, saving, onSave, onClose }: Props) {
  const { user } = useAuth();
  const { insumos } = useEstoque();
  const { recipes, getBatchesByRecipeId } = useProducao();
  const estacoesNomes = estacoes.map(e => e.nome);
  const [tab, setTab] = useState<TabLocal>('info');
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
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
    setTab('info');
    setNovaObs('');
    setUploadError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item ? JSON.stringify({ id: item.id, subproducao: item.subproducao, nome: item.nome, descricao: item.descricao, preco: item.preco, categoriaId: item.categoriaId, slaMinutos: item.slaMinutos, fotoUrl: item.fotoUrl, status: item.status, semPreparo: item.semPreparo, somenteDelivery: item.somenteDelivery, gruposOpcoes: item.gruposOpcoes, promocoes: item.promocoes, observacoesPadrao: item.observacoesPadrao, fichaTecnica: item.fichaTecnica, delivery: item.delivery }) : 'undefined', categorias]);

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

  const tabs: { id: TabLocal; label: string; icon: string }[] = [
    { id: 'info', label: 'Informações', icon: 'ri-information-line' },
    {
      id: 'producao',
      label: semPreparo ? 'Produção (direta)' : producaoDividida ? `Produção (${subproducao.length})` : 'Produção',
      icon: 'ri-tools-line',
    },
    { id: 'opcoes', label: `Opções (${grupos.length})`, icon: 'ri-list-check-2' },
    { id: 'promocoes', label: `Promoções (${promocoes.length})`, icon: 'ri-price-tag-3-line' },
    { id: 'observacoes', label: `Obs (${obs.length})`, icon: 'ri-chat-3-line' },
    { id: 'ficha', label: `Ficha Técnica (${fichasCount})`, icon: 'ri-test-tube-line' },
    {
      id: 'delivery',
      label: deliveryConfig?.ativo ? 'Delivery Próprio ✓' : 'Delivery Próprio',
      icon: 'ri-e-bike-2-line',
    },
  ];

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

  const handleSave = () => {
    if (!nome.trim() || !preco) return;
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
    };
    onSave(saved);
  };

  const estacoesUsadas = subproducao.map(s => s.estacao);
  const hasDuplicateEstacao = estacoesUsadas.length !== new Set(estacoesUsadas).size;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-base font-semibold text-gray-800">
            {item ? 'Editar Item' : 'Novo Item'}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5 flex-shrink-0 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap -mb-px ${
                tab === t.id ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <i className={`${t.icon} text-sm`} />
              {t.label}
              {t.id === 'producao' && semPreparo && (
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 ml-0.5" />
              )}
              {t.id === 'producao' && !semPreparo && producaoDividida && (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 ml-0.5" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── INFO ── */}
          {tab === 'info' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Nome do Item *</label>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors"
                    placeholder="Ex: X-Burguer Clássico"
                    value={nome}
                    onChange={e => setNome(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Preço (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors"
                    placeholder="0,00"
                    value={preco}
                    onChange={e => setPreco(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    SLA (minutos)
                    {semPreparo && (
                      <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 bg-teal-50 text-teal-600 rounded-full border border-teal-100">
                        Entrega Direta
                      </span>
                    )}
                    {slaCalculado !== null && !semPreparo && (
                      <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded-full border border-orange-100">
                        Calculado automaticamente
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    className={`w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none transition-colors ${(slaCalculado !== null || semPreparo) ? 'bg-gray-50 text-gray-400 cursor-default' : 'focus:border-orange-400'}`}
                    placeholder="10"
                    value={semPreparo ? 0 : slaCalculado !== null ? slaCalculado : sla}
                    readOnly={slaCalculado !== null || semPreparo}
                    onChange={e => { if (slaCalculado === null && !semPreparo) setSla(e.target.value); }}
                  />
                  {semPreparo && (
                    <p className="text-[10px] text-teal-500 mt-1">Sem preparo — entregue diretamente</p>
                  )}
                  {slaCalculado !== null && !semPreparo && (
                    <p className="text-[10px] text-gray-400 mt-1">
                      Soma: {subproducao.map(s => `${s.slaMinutos}min`).join(' + ')} = {slaCalculado}min
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Categoria</label>
                  <select
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors cursor-pointer"
                    value={categoriaId}
                    onChange={e => setCategoriaId(e.target.value)}
                  >
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Status</label>
                  <select
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors cursor-pointer"
                    value={status}
                    onChange={e => setStatus(e.target.value as 'ativo' | 'inativo')}
                  >
                    <option value="ativo">Ativo</option>
                    <option value="inativo">Inativo</option>
                  </select>
                </div>

                {/* Somente Delivery */}
                <div className="col-span-2">
                  <div
                    onClick={() => setSomenteDelivery(v => !v)}
                    className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-colors select-none ${
                      somenteDelivery
                        ? 'bg-orange-50 border-orange-200'
                        : 'bg-zinc-50 border-zinc-200 hover:border-zinc-300'
                    }`}
                  >
                    <div className="w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: somenteDelivery ? '#fff7ed' : '#f4f4f5' }}>
                      <i className="ri-e-bike-2-line text-lg" style={{ color: somenteDelivery ? '#f97316' : '#a1a1aa' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-800">Exclusivo PDV Delivery (iFood, 99, etc.)</p>
                        {somenteDelivery && (
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-orange-100 text-orange-700 border border-orange-200 rounded-full whitespace-nowrap">
                            ATIVO
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {somenteDelivery
                          ? 'Este item aparece apenas no PDV Delivery (apps de entrega) — não fica visível no caixa, garçom ou autoatendimento.'
                          : 'Ative para que este item apareça somente no PDV Delivery (apps como iFood, 99), ocultando-o dos demais canais.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setSomenteDelivery(v => !v); }}
                      className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer ${
                        somenteDelivery ? 'bg-orange-500' : 'bg-gray-200'
                      }`}
                    >
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
                        somenteDelivery ? 'left-6' : 'left-1'
                      }`} />
                    </button>
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Descrição</label>
                  <textarea
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors resize-none"
                    rows={3}
                    placeholder="Descreva os ingredientes e características do item..."
                    value={descricao}
                    onChange={e => setDescricao(e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Foto</label>
                  <div className="flex items-start gap-3">
                    <div className="w-20 h-20 rounded-xl overflow-hidden border border-gray-100 flex-shrink-0">
                      <ItemImage src={fotoUrl} alt={nome || 'Novo Item'} className="w-full h-full" />
                    </div>
                    <div className="flex-1 space-y-2">
                      <input
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors"
                        placeholder="https://... (cole uma URL)"
                        value={fotoUrl.startsWith('data:') ? '' : fotoUrl}
                        onChange={e => setFotoUrl(e.target.value)}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => !uploadingFoto && fotoInputRef.current?.click()}
                          disabled={uploadingFoto}
                          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {uploadingFoto ? (
                            <>
                              <span className="w-3.5 h-3.5 border-2 border-gray-400/30 border-t-gray-500 rounded-full animate-spin" />
                              Enviando...
                            </>
                          ) : (
                            <>
                              <i className="ri-upload-2-line text-sm" />
                              Anexar do computador
                            </>
                          )}
                        </button>
                        {fotoUrl && !uploadingFoto && (
                          <button
                            type="button"
                            onClick={() => setFotoUrl('')}
                            className="text-xs text-red-400 hover:text-red-600 cursor-pointer font-medium"
                          >
                            Remover foto
                          </button>
                        )}
                      </div>
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
              </div>
            </div>
          )}

          {/* ── PRODUÇÃO ── */}
          {tab === 'producao' && (
            <div className="space-y-5">

              {/* ── Entrega Direta toggle ── */}
              <div className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${semPreparo ? 'bg-teal-50 border-teal-200' : 'bg-zinc-50 border-zinc-200'}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-gray-800">Entrega Direta — sem preparo</p>
                    {semPreparo && (
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-teal-100 text-teal-700 border border-teal-200 rounded-full">
                        ATIVO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Ative para itens que <strong>não precisam de preparo na cozinha</strong>. Ao chegar no KDS, o item pula direto para <strong>Pronto</strong>, aguardando apenas a entrega.
                  </p>
                  <p className="text-xs text-teal-600 mt-1.5 font-medium">
                    Ex: Refrigerante, Água Mineral, Bebidas embaladas, Itens pré-prontos.
                  </p>
                </div>
                <button
                  onClick={() => handleToggleSemPreparo(!semPreparo)}
                  className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer mt-0.5 ${semPreparo ? 'bg-teal-500' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${semPreparo ? 'left-6' : 'left-1'}`} />
                </button>
              </div>

              {/* Info quando entrega direta ativa */}
              {semPreparo && (
                <div className="flex items-start gap-2.5 p-3 bg-teal-50 border border-teal-100 rounded-xl">
                  <i className="ri-arrow-right-circle-line text-teal-500 text-base flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-teal-700 mb-1">Como funciona no KDS:</p>
                    <ul className="space-y-0.5 text-xs text-teal-600">
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
                <div className="flex items-start gap-4 p-4 bg-orange-50 rounded-xl border border-orange-100">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-800">Produção dividida em múltiplas estações</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Ative quando este item exige produção em mais de uma estação da cozinha.
                      O item só fica pronto quando <strong>todas as partes</strong> estiverem concluídas.
                    </p>
                    <p className="text-xs text-orange-600 mt-1.5 font-medium">
                      Ex: Hambúrguer (Grelha) + Batata inclusa (Frituras) — cada estação vê e controla sua parte.
                    </p>
                    {semPreparo && (
                      <p className="text-xs text-gray-400 mt-1 italic">Indisponível quando &quot;Entrega Direta&quot; está ativo.</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggleProducaoDividida(!producaoDividida)}
                    className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer mt-0.5 ${producaoDividida ? 'bg-orange-500' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${producaoDividida ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                {producaoDividida && (
                  <div className="space-y-3 mt-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-gray-700">Partes da Produção</h4>
                      {hasDuplicateEstacao && (
                        <span className="text-xs text-amber-600 flex items-center gap-1">
                          <i className="ri-alert-line" />
                          Estação duplicada
                        </span>
                      )}
                    </div>

                    {subproducao.map((parte, idx) => (
                      <div key={parte.id} className="border border-gray-200 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                            Parte {idx + 1}
                          </span>
                          <button
                            onClick={() => removeSubParte(parte.id)}
                            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg cursor-pointer transition-colors"
                          >
                            <i className="ri-delete-bin-line text-sm" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">Nome da Parte *</label>
                            <input
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition-colors"
                              placeholder="Ex: Hambúrguer, Batata Frita, Molho..."
                              value={parte.nome}
                              onChange={e => updateSubParte(parte.id, { nome: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">Estação *</label>
                            <select
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition-colors cursor-pointer"
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
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">SLA desta parte (min)</label>
                            <input
                              type="number"
                              min="1"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition-colors"
                              value={parte.slaMinutos}
                              onChange={e => updateSubParte(parte.id, { slaMinutos: parseInt(e.target.value, 10) || 1 })}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 flex items-center justify-center">
                            <i className="ri-map-pin-2-line text-orange-500 text-sm" />
                          </div>
                          <span className="text-xs text-gray-500">
                            Aparecerá no KDS da estação{' '}
                            <strong className="text-orange-600">{parte.estacao || '—'}</strong>
                            {parte.slaMinutos > 0 && (
                              <> com SLA de <strong>{parte.slaMinutos} min</strong></>
                            )}
                          </span>
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={addSubParte}
                      className="w-full border-2 border-dashed border-gray-200 hover:border-orange-300 hover:bg-orange-50 text-gray-500 hover:text-orange-500 text-sm font-medium py-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <i className="ri-add-line" /> Adicionar Parte
                    </button>

                    {subproducao.length >= 2 && (
                      <div className="bg-gray-50 rounded-xl p-3 flex items-start gap-2">
                        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <i className="ri-information-line text-sm text-gray-400" />
                        </div>
                        <div>
                          <p className="text-xs text-gray-600 font-medium">Como funciona no KDS:</p>
                          <ul className="mt-1 space-y-0.5">
                            {subproducao.map((p, i) => (
                              <li key={p.id} className="text-xs text-gray-500 flex items-center gap-1.5">
                                <span className="w-4 h-4 rounded-full bg-orange-100 text-orange-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                                Estação <strong>{p.estacao || '—'}</strong> vê e controla &quot;{p.nome || 'sem nome'}&quot;
                              </li>
                            ))}
                            <li className="text-xs text-orange-600 font-medium flex items-center gap-1.5 mt-1">
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
                  <div className="text-center py-8">
                    <div className="w-12 h-12 flex items-center justify-center mx-auto bg-gray-100 rounded-xl mb-3">
                      <i className="ri-tools-line text-2xl text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-500">Produção simples — uma única estação</p>
                    <p className="text-xs text-gray-400 mt-1">
                      A estação usada é a da categoria do item.<br />
                      Ative a produção dividida se este item precisar de múltiplas estações.
                    </p>
                  </div>
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
              getBatchesByRecipeId={getBatchesByRecipeId}
              onAddGrupo={addGrupo}
              onAddGrupoCompleto={addGrupoCompleto}
              onRemoveGrupo={removeGrupo}
              onUpdateGrupo={updateGrupo}
              onAddOpcao={addOpcao}
              onRemoveOpcao={removeOpcao}
              onUpdateOpcao={updateOpcao}
              onMoveOpcao={moverOpcao}
            />
          )}

          {/* ── PROMOÇÕES ── */}
          {tab === 'promocoes' && (
            <div className="space-y-4">
              {promocoes.map(promo => (
                <div key={promo.id} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <select
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400 cursor-pointer"
                        value={promo.tipo}
                        onChange={e => updatePromocao(promo.id, { tipo: e.target.value as 'semanal' | 'pontual' })}
                      >
                        <option value="semanal">Semanal</option>
                        <option value="pontual">Pontual</option>
                      </select>
                      <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                        <span className="text-gray-400 text-xs">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          className="w-20 focus:outline-none text-sm"
                          placeholder="Preço promo"
                          value={promo.precoPromocional || ''}
                          onChange={e => updatePromocao(promo.id, { precoPromocional: parseFloat(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updatePromocao(promo.id, { ativo: !promo.ativo })}
                        className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${promo.ativo ? 'bg-orange-500' : 'bg-gray-200'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${promo.ativo ? 'left-4' : 'left-0.5'}`} />
                      </button>
                      <button
                        onClick={() => removePromocao(promo.id)}
                        className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 cursor-pointer rounded transition-colors"
                      >
                        <i className="ri-delete-bin-line text-sm" />
                      </button>
                    </div>
                  </div>
                  {promo.tipo === 'semanal' ? (
                    <div className="flex gap-1.5 flex-wrap">
                      {mockDiasSemana.map((dia, idx) => (
                        <button
                          key={idx}
                          onClick={() => toggleDia(promo.id, idx)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-full cursor-pointer transition-colors whitespace-nowrap ${
                            promo.diasSemana.includes(idx) ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          {dia}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs text-gray-500 mb-1.5 block">Data específica</label>
                      <input
                        type="date"
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                        value={promo.dataEspecifica ?? ''}
                        onChange={e => updatePromocao(promo.id, { dataEspecifica: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={addPromocao}
                className="w-full border-2 border-dashed border-gray-200 hover:border-orange-300 hover:bg-orange-50 text-gray-500 hover:text-orange-500 text-sm font-medium py-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <i className="ri-add-line" /> Nova Promoção
              </button>
            </div>
          )}

          {/* ── OBSERVAÇÕES ── */}
          {tab === 'observacoes' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">Observações deste item</p>
                <p className="text-xs text-gray-500 mb-2">Aparecem como opção exclusiva ao lançar este item</p>
                <div className="flex gap-2 mb-3">
                  <input
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                    placeholder="Ex: Sem cebola, Pão sem glúten..."
                    value={novaObs}
                    onChange={e => setNovaObs(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addObs()}
                  />
                  <button
                    onClick={addObs}
                    className="bg-orange-500 hover:bg-orange-600 text-white px-4 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Adicionar
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {obs.length === 0 && (
                    <p className="text-xs text-gray-400 italic">Nenhuma obs. específica cadastrada</p>
                  )}
                  {obs.map((o, i) => (
                    <span key={i} className="flex items-center gap-1.5 bg-orange-50 text-orange-700 text-xs px-3 py-1.5 rounded-full">
                      {o}
                      <button
                        onClick={() => setObs(arr => arr.filter((_, j) => j !== i))}
                        className="hover:text-red-500 cursor-pointer transition-colors"
                      >
                        <i className="ri-close-line" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs font-semibold text-gray-700">Observações Globais</p>
                  <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium">Aparecem em todos os itens</span>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  Gerenciadas na aba <strong>Obs. Globais</strong> do cardápio. Aparecem automaticamente como opção neste e em todos os outros itens.
                </p>
                <div className="flex flex-wrap gap-2">
                  {obsGlobais.filter(o => o.ativo).map(o => (
                    <span key={o.id} className="flex items-center gap-1.5 bg-gray-100 text-gray-600 text-xs px-3 py-1.5 rounded-full">
                      <i className="ri-global-line text-gray-400" />
                      {o.texto}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── FICHA TÉCNICA ── */}
          {tab === 'ficha' && (
            <FichaTecnicaTab
              itemId={item?.id}
              precoVenda={parseFloat(preco) || 0}
              onCountChange={setFichasCount}
            />
          )}

          {/* ── DELIVERY ── */}
          {tab === 'delivery' && (
            <DeliveryTab
              config={deliveryConfig}
              precoBase={parseFloat(preco) || 0}
              slaBase={parseInt(sla, 10) || 10}
              descricaoBase={descricao}
              onChange={setDeliveryConfig}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!nome.trim() || !preco || saving}
            className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {saving ? 'Salvando...' : item ? 'Salvar Alterações' : 'Criar Item'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-componente da aba Opções (para não poluir o principal) ──────────────

interface OpcoesTabProps {
  grupos: GrupoOpcoes[];
  insumos: Insumo[];
  recipes: ProductionRecipe[];
  getBatchesByRecipeId: (recipeId: string) => Array<{ unitCost: number }>;
  onAddGrupo: () => void;
  onAddGrupoCompleto?: (grupo: GrupoOpcoes) => void;
  onRemoveGrupo: (id: string) => void;
  onUpdateGrupo: (id: string, patch: Partial<GrupoOpcoes>) => void;
  onAddOpcao: (grupoId: string) => void;
  onRemoveOpcao: (grupoId: string, opcId: string) => void;
  onUpdateOpcao: (grupoId: string, opcId: string, patch: Partial<OpcaoItem>) => void;
  onMoveOpcao: (grupoId: string, opcId: string, direction: 'up' | 'down') => void;
}

function OpcoesTab({
  grupos, insumos, recipes, getBatchesByRecipeId,
  onAddGrupo, onAddGrupoCompleto, onRemoveGrupo, onUpdateGrupo,
  onAddOpcao, onRemoveOpcao, onUpdateOpcao, onMoveOpcao,
}: OpcoesTabProps) {
  const [openVinculo, setOpenVinculo] = useState<string | null>(null);
  const [vinculoTab, setVinculoTab] = useState<'ingredient' | 'production'>('ingredient');
  const [buscaInsumo, setBuscaInsumo] = useState('');
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

  const vincularInsumo = (grupoId: string, opcId: string, insumo: Insumo) => {
    onUpdateOpcao(grupoId, opcId, {
      ingredientId: insumo.id,
      ingredientName: insumo.nome,
      productionRecipeId: null,
      consumptionQuantity: 1,
      consumptionUnit: insumo.unidade,
      source: 'ingredient',
    });
    setOpenVinculo(null);
    setBuscaInsumo('');
  };

  const vincularProducao = (grupoId: string, opcId: string, recipe: ProductionRecipe) => {
    if (!recipe.outputIngredientId) return;
    onUpdateOpcao(grupoId, opcId, {
      ingredientId: recipe.outputIngredientId,
      ingredientName: recipe.name,
      productionRecipeId: recipe.id,
      consumptionQuantity: 1,
      consumptionUnit: recipe.unit,
      source: 'production',
    });
    setOpenVinculo(null);
    setBuscaInsumo('');
  };

  const removerVinculo = (grupoId: string, opcId: string) => {
    onUpdateOpcao(grupoId, opcId, {
      ingredientId: null,
      ingredientName: undefined,
      productionRecipeId: null,
      consumptionQuantity: undefined,
      consumptionUnit: undefined,
      source: undefined,
    });
  };

  return (
    <div className="space-y-4">
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

                {/* Vínculo com estoque */}
                {opc.ingredientId ? (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                      {opc.source === 'production' ? (
                        <i className="ri-flask-line text-amber-600 text-sm" />
                      ) : (
                        <i className="ri-archive-line text-amber-600 text-sm" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-amber-800 truncate">
                        {opc.source === 'production' ? 'Produção: ' : 'Insumo: '}
                        {opc.ingredientName || opc.nome}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-amber-600">Consumo:</span>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="w-16 border border-amber-200 rounded px-1.5 py-0.5 text-[11px] text-amber-800 focus:outline-none focus:border-amber-400 bg-white"
                          value={opc.consumptionQuantity ?? 1}
                          onChange={e => onUpdateOpcao(grp.id, opc.id, { consumptionQuantity: parseFloat(e.target.value) || 0 })}
                        />
                        <select
                          value={opc.consumptionUnit || 'un'}
                          onChange={e => onUpdateOpcao(grp.id, opc.id, { consumptionUnit: e.target.value })}
                          className="border border-amber-200 rounded px-1.5 py-0.5 text-[11px] text-amber-800 focus:outline-none focus:border-amber-400 bg-white cursor-pointer"
                        >
                          {ALL_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={() => removerVinculo(grp.id, opc.id)}
                      className="text-[10px] text-amber-600 hover:text-red-500 font-medium cursor-pointer whitespace-nowrap transition-colors"
                    >
                      Remover
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setOpenVinculo(openVinculo === `${grp.id}-${opc.id}` ? null : `${grp.id}-${opc.id}`);
                      setVinculoTab('ingredient');
                      setBuscaInsumo('');
                    }}
                    className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-amber-600 font-medium cursor-pointer transition-colors"
                  >
                    <i className="ri-link-m" />
                    {openVinculo === `${grp.id}-${opc.id}` ? 'Fechar vínculo' : 'Vincular ao estoque'}
                  </button>
                )}

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
                      {vinculoTab === 'ingredient' ? (
                        insumos.filter(ins =>
                          ins.nome.toLowerCase().includes(buscaInsumo.toLowerCase())
                        ).length === 0 ? (
                          <p className="text-xs text-zinc-400 text-center py-2">
                            {insumos.length === 0 ? 'Nenhum insumo cadastrado' : 'Nenhum insumo encontrado'}
                          </p>
                        ) : (
                          insumos.filter(ins =>
                            ins.nome.toLowerCase().includes(buscaInsumo.toLowerCase())
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
                          r.name.toLowerCase().includes(buscaInsumo.toLowerCase())
                        ).length === 0 ? (
                          <p className="text-xs text-zinc-400 text-center py-2">
                            {recipes.length === 0 ? 'Nenhuma produção cadastrada' : 'Nenhum produto encontrado'}
                          </p>
                        ) : (
                          recipes.filter(r =>
                            r.outputIngredientId &&
                            r.name.toLowerCase().includes(buscaInsumo.toLowerCase())
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