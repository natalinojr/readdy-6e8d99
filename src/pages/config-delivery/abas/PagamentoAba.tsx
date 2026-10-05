import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '@/contexts/ToastContext';
import { formaLigada, situacaoPagamentoOnline } from '../config';
import { useDeliveryTela } from '../DeliveryTela';
import { btn, CartaoAcao, Colunas, Interruptor, Manchete, Nota, PaginaDelivery, SecaoTitulo } from '../ui';

// Pedido › Pagamento (protótipo docs/prototipos/delivery-proposta.html, T.pagamento).
// Separado em "paga antes, pelo app" (Pix e cartão pelo Mercado Pago) e "paga na entrega". Cada forma "pelo
// app" diz se o cliente realmente a vê: ligar aqui não basta, o Mercado Pago da loja precisa estar ligado
// (e, no cartão, com a chave). Nada grava aqui: a barra "Salvar" da página grava.

const FORMAS_ENTREGA = [
  { chave: 'pix', titulo: 'Pix na entrega', texto: 'O motoboy leva o QR da loja', icone: 'ri-qr-code-line' },
  { chave: 'cartao_credito', titulo: 'Cartão de crédito', texto: 'Na maquininha', icone: 'ri-bank-card-line' },
  { chave: 'cartao_debito', titulo: 'Cartão de débito', texto: 'Na maquininha', icone: 'ri-bank-card-2-line' },
  { chave: 'dinheiro', titulo: 'Dinheiro', texto: 'O app pergunta se precisa de troco', icone: 'ri-money-dollar-circle-line' },
  { chave: 'vale_refeicao', titulo: 'Vale-refeição', texto: 'Na maquininha', icone: 'ri-coupon-line' },
];

type Situacao = { pix: boolean; cartao: boolean } | null | undefined; // undefined = conferindo, null = não consegui

