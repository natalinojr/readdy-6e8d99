// Gráfico por hora das ações rápidas: topo identificado como "pico" e, no dia de hoje, a linha
// principal para na hora atual (valor null) enquanto a da semana passada segue até o fim.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GraficoLinha } from '@/components/feature/assistente/acoes/painel';

describe('GraficoLinha', () => {
  it('mostra o pico e para a linha principal onde o valor é null', () => {
    const { container } = render(
      <GraficoLinha titulo="Faturado por hora" rotuloBase="sáb passada" pontos={[
        { rotulo: '12h', valor: 100, base: 50 },
        { rotulo: '13h', valor: 60, base: 80 },
        { rotulo: '14h', valor: null, base: 120 },
        { rotulo: '15h', valor: null, base: 40 },
      ]} />,
    );
    // Pico é do dia escolhido (100 às 12h), não da base (120)
    expect(screen.getByText(/^pico R\$\s100,00 · 12h$/)).toBeInTheDocument();
    const caminhos = [...container.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
    // Base (tracejada) com 4 pontos; principal só com 2
    expect(caminhos.some((d) => (d.match(/[ML]/g) ?? []).length === 4)).toBe(true);
    expect(caminhos.some((d) => (d.match(/[ML]/g) ?? []).length === 2)).toBe(true);
  });
});
