// Painel "Não pediram": quem entrou no cardápio do delivery e saiu sem pedido.
//
// Duas situações, lidas de menu_visits (action list_abandoned_carts):
//  - "carrinho": montou carrinho e não finalizou -> a maior chance de recuperar;
//  - "visita": abriu o cardápio e saiu sem colocar nada.
//
// O envio é sempre um clique humano (WhatsApp ou voucher). A regra do "Cupom sugerido" mora aqui, junto
// da lista (antes ficava em Delivery › Recuperar carrinho abandonado; o dono tirou de lá em 2026-10-04).
// Ligada, o botão de cada cliente cadastrado diz o cupom ("Mandar cupom de 10%") — nada sai sozinho.
// Quem muda a regra é quem emite cupom (permissão gestao_vouchers); o servidor confere (save_cart_recovery).
import { useEffect, useRef, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { btn, CampoNumero, LinhaInterruptor } from '@/pages/config-delivery/ui';
import type { ClienteCRM } from '@/hooks/useClientes';
import type { OfertaVoucher } from '../abas/FunilAba';

interface CartItemResumo {
  nome: string;
  qtd: number;
  total: number;
}

interface Abandono {
  id: string;
  phone: string | null;
  phone_fmt: string | null;
  customer_id: string | null;
  customer_name: string | null;
  started_at: string;
  last_seen_at: string;
  last_step: string | null;
  items_count: number;
  cart_total: number;
  cart_items: CartItemResumo[] | null;
  tipo: 'carrinho' | 'visita';
}

interface CartRecoveryCfg {
  enabled?: boolean;
  delay_min?: number;
  voucher_type?: 'percentual' | 'valor';
  voucher_value?: number;
  validade_dias?: number;
  mensagem?: string;
}

/** O que está na tela no cartão "Cupom sugerido" (salvo ou não). */
interface Rascunho {
  enabled: boolean;
  delay_min: number;
  voucher_type: 'percentual' | 'valor';
  voucher_value: number;
  validade_dias: number;
  mensagem: string;
}

interface Props {
  onClose: () => void;
  /**
   * Abre o modal de voucher para um cliente já cadastrado. `oferta` vem preenchida (a regra do Cupom sugerido)
   * quando a sugestão está ligada; quem recebe pode usá-la para já abrir o voucher com esse desconto.
   */
  onEnviarVoucher: (cliente: ClienteCRM, oferta?: OfertaVoucher) => void;
}

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function haQuanto(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
}

const PASSO_LABEL: Record<string, string> = {
  preview: 'viu a vitrine',
  identificacao: 'parou no celular',
  modo_entrega: 'parou na entrega/retirada',
  endereco: 'parou no endereço',
  cardapio: 'estava no cardápio',
};

/** Monta um ClienteCRM mínimo para reusar o modal de voucher. */
function comoCliente(a: Abandono): ClienteCRM {
  const agora = new Date().toISOString();
  return {
    id: String(a.customer_id),
    nome: a.customer_name || 'Cliente',
    celular: a.phone || '',
    email: null,
    cpf: null,
    dataNascimento: null,
    genero: null,
    notes: null,
    manualTags: [],
    aceitaMarketing: false,
    ultimoContato: null,
    primeiraVisita: a.started_at || agora,
    ultimaVisita: a.last_seen_at || agora,
    totalVisitas: 0,
    valorTotal: 0,
    ticketMedio: 0,
    itensFavoritos: [],
    pedidos: [],
    tags: ['novo'],
  };
}

/** Regra salva no servidor -> o que a tela mostra (o que nunca foi salvo entra com o padrão). */
function deCfg(c: CartRecoveryCfg): Rascunho {
  return {
    enabled: c.enabled === true,
    delay_min: Number(c.delay_min) || 30,
    voucher_type: c.voucher_type === 'valor' ? 'valor' : 'percentual',
    voucher_value: c.voucher_value == null ? 10 : Number(c.voucher_value) || 0,
    validade_dias: Number(c.validade_dias) || 7,
    mensagem: c.mensagem ?? '',
  };
}

const numeroBr = (n: number) => String(n).replace('.', ',');
/** "10%" ou "R$ 15,00" */
const descontoTxt = (tipo: 'percentual' | 'valor', valor: number) => (tipo === 'valor' ? fmtMoeda(valor) : numeroBr(valor) + '%');

export default function NaoPediramPanel(props: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const { hasPermissao } = usePermissoes();
  // Mesmo critério da aba Clientes e do servidor: o dono ou quem tem "emitir voucher".
  const podeEditar = user?.perfil === 'admin' || hasPermissao('gestao_vouchers');

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [abandonos, setAbandonos] = useState<Abandono[]>([]);
  const [cfg, setCfg] = useState<CartRecoveryCfg>({ enabled: false }); // como está salvo
  const [cfgOk, setCfgOk] = useState(false); // só mexe na regra depois de ler a que existe (senão gravaria o padrão por cima)
  const [rasc, setRasc] = useState<Rascunho>(deCfg({ enabled: false }));
  const rascIniciado = useRef(false);
  const [cupomAberto, setCupomAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [dias, setDias] = useState(7);
  const [aba, setAba] = useState<'carrinho' | 'visita'>('carrinho');

  // Trocou de loja: a regra da anterior não fica na tela.
  useEffect(function () {
    rascIniciado.current = false;
    setCfgOk(false);
    setCfg({ enabled: false });
  }, [user?.tenantId]);

  useEffect(function () {
    let vivo = true;
    if (!user?.tenantId) return;
    setCarregando(true);
    setErro('');
    invokeWithAuth<{ abandonos?: Abandono[]; cart_recovery?: CartRecoveryCfg; error?: string; message?: string }>(
      'delivery-write',
      { body: { action: 'list_abandoned_carts', tenant_id: user.tenantId, days: dias } },
    ).then(function (res) {
      if (!vivo) return;
      setCarregando(false);
      if (res.error) { setErro(res.error.message); return; }
      const data = res.data;
      if (!data || data.error) { setErro(data?.message || data?.error || 'Não foi possível carregar.'); return; }
      setAbandonos(data.abandonos ?? []);
      const regra = data.cart_recovery ?? { enabled: false };
      setCfg(regra);
      setCfgOk(true);
      // O rascunho só nasce da primeira leitura: trocar o período não apaga o que a pessoa está digitando.
      if (!rascIniciado.current) { setRasc(deCfg(regra)); rascIniciado.current = true; }
    });
    return function () { vivo = false; };
  }, [user?.tenantId, dias, recarga]);

  const mudou = JSON.stringify(rasc) !== JSON.stringify(deCfg(cfg));
  const detalhes = cupomAberto || mudou;
  const semEdicao = !podeEditar || salvando;
  const mudarRasc = function (patch: Partial<Rascunho>) { setRasc(function (r) { return { ...r, ...patch }; }); };

  async function salvarCupom() {
    if (!user?.tenantId || salvando || !podeEditar) return;
    if (rasc.enabled && !(rasc.voucher_value > 0)) {
      toast.error('Falta o desconto', 'Coloque quanto é o desconto, ou desligue o cupom sugerido.');
      return;
    }
    if (rasc.voucher_type === 'percentual' && rasc.voucher_value > 100) {
      toast.error('Desconto alto demais', 'O desconto em % não pode passar de 100.');
      return;
    }
    setSalvando(true);
    const res = await invokeWithAuth<{ ok?: boolean; cart_recovery?: CartRecoveryCfg; error?: string; message?: string }>(
      'delivery-write',
      { body: { action: 'save_cart_recovery', tenant_id: user.tenantId, cart_recovery: { ...rasc, mensagem: rasc.mensagem.trim() } } },
    );
    setSalvando(false);
    if (res.error) { toast.error('Não salvou o cupom sugerido', res.error.message); return; }
    const d = res.data;
    if (!d || d.error || !d.cart_recovery) {
      toast.error('Não salvou o cupom sugerido', d?.message || d?.error || 'O servidor não confirmou a mudança.');
      return;
    }
    // O servidor ajusta limites (ex.: espera mínima de 5 min); a tela passa a mostrar o que ficou valendo.
    setCfg(d.cart_recovery);
    setRasc(deCfg(d.cart_recovery));
    toast.success('Cupom sugerido salvo', d.cart_recovery.enabled ? 'Os botões da lista já mostram o cupom.' : 'A lista não sugere mais cupom.');
    setRecarga(function (n) { return n + 1; }); // a espera (delay_min) muda quem aparece na lista
  }

  // A regra SALVA (não a que está sendo digitada) é a que vale nos botões e na mensagem.
  const ofertaSugerida: OfertaVoucher | undefined = cfg.enabled === true && Number(cfg.voucher_value) > 0
    ? { tipo: cfg.voucher_type === 'valor' ? 'discount_fixed' : 'discount_percent', valor: Number(cfg.voucher_value), validadeDias: Number(cfg.validade_dias) || 7 }
    : undefined;
  const rotuloCupom = ofertaSugerida
    ? 'Mandar cupom de ' + descontoTxt(cfg.voucher_type === 'valor' ? 'valor' : 'percentual', ofertaSugerida.valor)
    : 'Voucher';

  const comCarrinho = abandonos.filter(function (a) { return a.tipo === 'carrinho'; });
  const soVisita = abandonos.filter(function (a) { return a.tipo === 'visita'; });
  const lista = aba === 'carrinho' ? comCarrinho : soVisita;
  const valorParado = comCarrinho.reduce(function (s, a) { return s + a.cart_total; }, 0);

  function mensagemSugerida(a: Abandono): string {
    const primeiroNome = (a.customer_name || '').split(' ')[0];
    const ola = primeiroNome ? `Oi, ${primeiroNome}! ` : 'Oi! ';
    if (cfg.mensagem) return ola + cfg.mensagem;
    if (a.tipo === 'carrinho') {
      const item = a.cart_items && a.cart_items.length > 0 ? a.cart_items[0].nome : 'seu pedido';
      return ola + `vi que você montou um pedido com ${item} e não finalizou. Posso ajudar a fechar?`;
    }
    return ola + 'passou no nosso cardápio hoje! Qualquer dúvida é só chamar 😊';
  }

  function abrirWhatsapp(a: Abandono) {
    if (!a.phone) return;
    const numero = a.phone.replace(/\D/g, '');
    const comDDI = numero.length <= 11 ? '55' + numero : numero;
    window.open('https://wa.me/' + comDDI + '?text=' + encodeURIComponent(mensagemSugerida(a)), '_blank');
  }

  const resumoRegra = `Quem saiu há mais de ${rasc.delay_min} min ganha ${descontoTxt(rasc.voucher_type, rasc.voucher_value)} de desconto, que vale por ${rasc.validade_dias} dias.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={props.onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={function (e) { e.stopPropagation(); }}
      >
        {/* Cabeçalho */}
        <div className="px-5 py-4 border-b border-zinc-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <i className="ri-shopping-cart-2-line text-amber-500" /> Entraram e não pediram
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Cardápio do delivery — quem abriu e saiu sem fechar pedido
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={String(dias)}
              onChange={function (e) { setDias(Number(e.target.value)); }}
              className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs text-zinc-600 cursor-pointer focus:outline-none"
            >
              <option value="1">Últimas 24h</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
            </select>
            <button onClick={props.onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
              <i className="ri-close-line text-zinc-500" />
            </button>
          </div>
        </div>

        {/* Resumo + abas */}
        <div className="px-5 py-3 border-b border-zinc-100 flex flex-wrap items-center gap-2">
          {([
            ['carrinho', 'Montaram carrinho', comCarrinho.length],
            ['visita', 'Só espiaram', soVisita.length],
          ] as const).map(function ([key, label, count]) {
            return (
              <button
                key={key}
                onClick={function () { setAba(key); }}
                className={'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1.5 ' +
                  (aba === key ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200')}
              >
                {label}
                <span className={'px-1.5 py-0.5 rounded-full text-[10px] ' + (aba === key ? 'bg-white/30' : 'bg-zinc-200 text-zinc-600')}>
                  {count}
                </span>
              </button>
            );
          })}
          {valorParado > 0 && (
            <span className="ml-auto text-xs text-zinc-500">
              <strong className="text-zinc-800">{fmtMoeda(valorParado)}</strong> parados em carrinhos
            </span>
          )}
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Cupom sugerido: a regra mora aqui, junto da lista */}
          {cfgOk && (
            <div className="border border-amber-200 bg-gradient-to-b from-amber-50/80 to-white rounded-2xl px-4 py-3.5">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0"><i className="ri-coupon-3-line" /></span>
                <h4 className="text-[13px] font-extrabold text-zinc-900">Cupom sugerido</h4>
              </div>
              <LinhaInterruptor
                titulo="Sugerir cupom nesta lista"
                texto={!rasc.enabled ? 'Desligado: a lista só chama no WhatsApp' : detalhes ? 'Ligado' : resumoRegra}
                ligado={rasc.enabled}
                onChange={function (v) { mudarRasc({ enabled: v }); }}
                disabled={semEdicao}
              />

              {detalhes ? (
                <div className="mt-3 pt-3 border-t border-amber-100 space-y-3">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[13px] text-zinc-700">
                    <span>Quem saiu há mais de</span>
                    <CampoNumero valor={rasc.delay_min} onChange={function (n) { mudarRasc({ delay_min: Math.round(n) }); }}
                      sufixo="min" casas={0} largura="w-10" rotulo="Minutos sem voltar" disabled={semEdicao} />
                    <span>ganha</span>
                    <CampoNumero valor={rasc.voucher_value}
                      onChange={function (n) { mudarRasc({ voucher_value: rasc.voucher_type === 'percentual' ? Math.min(100, Math.round(n)) : n }); }}
                      prefixo={rasc.voucher_type === 'valor' ? 'R$' : undefined} sufixo={rasc.voucher_type === 'percentual' ? '%' : undefined}
                      casas={rasc.voucher_type === 'valor' ? 2 : 0} largura={rasc.voucher_type === 'valor' ? 'w-16' : 'w-10'} rotulo="Desconto" disabled={semEdicao} />
                    <span>de desconto, que vale por</span>
                    <CampoNumero valor={rasc.validade_dias} onChange={function (n) { mudarRasc({ validade_dias: Math.round(n) }); }}
                      sufixo="dias" casas={0} largura="w-8" rotulo="Dias de validade" disabled={semEdicao} />
                    <span className="-ml-1">.</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11.5px] font-bold text-zinc-500 mr-1">Desconto em</span>
                    {([['percentual', '%'], ['valor', 'R$']] as const).map(function ([tipo, rotulo]) {
                      const ativo = rasc.voucher_type === tipo;
                      return (
                        <button key={tipo} type="button" disabled={semEdicao} aria-pressed={ativo}
                          onClick={function () { mudarRasc({ voucher_type: tipo, voucher_value: tipo === 'percentual' ? Math.min(100, Math.round(rasc.voucher_value)) : rasc.voucher_value }); }}
                          className={'h-8 min-w-[44px] px-3 rounded-full border text-[12.5px] font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ' +
                            (ativo ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300')}>
                          {rotulo}
                        </button>
                      );
                    })}
                  </div>

                  <div>
                    <label htmlFor="cupom-mensagem" className="block text-xs font-bold text-zinc-600 mb-1">Mensagem que vai junto</label>
                    <textarea id="cupom-mensagem" rows={3} value={rasc.mensagem} disabled={semEdicao} maxLength={500}
                      onChange={function (e) { mudarRasc({ mensagem: e.target.value }); }}
                      placeholder="Ex.: Vi que você montou um pedido e não finalizou! Separei um cupom pra você 😊"
                      className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm outline-none focus:border-amber-400 disabled:opacity-60" />
                    <p className="text-[11px] text-zinc-400 mt-1">Em branco, usa uma mensagem padrão. O nome da pessoa entra na frente ("Oi, Mariana!").</p>
                  </div>

                  {!podeEditar ? (
                    <p className="text-[11.5px] text-zinc-500 bg-zinc-50 rounded-xl px-3 py-2">Quem muda é quem emite cupom (permissão de Vouchers). Você só pode ver.</p>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      {mudou ? (
                        <>
                          <button type="button" disabled={salvando} onClick={function () { setRasc(deCfg(cfg)); }} className={btn('out', 'sm')}>Desfazer</button>
                          <button type="button" disabled={salvando} onClick={function () { void salvarCupom(); }} className={btn('p', 'sm')}>
                            {salvando ? <><i className="ri-loader-4-line animate-spin" />Salvando…</> : 'Salvar'}
                          </button>
                        </>
                      ) : (
                        <button type="button" onClick={function () { setCupomAberto(false); }} className={btn('ghost', 'sm')}>Fechar</button>
                      )}
                      <span className="text-[11px] text-zinc-400">O envio continua sendo um clique seu.</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2">
                  <button type="button" onClick={function () { setCupomAberto(true); }} className={btn('ghost', 'sm')}>
                    <i className={podeEditar ? 'ri-equalizer-line' : 'ri-eye-line'} />{podeEditar ? 'Ajustar o cupom e a mensagem' : 'Ver a regra'}
                  </button>
                  {!podeEditar && <p className="text-[11px] text-zinc-400 mt-1">Quem muda é quem emite cupom (permissão de Vouchers).</p>}
                </div>
              )}
            </div>
          )}

          {/* Lista */}
          {carregando ? (
            <p className="text-xs text-zinc-400 text-center py-8">Carregando…</p>
          ) : erro ? (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{erro}</div>
          ) : lista.length === 0 ? (
            <div className="text-center py-10">
              <i className="ri-emotion-happy-line text-3xl text-zinc-300" />
              <p className="text-xs text-zinc-400 mt-2">
                {aba === 'carrinho' ? 'Nenhum carrinho abandonado no período.' : 'Ninguém entrou e saiu sem pedir no período.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {lista.map(function (a) {
                return (
                  <div key={a.id} className="border border-zinc-100 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-zinc-800 truncate">
                          {a.customer_name || (a.phone_fmt ? 'Sem cadastro' : 'Visitante anônimo')}
                        </span>
                        {a.phone_fmt && <span className="text-xs text-zinc-500">{a.phone_fmt}</span>}
                        <span className="text-[10px] text-zinc-400">{haQuanto(a.last_seen_at)}</span>
                      </div>
                      {a.tipo === 'carrinho' ? (
                        <p className="text-[11px] text-zinc-500 mt-1 truncate">
                          {a.items_count} {a.items_count === 1 ? 'item' : 'itens'} · <strong>{fmtMoeda(a.cart_total)}</strong>
                          {a.cart_items && a.cart_items.length > 0
                            ? ' · ' + a.cart_items.map(function (i) { return i.qtd + '× ' + i.nome; }).join(', ')
                            : ''}
                        </p>
                      ) : (
                        <p className="text-[11px] text-zinc-400 mt-1">
                          {a.last_step ? (PASSO_LABEL[a.last_step] ?? a.last_step) : 'abriu o cardápio'} e saiu
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                      {a.phone && (
                        <button
                          onClick={function () { abrirWhatsapp(a); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-green-200 bg-green-50 hover:bg-green-100 text-green-700"
                        >
                          <i className="ri-whatsapp-line" /> Chamar
                        </button>
                      )}
                      {a.customer_id && (
                        <button
                          onClick={function () { props.onEnviarVoucher(comoCliente(a), ofertaSugerida); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700"
                        >
                          <i className="ri-coupon-3-line" /> {rotuloCupom}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