function LinhaForma({ icone, titulo, ligado, tom, onChange, children }: {
  icone: string; titulo: string; ligado: boolean; tom: 'verde' | 'ambar' | 'cinza'; onChange: (v: boolean) => void; children: ReactNode;
}) {
  const cor = { verde: 'bg-emerald-50 text-emerald-700', ambar: 'bg-amber-50 text-amber-700', cinza: 'bg-zinc-100 text-zinc-500' }[tom];
  return (
    <div className="flex items-center gap-3 bg-white border border-zinc-200 rounded-2xl px-3.5 py-3">
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cor}`}><i className={`${icone} text-lg`} /></span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-extrabold text-zinc-900 leading-snug">{titulo}</p>
        <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{children}</p>
      </div>
      <Interruptor ligado={ligado} onChange={onChange} rotulo={titulo} />
    </div>
  );
}

export default function PagamentoAba() {
  const { tenantId, cfg, mudar } = useDeliveryTela();
  const toast = useToast();
  const formas = cfg.formasPagamento;

  // O que o cliente realmente vê do Mercado Pago (mesma checagem do cardápio do cliente).
  const [sit, setSit] = useState<Situacao>(undefined);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    setSit(undefined);
    void situacaoPagamentoOnline(tenantId).then((r) => { if (vivo) setSit(r); });
    return () => { vivo = false; };
  }, [tenantId, tentativa]);

  const pixAppLigado = formaLigada(formas, 'pix_online');
  const cartaoAppLigado = formaLigada(formas, 'cartao_online');

  /** Quantas formas o cliente vê com estas escolhas ("pelo app" só contam quando aparecem de verdade). */
  const vistas = (f: Record<string, boolean>) =>
    FORMAS_ENTREGA.filter((x) => f[x.chave] === true).length
    + (sit && formaLigada(f, 'pix_online') && sit.pix ? 1 : 0)
    + (sit && formaLigada(f, 'cartao_online') && sit.cartao ? 1 : 0);

  const alternar = (chave: string, ligar: boolean) => {
    const proximo = { ...formas, [chave]: ligar };
    // Não deixa o cliente sem nenhuma forma: só trava quando esta mudança tira a última que ele vê.
    if (!ligar && vistas(formas) > 0 && vistas(proximo) === 0) {
      toast.warning('Pelo menos uma forma fica ligada', 'O cliente precisa ter como pagar. Ligue outra antes de desligar esta.');
      return;
    }
    mudar({ formasPagamento: proximo });
  };

  const semNenhuma = sit != null && vistas(formas) === 0;
  const mpDesligado = sit != null && !sit.pix;

  // Frase de situação de uma forma "pelo app".
  const situacaoApp = (ligado: boolean, aparece: boolean, faltaCartao: boolean): ReactNode => {
    if (!ligado) return <span className="font-bold text-zinc-500">Desligado: o cliente não vê.</span>;
    if (sit === undefined) return <span className="font-bold text-zinc-400">Conferindo se aparece para o cliente…</span>;
    if (sit === null) return <span className="font-bold text-amber-700">Não consegui conferir o Mercado Pago agora.</span>;
    if (aparece) return <span className="font-extrabold text-emerald-700">Aparece para o cliente.</span>;
    return (
      <span className="font-extrabold text-amber-700">
        {mpDesligado ? 'Ligado, mas não aparece: o Mercado Pago está desligado.'
          : faltaCartao ? 'Ligado, mas não aparece: falta ligar o cartão ou pôr a chave dele no Mercado Pago.'
          : 'Ligado, mas não aparece para o cliente.'}
      </span>
    );
  };

  const tomApp = (ligado: boolean, aparece: boolean): 'verde' | 'ambar' | 'cinza' =>
    !ligado ? 'cinza' : sit && aparece ? 'verde' : 'ambar';

  return (
    <PaginaDelivery>
      <Manchete titulo="Como o cliente paga">O que estiver ligado aparece para o cliente antes de fechar o pedido.</Manchete>

      {semNenhuma && (
        <CartaoAcao tom="alerta" icone="ri-error-warning-line" titulo="O cliente não está vendo nenhuma forma de pagamento">
          Ligue pelo menos uma abaixo, senão ninguém consegue fechar o pedido.
        </CartaoAcao>
      )}

      <Colunas>
        <div className="min-w-0">
          <SecaoTitulo titulo="Paga antes, pelo app" />
          <div className="space-y-2">
            <LinhaForma icone="ri-qr-code-line" titulo="Pix pelo app" ligado={pixAppLigado}
              tom={tomApp(pixAppLigado, !!sit?.pix)} onChange={(v) => alternar('pix_online', v)}>
              {situacaoApp(pixAppLigado, !!sit?.pix, false)}{' '}
              {pixAppLigado && sit?.pix ? 'Cai na hora pelo Mercado Pago.' : null}
            </LinhaForma>
            <LinhaForma icone="ri-bank-card-line" titulo="Cartão de crédito pelo app" ligado={cartaoAppLigado}
              tom={tomApp(cartaoAppLigado, !!sit?.cartao)} onChange={(v) => alternar('cartao_online', v)}>
              {situacaoApp(cartaoAppLigado, !!sit?.cartao, true)}{' '}
              {cartaoAppLigado && sit?.cartao ? 'Pago agora no celular, à vista.' : null}
            </LinhaForma>
          </div>

          <div className="flex gap-2 flex-wrap mt-2.5">
            <Link to="/configuracoes?tab=estacoes&subtab=pagamentos" className={btn('out', 'sm')}>
              <i className="ri-settings-3-line" />Configurações › Pagamentos
            </Link>
            {sit === null && (
              <button type="button" className={btn('ghost', 'sm')} onClick={() => setTentativa((t) => t + 1)}>Conferir de novo</button>
            )}
          </div>
          {sit === null && (
            <Nota className="mt-2.5">Não deu para falar com o Mercado Pago agora, então não dá para dizer se o Pix e o cartão pelo app aparecem. As formas "pelo app" não contam como visíveis até conferir.</Nota>
          )}
        </div>

        <div className="min-w-0">
          <SecaoTitulo titulo="Paga na entrega" />
          <div className="space-y-2">
            {FORMAS_ENTREGA.map((f) => {
              const ligado = formas[f.chave] === true;
              return (
                <LinhaForma key={f.chave} icone={f.icone} titulo={f.titulo} ligado={ligado}
                  tom={ligado ? 'verde' : 'cinza'} onChange={(v) => alternar(f.chave, v)}>
                  {f.texto}
                </LinhaForma>
              );
            })}
          </div>
          <Nota className="mt-2.5">Pelo menos uma forma fica ligada: o app não deixa desligar a última que o cliente vê.</Nota>
        </div>
      </Colunas>
    </PaginaDelivery>
  );
}
