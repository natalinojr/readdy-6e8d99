// Estoque › Custo › Consumo (layout novo, 2026-10-04): cartões no celular, "dura" e "abaixo do mínimo" vindos
// da regra única, linha abre a ficha dentro do Estoque, período por chips, CSV que baixa e erro sem ids.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  hook: {} as Record<string, unknown>,
  chamadasHook: [] as Array<[string | undefined, string | undefined]>,
  ctx: null as null | Record<string, unknown>,
  situacao: null as null | Record<string, unknown>,
  perfil: 'admin',
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-secreto', tenantId: 't-secreto', perfil: h.perfil } }) }));
vi.mock('@/hooks/useConsumoIngredientes', () => ({
  useConsumoIngredientes: (de?: string, ate?: string) => { h.chamadasHook.push([de, ate]); return h.hook; },
}));
vi.mock('@/hooks/useEstoqueSituacao', () => ({ useEstoqueSituacao: () => ({ data: h.situacao, loading: false, error: null, reload: vi.fn() }) }));
vi.mock('@/pages/estoque/EstoqueTela', () => ({ useEstoqueTelaOpcional: () => h.ctx }));
vi.mock('@/pages/relatorios/components/ConsumoDetalheDia', () => ({ default: () => <div>detalhe-do-dia</div> }));
vi.mock('@/pages/relatorios/components/ConsumoCategoriasPanel', () => ({ default: () => <div>painel-categorias</div> }));
vi.mock('@/pages/relatorios/components/ConsumoPorLanchePanel', () => ({ default: () => <div>painel-pratos</div> }));
vi.mock('@/pages/relatorios/components/ConsumoPerdas', () => ({ default: () => <div>painel-perdas</div> }));
vi.mock('@/pages/estoque/components/FichasVendasPassadasModal', () => ({ default: () => <div>modal-fichas</div> }));

import ConsumoIngredientesTab from '@/pages/relatorios/components/ConsumoIngredientesTab';
import { todayBrasilia, somarDias } from '@/lib/dateUtils';

const porTipo = (v: number) => ({ vendas: v, producao: 0, perda: 0, ajuste: 0, transferencia: 0 });
const item = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  id, nome, unidade: 'g', categoria: 'Carnes', fornecedor: 'Industria El Patron', estoqueAtual: 0, minimo: 0,
  totalConsumido: 0, porTipo: porTipo(0), custoTotal: 0, custoVendas: 0, custoProducao: 0, custoPerda: 0,
  tendencia: null, semCadastro: false, ...extra,
});
const sit = (id: string, extra: Record<string, unknown> = {}) => ({
  id, nome: id, unidade: 'g', categoria: null, fornecedorId: null, fornecedor: null, fornecedorFone: null, produzido: false,
  estoque: 0, minimo: 0, marcadoEsgotado: false, acompanha: true, contaInventario: true, unidadeContagem: null, fatorContagem: null,
  preco: 0, unidadeCompra: null, fatorCompra: 1, consumoDia: null, diasRestantes: null, ultimaContagem: null, ultimaEntrada: null,
  abaixoMinimo: false, esgotado: false, vaiFaltar: false, naLista: false, ...extra,
});

beforeEach(() => {
  h.chamadasHook = [];
  h.ctx = null;
  h.perfil = 'admin';
  h.situacao = {
    janelaDias: 14, totais: { abaixoMinimo: 16, esgotados: 0, zeradosAbaixo: 0, vaiFaltar: 0, naLista: 0 },
    insumos: [
      sit('a', { estoque: 58000, consumoDia: 1000, diasRestantes: 58.2 }),
      sit('b', { estoque: 500, minimo: 800, consumoDia: 250, diasRestantes: 2, abaixoMinimo: true }),
    ],
  };
  h.hook = {
    loading: false, error: null, aviso: null, reload: vi.fn(),
    resumo: { insumosUsados: 2, totalConsumidoValor: 2488, totalVendasValor: 16168, custoVendas: 2000, custoProducao: 0, custoPerda: 12 },
    dados: [
      item('a', 'Chilli com Carne', { totalConsumido: 75000, porTipo: porTipo(75000), custoTotal: 2127.5, tendencia: 'subindo' }),
      item('b', 'Barbacoa', { totalConsumido: 18600, porTipo: porTipo(18600), custoTotal: 360, tendencia: 'estavel' }),
      item('c', 'Sal', { totalConsumido: 0 }),
      item('x', 'Removido', { semCadastro: true, totalConsumido: 10, porTipo: porTipo(10) }),
    ],
  };
});

