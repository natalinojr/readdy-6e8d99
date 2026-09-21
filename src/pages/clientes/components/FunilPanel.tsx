// Funil de CRM do delivery.
//
// Mostra em que estágio cada cliente está, quem pode ser abordado agora e com
// qual oferta. O envio é sempre um clique humano: "Chamar" abre o WhatsApp com
// a mensagem da regra; "Voucher" abre o modal de voucher já preenchido com a
// oferta do estágio. Depois do envio, registra em crm_sends (para o cooldown,
// o teto de frequência e a medição de retorno).
//
// A aba Regras edita o que o ERPOS sugere em cada estágio. Nada dispara sozinho.
import { useCallback, useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ClienteCRM } from '@/hooks/useClientes';
import type { Voucher } from '@/types/vouchers';

export type CrmStage =
  | 'carrinho_abandonado' | 'nunca_comprou' | 'primeira_compra' | 'recorrente'
  | 'fiel' | 'vip' | 'em_risco' | 'perdido';

interface StageResumo {
  stage: CrmStage;
  label: string;
  desc: string;
  clientes: number;
  gasto: number;
  enviados: number;
  converteu: number;
}

export interface CrmRule {
  id: string;
  stage: CrmStage;
  enabled: boolean;
  auto_send: boolean;
  delay_hours: number;
  voucher_type: 'percentual' | 'valor' | 'nenhum';
  voucher_value: number;
  validade_dias: number;
  mensagem: string | null;
  cooldown_days: number;
}

export interface CrmCriteria {
  carrinho_horas: number;
  perdido_dias: number;
  risco_multiplicador: number;
  risco_min_dias: number;
  ciclo_padrao_dias: number;
  fiel_min_pedidos: number;
  vip_min_pedidos: number;
  vip_percentil: number;
  vip_min_gasto: number;
}

interface CrmSettings {
  max_msgs_por_semana: number;
  hora_inicio: number;
  hora_fim: number;
  desconto_max_percent: number;
}

interface ClienteFunil {
  customer_id: string;
  nome: string;
  phone: string;
  phone_fmt: string;
  orders_count: number;
  total_spent: number;
  last_order_at: string | null;
  days_since_last: number | null;
  avg_cycle_days: number | null;
  entered_at: string;
  ultimo_contato: string | null;
  pode_abordar: boolean;
  bloqueio: string | null;
}

interface Props {
  onClose: () => void;
  /** Abre o modal de voucher com a oferta da regra já preenchida. */
  onEnviarVoucher: (
    cliente: ClienteCRM,
    oferta: { tipo: 'discount_percent' | 'discount_fixed' | 'gift_card'; valor: number; validadeDias: number },
    aoEnviar: (voucher?: Voucher, mensagem?: string) => void,
  ) => void;
}

