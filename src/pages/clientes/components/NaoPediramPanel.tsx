// Painel "Não pediram": quem entrou no cardápio do delivery e saiu sem pedido.
//
// Duas situações, lidas de menu_visits (action list_abandoned_carts):
//  - "carrinho": montou carrinho e não finalizou -> a maior chance de recuperar;
//  - "visita": abriu o cardápio e saiu sem colocar nada.
//
// O envio é sempre um clique humano (WhatsApp ou voucher). Quando a loja liga
// "Recuperar carrinho abandonado" em Config. Delivery, o ERPOS passa a sugerir
// o voucher aqui — nada sai sozinho.
import { useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ClienteCRM } from '@/hooks/useClientes';

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

interface Props {
  onClose: () => void;
  /** Abre o modal de voucher para um cliente já cadastrado. */
  onEnviarVoucher: (cliente: ClienteCRM) => void;
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

export default function NaoPediramPanel(props: Props) {
  const { user } = useAuth();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [abandonos, setAbandonos] = useState<Abandono[]>([]);
  const [cfg, setCfg] = useState<CartRecoveryCfg>({ enabled: false });
  const [dias, setDias] = useState(7);
  const [aba, setAba] = useState<'carrinho' | 'visita'>('carrinho');

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
      setCfg(data.cart_recovery ?? { enabled: false });
    });
    return function () { vivo = false; };
  }, [user?.tenantId, dias]);

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

        {/* Aviso da configuração */}
        {!cfg.enabled && (
          <div className="mx-5 mt-3 flex items-start gap-2 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg">
            <i className="ri-information-line text-zinc-400 text-sm mt-0.5" />
            <p className="text-[11px] text-zinc-500">
              A oferta de voucher está <strong>desligada</strong>. Para ligar: Config. Delivery › Recuperar carrinho
              abandonado. Mesmo desligada, você pode chamar no WhatsApp ou mandar voucher manualmente aqui.
            </p>
          </div>
        )}
        {cfg.enabled && (
          <div className="mx-5 mt-3 flex items-start gap-2 px-3 py-2 bg-green-50 border border-green-100 rounded-lg">
            <i className="ri-coupon-3-line text-green-500 text-sm mt-0.5" />
            <p className="text-[11px] text-green-700">
              Voucher sugerido:{' '}
              <strong>
                {cfg.voucher_type === 'valor'
                  ? fmtMoeda(Number(cfg.voucher_value ?? 0)) + ' de desconto'
                  : String(cfg.voucher_value ?? 0) + '% de desconto'}
              </strong>{' '}
              válido por {cfg.validade_dias ?? 7} dias. O envio continua sendo um clique seu.
            </p>
          </div>
        )}

        {/* Lista */}
        <div className="flex-1 overflow-auto p-5">
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
                    <div className="flex items-center gap-1.5 flex-shrink-0">
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
                          onClick={function () { props.onEnviarVoucher(comoCliente(a)); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700"
                        >
                          <i className="ri-coupon-3-line" /> Voucher
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
