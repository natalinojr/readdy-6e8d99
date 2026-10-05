// Aba "Descontos" de Clientes & Marketing: junta as antigas abas Promoções e Vouchers numa tela só,
// de cima para baixo, pela pergunta "para quem é o desconto?":
//  1. Para todo mundo   — preço promocional do Cardápio (vale no caixa, garçom, QR e delivery).
//  2. Para uma pessoa   — vouchers, gift cards e links enviados.
//  3. Regras de desconto e cupons — recolhida: ainda não aplica em nenhuma venda (ver PromocoesAba).
// As permissões chegam de fora: `podePromocoes` mostra 1 e 3, `podeVouchers` mostra 2.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import { PrecoPromocionalCardapio, RegrasDescontoSecao } from './PromocoesAba';
import { VouchersPainel } from './VouchersAba';

export interface DescontosAbaProps {
  /** Mostra "Para todo mundo" e "Regras de desconto e cupons". */
  podePromocoes: boolean;
  /** Mostra "Para uma pessoa" (vouchers e gift cards). */
  podeVouchers: boolean;
  /** Ao montar, rola suavemente até esta seção (ex.: link antigo ?aba=vouchers). */
  secaoInicial?: 'promocoes' | 'vouchers';
}

function Secao({ icone, iconeCor, titulo, subtitulo, children }: {
  icone: string;
  iconeCor: string;
  titulo: string;
  subtitulo: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-white border border-zinc-100 rounded-2xl p-4 md:p-5 space-y-3">
      <header className="min-w-0">
        <h2 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
          <i className={`${icone} ${iconeCor}`} /> {titulo}
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">{subtitulo}</p>
      </header>
      {children}
    </section>
  );
}

export default function DescontosAba({ podePromocoes, podeVouchers, secaoInicial }: DescontosAbaProps) {
  const { loading: cardapioLoading } = useCardapio();
  const promocoesRef = useRef<HTMLDivElement>(null);
  const vouchersRef = useRef<HTMLDivElement>(null);
  // Última seção já rolada: a rolagem inicial acontece uma vez por pedido, não a cada render.
  const rolouPara = useRef<string | null>(null);

  useEffect(() => {
    if (!secaoInicial || rolouPara.current === secaoInicial) return;
    // "Para uma pessoa" fica abaixo da lista do cardápio, que muda de altura quando termina de
    // carregar — rolar antes disso deixaria a seção fora do lugar.
    if (secaoInicial === 'vouchers' && podePromocoes && cardapioLoading) return;
    const alvo = secaoInicial === 'vouchers' ? vouchersRef.current : promocoesRef.current;
    if (!alvo) return; // sem permissão para essa seção: nada a rolar
    rolouPara.current = secaoInicial;
    alvo.scrollIntoView({ block: 'start' }); // instantâneo: a rolagem suave parava no meio quando a lista acabava de carregar
  }, [secaoInicial, podePromocoes, cardapioLoading]);

  if (!podePromocoes && !podeVouchers) return null;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {podePromocoes && (
        <div id="descontos-promocoes" ref={promocoesRef} className="scroll-mt-4">
          <Secao
            icone="ri-group-line"
            iconeCor="text-rose-500"
            titulo="Para todo mundo"
            subtitulo="Preço promocional do cardápio · vale no caixa, garçom, QR e delivery"
          >
            <PrecoPromocionalCardapio />
          </Secao>
        </div>
      )}

      {podeVouchers && (
        <div id="descontos-vouchers" ref={vouchersRef} className="scroll-mt-4">
          <Secao
            icone="ri-gift-line"
            iconeCor="text-rose-500"
            titulo="Para uma pessoa"
            subtitulo="Vouchers, gift cards e links enviados"
          >
            <VouchersPainel embutido />
          </Secao>
        </div>
      )}

      {podePromocoes && (
        <div id="descontos-regras" className="scroll-mt-4">
          <RegrasDescontoSecao />
        </div>
      )}
    </div>
  );
}
