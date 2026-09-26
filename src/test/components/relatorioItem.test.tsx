import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({}));

import ItemRelatorio from '@/pages/tarefas/relatorios/ItemRelatorio';
import type { CampoRel, ItemRel } from '@/pages/tarefas/relatorios/api';
import { camposVisiveis, limparCampos } from '@/pages/tarefas/relatorios/CamposResposta';

const item: ItemRel = {
  id: 'i1', position: 1, title: 'Pia vazando', body: 'Resolver até sexta?', images: [], status: 'answered',
  created_by_guest_name: null, created_at: '2026-09-24T10:00:00Z', updated_at: '2026-09-24T10:00:00Z',
  responses: [
    { id: 'r1', kind: 'reply', body: 'Vou mandar o encanador', images: [], new_status: null, author_name: 'Carlos', author_type: 'guest', author_guest_id: 'g1', created_at: '2026-09-24T11:00:00Z' },
    { id: 'r2', kind: 'reply', body: 'Trocado', images: [], new_status: 'resolved', author_name: 'Maria', author_type: 'guest', author_guest_id: 'g2', created_at: '2026-09-24T12:00:00Z' },
    { id: 'r3', kind: 'edit', body: 'Título anterior: Pia', images: [], new_status: null, author_name: 'Dono', author_type: 'owner', author_guest_id: null, created_at: '2026-09-24T13:00:00Z' },
  ],
};

