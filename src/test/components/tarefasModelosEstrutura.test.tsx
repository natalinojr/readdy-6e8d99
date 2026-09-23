// Tarefas › Modelos de estrutura de pastas: gravar (pasta → modelo), filtrar
// pelo que o usuário escolheu, e aplicar (modelo → linhas novas) com datas relativas.
import { describe, it, expect } from 'vitest';
import {
  montarModelo, filtrarModelo, planejarAplicacao, resolverStatus, resumirModelo, normalizarOpcoes,
  diaLocal, somarDias, vencimentoIso, rotuloDia, OPCOES_PADRAO,
  type OrigemBruta, type OpcoesModelo, type ContextoAplicacao,
} from '@/pages/tarefas/lib/modeloEstrutura';

function origem(): OrigemBruta {
  return {
    raiz_id: 'P1',
    pastas: [
      { id: 'P1', name: 'Inauguração', color: '#111', icon: null, parent_list_id: 'PAI_FORA', sort_order: 5 },
      { id: 'P2', name: 'Obras', color: '#222', icon: null, parent_list_id: 'P1', sort_order: 2 },
      { id: 'P3', name: 'Marketing', color: '#333', icon: null, parent_list_id: 'P1', sort_order: 1 },
      { id: 'P4', name: 'Fornecedores', color: '#444', icon: null, parent_list_id: 'P2', sort_order: 0 },
    ],
    statuses: [
      { id: 'S1', list_id: 'P1', name: 'Pendente', color: '#aaa', category: 'todo', sort_order: 1 },
      { id: 'S2', list_id: 'P1', name: 'Pronto', color: '#0f0', category: 'done', sort_order: 2 },
      { id: 'S3', list_id: 'P1', name: 'Fazendo', color: '#00f', category: 'in_progress', sort_order: 3 },
    ],
    campos: [
      { id: 'F1', list_id: 'P2', name: 'Custo', field_type: 'currency', options: [], show_on_card: true, sort_order: 1 },
    ],
    tarefas: [
      // 10/10 12:00Z (sem hora) = dia 0
      { id: 'T1', list_id: 'P1', parent_task_id: null, title: 'Contratar equipe', description: 'Vagas', status_id: 'S3', priority: 3, assignee_id: 'U9', start_date: null, due_date: '2026-10-10T12:00:00Z', due_has_time: false, recurrence: null, time_estimate_minutes: 90, sort_order: 2 },
      // início 12/10, vence 15/10 às 14:30 de Brasília (17:30Z)
      { id: 'T2', list_id: 'P1', parent_task_id: null, title: 'Treinar', description: null, status_id: 'S1', priority: 0, assignee_id: null, start_date: '2026-10-12', due_date: '2026-10-15T17:30:00Z', due_has_time: true, recurrence: { freq: 'weekly', interval: 1 }, time_estimate_minutes: null, sort_order: 1 },
      { id: 'T3', list_id: 'P1', parent_task_id: 'T1', title: 'Anunciar vaga', description: null, status_id: 'S1', priority: 0, assignee_id: null, start_date: null, due_date: null, due_has_time: false, recurrence: null, time_estimate_minutes: null, sort_order: 1 },
      { id: 'T4', list_id: 'P1', parent_task_id: null, title: 'Já feita', description: null, status_id: 'S2', priority: 0, assignee_id: null, start_date: null, due_date: null, due_has_time: false, recurrence: null, time_estimate_minutes: null, sort_order: 3 },
      { id: 'T5', list_id: 'P4', parent_task_id: null, title: 'Cotar gás', description: null, status_id: null, priority: 1, assignee_id: null, start_date: null, due_date: '2026-10-20T12:00:00Z', due_has_time: false, recurrence: null, time_estimate_minutes: null, sort_order: 1 },
      { id: 'T6', list_id: 'P2', parent_task_id: null, title: 'Pintura', description: null, status_id: null, priority: 0, assignee_id: null, start_date: null, due_date: null, due_has_time: false, recurrence: null, time_estimate_minutes: null, sort_order: 1 },
    ],
    checklist: [
      { task_id: 'T1', title: 'Segundo', is_done: true, sort_order: 2 },
      { task_id: 'T1', title: 'Primeiro', is_done: false, sort_order: 1 },
    ],
    etiquetas: [
      { task_id: 'T1', name: 'RH', color: '#f00' },
      { task_id: 'T2', name: 'Novo', color: '#0f0' },
    ],
    valores: [
      { task_id: 'T6', field_id: 'F1', global: false, value: 1500 },
      { task_id: 'T6', field_id: 'G1', global: true, value: 'x' },
      { task_id: 'T6', field_id: 'G_APAGADO', global: true, value: 'y' },
    ],
    visoes: [
      { list_id: 'P2', name: 'Por custo', view_type: 'kanban', group_by: 'field:F1', filters: { ocultarConcluidas: true }, sort_order: 1 },
    ],
    exibicao: {
      P2: { agrupar: 'field:F1', colunas: ['responsavel', 'campo:F1', 'campo:G1'], ordem: null, larguras: { 'campo:F1': 200 } },
    },
  };
}

