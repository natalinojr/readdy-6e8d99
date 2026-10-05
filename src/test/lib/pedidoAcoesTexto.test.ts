import { describe, it, expect } from 'vitest';
import type { PedidoRecente } from '@/types/pdv';
import { rotuloNumero, textoWhatsapp, totalRecebido, itensAtivos, ehGrupo, moedaTexto } from '@/pages/pedidos/lib/textoPedido';
import { buildResumoHTML } from '@/pages/pedidos/lib/imprimirResumo';
import { recenteParaKds } from '@/pages/pedidos/lib/recenteParaKds';

function item(over: Partial<PedidoRecente['itensDetalhes'][0]> = {}): PedidoRecente['itensDetalhes'][0] {
  return { id: 'i1', nome: 'Taco al pastor', quantidade: 2, preco: 30, estacao: 'Chapa', opcoes: [], unidades: [], ...over };
}
function ped(over: Partial<PedidoRecente> = {}): PedidoRecente {
  return {
    id: 'p1', numero: 48, numeroCodigo: 'P0410260048', destino: 'senha', senha: 'P-14',
    status: 'ready', pago: false, total: 122, criadoEm: '19:11', dataPedido: '2026-10-04', minutosAtras: 30,
    itensProntos: 0, itensTotal: 3, origem: 'caixa', _criadoTs: '2026-10-04T22:11:00.000Z',
    itensDetalhes: [item(), item({ id: 'i2', nome: 'Guacamole', quantidade: 1, preco: 62 })],
    ...over,
  } as PedidoRecente;
}

describe('rotuloNumero / ehGrupo', () => {
  it('pedido solto usa o número curto', () => {
    expect(rotuloNumero(ped())).toBe('#048');
    expect(ehGrupo(ped())).toBe(false);
  });
  it('pagos juntos lista os números dos pedidos', () => {
    const a = ped({ id: 'a', numeroCodigo: 'P0410260048' });
    const b = ped({ id: 'b', numeroCodigo: 'P0410260049' });
    const g = ped({ id: 'group-x', numeroCodigo: 'P0410260048, P0410260049', pedidoIds: ['a', 'b'], pedidosOriginais: [a, b] });
    expect(ehGrupo(g)).toBe(true);
    expect(rotuloNumero(g)).toBe('#048 + #049');
  });
});

describe('textoWhatsapp', () => {
  it('cabeçalho com a loja, itens e total (sem item cancelado)', () => {
    const p = ped({ itensDetalhes: [item(), item({ id: 'i2', nome: 'Guacamole', quantidade: 1, preco: 62 }), item({ id: 'i3', nome: 'Cancelado', cancelado: true })] });
    expect(textoWhatsapp(p, 'El Patrón')).toBe('Pedido #048 — El Patrón\n2× Taco al pastor\n1× Guacamole\nTotal R$ 122,00');
  });
  it('sem nome da loja não deixa travessão solto', () => {
    expect(textoWhatsapp(ped(), '  ').split('\n')[0]).toBe('Pedido #048');
  });
  it('moeda sem espaço não quebrável', () => {
    expect(moedaTexto(1234.5)).toBe('R$ 1.234,50');
  });
});

describe('totalRecebido / itensAtivos', () => {
  it('soma só o que não foi estornado', () => {
    const pg = (amount: number, is_refunded = false) => ({ id: String(amount), amount, change_amount: 0, is_refunded, payment_method_name: null });
    expect(totalRecebido([pg(50), pg(20, true), pg(10)])).toBe(60);
    expect(totalRecebido(undefined)).toBe(0);
  });
  it('tira item cancelado', () => {
    expect(itensAtivos(ped({ itensDetalhes: [item(), item({ id: 'x', cancelado: true })] }))).toHaveLength(1);
  });
});

describe('buildResumoHTML', () => {
  const agora = new Date('2026-10-04T22:30:00.000Z');
  it('mostra número curto, itens ativos e total', () => {
    const html = buildResumoHTML(ped({ itensDetalhes: [item(), item({ id: 'x', nome: 'Item cancelado', cancelado: true })] }), agora);
    expect(html).toContain('PEDIDO #048');
    expect(html).toContain('2x Taco al pastor');
    expect(html).not.toContain('Item cancelado');
    expect(html).toContain('R$ 122,00');
    expect(html).toContain('PENDENTE');
  });
  it('rodapé conforme a situação', () => {
    expect(buildResumoHTML(ped({ pago: true }), agora)).toContain('>PAGO<');
    expect(buildResumoHTML(ped({ status: 'cancelled' }), agora)).toContain('>CANCELADO<');
    expect(buildResumoHTML(ped({ cortesia: true, total: 0 }), agora)).toContain('>CORTESIA<');
  });
  it('escapa o nome do item', () => {
    const html = buildResumoHTML(ped({ itensDetalhes: [item({ nome: '<b>X</b>' })] }), agora);
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).not.toContain('<b>X</b>');
  });
});

describe('recenteParaKds', () => {
  it('leva itens ativos, opções e observação; item sem cozinha vira skip_kds', () => {
    const p = ped({
      itensDetalhes: [
        item({ opcoesDetalhadas: [{ nome: 'Queijo', preco: 3 }], opcoes: ['Queijo'], observacao: 'sem cebola' }),
        item({ id: 'b', nome: 'Água', estacao: '', unidades: [{ unidade: 1, status: 'pronto', semCozinha: true }] }),
        item({ id: 'c', nome: 'Cancelado', cancelado: true }),
      ],
    });
    const k = recenteParaKds(p);
    expect(k.itens.map((i) => i.nome)).toEqual(['Taco al pastor', 'Água']);
    expect(k.itens[0].opcoes).toEqual([{ grupoNome: '', opcaoNome: 'Queijo', additional_price: 3 }]);
    expect(k.itens[0].observacoes).toEqual(['sem cebola']);
    expect(k.itens[1].skip_kds).toBe(true);
    expect(k.itens[0].skip_kds).toBeUndefined();
    expect(k.numeroStr).toBe('P0410260048');
    expect(k.totalAmount).toBe(122);
    expect(k.criadoEm).toBe(new Date('2026-10-04T22:11:00.000Z').getTime());
  });
  it('delivery mantém destino delivery e leva endereço/telefone', () => {
    const k = recenteParaKds(ped({ origem: 'delivery', destino: 'nome', endereco: 'Rua A, 10', telefone: '41999998888', deliveryFee: 6 }));
    expect(k.destino).toBe('delivery');
    expect(k.deliveryAddress).toBe('Rua A, 10');
    expect(k.customerPhone).toBe('41999998888');
    expect(k.deliveryFee).toBe(6);
  });
  it('na_hora vira hora', () => {
    expect(recenteParaKds(ped({ destino: 'na_hora' })).destino).toBe('hora');
  });
});
