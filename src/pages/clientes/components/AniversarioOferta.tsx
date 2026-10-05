// Linha "Aniversário" da sub-aba Ofertas do Funil: a configuração do voucher de aniversário da
// loja (desconto, gasto mínimo, validade, automação diária) + a geração manual do mês.
// Veio do antigo BirthdayVoucherModal, agora em linha no acordeão das ofertas.
//
// Quem manda a mensagem é o cartão "Aniversariantes" (aba Quem chamar); aqui só se configura e se
// gera o voucher. A config só é lida/gravada por quem tem acesso a Vouchers (podeVoucher): o
// voucher-write nega as ações de gestão para os outros (403) — sem isso a linha só mostra o aviso.
import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { abrirWhatsApp } from '../clienteUtils';

export interface BirthdayConfig {
  enabled: boolean;
  discount_type: 'percent' | 'fixed' | 'gift_card';
  discount_value: number;
  min_order_amount: number;
  validity_days: number;
  only_opt_in: boolean;
  message: string | null;
}

interface GeradoItem { customer_id: string; name: string; phone: string | null; code: string; }

const DEFAULTS: BirthdayConfig = {
  enabled: false, discount_type: 'percent', discount_value: 15,
  min_order_amount: 0, validity_days: 15, only_opt_in: false, message: null,
};

const COR_ANIVERSARIO = '#ec4899';

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function labelDesconto(cfg: BirthdayConfig): string {
  if (cfg.discount_type === 'percent') return `${cfg.discount_value}% de desconto`;
  if (cfg.discount_type === 'fixed') return `${fmtMoeda(cfg.discount_value)} de desconto`;
  return `um vale de ${fmtMoeda(cfg.discount_value)}`;
}

