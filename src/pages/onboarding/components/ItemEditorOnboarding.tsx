import { useState, useEffect, useRef } from 'react';
import type { GrupoOpcoes, OpcaoItem, PromocaoItem, SubproducaoItem } from '@/types/cardapio';
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
import type { CategoriaOnboarding, ItemOnboarding } from './StepCardapio';
import type { EstacaoOnboarding } from './StepEstacao';
import ItemImage from '../../../components/base/ItemImage';

interface ItemEditorOnboardingProps {
  item?: ItemOnboarding;
  categorias: CategoriaOnboarding[];
  estacoes: EstacaoOnboarding[];
  onSave: (item: ItemOnboarding) => void;
  onClose: () => void;
}

type TabEditor = 'info' | 'producao' | 'opcoes' | 'promocoes' | 'obs';

const novoGrupo = (): GrupoOpcoes => ({
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
});

const novaPromocao = (): PromocaoItem => ({
  id: `promo-${Date.now()}`,
  precoPromocional: 0,
  tipo: 'semanal',
  diasSemana: [],
  ativo: true,
});

export default function ItemEditorOnboarding({ item, categorias, estacoes, onSave, onClose }: ItemEditorOnboardingProps) {
  const [tab, setTab] = useState<TabEditor>('info');
  const [nome, setNome] = useState(item?.nome ?? '');
  const [preco, setPreco] = useState(item?.preco ?? '');
  const [descricao, setDescricao] = useState(item?.descricao ?? '');
  const [slaMinutos, setSlaMinutos] = useState(String(item?.slaMinutos ?? 10));
  const [fotoUrl, setFotoUrl] = useState(item?.fotoUrl ?? '');
  const [status, setStatus] = useState<'ativo' | 'inativo'>(item?.status ?? 'ativo');
  const [categoriaId, setCategoriaId] = useState(item?.categoriaId ?? (categorias[0]?.id ?? ''));

  const [producaoDividida, setProducaoDividida] = useState(item?.producaoDividida ?? false);
  const [subproducao, setSubproducao] = useState<SubproducaoItem[]>(item?.subproducao ?? []);

  const [grupos, setGrupos] = useState<GrupoOpcoes[]>(item?.gruposOpcoes ?? []);
  const [promocoes, setPromocoes] = useState<PromocaoItem[]>(item?.promocoes ?? []);
  const [obs, setObs] = useState<string[]>(item?.observacoesPadrao ?? []);
  const [novaObs, setNovaObs] = useState('');
  const fotoInputRef = useRef<HTMLInputElement>(null);

  // Quando produção dividida ativa, SLA = soma das partes
  const slaCalculado = producaoDividida && subproducao.length > 0
    ? subproducao.reduce((acc, s) => acc + (s.slaMinutos || 0), 0)
    : null;

  useEffect(() => {
    if (slaCalculado !== null) setSlaMinutos(String(slaCalculado));
  }, [slaCalculado]);

  const estacoesNomes = estacoes.map((e) => e.nome);

  const novaSubParte = (): SubproducaoItem => ({
    id: `sp-${Date.now()}`,
    nome: '',
    estacao: estacoesNomes[0] ?? '',
    slaMinutos: 10,
  });

  const handleFotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) setFotoUrl(ev.target.result as string);
    };
    reader.readAsDataURL(file);
  };

  /* ── grupos ── */
  const addGrupo = () => setGrupos((g) => [...g, novoGrupo()]);
  const removeGrupo = (id: string) => setGrupos((g) => g.filter((x) => x.id !== id));
  const updateGrupo = (id: string, patch: Partial<GrupoOpcoes>) =>
    setGrupos((g) => g.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addOpcaoGrupo = (grupoId: string) =>
    setGrupos((g) =>
      g.map((x) => (x.id === grupoId ? { ...x, opcoes: [...x.opcoes, novaOpcao()] } : x))
    );
  const removeOpcaoGrupo = (grupoId: string, opcId: string) =>
    setGrupos((g) =>
      g.map((x) => (x.id === grupoId ? { ...x, opcoes: x.opcoes.filter((o) => o.id !== opcId) } : x))
    );
  const updateOpcaoGrupo = (grupoId: string, opcId: string, patch: Partial<OpcaoItem>) =>
    setGrupos((g) =>
      g.map((x) =>
        x.id === grupoId ? { ...x, opcoes: x.opcoes.map((o) => (o.id === opcId ? { ...o, ...patch } : o)) } : x
      )
    );

  /* ── promoções ── */
  const addPromocao = () => setPromocoes((p) => [...p, novaPromocao()]);
  const removePromocao = (id: string) => setPromocoes((p) => p.filter((x) => x.id !== id));
  const updatePromocao = (id: string, patch: Partial<PromocaoItem>) =>
    setPromocoes((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const toggleDia = (promoId: string, dia: number) =>
    setPromocoes((p) =>
      p.map((x) => {
        if (x.id !== promoId) return x;
        const dias = x.diasSemana.includes(dia) ? x.diasSemana.filter((d) => d !== dia) : [...x.diasSemana, dia];
        return { ...x, diasSemana: dias };
      })
    );

  /* ── subprodução ── */
  const addSubParte = () => setSubproducao((s) => [...s, novaSubParte()]);
  const removeSubParte = (id: string) => setSubproducao((s) => s.filter((x) => x.id !== id));
  const updateSubParte = (id: string, patch: Partial<SubproducaoItem>) =>
    setSubproducao((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const handleToggleProducaoDividida = (val: boolean) => {
    setProducaoDividida(val);
    if (!val) setSubproducao([]);
    else if (subproducao.length === 0) setSubproducao([novaSubParte()]);
  };

  const addObs = () => {
    if (!novaObs.trim()) return;
    setObs((o) => [...o, novaObs.trim()]);
    setNovaObs('');
  };

  const handleSave = () => {
    if (!nome.trim() || !preco) return;
    const saved: ItemOnboarding = {
      id: item?.id ?? `item-ob-${Date.now()}`,
      nome,
      preco,
      categoriaId,
      descricao,
      slaMinutos: parseInt(slaMinutos, 10) || 10,
      fotoUrl,
      status,
      gruposOpcoes: grupos,
      promocoes,
      observacoesPadrao: obs,
      producaoDividida,
      subproducao: producaoDividida ? subproducao : [],
    };
    onSave(saved);
  };

  const tabs: { id: TabEditor; label: string; icon: string; badge?: number }[] = [
    { id: 'info', label: 'Info', icon: 'ri-information-line' },
    { id: 'producao', label: 'Produção', icon: 'ri-tools-line' },
    { id: 'opcoes', label: 'Opções', icon: 'ri-list-check-2', badge: grupos.length },
    { id: 'promocoes', label: 'Promoções', icon: 'ri-price-tag-3-line', badge: promocoes.length },
    { id: 'obs', label: 'Obs.', icon: 'ri-chat-3-line', badge: obs.length },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 flex-shrink-0">
          <h3 className="text-base font-bold text-zinc-900">
            {item ? 'Editar item' : 'Novo item'}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg cursor-pointer"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-100 px-4 flex-shrink-0 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap -mb-px ${
                tab === t.id
                  ? 'border-amber-500 text-amber-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}
            >
              <i className={`${t.icon} text-sm`} />
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {t.badge}
                </span>
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
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nome do item *</label>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Ex: X-Burguer Clássico"
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Preço (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={preco}
                    onChange={(e) => setPreco(e.target.value)}
                    placeholder="0,00"
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                    SLA (minutos)
                    {slaCalculado !== null && (
                      <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full border border-amber-100">
                        Calculado automaticamente
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={slaCalculado !== null ? slaCalculado : slaMinutos}
                    onChange={(e) => { if (slaCalculado === null) setSlaMinutos(e.target.value); }}
                    readOnly={slaCalculado !== null}
                    placeholder="10"
                    className={`w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none text-zinc-800 ${slaCalculado !== null ? 'bg-zinc-50 text-zinc-400 cursor-default' : 'focus:border-amber-400'}`}
                  />
                  {slaCalculado !== null && (
                    <p className="text-[10px] text-zinc-400 mt-1">
                      Soma dos SLAs das estações: {subproducao.map((s) => `${s.slaMinutos}min`).join(' + ')} = {slaCalculado}min
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Categoria</label>
                  <select
                    value={categoriaId}
                    onChange={(e) => setCategoriaId(e.target.value)}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 cursor-pointer text-zinc-800"
                  >
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'ativo' | 'inativo')}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 cursor-pointer text-zinc-800"
                  >
                    <option value="ativo">Ativo</option>
                    <option value="inativo">Inativo</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Descrição</label>
                  <textarea
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    rows={3}
                    placeholder="Ingredientes e características do item..."
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 resize-none text-zinc-800"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Foto (opcional)</label>
                  <div className="flex items-start gap-3">
                    <div className="w-20 h-20 rounded-xl overflow-hidden border border-zinc-200 flex-shrink-0">
                      <ItemImage src={fotoUrl} alt={nome || 'Novo Item'} className="w-full h-full" />
                    </div>
                    <div className="flex-1 space-y-2">
                      <input
                        value={fotoUrl.startsWith('data:') ? '' : fotoUrl}
                        onChange={(e) => setFotoUrl(e.target.value)}
                        placeholder="https://... (cole uma URL)"
                        className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fotoInputRef.current?.click()}
                          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg hover:bg-zinc-100 cursor-pointer whitespace-nowrap transition-colors"
                        >
                          <i className="ri-upload-2-line text-sm" />
                          Anexar do computador
                        </button>
                        {fotoUrl && (
                          <button
                            type="button"
                            onClick={() => setFotoUrl('')}
                            className="text-xs text-red-400 hover:text-red-600 cursor-pointer font-medium"
                          >
                            Remover foto
                          </button>
                        )}
                      </div>
                      <input
                        ref={fotoInputRef}
                        type="file"
                        accept="image/*"
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
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 bg-amber-50 rounded-xl border border-amber-100">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-zinc-800">Produção dividida em múltiplas estações</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Ative quando este item exige produção em mais de uma estação. O item só fica pronto quando <strong>todas as partes</strong> estiverem concluídas.
                  </p>
                </div>
                <button
                  onClick={() => handleToggleProducaoDividida(!producaoDividida)}
                  className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer mt-0.5 ${producaoDividida ? 'bg-amber-500' : 'bg-zinc-200'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${producaoDividida ? 'left-6' : 'left-1'}`} />
                </button>
              </div>

              {producaoDividida && (
                <div className="space-y-3">
                  {subproducao.map((parte, idx) => (
                    <div key={parte.id} className="border border-zinc-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Parte {idx + 1}</span>
                        <button
                          onClick={() => removeSubParte(parte.id)}
                          className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg cursor-pointer"
                        >
                          <i className="ri-delete-bin-line text-sm" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="block text-xs font-semibold text-zinc-600 mb-1">Nome da parte *</label>
                          <input
                            value={parte.nome}
                            onChange={(e) => updateSubParte(parte.id, { nome: e.target.value })}
                            placeholder="Ex: Hambúrguer, Batata Frita..."
                            className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-600 mb-1">Estação *</label>
                          <select
                            value={parte.estacao}
                            onChange={(e) => updateSubParte(parte.id, { estacao: e.target.value })}
                            className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 cursor-pointer text-zinc-800"
                          >
                            {estacoesNomes.map((est) => (
                              <option key={est} value={est}>{est}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-600 mb-1">SLA (min)</label>
                          <input
                            type="number"
                            min="1"
                            value={parte.slaMinutos}
                            onChange={(e) => updateSubParte(parte.id, { slaMinutos: parseInt(e.target.value, 10) || 1 })}
                            className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={addSubParte}
                    className="w-full border-2 border-dashed border-zinc-200 hover:border-amber-300 hover:bg-amber-50 text-zinc-500 hover:text-amber-600 text-sm font-medium py-3 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 transition-all"
                  >
                    <i className="ri-add-line" /> Adicionar parte
                  </button>
                </div>
              )}

              {!producaoDividida && (
                <div className="text-center py-8 text-zinc-400">
                  <i className="ri-tools-line text-3xl block mb-2" />
                  <p className="text-sm">Produção simples — estação da categoria</p>
                  <p className="text-xs mt-1">Ative acima para dividir em múltiplas estações.</p>
                </div>
              )}
            </div>
          )}

          {/* ── OPÇÕES ── */}
          {tab === 'opcoes' && (
            <div className="space-y-4">
              {grupos.map((grp) => (
                <div key={grp.id} className="border border-zinc-100 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <input
                      value={grp.nome}
                      onChange={(e) => updateGrupo(grp.id, { nome: e.target.value })}
                      placeholder="Nome do grupo (ex: Ponto da carne)"
                      className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                    />
                    <button
                      onClick={() => removeGrupo(grp.id)}
                      className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg cursor-pointer"
                    >
                      <i className="ri-delete-bin-line text-sm" />
                    </button>
                  </div>
                  <div className="flex items-center gap-4 mb-3 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={grp.obrigatorio}
                        onChange={(e) => updateGrupo(grp.id, { obrigatorio: e.target.checked })}
                        className="accent-amber-500"
                      />
                      <span className="text-zinc-600">Obrigatório</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-600">Mín</span>
                      <input
                        type="number"
                        min="0"
                        value={grp.minSelecao}
                        onChange={(e) => updateGrupo(grp.id, { minSelecao: parseInt(e.target.value, 10) })}
                        className="w-12 border border-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-400 text-zinc-800"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-600">Máx</span>
                      <input
                        type="number"
                        min="1"
                        value={grp.maxSelecao}
                        onChange={(e) => updateGrupo(grp.id, { maxSelecao: parseInt(e.target.value, 10) })}
                        className="w-12 border border-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-400 text-zinc-800"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    {grp.opcoes.map((opc) => (
                      <div key={opc.id} className="flex items-center gap-2">
                        <input
                          value={opc.nome}
                          onChange={(e) => updateOpcaoGrupo(grp.id, opc.id, { nome: e.target.value })}
                          placeholder="Nome da opção"
                          className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                        />
                        <div className="flex items-center gap-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm">
                          <span className="text-zinc-400 text-xs">+R$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={opc.precoAdicional}
                            onChange={(e) => updateOpcaoGrupo(grp.id, opc.id, { precoAdicional: parseFloat(e.target.value) })}
                            className="w-16 focus:outline-none text-sm text-zinc-800"
                          />
                        </div>
                        <button
                          onClick={() => removeOpcaoGrupo(grp.id, opc.id)}
                          className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer rounded"
                        >
                          <i className="ri-close-line text-sm" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => addOpcaoGrupo(grp.id)}
                    className="mt-2 text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <i className="ri-add-line" /> Adicionar opção
                  </button>
                </div>
              ))}
              <button
                onClick={addGrupo}
                className="w-full border-2 border-dashed border-zinc-200 hover:border-amber-300 hover:bg-amber-50 text-zinc-500 hover:text-amber-600 text-sm font-medium py-3 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 transition-all"
              >
                <i className="ri-add-line" /> Novo grupo de opções
              </button>
            </div>
          )}

          {/* ── PROMOÇÕES ── */}
          {tab === 'promocoes' && (
            <div className="space-y-4">
              {promocoes.map((promo) => (
                <div key={promo.id} className="border border-zinc-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={promo.tipo}
                        onChange={(e) => updatePromocao(promo.id, { tipo: e.target.value as 'semanal' | 'pontual' })}
                        className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 cursor-pointer text-zinc-800"
                      >
                        <option value="semanal">Semanal</option>
                        <option value="pontual">Pontual</option>
                      </select>
                      <div className="flex items-center gap-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm">
                        <span className="text-zinc-400 text-xs">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={promo.precoPromocional || ''}
                          onChange={(e) => updatePromocao(promo.id, { precoPromocional: parseFloat(e.target.value) })}
                          placeholder="Preço promo"
                          className="w-20 focus:outline-none text-sm text-zinc-800"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updatePromocao(promo.id, { ativo: !promo.ativo })}
                        className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${promo.ativo ? 'bg-amber-500' : 'bg-zinc-200'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${promo.ativo ? 'left-4' : 'left-0.5'}`} />
                      </button>
                      <button
                        onClick={() => removePromocao(promo.id)}
                        className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer rounded"
                      >
                        <i className="ri-delete-bin-line text-sm" />
                      </button>
                    </div>
                  </div>
                  {promo.tipo === 'semanal' ? (
                    <div className="flex gap-1.5 flex-wrap">
                      {DIAS_SEMANA.map((dia, idx) => (
                        <button
                          key={idx}
                          onClick={() => toggleDia(promo.id, idx)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-full cursor-pointer transition-colors whitespace-nowrap ${
                            promo.diasSemana.includes(idx) ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
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
                        value={promo.dataEspecifica ?? ''}
                        onChange={(e) => updatePromocao(promo.id, { dataEspecifica: e.target.value })}
                        className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                      />
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={addPromocao}
                className="w-full border-2 border-dashed border-zinc-200 hover:border-amber-300 hover:bg-amber-50 text-zinc-500 hover:text-amber-600 text-sm font-medium py-3 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 transition-all"
              >
                <i className="ri-add-line" /> Nova promoção
              </button>
            </div>
          )}

          {/* ── OBS ── */}
          {tab === 'obs' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-zinc-700 mb-1">Observações padrão deste item</p>
                <p className="text-xs text-zinc-400 mb-3">Aparecem como opções ao lançar este item no PDV.</p>
                <div className="flex gap-2 mb-3">
                  <input
                    value={novaObs}
                    onChange={(e) => setNovaObs(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addObs()}
                    placeholder="Ex: Sem cebola, Pão sem glúten..."
                    className="flex-1 border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                  />
                  <button
                    onClick={addObs}
                    className="bg-amber-500 hover:bg-amber-600 text-white px-4 rounded-lg text-sm font-medium cursor-pointer whitespace-nowrap"
                  >
                    Adicionar
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {obs.length === 0 && <p className="text-xs text-zinc-400 italic">Nenhuma observação cadastrada</p>}
                  {obs.map((o, i) => (
                    <span key={i} className="flex items-center gap-1.5 bg-amber-50 text-amber-700 text-xs px-3 py-1.5 rounded-full">
                      {o}
                      <button
                        onClick={() => setObs((arr) => arr.filter((_, j) => j !== i))}
                        className="hover:text-red-500 cursor-pointer"
                      >
                        <i className="ri-close-line" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-zinc-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 border border-zinc-200 text-zinc-600 text-sm font-semibold py-2.5 rounded-xl hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!nome.trim() || !preco}
            className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-xl cursor-pointer whitespace-nowrap"
          >
            {item ? 'Salvar alterações' : 'Adicionar item'}
          </button>
        </div>
      </div>
    </div>
  );
}