describe('ItemRelatorio', () => {
  it('mostra a sequência de respostas com autor, marca a da pessoa atual e o evento de edição', () => {
    render(<ItemRelatorio item={item} numero={1} podeResponder meuGuestId="g2" onResponder={vi.fn()} onEnviarImagem={vi.fn()} />);
    expect(screen.getByText('Vou mandar o encanador')).toBeTruthy();
    expect(screen.getByText('Carlos')).toBeTruthy();
    expect(screen.getByText('Maria (você)')).toBeTruthy();
    expect(screen.getByText('resolvido')).toBeTruthy();
    expect(screen.getByText(/editou o item/)).toBeTruthy();
  });

  it('envia a resposta com o texto digitado e sem status', async () => {
    const onResponder = vi.fn().mockResolvedValue(true);
    render(<ItemRelatorio item={{ ...item, responses: [] }} numero={1} podeResponder onResponder={onResponder} onEnviarImagem={vi.fn()} />);
    fireEvent.click(screen.getByText('Responder'));
    fireEvent.change(screen.getByPlaceholderText('Escreva sua resposta…'), { target: { value: 'Feito ontem' } });
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(onResponder).toHaveBeenCalledWith('Feito ontem', [], null, null, []));
  });

  const comCampos: ItemRel = {
    ...item,
    responses: [
      { id: 'x1', kind: 'reply', body: null, images: [], new_status: null, answers: { c1: 'o1' }, author_name: 'Carlos', author_type: 'guest', author_guest_id: 'g1', created_at: '2026-09-24T11:00:00Z' },
    ],
    fields: [
      { id: 'c1', type: 'escolha', label: 'Situação', options: [{ id: 'o1', label: 'Ok' }, { id: 'o2', label: 'Refazer' }] },
      { id: 'c2', type: 'multipla', label: 'Cômodos', options: [{ id: 'a', label: 'Sala' }, { id: 'b', label: 'Cozinha' }] },
    ],
  };

  it('mostra o valor atual no resumo e o que foi respondido no histórico', () => {
    render(<ItemRelatorio item={comCampos} numero={1} podeResponder={false} onResponder={vi.fn()} onEnviarImagem={vi.fn()} />);
    expect(screen.getAllByText('Ok').length).toBe(2); // resumo + etiqueta da resposta
    expect(screen.getByText('sem resposta')).toBeTruthy(); // Cômodos ainda vazio
    expect(screen.getByText('Situação:')).toBeTruthy();
    expect(screen.getByText(/Respondido por Carlos/)).toBeTruthy();
  });

  it('valor apagado continua no histórico (antes riscado + "apagou")', () => {
    const apagado: ItemRel = {
      ...comCampos,
      responses: [
        ...comCampos.responses,
        { id: 'x3', kind: 'reply', body: null, images: [], new_status: null, answers: { c1: null }, author_name: 'Maria', author_type: 'guest', author_guest_id: 'g2', created_at: '2026-09-24T12:00:00Z' },
      ],
    };
    render(<ItemRelatorio item={apagado} numero={1} podeResponder={false} onResponder={vi.fn()} onEnviarImagem={vi.fn()} />);
    expect(screen.getAllByText('Ok').some((e) => /line-through/.test(e.className))).toBe(true);
    expect(screen.getByText('apagou')).toBeTruthy();
  });

  it('dois cliques seguidos em Enviar mandam uma resposta só', async () => {
    let terminar: (v: boolean) => void = () => {};
    const onResponder = vi.fn(() => new Promise<boolean>((res) => { terminar = res; }));
    render(<ItemRelatorio item={{ ...item, responses: [] }} numero={1} podeResponder onResponder={onResponder} onEnviarImagem={vi.fn()} />);
    fireEvent.click(screen.getByText('Responder'));
    fireEvent.change(screen.getByPlaceholderText('Escreva sua resposta…'), { target: { value: 'Oi' } });
    const enviarBtn = screen.getByText('Enviar');
    fireEvent.click(enviarBtn);
    fireEvent.click(enviarBtn);
    terminar(true);
    await waitFor(() => expect(onResponder).toHaveBeenCalledTimes(1));
  });

  it('mudança de valor aparece como antes → depois', () => {
    const mudou: ItemRel = {
      ...comCampos,
      responses: [
        ...comCampos.responses,
        { id: 'x2', kind: 'reply', body: null, images: [], new_status: null, answers: { c1: 'o2' }, author_name: 'Maria', author_type: 'guest', author_guest_id: 'g2', created_at: '2026-09-24T12:00:00Z' },
      ],
    };
    render(<ItemRelatorio item={mudou} numero={1} podeResponder={false} onResponder={vi.fn()} onEnviarImagem={vi.fn()} />);
    expect(screen.getAllByText('Ok').some((e) => /line-through/.test(e.className))).toBe(true);
    expect(screen.getAllByText('Refazer').length).toBe(2); // valor atual + "→ Refazer"
  });

  it('caixas de seleção respeitam o máximo e o mínimo', async () => {
    const limitado: ItemRel = {
      ...item, responses: [],
      fields: [{ id: 'm', type: 'multipla', label: 'Cômodos', min: 2, max: 2, options: [{ id: 'a', label: 'Sala' }, { id: 'b', label: 'Cozinha' }, { id: 'c', label: 'Quarto' }] }],
    };
    const onResponder = vi.fn().mockResolvedValue(true);
    render(<ItemRelatorio item={limitado} numero={1} podeResponder onResponder={onResponder} onEnviarImagem={vi.fn()} />);
    fireEvent.click(screen.getByText('Responder'));
    expect(screen.getByText('Marque 2')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Sala'));
    fireEvent.click(screen.getByText('Enviar'));
    expect(await screen.findByText('"Cômodos": marque pelo menos 2')).toBeTruthy();
    expect(onResponder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Cozinha'));
    expect((screen.getByLabelText('Quarto') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(onResponder).toHaveBeenCalledWith('', [], null, { m: ['a', 'b'] }, []));
  });

  it('responder campos envia só o que mudou', async () => {
    const onResponder = vi.fn().mockResolvedValue(true);
    render(<ItemRelatorio item={comCampos} numero={1} podeResponder onResponder={onResponder} onEnviarImagem={vi.fn()} />);
    fireEvent.click(screen.getByText('Responder'));
    fireEvent.click(screen.getByLabelText('Cozinha'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(onResponder).toHaveBeenCalledWith('', [], null, { c2: ['b'] }, []));
  });

  it('Ctrl+V de imagem na caixa de resposta envia a imagem e aceita legenda', async () => {
    const onEnviarImagem = vi.fn().mockResolvedValue({ path: 'r1/x.png', name: 'print.png' });
    const onResponder = vi.fn().mockResolvedValue(true);
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    render(<ItemRelatorio item={{ ...item, responses: [] }} numero={1} podeResponder onResponder={onResponder} onEnviarImagem={onEnviarImagem} />);
    fireEvent.click(screen.getByText('Responder'));
    const arquivo = new File(['x'], 'image.png', { type: 'image/png' });
    fireEvent.paste(screen.getByPlaceholderText('Escreva sua resposta…'), {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => arquivo }] },
    });
    await waitFor(() => expect(onEnviarImagem).toHaveBeenCalledTimes(1));
    fireEvent.change(await screen.findByPlaceholderText('Legenda'), { target: { value: 'Ralo do banheiro' } });
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(onResponder).toHaveBeenCalledWith('', [{ path: 'r1/x.png', name: 'print.png', caption: 'Ralo do banheiro' }], null, null, []));
  });

  it('anexa link de arquivo da nuvem na resposta e mostra os links do item', async () => {
    const onResponder = vi.fn().mockResolvedValue(true);
    const comLink: ItemRel = { ...item, responses: [], links: [{ url: 'https://drive.google.com/x', title: 'Planta baixa' }] };
    render(<ItemRelatorio item={comLink} numero={1} podeResponder onResponder={onResponder} onEnviarImagem={vi.fn()} />);
    expect(screen.getByText('Planta baixa')).toBeTruthy();
    expect(screen.getByText('Google Drive')).toBeTruthy();
    fireEvent.click(screen.getByText('Responder'));
    fireEvent.click(screen.getByText('Link'));
    fireEvent.change(screen.getByPlaceholderText(/Cole o link de compartilhamento/), { target: { value: 'dropbox.com/s/abc' } });
    fireEvent.change(screen.getByPlaceholderText('Nome do arquivo (opcional)'), { target: { value: 'Orçamento' } });
    fireEvent.click(screen.getByText('Incluir link'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(onResponder).toHaveBeenCalledWith('', [], null, null, [{ url: 'https://dropbox.com/s/abc', title: 'Orçamento' }]));
  });

  it('nome do relatório no endereço vira texto simples, sem acento', async () => {
    const { slugRelatorio } = await import('@/pages/tarefas/relatorios/api');
    expect(slugRelatorio('Compatibilização – Lume (APTO 02)')).toBe('compatibilizacao-lume-apto-02');
    expect(slugRelatorio('   ')).toBe('');
  });

  it('na tela da equipe marca "você" pelo usuário e diferencia autor do relatório e equipe da pasta', () => {
    const comEquipe: ItemRel = {
      ...item,
      responses: [
        { id: 'e1', kind: 'reply', body: 'Olhei', images: [], new_status: null, author_name: 'Ana', author_type: 'owner', author_guest_id: null, author_is_creator: true, author_user_id: 'u-ana', created_at: '2026-09-24T11:00:00Z' },
        { id: 'e2', kind: 'reply', body: 'Eu também', images: [], new_status: null, author_name: 'Bruno', author_type: 'owner', author_guest_id: null, author_is_creator: false, author_user_id: 'u-bruno', created_at: '2026-09-24T12:00:00Z' },
      ],
    };
    render(<ItemRelatorio item={comEquipe} numero={1} podeResponder meuUserId="u-bruno" onResponder={vi.fn()} onEnviarImagem={vi.fn()} />);
    expect(screen.getByText('Bruno (você)')).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('autor do relatório')).toBeTruthy();
    expect(screen.getByText('equipe')).toBeTruthy();
  });

  describe('campo condicional (show_if)', () => {
    const campos: CampoRel[] = [
      { id: 'tipo', type: 'escolha', label: 'Tipo de evento', options: [{ id: 'fest', label: 'Festa' }, { id: 'corp', label: 'Corporativo' }] },
      { id: 'conv', type: 'numero', label: 'Convidados', show_if: { field_id: 'tipo', values: ['fest'] } },
      { id: 'buf', type: 'sim_nao', label: 'Quer bufê?', show_if: { field_id: 'tipo', values: ['fest'] } },
      { id: 'cardapio', type: 'texto', label: 'Cardápio', show_if: { field_id: 'buf', values: ['sim'] } },
      { id: 'cnpj', type: 'texto', label: 'CNPJ', show_if: { field_id: 'tipo', values: ['corp'] } },
    ];
    const briefing: ItemRel = { ...item, responses: [], fields: campos };

    it('mostra só os campos da resposta escolhida, em cadeia', () => {
      const ids = (v: Record<string, string | null>) => camposVisiveis(campos, v).map((c) => c.id);
      expect(ids({})).toEqual(['tipo']);
      expect(ids({ tipo: 'fest' })).toEqual(['tipo', 'conv', 'buf']);
      expect(ids({ tipo: 'fest', buf: 'sim' })).toEqual(['tipo', 'conv', 'buf', 'cardapio']);
      // Pergunta da condição escondida esconde o filho também.
      expect(ids({ tipo: 'corp', buf: 'sim' })).toEqual(['tipo', 'cnpj']);
    });

    it('quem responde vê os campos aparecerem conforme escolhe', () => {
      render(<ItemRelatorio item={briefing} numero={1} podeResponder onResponder={vi.fn()} onEnviarImagem={vi.fn()} />);
      fireEvent.click(screen.getByText('Responder'));
      expect(screen.queryByText('CNPJ')).toBeNull();
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'corp' } });
      expect(screen.getByText('CNPJ')).toBeTruthy();
      expect(screen.queryByText('Convidados')).toBeNull();
    });

    it('trocar a resposta apaga o valor do campo que ficou escondido', async () => {
      const onResponder = vi.fn().mockResolvedValue(true);
      const respondido: ItemRel = { ...briefing, responses: [
        { id: 'r1', kind: 'reply', body: null, images: [], new_status: null, author_name: 'Ana', author_type: 'guest', author_guest_id: 'g1', created_at: '2026-09-24T11:00:00Z', answers: { tipo: 'corp', cnpj: '123' } },
      ] };
      render(<ItemRelatorio item={respondido} numero={1} podeResponder onResponder={onResponder} onEnviarImagem={vi.fn()} />);
      fireEvent.click(screen.getByText('Responder'));
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fest' } });
      fireEvent.click(screen.getByText('Enviar'));
      await waitFor(() => expect(onResponder).toHaveBeenCalledWith('', [], null, { tipo: 'fest', cnpj: null }, []));
    });

    it('ao salvar, recusa condição sem resposta escolhida ou com pergunta abaixo', () => {
      expect(limparCampos(campos).erro).toBeNull();
      expect(limparCampos([campos[0], { ...campos[1], show_if: { field_id: 'tipo', values: [] } }]).erro).toMatch(/escolha com qual resposta/);
      expect(limparCampos([campos[1], campos[0]]).erro).toMatch(/ficar acima/);
    });
  });

  it('sem permissão de responder (relatório encerrado) não mostra a caixa', () => {
    render(<ItemRelatorio item={item} numero={1} podeResponder={false} onResponder={vi.fn()} onEnviarImagem={vi.fn()} />);
    expect(screen.queryByText('Responder')).toBeNull();
  });
});
