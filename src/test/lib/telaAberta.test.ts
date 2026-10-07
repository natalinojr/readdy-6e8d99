import { describe, expect, it } from 'vitest';
import { criarDebounce, perfilRegistra, rotaParaTelemetria } from '@/lib/telaAberta';

describe('rotaParaTelemetria', () => {
  it('rotas de dentro do sistema entram sem query nem barra final', () => {
    expect(rotaParaTelemetria('/pedidos')).toBe('/pedidos');
    expect(rotaParaTelemetria('/pedidos/')).toBe('/pedidos');
    expect(rotaParaTelemetria('/financeiro?tab=painel')).toBe('/financeiro');
    expect(rotaParaTelemetria('/hoje/rotina')).toBe('/hoje/rotina');
  });
  it('ids e tokens viram :id', () => {
    expect(rotaParaTelemetria('/algo/12345')).toBe('/algo/:id');
    expect(rotaParaTelemetria('/algo/3f2b8c1e-1111-4222-8333-444455556666')).toBe('/algo/:id');
    expect(rotaParaTelemetria('/algo/abcdefghij0123456789xyz')).toBe('/algo/:id');
  });
  it('rotas públicas e de cliente nunca contam', () => {
    for (const r of ['/', '/login', '/delivery', '/mesa-qr/abc/def', '/mesa/3', '/pedido/abc', '/totem/xyz', '/autoatendimento',
      '/senhas/abc', '/r/abc', '/r/nome/abc', '/voucher/abc', '/clube/loja', '/p/0123456789abcdef', '/vila-delivery', '/motoboy/9', '/relatorio/abc']) {
      expect(rotaParaTelemetria(r)).toBeNull();
    }
  });
});

describe('perfilRegistra / debounce', () => {
  it('totem e tablet não registram', () => {
    expect(perfilRegistra('totem')).toBe(false);
    expect(perfilRegistra('tablet')).toBe(false);
    expect(perfilRegistra('admin')).toBe(true);
    expect(perfilRegistra(undefined)).toBe(false);
  });
  it('mesma chave só conta 1x por minuto', () => {
    let t = 1000;
    const pode = criarDebounce(60_000, () => t);
    expect(pode('a')).toBe(true);
    t += 30_000;
    expect(pode('a')).toBe(false);
    expect(pode('b')).toBe(true);
    t += 31_000;
    expect(pode('a')).toBe(true);
  });
});