/** "15% por 15 dias", "R$ 15 por 7 dias" ou "vale de R$ 50 por 30 dias". */
function resumoOfertaAniversario(cfg: BirthdayConfig): string {
  const n = Number(cfg.discount_value);
  const valor = cfg.discount_type === 'percent' ? `${n}%`
    : cfg.discount_type === 'fixed' ? `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`
      : `vale de R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  const dias = Number(cfg.validity_days);
  return `${valor} por ${dias} dia${dias === 1 ? '' : 's'}`;
}

// ── Cabeçalho de uma linha do acordeão (usado também pelos estágios do FunilAba) ─────────────
export interface SeloLinha { texto: string; cls: string }

export function CabecalhoOferta(props: {
  aberto: boolean;
  /** Sem onToggle a linha não abre (ex.: sem permissão): mostra um cadeado no lugar da seta. */
  onToggle?: () => void;
  cor: string;
  titulo: string;
  resumo: string;
  resumoCls?: string;
  selo?: SeloLinha;
  idCorpo?: string;
}) {
  const conteudo = (
    <>
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: props.cor }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-zinc-800">{props.titulo}</span>
          {props.selo && (
            <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ' + props.selo.cls}>{props.selo.texto}</span>
          )}
        </span>
        <span className={'block text-[11px] leading-snug mt-0.5 ' + (props.resumoCls ?? 'text-zinc-500')}>{props.resumo}</span>
      </span>
    </>
  );
  if (!props.onToggle) {
    return (
      <div className="w-full flex items-center gap-3 px-4 py-3 text-left">
        {conteudo}
        <i className="ri-lock-line text-zinc-300 flex-shrink-0" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onToggle}
      aria-expanded={props.aberto}
      aria-controls={props.idCorpo}
      className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-zinc-50/70 transition-colors"
    >
      {conteudo}
      <i className={'ri-arrow-down-s-line text-xl text-zinc-400 flex-shrink-0 transition-transform ' + (props.aberto ? 'rotate-180' : '')} />
    </button>
  );
}

interface Props {
  tenantId: string;
  /** Acesso a Vouchers & Gift Cards (gestao_vouchers). Sem isso nada é carregado nem gravado. */
  podeVoucher: boolean;
  aberto: boolean;
  onToggle: () => void;
  /** Depois de gerar os vouchers do mês: o cartão Aniversariantes precisa reler quem já tem voucher. */
  onGerado?: () => void;
}

export default function AniversarioOferta({ tenantId, podeVoucher, aberto, onToggle, onGerado }: Props) {
  const [cfg, setCfg] = useState<BirthdayConfig>(DEFAULTS);
  // A config como está no servidor: o resumo da linha e o "não salvo" usam esta, não o que está sendo digitado.
  const [salvo, setSalvo] = useState<BirthdayConfig | null>(null);
  const [carregando, setCarregando] = useState(podeVoucher);
  // Sem a config real carregada, salvar/gerar gravaria os padrões por cima (desligando a automação).
  const [erroCarga, setErroCarga] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [resultado, setResultado] = useState<{ created: number; skipped: number; items: GeradoItem[] } | null>(null);
  const req = useRef(0);

  const carregar = useCallback(async () => {
    if (!tenantId || !podeVoucher) return;
    const minha = ++req.current;
    setCarregando(true);
    setErroCarga('');
    try {
      const { data, error } = await invokeWithAuth('voucher-write', {
        body: { action: 'get_birthday_config', active_tenant_id: tenantId },
      });
      if (minha !== req.current) return;
      const resp = data as { data?: BirthdayConfig; error?: string } | null;
      if (error || resp?.error || !resp?.data) {
        setErroCarga(resp?.error || error?.message || 'Não consegui carregar a configuração de aniversário.');
        return;
      }
      const lida = { ...DEFAULTS, ...resp.data };
      setCfg(lida);
      setSalvo(lida);
    } catch {
      if (minha === req.current) setErroCarga('Não consegui carregar a configuração de aniversário.');
    } finally {
      if (minha === req.current) setCarregando(false);
    }
  }, [tenantId, podeVoucher]);

  useEffect(() => {
    // Troca de loja: o que estava na tela era da outra.
    setSalvo(null); setCfg(DEFAULTS); setResultado(null); setErro(''); setOkMsg('');
    carregar();
    // Ao desmontar ou trocar de loja, a resposta que ainda estiver voando é descartada (contador, não nó do DOM).
    const contador = req;
    return () => { contador.current++; };
  }, [carregar]);

  const set = <K extends keyof BirthdayConfig>(k: K, v: BirthdayConfig[K]) => {
    setOkMsg('');
    setCfg((p) => ({ ...p, [k]: v }));
  };

  const naoSalvo = !!salvo && JSON.stringify(salvo) !== JSON.stringify(cfg);

  function validar(): string | null {
    if (!(cfg.discount_value > 0)) return 'O valor do desconto deve ser maior que zero.';
    if (cfg.discount_type === 'percent' && cfg.discount_value > 100) return 'Percentual não pode passar de 100%.';
    return null;
  }

  const salvarConfig = async () => {
    setErro(''); setOkMsg('');
    if (erroCarga || !salvo) { setErro('Carregue a configuração antes de salvar.'); return; }
    const invalido = validar();
    if (invalido) { setErro(invalido); return; }
    setSalvando(true);
    try {
      const { data, error } = await invokeWithAuth('voucher-write', {
        body: { action: 'set_birthday_config', active_tenant_id: tenantId, config: cfg },
      });
      if (error) throw new Error(error.message);
      const resp = data as { error?: string; data?: BirthdayConfig };
      if (resp?.error) throw new Error(resp.error);
      const gravada = { ...DEFAULTS, ...(resp?.data ?? cfg) };
      setCfg(gravada);
      setSalvo(gravada);
      setOkMsg('Configuração salva.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const gerarAgora = async () => {
    setErro(''); setOkMsg(''); setResultado(null);
    if (erroCarga || !salvo) { setErro('Carregue a configuração antes de gerar.'); return; }
    setGerando(true);
    try {
      const invalido = validar();
      if (invalido) throw new Error(invalido);
      // Salva a config antes de gerar, para usar os valores atuais da tela.
      const gravou = await invokeWithAuth('voucher-write', {
        body: { action: 'set_birthday_config', active_tenant_id: tenantId, config: cfg },
      });
      const gravouResp = gravou.data as { error?: string; data?: BirthdayConfig } | null;
      if (gravou.error || gravouResp?.error) throw new Error(gravouResp?.error || 'Não consegui salvar a configuração antes de gerar.');
      setSalvo({ ...DEFAULTS, ...(gravouResp?.data ?? cfg) });
      const { data, error } = await invokeWithAuth('voucher-write', {
        body: { action: 'generate_birthday_vouchers', active_tenant_id: tenantId, scope: 'month' },
      });
      if (error) throw new Error(error.message);
      const resp = data as { error?: string; data?: { created: number; skipped: number; items: GeradoItem[]; error?: string } };
      if (resp?.error) throw new Error(resp.error);
      if (resp?.data?.error) throw new Error(resp.data.error);
      setResultado(resp?.data ?? { created: 0, skipped: 0, items: [] });
      onGerado?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar');
    } finally {
      setGerando(false);
    }
  };

  const enviarWhatsApp = (item: GeradoItem) => {
    const primeiro = item.name.split(' ')[0];
    abrirWhatsApp(
      item.phone,
      `Olá, ${primeiro}! \u{1F382} Feliz aniversário! Preparamos um presente pra você: use o código *${item.code}* e ganhe ${labelDesconto(cfg)}`
      + (cfg.min_order_amount > 0 ? ` (em pedidos acima de ${fmtMoeda(cfg.min_order_amount)})` : '')
      + `. Válido por ${cfg.validity_days} dias. Te esperamos! \u{1F973}`,
    );
  };

  // ── Linha (resumo) ──────────────────────────────────────────────────────────
  let resumo: string;
  let resumoCls: string | undefined;
  let selo: SeloLinha | undefined;
  if (!podeVoucher) {
    resumo = 'Só quem tem acesso a Vouchers configura';
    resumoCls = 'text-zinc-400';
  } else if (erroCarga) {
    resumo = 'Não consegui carregar a configuração';
    resumoCls = 'text-red-600';
    selo = { texto: 'Erro', cls: 'bg-red-50 text-red-700 border-red-200' };
  } else if (!salvo) {
    resumo = 'Carregando…';
    resumoCls = 'text-zinc-400';
  } else {
    resumo = `${resumoOfertaAniversario(salvo)} · ${salvo.enabled ? 'gera sozinho às 9h' : 'automação desligada'}`;
    selo = salvo.enabled
      ? { texto: 'Automático', cls: 'bg-green-50 text-green-700 border-green-200' }
      : { texto: 'Desligado', cls: 'bg-zinc-50 text-zinc-500 border-zinc-200' };
  }

  const inputCls = 'w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-700 focus:outline-none focus:border-amber-400 transition-colors';
  const idCorpo = 'oferta-aniversario';

  return (
    <div>
      <CabecalhoOferta
        aberto={aberto && podeVoucher}
        onToggle={podeVoucher ? onToggle : undefined}
        cor={COR_ANIVERSARIO}
        titulo="Aniversário"
        resumo={resumo}
        resumoCls={resumoCls}
        selo={selo}
        idCorpo={idCorpo}
      />

      {aberto && podeVoucher && (
        <div id={idCorpo} className="px-4 pb-4 pt-3 space-y-3 border-t border-zinc-100">
          {carregando && !salvo ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : erroCarga ? (
            <div className="px-3 py-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 text-center">
              {erroCarga}
              <button onClick={carregar} className="block mx-auto mt-2 px-3 py-1.5 rounded-lg bg-white border border-red-200 font-semibold hover:bg-red-100 cursor-pointer">Tentar de novo</button>
            </div>
          ) : (
            <>
              {erro && <div role="alert" className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{erro}</div>}
              {okMsg && <div role="status" className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">{okMsg}</div>}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Tipo de benefício</label>
                  <select className={`${inputCls} cursor-pointer bg-white`} value={cfg.discount_type} onChange={(e) => set('discount_type', e.target.value as BirthdayConfig['discount_type'])}>
                    <option value="percent">Desconto %</option>
                    <option value="fixed">Desconto R$</option>
                    <option value="gift_card">Vale-presente R$</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">
                    {cfg.discount_type === 'percent' ? 'Percentual (%)' : 'Valor (R$)'}
                  </label>
                  <input type="number" min={0} className={inputCls} value={cfg.discount_value} onChange={(e) => set('discount_value', Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Gasto mínimo (R$)</label>
                  <input type="number" min={0} className={inputCls} value={cfg.min_order_amount} onChange={(e) => set('min_order_amount', Number(e.target.value))} placeholder="0 = sem mínimo" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Validade (dias)</label>
                  <input type="number" min={1} max={365} className={inputCls} value={cfg.validity_days} onChange={(e) => set('validity_days', Number(e.target.value))} />
                </div>
              </div>

              <label className="flex items-center gap-2.5 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg cursor-pointer">
                <input type="checkbox" checked={cfg.only_opt_in} onChange={(e) => set('only_opt_in', e.target.checked)} className="w-4 h-4 accent-amber-500 cursor-pointer flex-shrink-0" />
                <span className="text-xs text-zinc-600">Gerar só para quem aceita marketing (opt-in)</span>
              </label>

              <label className="flex items-center gap-2.5 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                <input type="checkbox" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} className="w-4 h-4 accent-amber-500 cursor-pointer flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">Automação diária</p>
                  <p className="text-[11px] text-amber-700 leading-snug">
                    Todo dia, às 9h, gera o voucher de quem faz aniversário naquela data. Só gera — a mensagem você manda pelo cartão Aniversariantes.
                  </p>
                </div>
              </label>

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <button
                  onClick={salvarConfig}
                  disabled={salvando || gerando}
                  className="px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-600 text-sm font-semibold hover:bg-zinc-50 cursor-pointer disabled:opacity-50"
                >
                  {salvando ? 'Salvando…' : 'Salvar'}
                </button>
                <button
                  onClick={gerarAgora}
                  disabled={gerando || salvando}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 cursor-pointer disabled:opacity-50"
                >
                  {gerando ? <><i className="ri-loader-4-line animate-spin" /> Gerando…</> : <><i className="ri-cake-3-line" /> Gerar vouchers do mês</>}
                </button>
                {naoSalvo && <span className="text-[11px] text-amber-700 font-semibold">alterações não salvas</span>}
              </div>

              {/* Resultado da geração */}
              {resultado && (
                <div className="border border-zinc-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-zinc-700 mb-2">
                    {resultado.created} voucher{resultado.created !== 1 ? 's' : ''} gerado{resultado.created !== 1 ? 's' : ''}
                    {resultado.skipped > 0 && <span className="text-zinc-400 font-normal"> · {resultado.skipped} já tinha{resultado.skipped !== 1 ? 'm' : ''}</span>}
                  </p>
                  {resultado.items.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-auto">
                      {resultado.items.map((it) => (
                        <div key={it.customer_id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-zinc-600 truncate">{it.name} · <span className="font-mono text-zinc-400">{it.code}</span></span>
                          <button
                            onClick={() => enviarWhatsApp(it)}
                            disabled={!it.phone}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-30 cursor-pointer flex-shrink-0"
                            title={it.phone ? 'Enviar no WhatsApp' : 'Sem telefone'}
                          >
                            <i className="ri-whatsapp-line" /> Enviar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