const CORES: Record<CrmStage, string> = {
  carrinho_abandonado: 'bg-orange-50 border-orange-200 text-orange-700',
  nunca_comprou: 'bg-zinc-50 border-zinc-200 text-zinc-600',
  primeira_compra: 'bg-sky-50 border-sky-200 text-sky-700',
  recorrente: 'bg-green-50 border-green-200 text-green-700',
  fiel: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  vip: 'bg-amber-50 border-amber-200 text-amber-700',
  em_risco: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  perdido: 'bg-red-50 border-red-200 text-red-700',
};

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Troca os marcadores da mensagem da regra pelos dados reais. */
function montarMensagem(modelo: string, dados: { nome: string; loja: string; cupom?: string; link?: string }): string {
  const primeiroNome = dados.nome.split(' ')[0];
  return modelo
    .replace(/\{nome\}/g, primeiroNome)
    .replace(/\{loja\}/g, dados.loja)
    .replace(/\{cupom\}/g, dados.cupom ?? '')
    .replace(/\{link\}/g, dados.link ?? '')
    // Sem cupom os marcadores somem e podem deixar sobras de pontuação.
    .replace(/\s*:\s*—\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export default function FunilPanel(props: Props) {
  const { user } = useAuth();
  const [aba, setAba] = useState<'funil' | 'regras' | 'criterios'>('funil');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [stages, setStages] = useState<StageResumo[]>([]);
  const [rules, setRules] = useState<CrmRule[]>([]);
  const [settings, setSettings] = useState<CrmSettings | null>(null);
  const [criteria, setCriteria] = useState<CrmCriteria | null>(null);
  const [criteriaPadrao, setCriteriaPadrao] = useState<CrmCriteria | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [msgSalvo, setMsgSalvo] = useState('');

  const [stageAberto, setStageAberto] = useState<CrmStage | null>(null);
  const [listaCarregando, setListaCarregando] = useState(false);
  const [clientes, setClientes] = useState<ClienteFunil[]>([]);
  const [soElegiveis, setSoElegiveis] = useState(true);

  const tenantId = user?.tenantId;

  // `silencioso`: recarrega sem trocar a tela por "Calculando o funil…". Usado
  // depois de salvar, senão o formulário que o dono acabou de mexer some.
  const carregarOverview = useCallback(function (silencioso?: boolean) {
    if (!tenantId) return;
    if (!silencioso) setCarregando(true);
    setErro('');
    invokeWithAuth<{
      stages?: StageResumo[]; rules?: CrmRule[]; settings?: CrmSettings;
      criteria?: CrmCriteria; criteria_padrao?: CrmCriteria; error?: string; message?: string;
    }>(
      'crm-funnel', { body: { action: 'overview', tenant_id: tenantId } },
    ).then(function (res) {
      setCarregando(false);
      if (res.error) { setErro(res.error.message); return; }
      const d = res.data;
      if (!d || d.error) { setErro(d?.message || d?.error || 'Não foi possível carregar o funil.'); return; }
      setStages(d.stages ?? []);
      setRules(d.rules ?? []);
      setSettings(d.settings ?? null);
      setCriteria(d.criteria ?? null);
      setCriteriaPadrao(d.criteria_padrao ?? null);
    });
  }, [tenantId]);

  useEffect(function () { carregarOverview(); }, [carregarOverview]);

  const abrirStage = useCallback(function (stage: CrmStage) {
    if (!tenantId) return;
    setStageAberto(stage);
    setListaCarregando(true);
    setClientes([]);
    invokeWithAuth<{ clientes?: ClienteFunil[]; error?: string; message?: string }>(
      'crm-funnel', { body: { action: 'list_stage', tenant_id: tenantId, stage } },
    ).then(function (res) {
      setListaCarregando(false);
      if (res.error) { setErro(res.error.message); return; }
      const d = res.data;
      if (!d || d.error) { setErro(d?.message || d?.error || 'Não foi possível carregar a lista.'); return; }
      setClientes(d.clientes ?? []);
    });
  }, [tenantId]);

  function regraDo(stage: CrmStage): CrmRule | undefined {
    return rules.find(function (r) { return r.stage === stage; });
  }

  function registrarEnvio(stage: CrmStage, customerId: string, voucherId: string | null, mensagem: string) {
    if (!tenantId) return;
    invokeWithAuth('crm-funnel', {
      body: { action: 'log_send', tenant_id: tenantId, stage, customer_id: customerId, voucher_id: voucherId, message: mensagem },
    }).then(function () {
      // Some da lista de elegíveis (entrou em cooldown).
      setClientes(function (prev) {
        return prev.map(function (c) {
          return c.customer_id === customerId ? { ...c, pode_abordar: false, bloqueio: 'já abordado (cooldown)' } : c;
        });
      });
    });
  }

  function chamarNoWhats(c: ClienteFunil, stage: CrmStage) {
    const regra = regraDo(stage);
    const modelo = regra?.mensagem || 'Oi, {nome}! Tudo bem? Aqui é da {loja} 😊';
    const texto = montarMensagem(modelo, { nome: c.nome, loja: user?.loja || 'nossa loja' });
    const numero = c.phone.replace(/\D/g, '');
    const comDDI = numero.length <= 11 ? '55' + numero : numero;
    window.open('https://wa.me/' + comDDI + '?text=' + encodeURIComponent(texto), '_blank');
    if (stageAberto) registrarEnvio(stage, c.customer_id, null, texto);
  }

  function mandarVoucher(c: ClienteFunil, stage: CrmStage) {
    const regra = regraDo(stage);
    if (!regra) return;
    const tipo = regra.voucher_type === 'valor' ? 'discount_fixed' : 'discount_percent';
    props.onEnviarVoucher(
      {
        id: c.customer_id, nome: c.nome, celular: c.phone, email: null, cpf: null,
        dataNascimento: null, genero: null, notes: null, manualTags: [], aceitaMarketing: false,
        ultimoContato: c.ultimo_contato, primeiraVisita: c.entered_at, ultimaVisita: c.last_order_at ?? c.entered_at,
        totalVisitas: c.orders_count, valorTotal: c.total_spent,
        ticketMedio: c.orders_count > 0 ? c.total_spent / c.orders_count : 0,
        itensFavoritos: [], pedidos: [], tags: [],
      },
      { tipo, valor: Number(regra.voucher_value || 0), validadeDias: Number(regra.validade_dias || 7) },
      function (voucher, mensagem) {
        registrarEnvio(stage, c.customer_id, voucher?.id ?? null, mensagem ?? '');
      },
    );
  }

  function naoPerturbe(c: ClienteFunil) {
    if (!tenantId) return;
    invokeWithAuth('crm-funnel', {
      body: { action: 'set_opt_out', tenant_id: tenantId, customer_id: c.customer_id, opt_out: true },
    }).then(function () {
      setClientes(function (prev) {
        return prev.map(function (x) {
          return x.customer_id === c.customer_id ? { ...x, pode_abordar: false, bloqueio: 'pediu para não receber' } : x;
        });
      });
    });
  }

  /** Público personalizado da Meta: phone,email,fn,ln,country (o mesmo formato da aba Clientes). */
  function exportarPublicoMeta(stage: CrmStage) {
    const linhas = clientes.filter(function (c) { return !!c.phone; }).map(function (c) {
      const partes = c.nome.trim().split(/\s+/);
      const fn = (partes[0] || '').toLowerCase();
      const ln = (partes.length > 1 ? partes[partes.length - 1] : '').toLowerCase();
      const tel = c.phone.replace(/\D/g, '');
      return ['+55' + tel, '', fn, ln, 'br'].join(',');
    });
    const csv = 'phone,email,fn,ln,country\n' + linhas.join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'publico-meta-' + stage + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function alterarRegra(stage: CrmStage, patch: Partial<CrmRule>) {
    setRules(function (prev) {
      return prev.map(function (r) { return r.stage === stage ? { ...r, ...patch } : r; });
    });
  }

  function salvarRegras() {
    if (!tenantId) return;
    setSalvando(true);
    setMsgSalvo('');
    invokeWithAuth<{ rules?: CrmRule[]; settings?: CrmSettings; criteria?: CrmCriteria; error?: string; message?: string }>(
      'crm-funnel', { body: { action: 'save_rules', tenant_id: tenantId, rules, settings, criteria } },
    ).then(function (res) {
      setSalvando(false);
      const d = res.data;
      if (res.error || !d || d.error) {
        setMsgSalvo(res.error?.message || d?.message || d?.error || 'Erro ao salvar.');
        return;
      }
      setRules(d.rules ?? rules);
      setSettings(d.settings ?? settings);
      // O servidor devolve o que REALMENTE gravou (valores fora da faixa são
      // ajustados lá) — a tela tem que mostrar isso, não o que foi digitado.
      if (d.criteria) setCriteria(d.criteria);
      setMsgSalvo('Salvo.');
      // Mudou um corte, mudou quem está em cada estágio: recarrega as contagens.
      carregarOverview(true);
      if (stageAberto) abrirStage(stageAberto);
    });
  }

  const listaVisivel = soElegiveis ? clientes.filter(function (c) { return c.pode_abordar; }) : clientes;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={props.onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={function (e) { e.stopPropagation(); }}
      >
        <div className="px-5 py-4 border-b border-zinc-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <i className="ri-filter-3-line text-amber-500" /> Funil de clientes — delivery
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Cada cliente em um estágio, com a oferta certa pra cada momento. Nada é enviado sozinho.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {([['funil', 'Funil'], ['regras', 'Ofertas'], ['criterios', 'Critérios']] as const).map(function ([key, label]) {
              return (
                <button
                  key={key}
                  onClick={function () { setAba(key); }}
                  className={'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ' +
                    (aba === key ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200')}
                >
                  {label}
                </button>
              );
            })}
            <button onClick={props.onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
              <i className="ri-close-line text-zinc-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {erro && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{erro}</div>}

          {carregando ? (
            <p className="text-xs text-zinc-400 text-center py-10">Calculando o funil…</p>
          ) : aba === 'funil' ? (
            <>
              {/* Etapas */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {stages.map(function (s) {
                  const regra = regraDo(s.stage);
                  return (
                    <button
                      key={s.stage}
                      onClick={function () { abrirStage(s.stage); }}
                      className={'text-left rounded-xl border p-3 cursor-pointer transition-all hover:shadow-sm ' +
                        CORES[s.stage] + (stageAberto === s.stage ? ' ring-2 ring-amber-400' : '')}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-bold truncate">{s.label}</span>
                        {regra?.enabled && <i className="ri-coupon-3-line text-[11px]" title="Oferta ligada" />}
                      </div>
                      <p className="text-lg font-black leading-tight mt-0.5">{s.clientes}</p>
                      <p className="text-[10px] opacity-70 leading-tight">{s.desc}</p>
                      {s.enviados > 0 && (
                        <p className="text-[10px] mt-1 font-semibold">
                          {s.converteu}/{s.enviados} voltaram
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Lista do estágio aberto */}
              {stageAberto && (
                <div className="border border-zinc-200 rounded-xl">
                  <div className="px-4 py-3 border-b border-zinc-100 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-zinc-800">
                      {stages.find(function (s) { return s.stage === stageAberto; })?.label}
                    </span>
                    <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={soElegiveis}
                        onChange={function (e) { setSoElegiveis(e.target.checked); }}
                        className="cursor-pointer"
                      />
                      só quem pode ser abordado agora
                    </label>
                    <button
                      onClick={function () { exportarPublicoMeta(stageAberto); }}
                      disabled={clientes.length === 0}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 disabled:opacity-40"
                      title="Baixar este estágio como Público Personalizado do Meta Ads"
                    >
                      <i className="ri-meta-line" /> Público Meta
                    </button>
                  </div>

                  <div className="max-h-[38vh] overflow-auto p-3 space-y-2">
                    {listaCarregando ? (
                      <p className="text-xs text-zinc-400 text-center py-6">Carregando…</p>
                    ) : listaVisivel.length === 0 ? (
                      <p className="text-xs text-zinc-400 text-center py-6">
                        {soElegiveis ? 'Ninguém elegível agora neste estágio.' : 'Nenhum cliente neste estágio.'}
                      </p>
                    ) : listaVisivel.map(function (c) {
                      const regra = regraDo(stageAberto);
                      const temCupom = !!regra && regra.voucher_type !== 'nenhum' && Number(regra.voucher_value) > 0;
                      return (
                        <div key={c.customer_id} className="border border-zinc-100 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-zinc-800 truncate">{c.nome}</span>
                              <span className="text-xs text-zinc-500">{c.phone_fmt}</span>
                              {!c.pode_abordar && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">{c.bloqueio}</span>
                              )}
                            </div>
                            <p className="text-[11px] text-zinc-500 mt-0.5">
                              {c.orders_count} {c.orders_count === 1 ? 'pedido' : 'pedidos'} · {fmtMoeda(c.total_spent)}
                              {c.days_since_last != null ? ' · há ' + c.days_since_last + ' dias sem pedir' : ''}
                              {c.avg_cycle_days != null ? ' · costuma pedir a cada ' + Math.round(Number(c.avg_cycle_days)) + 'd' : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={function () { chamarNoWhats(c, stageAberto); }}
                              disabled={!c.phone}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-green-200 bg-green-50 hover:bg-green-100 text-green-700 disabled:opacity-40"
                            >
                              <i className="ri-whatsapp-line" /> Chamar
                            </button>
                            {temCupom && (
                              <button
                                onClick={function () { mandarVoucher(c, stageAberto); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700"
                              >
                                <i className="ri-coupon-3-line" />
                                {regra!.voucher_type === 'valor'
                                  ? fmtMoeda(Number(regra!.voucher_value))
                                  : Number(regra!.voucher_value) + '%'}
                              </button>
                            )}
                            <button
                              onClick={function () { naoPerturbe(c); }}
                              title="Cliente pediu para não receber mensagens"
                              className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 hover:bg-zinc-50 cursor-pointer"
                            >
                              <i className="ri-notification-off-line text-sm" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!stageAberto && (
                <p className="text-xs text-zinc-400 text-center py-6">Clique num estágio para ver quem está lá.</p>
              )}
            </>
          ) : aba === 'regras' ? (
            /* ── Aba Ofertas (o que o ERPOS sugere em cada estágio) ── */
            <div className="space-y-3">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                <i className="ri-information-line text-blue-500 text-sm mt-0.5" />
                <p className="text-[11px] text-blue-700">
                  Ligar um estágio faz o ERPOS <strong>sugerir</strong> a oferta na lista do funil. O envio continua
                  sendo um clique seu — disparo automático ainda não existe. Marcadores da mensagem:{' '}
                  <code>{'{nome}'}</code>, <code>{'{loja}'}</code>, <code>{'{cupom}'}</code>, <code>{'{link}'}</code>.
                </p>
              </div>

              {rules.map(function (r) {
                const resumo = stages.find(function (s) { return s.stage === r.stage; });
                return (
                  <div key={r.stage} className="border border-zinc-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-zinc-800">
                          {resumo?.label ?? r.stage}
                          <span className="ml-2 text-xs font-normal text-zinc-400">{resumo?.clientes ?? 0} clientes</span>
                        </h4>
                        <p className="text-[11px] text-zinc-400">{resumo?.desc}</p>
                      </div>
                      <button
                        type="button"
                        onClick={function () { alterarRegra(r.stage, { enabled: !r.enabled }); }}
                        className={'relative w-12 h-7 rounded-full transition-colors cursor-pointer flex-shrink-0 ' +
                          (r.enabled ? 'bg-green-500' : 'bg-zinc-200')}
                      >
                        <div className={'absolute top-0.5 w-6 h-6 bg-white rounded-full transition-transform shadow ' +
                          (r.enabled ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">Esperar (horas)</label>
                        <input
                          type="number" min={0} value={r.delay_hours}
                          onChange={function (e) { alterarRegra(r.stage, { delay_hours: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">Oferta</label>
                        <select
                          value={r.voucher_type}
                          onChange={function (e) { alterarRegra(r.stage, { voucher_type: e.target.value as CrmRule['voucher_type'] }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                          <option value="nenhum">Sem cupom</option>
                          <option value="percentual">Desconto %</option>
                          <option value="valor">Desconto R$</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">Valor</label>
                        <input
                          type="number" min={0} value={r.voucher_value}
                          disabled={r.voucher_type === 'nenhum'}
                          onChange={function (e) { alterarRegra(r.stage, { voucher_value: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-zinc-50 disabled:text-zinc-300"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">Não repetir por (dias)</label>
                        <input
                          type="number" min={0} value={r.cooldown_days}
                          onChange={function (e) { alterarRegra(r.stage, { cooldown_days: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-zinc-500 mb-1">Mensagem</label>
                      <textarea
                        rows={2}
                        value={r.mensagem ?? ''}
                        onChange={function (e) { alterarRegra(r.stage, { mensagem: e.target.value }); }}
                        className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                      />
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-end gap-3 pt-1">
                {msgSalvo && <span className="text-xs text-zinc-500">{msgSalvo}</span>}
                <button
                  onClick={salvarRegras}
                  disabled={salvando}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl cursor-pointer disabled:opacity-50"
                >
                  {salvando ? 'Salvando…' : 'Salvar ofertas'}
                </button>
              </div>
            </div>
          ) : (
            /* ── Aba Critérios (quem entra em cada estágio) + travas ── */
            <div className="space-y-3">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                <i className="ri-information-line text-blue-500 text-sm mt-0.5" />
                <p className="text-[11px] text-blue-700">
                  Aqui você define <strong>quem cai em cada estágio</strong>. Cada operação tem um ritmo — um mês sem
                  pedir pode ser normal numa casa de almoço e péssimo sinal numa hamburgueria. Ao salvar, o funil é
                  recalculado na hora e as contagens da aba Funil já mudam.
                </p>
              </div>

              {criteria && (
                <>
                  <div className="border border-zinc-200 rounded-xl p-4 space-y-3">
                    <h4 className="text-sm font-bold text-zinc-800">Quando o cliente sumiu</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">Perdido depois de (dias)</label>
                        <input
                          type="number" min={30} max={365} value={criteria.perdido_dias}
                          onChange={function (e) { setCriteria({ ...criteria, perdido_dias: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <p className="text-[10px] text-zinc-400 mt-1">Sem pedir por esse tempo = perdido.</p>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">Em risco: ritmo ×</label>
                        <input
                          type="number" min={1} max={5} step={0.1} value={criteria.risco_multiplicador}
                          onChange={function (e) { setCriteria({ ...criteria, risco_multiplicador: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <p className="text-[10px] text-zinc-400 mt-1">Vezes o intervalo médio do próprio cliente.</p>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">Em risco: nunca antes de (dias)</label>
                        <input
                          type="number" min={3} max={180} value={criteria.risco_min_dias}
                          onChange={function (e) { setCriteria({ ...criteria, risco_min_dias: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <p className="text-[10px] text-zinc-400 mt-1">Piso: evita cobrar quem pede todo dia.</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2">
                      Exemplo: quem costuma pedir a cada <strong>10 dias</strong> entra em risco com{' '}
                      <strong>{Math.max(Number(criteria.risco_min_dias), Math.round(10 * Number(criteria.risco_multiplicador)))} dias</strong>{' '}
                      sem pedir, e vira perdido com <strong>{criteria.perdido_dias}</strong>.
                    </p>
                  </div>

                  <div className="border border-zinc-200 rounded-xl p-4 space-y-3">
                    <h4 className="text-sm font-bold text-zinc-800">Fiel e VIP</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">Fiel a partir de (pedidos)</label>
                        <input
                          type="number" min={2} max={50} value={criteria.fiel_min_pedidos}
                          onChange={function (e) { setCriteria({ ...criteria, fiel_min_pedidos: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <p className="text-[10px] text-zinc-400 mt-1">De 2 até aí, é recorrente.</p>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">VIP: mínimo de pedidos</label>
                        <input
                          type="number" min={1} max={50} value={criteria.vip_min_pedidos}
                          onChange={function (e) { setCriteria({ ...criteria, vip_min_pedidos: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">VIP: top % que mais gasta</label>
                        <input
                          type="number" min={1} max={50}
                          value={Math.round((1 - Number(criteria.vip_percentil)) * 100)}
                          onChange={function (e) {
                            const topPercent = Math.min(50, Math.max(1, Number(e.target.value) || 10));
                            setCriteria({ ...criteria, vip_percentil: Number((1 - topPercent / 100).toFixed(3)) });
                          }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <p className="text-[10px] text-zinc-400 mt-1">10 = os 10% maiores da loja.</p>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">VIP: gasto mínimo (R$)</label>
                        <input
                          type="number" min={0} value={criteria.vip_min_gasto}
                          onChange={function (e) { setCriteria({ ...criteria, vip_min_gasto: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <p className="text-[10px] text-zinc-400 mt-1">0 = sem piso, só o top %.</p>
                      </div>
                    </div>
                  </div>

                  <div className="border border-zinc-200 rounded-xl p-4 space-y-3">
                    <h4 className="text-sm font-bold text-zinc-800">Carrinho e histórico curto</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">Carrinho parado conta por (horas)</label>
                        <input
                          type="number" min={1} max={720} value={criteria.carrinho_horas}
                          onChange={function (e) { setCriteria({ ...criteria, carrinho_horas: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <p className="text-[10px] text-zinc-400 mt-1">Depois disso o cliente volta ao estágio normal dele.</p>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-500 mb-1">Ritmo assumido sem histórico (dias)</label>
                        <input
                          type="number" min={1} max={120} value={criteria.ciclo_padrao_dias}
                          onChange={function (e) { setCriteria({ ...criteria, ciclo_padrao_dias: Number(e.target.value) }); }}
                          className="w-full px-2.5 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <p className="text-[10px] text-zinc-400 mt-1">Usado para quem só tem 1 pedido.</p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Travas: valem para todos os estágios */}
              <h4 className="text-sm font-bold text-zinc-800 pt-1">Travas de segurança</h4>
              {settings && (
                <div className="border border-zinc-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-zinc-600 mb-1.5">Máx. mensagens por semana</label>
                    <input
                      type="number" min={1} max={7} value={settings.max_msgs_por_semana}
                      onChange={function (e) { setSettings({ ...settings, max_msgs_por_semana: Number(e.target.value) }); }}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <p className="text-[10px] text-zinc-400 mt-1">Por cliente, somando todos os estágios.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-600 mb-1.5">Desconto máximo (%)</label>
                    <input
                      type="number" min={0} max={90} value={settings.desconto_max_percent}
                      onChange={function (e) { setSettings({ ...settings, desconto_max_percent: Number(e.target.value) }); }}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <p className="text-[10px] text-zinc-400 mt-1">Teto de margem: nenhuma regra passa disso.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-600 mb-1.5">Horário para abordar</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min={0} max={23} value={settings.hora_inicio}
                        onChange={function (e) { setSettings({ ...settings, hora_inicio: Number(e.target.value) }); }}
                        className="w-16 px-2 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      <span className="text-xs text-zinc-400">às</span>
                      <input
                        type="number" min={0} max={23} value={settings.hora_fim}
                        onChange={function (e) { setSettings({ ...settings, hora_fim: Number(e.target.value) }); }}
                        className="w-16 px-2 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  onClick={function () { if (criteriaPadrao) setCriteria({ ...criteriaPadrao }); }}
                  disabled={!criteriaPadrao}
                  className="px-3 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-700 cursor-pointer disabled:opacity-40"
                >
                  Restaurar critérios padrão
                </button>
                <div className="flex items-center gap-3">
                  {msgSalvo && <span className="text-xs text-zinc-500">{msgSalvo}</span>}
                  <button
                    onClick={salvarRegras}
                    disabled={salvando}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    {salvando ? 'Salvando…' : 'Salvar e recalcular'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