describe('Consumo (tela)', () => {
  it('celular: cartão diz quanto usou, quanto tem e quanto dura; só mostra os que saíram', () => {
    render(<ConsumoIngredientesTab />);
    expect(screen.getByText('Chilli com Carne')).toBeTruthy();
    expect(screen.getByText(/usou 75 kg/)).toBeTruthy();
    expect(screen.getByText(/tem 58 kg/)).toBeTruthy();
    expect(screen.getByText('dura 58 dias')).toBeTruthy();
    expect(screen.getByText('↗ subindo')).toBeTruthy();
    expect(screen.getByText('→ igual')).toBeTruthy();
    expect(screen.getByText('dura 2 dias')).toBeTruthy();
    expect(screen.getByText('Abaixo do mínimo', { selector: 'span.inline-block' })).toBeTruthy();
    expect(screen.queryByText('Sal')).toBeNull(); // não saiu no período: escondido até pedir
    expect(screen.getByText('Sem cadastro')).toBeTruthy();
    fireEvent.click(screen.getByText(/Mostrar também os 1 insumos que não saíram/));
    expect(screen.getByText('Sal')).toBeTruthy();
  });

  it('faixa: "abaixo do mínimo" é o número da regra única (Início), não conta própria', () => {
    render(<ConsumoIngredientesTab />);
    expect(screen.getByText('16')).toBeTruthy();
    expect(screen.getByText('Abaixo do mínimo', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Insumos usados')).toBeTruthy();
    expect(screen.queryByText(/Cr[ií]ticos/)).toBeNull();
    expect(screen.queryByText(/ingrediente/i)).toBeNull();
  });

  it('botão "Abaixo do mínimo" filtra a lista e avisa por que o número é menor que o do Início', () => {
    render(<ConsumoIngredientesTab />);
    fireEvent.click(screen.getByRole('button', { name: /^Abaixo do mínimo \d+$/ }));
    expect(screen.getByText('Barbacoa')).toBeTruthy();
    expect(screen.queryByText('Chilli com Carne')).toBeNull();
    expect(screen.getByText(/O Início do Estoque conta 16/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Abaixo do mínimo \d+$/ }));
    expect(screen.getByText('Chilli com Carne')).toBeTruthy();
  });

  it('dentro do Estoque a linha abre a ficha; fora, a linha não é clicável', () => {
    const abrirFicha = vi.fn();
    h.ctx = { situacao: h.situacao, recarregarSituacao: vi.fn(), abrirFicha };
    const { unmount } = render(<ConsumoIngredientesTab />);
    fireEvent.click(screen.getByText('Chilli com Carne'));
    expect(abrirFicha).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByText('Removido')); // sem cadastro: não tem ficha
    expect(abrirFicha).toHaveBeenCalledTimes(1);
    unmount();

    h.ctx = null;
    abrirFicha.mockClear();
    render(<ConsumoIngredientesTab />);
    fireEvent.click(screen.getByText('Chilli com Carne'));
    expect(abrirFicha).not.toHaveBeenCalled();
  });

  it('computador: tabela com Usou, Custo, Tem, Dura e Tendência; linha abre a ficha e o dia a dia abre embaixo', () => {
    const abrirFicha = vi.fn();
    h.ctx = { situacao: h.situacao, recarregarSituacao: vi.fn(), abrirFicha };
    const antes = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
    try {
      render(<ConsumoIngredientesTab />);
      expect(screen.getByRole('table')).toBeTruthy();
      for (const col of ['Insumo', 'Usou', 'Custo', 'Tem']) expect(screen.getByText(col, { selector: 'th' })).toBeTruthy();
      expect(screen.getByText('58 dias')).toBeTruthy();
      expect(screen.getByText('2 dias')).toBeTruthy();
      expect(screen.getByText('↗ subindo')).toBeTruthy();
      fireEvent.click(screen.getByText('Chilli com Carne'));
      expect(abrirFicha).toHaveBeenCalledWith('a');
      fireEvent.click(screen.getAllByLabelText('Ver o dia a dia')[0]);
      expect(screen.getByText('detalhe-do-dia')).toBeTruthy();
      expect(abrirFicha).toHaveBeenCalledTimes(1); // o botão do dia a dia não abre a ficha
    } finally {
      window.matchMedia = antes;
    }
  });

  it('o dia a dia continua acessível', () => {
    render(<ConsumoIngredientesTab />);
    expect(screen.queryByText('detalhe-do-dia')).toBeNull();
    fireEvent.click(screen.getAllByText('Ver o dia a dia')[0]);
    expect(screen.getByText('detalhe-do-dia')).toBeTruthy();
  });

  it('período: 30 dias de início; 7 dias e Este mês trocam a consulta; Período valida as datas', () => {
    render(<ConsumoIngredientesTab />);
    const hoje = todayBrasilia();
    expect(h.chamadasHook.at(-1)).toEqual([somarDias(hoje, -29), hoje]);
    fireEvent.click(screen.getByText('7 dias'));
    expect(h.chamadasHook.at(-1)).toEqual([somarDias(hoje, -6), hoje]);
    fireEvent.click(screen.getByText('Este mês'));
    expect(h.chamadasHook.at(-1)).toEqual([hoje.slice(0, 8) + '01', hoje]);

    fireEvent.click(screen.getByText('Período'));
    const [de, ate] = [screen.getByLabelText('De'), screen.getByLabelText('até')];
    fireEvent.change(de, { target: { value: '2026-09-10' } });
    fireEvent.change(ate, { target: { value: '2026-09-12' } });
    expect(h.chamadasHook.at(-1)).toEqual(['2026-09-10', '2026-09-12']);
    // De depois de Até: avisa e mantém a consulta anterior
    fireEvent.change(de, { target: { value: '2026-09-20' } });
    expect(screen.getByText(/data inicial não pode ser depois da final/)).toBeTruthy();
    expect(h.chamadasHook.at(-1)).toEqual(['2026-09-10', '2026-09-12']);
    // Até depois de hoje
    fireEvent.change(de, { target: { value: '2026-09-10' } });
    fireEvent.change(ate, { target: { value: somarDias(hoje, 3) } });
    expect(screen.getByText(/data final não pode ser depois de hoje/)).toBeTruthy();
    expect(h.chamadasHook.at(-1)).toEqual(['2026-09-10', '2026-09-12']);
  });

  it('erro: mensagem amigável, sem usuário nem loja, e "Tentar de novo" recarrega só os dados', () => {
    const reload = vi.fn();
    h.hook = { ...h.hook, loading: false, error: 'Não deu para carregar o consumo agora.', dados: [], resumo: null, reload };
    render(<ConsumoIngredientesTab />);
    expect(screen.getByText('Não deu para carregar o consumo agora.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/u-secreto|t-secreto|Tenant|User:/);
    fireEvent.click(screen.getByText('Tentar de novo'));
    expect(reload).toHaveBeenCalled();
  });

  it('"Aplicar fichas nas vendas passadas" fica no menu ⋯, só para admin/Supervisor', () => {
    const { unmount } = render(<ConsumoIngredientesTab />);
    fireEvent.click(screen.getByLabelText('Mais ações'));
    expect(screen.getByText('Aplicar fichas nas vendas passadas')).toBeTruthy();
    unmount();
    h.perfil = 'caixa';
    render(<ConsumoIngredientesTab />);
    fireEvent.click(screen.getByLabelText('Mais ações'));
    expect(screen.queryByText('Aplicar fichas nas vendas passadas')).toBeNull();
    expect(screen.getByText('Atualizar os números')).toBeTruthy();
  });

  it('CSV baixa o que está na tela (ponto e vírgula, vírgula decimal)', async () => {
    let conteudo: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => { conteudo = b; return 'blob:teste'; });
    URL.revokeObjectURL = vi.fn();
    const clicou = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<ConsumoIngredientesTab />);
    fireEvent.click(screen.getByText('CSV'));
    expect(clicou).toHaveBeenCalled();
    const texto = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(conteudo!); });
    expect(texto).toContain('"Insumo";"Categoria"');
    expect(texto).toContain('"Chilli com Carne";"Carnes";"Industria El Patron";"g";75000;2127,5');
    expect(texto).not.toContain('Sal'); // não saiu: fora da tela, fora do arquivo
    clicou.mockRestore();
  });

  it('aviso de leitura incompleta e vendas em branco aparecem, nunca R$ 0 falso', async () => {
    h.hook = { ...h.hook, aviso: 'Não consegui somar as vendas do período.', resumo: { ...(h.hook.resumo as object), totalVendasValor: null } };
    render(<ConsumoIngredientesTab />);
    expect(screen.getByText('Os números podem estar incompletos')).toBeTruthy();
    expect(screen.getByText('Não consegui somar as vendas do período.')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('—', { selector: 'p' })).toBeTruthy());
  });
});
