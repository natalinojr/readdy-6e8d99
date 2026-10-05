import { describe, it, expect } from 'vitest';
import type { PedidoRecente } from '@/types/pdv';
import { rotuloEscolha } from '@/pages/pedidos/components/novo/PeriodoFolha';
import { pedidosPorHora } from '@/pages/pedidos/components/novo/HorasFolha';
import { celulaCsv, montarCsv, nomeArquivoCsv } from '@/pages/pedidos/lib/exportar';

const HOJE = '2026-10-04';

function ped(over: Partial<PedidoRecente> = {}): PedidoRecente {
  return {
    id: 'p1', numero: 48, numeroCodigo: 'P0410260048', destino: 'senha', senha: 'P-14',
    status: 'delivered', pago: true, total: 50, criadoEm: '19:11', dataPedido: HOJE, minutosAtras: 30,
    itensProntos: 1, itensTotal: 1, origem: 'autoatendimento', itensDetalhes: [],
    ...over,
  } as PedidoRecente;
}
const item = (nome: string, over: Partial<PedidoRecente['itensDetalhes'][0]> = {}) => ({
  id: nome, nome, quantidade: 2, preco: 12.5, estacao: 'Chapa', opcoes: ['Sem cebola'], ...over,
}) as PedidoRecente['itensDetalhes'][0];

describe('rotuloEscolha', () => {
  it('atalhos', () => {
    expect(rotuloEscolha({ modo: 'preset', preset: 'hoje' }, HOJE)).toBe('Hoje');
    expect(rotuloEscolha({ modo: 'preset', preset: '7dias' }, HOJE)).toBe('Últimos 7 dias');
    expect(rotuloEscolha({ modo: 'preset', preset: 'todos' }, HOJE)).toBe('Todos os dias');
  });
  it('dia, período, mês e ano', () => {
    expect(rotuloEscolha({ modo: 'dia', dia: '2026-10-03' }, HOJE)).toBe('03/10/2026');
    expect(rotuloEscolha({ modo: 'periodo', inicio: '2026-10-01', fim: '2026-10-04' }, HOJE)).toBe('01/10 → 04/10');
    expect(rotuloEscolha({ modo: 'mes', mes: 8, ano: 2026 }, HOJE)).toBe('Setembro 2026');
    expect(rotuloEscolha({ modo: 'ano', ano: 2025 }, HOJE)).toBe('2025');
  });
  it('período que sai do ano de hoje mostra o ano', () => {
    expect(rotuloEscolha({ modo: 'periodo', inicio: '2025-12-28', fim: '2026-01-03' }, HOJE)).toBe('28/12/2025 → 03/01/2026');
  });
});

describe('pedidosPorHora', () => {
  it('conta por hora, sem cancelado, e acha o pico', () => {
    const r = pedidosPorHora([
      ped({ id: 'a', criadoEm: '19:05' }), ped({ id: 'b', criadoEm: '19:40' }), ped({ id: 'c', criadoEm: '20:10' }),
      ped({ id: 'd', criadoEm: '19:50', status: 'cancelled' }),
    ]);
    expect(r).toEqual([{ hora: '19h', pedidos: 2 }, { hora: '20h', pedidos: 1 }]);
  });
  it('turno que passa da meia-noite fica em ordem e preenche as horas vazias', () => {
    const r = pedidosPorHora([
      ped({ id: 'a', criadoEm: '22:10' }), ped({ id: 'b', criadoEm: '00:20' }), ped({ id: 'c', criadoEm: '23:30' }),
      ped({ id: 'd', criadoEm: '17:00' }),
    ]);
    expect(r.map((x) => x.hora)).toEqual(['17h', '18h', '19h', '20h', '21h', '22h', '23h', '0h']);
    expect(r.find((x) => x.hora === '18h')?.pedidos).toBe(0);
    expect(r.find((x) => x.hora === '0h')?.pedidos).toBe(1);
  });
  it('pagos juntos contam cada pedido original', () => {
    const o1 = ped({ id: 'o1', criadoEm: '18:00' });
    const o2 = ped({ id: 'o2', criadoEm: '19:00' });
    const grupo = ped({ id: 'group-1', criadoEm: '19:00', pedidoIds: ['o1', 'o2'], pedidosOriginais: [o1, o2] });
    expect(pedidosPorHora([grupo])).toEqual([{ hora: '18h', pedidos: 1 }, { hora: '19h', pedidos: 1 }]);
  });
  it('vazio quando só há cancelados', () => {
    expect(pedidosPorHora([ped({ status: 'cancelled' })])).toEqual([]);
    expect(pedidosPorHora([])).toEqual([]);
  });
});

describe('exportar CSV', () => {
  it('célula com = + - @ ganha apóstrofo e aspas são duplicadas', () => {
    expect(celulaCsv('=SOMA(A1)')).toBe(`"'=SOMA(A1)"`);
    expect(celulaCsv('+55')).toBe(`"'+55"`);
    expect(celulaCsv('Ana "Boa"')).toBe('"Ana ""Boa"""');
    expect(celulaCsv(12)).toBe('"12"');
  });

  it('resumo: uma linha por pedido, item cancelado fora, vírgula decimal e ; como separador', () => {
    const p = ped({
      itensDetalhes: [item('X-Burger'), item('Chope', { quantidade: 1, cancelado: true })],
      total: 25, tempoAberto: 12,
    });
    const linhas = montarCsv([p], 'resumo').split('\n');
    expect(linhas).toHaveLength(2);
    expect(linhas[0].split(';')).toHaveLength(15);
    expect(linhas[1]).toContain('"2x X-Burger"');
    expect(linhas[1]).not.toContain('Chope');
    expect(linhas[1]).toContain('"25,00"');
    expect(linhas[1]).toContain('"Entregue"');
    expect(linhas[1]).toContain('"Pago"');
  });

  it('detalhado: uma linha por item, sem o cancelado', () => {
    const p = ped({ itensDetalhes: [item('X-Burger'), item('Batata', { preco: 8 }), item('Chope', { cancelado: true })], total: 33 });
    const linhas = montarCsv([p], 'detalhado').split('\n');
    expect(linhas).toHaveLength(3);
    expect(linhas[0].split(';')).toHaveLength(21);
    expect(linhas[2]).toContain('"16,00"'); // subtotal da batata: 2 x 8
    expect(linhas.join('\n')).not.toContain('Chope');
  });

  it('pagos juntos exporta cada pedido original', () => {
    const o1 = ped({ id: 'o1', numero: 31, itensDetalhes: [item('A')], total: 10 });
    const o2 = ped({ id: 'o2', numero: 34, itensDetalhes: [item('B')], total: 20 });
    const grupo = ped({ id: 'group-1', numero: 34, total: 30, itensDetalhes: [item('A'), item('B')], pedidoIds: ['o1', 'o2'], pedidosOriginais: [o1, o2] });
    const linhas = montarCsv([grupo], 'resumo').split('\n');
    expect(linhas).toHaveLength(3);
    expect(linhas[1]).toContain('"0031"');
    expect(linhas[2]).toContain('"0034"');
  });

  it('nome do arquivo não leva barra nem seta', () => {
    expect(nomeArquivoCsv('resumo', 'Hoje', HOJE)).toBe('pedidos_Hoje_2026-10-04.csv');
    expect(nomeArquivoCsv('detalhado', '01/10 → 04/10', HOJE)).toBe('pedidos_detalhado_01-10_04-10_2026-10-04.csv');
  });
});
