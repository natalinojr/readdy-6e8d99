import { describe, it, expect } from 'vitest';
import { nomeArquivoRelatorio, periodoParaNomeArquivo, conteudoCsvRelatorio, reais } from '@/lib/exportRelatorio';

describe('exportRelatorio', () => {
  it('período personalizado vira intervalo no nome', () => {
    expect(periodoParaNomeArquivo('custom:2026-09-01:2026-09-30')).toBe('2026-09-01_a_2026-09-30');
    expect(periodoParaNomeArquivo('custom:2026-09-05:2026-09-05')).toBe('2026-09-05');
    expect(nomeArquivoRelatorio('cancelamentos', 'custom:2026-09-01:2026-09-30')).toBe('cancelamentos_2026-09-01_a_2026-09-30.csv');
  });

  it('presets também viram datas (nunca "7 dias" com espaço)', () => {
    expect(nomeArquivoRelatorio('ranking-produtos', '7 dias')).toMatch(/^ranking-produtos_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(nomeArquivoRelatorio('x', 'Hoje')).toMatch(/^x_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('CSV tem BOM, ponto e vírgula, vírgula decimal e acento', () => {
    const csv = conteudoCsvRelatorio({ cabecalho: ['Item', 'Receita (R$)'], linhas: [['Pão de queijo', 12.5], ['=SOMA(A1)', reais(3.456)]] });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Item";"Receita (R$)"');
    expect(csv).toContain('"Pão de queijo";12,5');
    expect(csv).toContain("\"'=SOMA(A1)\";3,46");
  });
});
