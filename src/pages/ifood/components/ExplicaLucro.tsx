import Ajuda from '@/pages/estoque/components/inicio/Ajuda';

// Botão (?) com a conta do lucro bruto do iFood (dono, 05/10: "ter o botão de explicação pra mostrar qual é a conta feita").
export default function ExplicaLucro({ item = false }: { item?: boolean }) {
  return (
    <Ajuda titulo="Como é a conta do lucro bruto">
      {item ? (
        <>
          <b>Lucro bruto por unidade (sem promoções)</b> = preço do item no iFood − comissão e taxa de pagamento do iFood − a comida pela ficha técnica (com os complementos escolhidos).
          <br /><br />
          Comissão e taxa são a média da loja nos últimos 30 dias, calculadas sobre o preço do item. Promoções (desconto da loja, entrega grátis) não entram aqui: são de cada pedido — veja o custo real em Pedidos › Custos.
        </>
      ) : (
        <>
          <b>Lucro bruto</b> = vendas no iFood − comissão e taxas do iFood − desconto pago pela loja (inclui entrega grátis paga pela loja) − comida pela ficha técnica.
        </>
      )}
      <br /><br />
      Não desconta aluguel, salários, luz nem impostos. Antes de o iFood fechar o dia (no dia seguinte), comissão e taxas são estimadas pela média da loja nos últimos 30 dias (marcado com *). Item sem ficha deixa o lucro em aberto.
    </Ajuda>
  );
}