let contador = 0;
function ctx(extra: Partial<ContextoAplicacao> = {}): ContextoAplicacao {
  contador = 0;
  return {
    tenant_id: 'TEN', user_id: 'EU', parent_list_id: null, nome: null, data_base: '2026-11-01',
    etiquetas_existentes: { rh: 'TAG_RH' }, campos_globais: ['G1'],
    novo_id: () => `n${++contador}`, agora: 1000, ...extra,
  };
}

const opc = (o: Partial<OpcoesModelo> = {}): OpcoesModelo => ({ ...OPCOES_PADRAO, ...o });

describe('datas relativas', () => {
  it('converte para o dia de Brasília', () => {
    expect(diaLocal('2026-10-10T02:00:00Z')).toBe('2026-10-09'); // 23h do dia 9 em Brasília
    expect(diaLocal('2026-10-12')).toBe('2026-10-12');
    expect(somarDias('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('vencimento com hora mantém o horário de Brasília; sem hora vai ao meio-dia UTC', () => {
    expect(vencimentoIso('2026-11-06', '14:30')).toBe('2026-11-06T17:30:00.000Z');
    expect(vencimentoIso('2026-11-06', null)).toBe('2026-11-06T12:00:00Z');
  });

  it('a data mais antiga vira o dia 0 e as outras viram dia +N', () => {
    const m = montarModelo(origem());
    expect(m.data_referencia).toBe('2026-10-10');
    const [t2, t1] = m.raiz.tarefas; // ordem por sort_order
    expect(t1.due_dia).toBe(0);
    expect(t2.start_dia).toBe(2);
    expect(t2.due_dia).toBe(5);
    expect(t2.due_hora).toBe('14:30');
    expect(t1.due_hora).toBeNull();
  });

  it('rótulo mostra "Dia +N" sem data base e a data real com data base', () => {
    expect(rotuloDia(0, null)).toBe('Dia 0');
    expect(rotuloDia(5, null)).toBe('Dia +5');
    expect(rotuloDia(5, '2026-11-01')).toBe('06/11');
    expect(rotuloDia(70, '2026-11-01')).toBe('10/01/2027');
  });
});

describe('montarModelo', () => {
  it('monta a árvore de subpastas na ordem e com subtarefas dentro da tarefa-mãe', () => {
    const m = montarModelo(origem());
    expect(m.raiz.name).toBe('Inauguração');
    expect(m.raiz.filhas.map((f) => f.name)).toEqual(['Marketing', 'Obras']);
    expect(m.raiz.filhas[1].filhas[0].name).toBe('Fornecedores');
    const t1 = m.raiz.tarefas.find((t) => t.ref === 'T1')!;
    expect(t1.subtarefas.map((s) => s.title)).toEqual(['Anunciar vaga']);
    expect(m.raiz.tarefas.some((t) => t.ref === 'T3')).toBe(false);
    expect(t1.checklist.map((c) => c.title)).toEqual(['Primeiro', 'Segundo']);
    expect(m.raiz.tarefas.find((t) => t.ref === 'T4')!.concluida).toBe(true);
    expect(m.raiz.filhas[1].exibicao?.agrupar).toBe('field:F1');
  });
});

describe('filtrarModelo', () => {
  it('padrão: sem concluídas, sem responsável, status volta ao início, checklist desmarcado', () => {
    const f = filtrarModelo(montarModelo(origem()), opc());
    const titulos = f.raiz.tarefas.map((t) => t.title);
    expect(titulos).not.toContain('Já feita');
    const t1 = f.raiz.tarefas.find((t) => t.ref === 'T1')!;
    expect(t1.assignee_id).toBeNull();
    expect(t1.status_ref).toBeNull();
    expect(t1.checklist.every((c) => !c.is_done)).toBe(true);
  });

  it('pasta desmarcada na árvore sai com as subpastas; tarefa desmarcada sai com as subtarefas', () => {
    const f = filtrarModelo(montarModelo(origem()), opc({ excluidos: ['P2', 'T1'] }));
    expect(f.raiz.filhas.map((p) => p.name)).toEqual(['Marketing']);
    expect(f.raiz.tarefas.map((t) => t.title)).toEqual(['Treinar']);
    const r = resumirModelo(f);
    expect(r.pastas).toBe(2);
    expect(r.subtarefas).toBe(0);
  });

  it('sem campos: valores de campos da pasta somem, globais ficam', () => {
    const f = filtrarModelo(montarModelo(origem()), opc({ campos: false }));
    const obras = f.raiz.filhas[1];
    expect(obras.campos).toEqual([]);
    expect(obras.tarefas[0].valores.map((v) => v.campo_ref)).toEqual(['G1', 'G_APAGADO']);
  });

  it('sem subpastas / sem tarefas / sem datas', () => {
    const f = filtrarModelo(montarModelo(origem()), opc({ subpastas: false, tarefas: false }));
    expect(f.raiz.filhas).toEqual([]);
    expect(f.raiz.tarefas).toEqual([]);
    const g = filtrarModelo(montarModelo(origem()), opc({ datas: false }));
    expect(resumirModelo(g).com_data).toBe(false);
  });

  it('normalizarOpcoes completa chaves que faltam e ignora lixo', () => {
    const o = normalizarOpcoes({ tarefas: false, excluidos: ['a', 3], xyz: true });
    expect(o.tarefas).toBe(false);
    expect(o.status).toBe(true);
    expect(o.excluidos).toEqual(['a']);
  });
});

describe('planejarAplicacao', () => {
  it('cria pastas com ids novos, pai certo e nome escolhido', () => {
    const f = filtrarModelo(montarModelo(origem()), opc());
    const p = planejarAplicacao(f, ctx({ parent_list_id: 'DESTINO', nome: 'Loja Nova' }));
    const raiz = p.pastas.find((x) => x.id === p.raiz_id)!;
    expect(raiz.name).toBe('Loja Nova');
    expect(raiz.parent_list_id).toBe('DESTINO');
    expect(raiz.sort_order).toBe(1000);
    const forn = p.pastas.find((x) => x.name === 'Fornecedores')!;
    expect(forn.parent_list_id).toBe(p.mapa_pastas.P2);
    expect(p.pastas).toHaveLength(4);
    expect(p.pastas_com_status).toEqual([p.raiz_id]);
  });

  it('datas relativas viram datas reais a partir da data base', () => {
    const f = filtrarModelo(montarModelo(origem()), opc());
    const p = planejarAplicacao(f, ctx());
    const t = (titulo: string) => p.tarefas.find((x) => x.title === titulo)!;
    expect(t('Contratar equipe').due_date).toBe('2026-11-01T12:00:00Z');
    expect(t('Treinar').start_date).toBe('2026-11-03');
    expect(t('Treinar').due_date).toBe('2026-11-06T17:30:00.000Z');
    expect(t('Treinar').due_has_time).toBe(true);
    expect(t('Cotar gás').due_date).toBe('2026-11-11T12:00:00Z');
    expect(t('Pintura').due_date).toBeNull();
  });

  it('subtarefa vem depois da mãe e aponta pro id novo dela', () => {
    const p = planejarAplicacao(filtrarModelo(montarModelo(origem()), opc()), ctx());
    const iMae = p.tarefas.findIndex((x) => x.title === 'Contratar equipe');
    const iSub = p.tarefas.findIndex((x) => x.title === 'Anunciar vaga');
    expect(iSub).toBeGreaterThan(iMae);
    expect(p.tarefas[iSub].parent_task_id).toBe(p.tarefas[iMae].id);
  });

  it('etiqueta existente é reaproveitada pelo nome; nova é criada uma vez', () => {
    const p = planejarAplicacao(filtrarModelo(montarModelo(origem()), opc()), ctx());
    expect(p.novas_etiquetas.map((e) => e.name)).toEqual(['Novo']);
    expect(p.etiquetas.map((e) => e.tag_id)).toContain('TAG_RH');
  });

  it('campos, valores, visões e exibição são remapeados pro campo novo', () => {
    const p = planejarAplicacao(filtrarModelo(montarModelo(origem()), opc()), ctx());
    const novoF1 = p.mapa_campos.F1;
    expect(novoF1).toBeTruthy();
    expect(p.campos[0].list_id).toBe(p.mapa_pastas.P2);
    expect(p.valores.map((v) => v.field_id).sort()).toEqual(['G1', novoF1].sort()); // G_APAGADO some
    expect(p.visoes[0].group_by).toBe(`field:${novoF1}`);
    const ex = p.exibicao[p.mapa_pastas.P2];
    expect(ex.agrupar).toBe(`field:${novoF1}`);
    expect(ex.colunas).toEqual(['responsavel', `campo:${novoF1}`, 'campo:G1']);
    expect(ex.larguras).toEqual({ [`campo:${novoF1}`]: 200 });
  });

  it('sem campos no modelo, agrupamento por campo volta pra status', () => {
    const p = planejarAplicacao(filtrarModelo(montarModelo(origem()), opc({ campos: false })), ctx());
    expect(p.visoes[0].group_by).toBe('status');
    expect(p.exibicao[p.mapa_pastas.P2].colunas).toEqual(['responsavel', 'campo:G1']);
  });
});

describe('resolverStatus', () => {
  const statusesNovos = (p: ReturnType<typeof planejarAplicacao>) => [
    ...p.statuses.map((s) => ({ id: s.id as string, list_id: s.list_id as string, category: s.category as string, sort_order: s.sort_order as number })),
    // Pastas sem status no modelo ficam com os padrões do gatilho
    ...p.pastas.filter((x) => !p.pastas_com_status.includes(x.id as string)).flatMap((x) => [
      { id: `${x.id}-todo`, list_id: x.id as string, category: 'todo', sort_order: 1 },
      { id: `${x.id}-done`, list_id: x.id as string, category: 'done', sort_order: 3 },
    ]),
  ];

  it('padrão: toda tarefa nasce no primeiro status aberto da pasta', () => {
    const p = planejarAplicacao(filtrarModelo(montarModelo(origem()), opc()), ctx());
    const linhas = resolverStatus(p.tarefas, statusesNovos(p));
    const pendente = p.statuses.find((s) => s.name === 'Pendente')!.id;
    expect(linhas.find((l) => l.title === 'Contratar equipe')!.status_id).toBe(pendente);
    expect(linhas.find((l) => l.title === 'Cotar gás')!.status_id).toBe(`${p.mapa_pastas.P4}-todo`);
    expect(linhas.every((l) => !('status_preferido' in l))).toBe(true);
  });

  it('manter status: mesmo status do modelo e concluídas nascem concluídas', () => {
    const p = planejarAplicacao(filtrarModelo(montarModelo(origem()), opc({ manter_status: true, concluidas: true })), ctx());
    const linhas = resolverStatus(p.tarefas, statusesNovos(p));
    const fazendo = p.statuses.find((s) => s.name === 'Fazendo')!.id;
    expect(linhas.find((l) => l.title === 'Contratar equipe')!.status_id).toBe(fazendo);
    const feita = linhas.find((l) => l.title === 'Já feita')!;
    expect(feita.status_id).toBe(p.statuses.find((s) => s.name === 'Pronto')!.id);
    expect(feita.completed_at).toBeTruthy();
  });
});
