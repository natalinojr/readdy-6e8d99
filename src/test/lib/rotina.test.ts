import { describe, it, expect } from 'vitest';
import {
  agendados, contagemDaLoja, estadoDoItem, juntarNomes, papeisAbaixo, papeisDaPessoa, resumoRotina, rotinaDeHoje,
  type ItemRotina, type LojaRotina,
} from '../../../supabase/functions/_shared/rotina';
import { loginCompartilhado } from '../../pages/hoje/rotina/loginCompartilhado';

const HOJE = '2026-10-03'; // sábado
const ctx = (agora = '08:40', extra = {}) => ({ hoje: HOJE, agora, dow: 6, ...extra });

const item = (p: Partial<ItemRotina>): ItemRotina => ({
  id: p.id ?? 'i1', papel: 'supervisao', titulo: 'Item', tipo: 'manual', dias: [0, 1, 2, 3, 4, 5, 6], dias_plano: false, dia: null,
  hora: null, atalho: null, receita_id: null, receita: null, quantidade: null, ordem: 0, criado_em: '2026-10-01T10:00:00Z',
  criado_por_nome: null, producao: null, ...p,
});
const loja = (itens: ItemRotina[], extra: Partial<LojaRotina> = {}): LojaRotina => ({
  tenant_id: 't1', loja: 'Loja', papel: 'supervisao', itens, marcas: [],
  fatos: { aberta: null, fechada: null, recebido: null, contagens: [], planos: [] }, ...extra,
});

describe('rotina — quem faz o quê', () => {
  it('cada papel faz o seu; o login compartilhado faz tudo da equipe, cozinha e caixa', () => {
    expect(papeisDaPessoa('supervisao')).toEqual(['supervisao']);
    expect(papeisDaPessoa('gerente')).toEqual(['gerente']);
    expect(papeisDaPessoa('caixa')).toEqual(['equipe', 'caixa']);
    expect(papeisDaPessoa('caixa', true)).toEqual(['equipe', 'cozinha', 'caixa']);
    expect(papeisDaPessoa('admin')).toEqual([]);
    expect(papeisDaPessoa('totem')).toEqual([]);
  });
  it('quem está acima vê (e cria para) quem está abaixo', () => {
    expect(papeisAbaixo('supervisao')).toEqual(['equipe', 'cozinha', 'caixa']);
    expect(papeisAbaixo('gerente')).toEqual(['supervisao', 'equipe', 'cozinha', 'caixa']);
    expect(papeisAbaixo('admin')).toEqual(['gerente', 'supervisao', 'equipe', 'cozinha', 'caixa']);
    expect(papeisAbaixo('caixa')).toEqual([]);
  });
  it('login compartilhado = e-mail genérico @erpos.local', () => {
    expect(loginCompartilhado('caixa.par@erpos.local')).toBe(true);
    expect(loginCompartilhado('tablet1@totem.erpos.local')).toBe(true);
    expect(loginCompartilhado('thati@gmail.com')).toBe(false);
    expect(loginCompartilhado(null)).toBe(false);
  });
});

describe('rotina — estado de cada item hoje', () => {
  it('só vale nos dias da semana escolhidos', () => {
    expect(estadoDoItem(item({ dias: [1, 2] }), loja([]), ctx())).toBeNull();
    expect(estadoDoItem(item({ dias: [6] }), loja([]), ctx())).not.toBeNull();
  });
  it('com horário: antes é "mais tarde" (não segura), depois fica atrasado', () => {
    const i = item({ hora: '23:00' });
    const antes = estadoDoItem(i, loja([i]), ctx('15:10'))!;
    expect(antes.maisTarde).toBe(true);
    expect(antes.atrasado).toBe(false);
    const depois = estadoDoItem(i, loja([i]), ctx('23:20'))!;
    expect(depois.maisTarde).toBe(false);
    expect(depois.atrasado).toBe(true);
    expect(resumoRotina([antes])).toMatchObject({ pendentes: 0, feitos: 0, total: 1 });
    expect(resumoRotina([antes]).maisTarde).toHaveLength(1);
  });
  it('abrir a loja marca automático com quem abriu', () => {
    const i = item({ tipo: 'abrir', hora: '10:00' });
    const l = loja([i], { fatos: { aberta: { quem: 'Thati', quando: '2026-10-03T12:42:00Z' }, fechada: null, recebido: null, contagens: [], planos: [] } });
    const e = estadoDoItem(i, l, ctx('08:40'))!;
    expect(e).toMatchObject({ feito: true, origem: 'auto', quem: 'Thati', quando: '09:42' });
  });
  it('marca à mão guarda quem fez e o login que marcou', () => {
    const i = item({});
    const l = loja([i], { marcas: [{ item_id: 'i1', dia: HOJE, feito_em: '2026-10-03T18:10:00Z', pessoa_nome: 'Josiane', registrado_por: 'u', registrado_por_nome: 'Caixa', freelancer: true }] });
    expect(estadoDoItem(i, l, ctx())).toMatchObject({ feito: true, origem: 'mao', quem: 'Josiane', registradoPor: 'Caixa', freelancer: true, quando: '15:10' });
  });
  it('marca de ontem não vale para o item que se repete', () => {
    const i = item({});
    const l = loja([i], { marcas: [{ item_id: 'i1', dia: '2026-10-02', feito_em: '2026-10-02T18:10:00Z', pessoa_nome: 'Ana', registrado_por: 'u', registrado_por_nome: 'Ana', freelancer: false }] });
    expect(estadoDoItem(i, l, ctx())!.feito).toBe(false);
  });
  it('"só hoje" de ontem não feito aparece atrasado; feito ontem some; de amanhã ainda não aparece', () => {
    const ontem = item({ dias: null, dia: '2026-10-02' });
    expect(estadoDoItem(ontem, loja([ontem]), ctx())).toMatchObject({ deOntem: true, atrasado: true, feito: false });
    const feitoOntem = loja([ontem], { marcas: [{ item_id: 'i1', dia: '2026-10-02', feito_em: '2026-10-02T20:00:00Z', pessoa_nome: 'Ana', registrado_por: 'u', registrado_por_nome: 'Ana', freelancer: false }] });
    expect(estadoDoItem(ontem, feitoOntem, ctx())).toBeNull();
    expect(estadoDoItem(item({ dias: null, dia: '2026-10-04' }), loja([]), ctx())).toBeNull();
  });
  it('produção pedida marca automático com quem produziu', () => {
    const i = item({ papel: 'cozinha', tipo: 'producao', dias: null, dia: HOJE, receita_id: 'r1', producao: { quem: 'Marcos', quando: '2026-10-03T20:30:00Z', qtd: 2.4, unidade: 'kg' } });
    expect(estadoDoItem(i, loja([i]), ctx())).toMatchObject({ feito: true, origem: 'auto', quem: 'Marcos', det: '2,4 kg', quando: '17:30' });
  });
  it('rotina de hoje filtra por papel e põe o que se repete antes do "só hoje"', () => {
    const a = item({ id: 'a', papel: 'equipe', dias: null, dia: HOJE, ordem: 0 });
    const b = item({ id: 'b', papel: 'equipe', ordem: 5 });
    const c = item({ id: 'c', papel: 'supervisao' });
    expect(rotinaDeHoje(loja([a, b, c]), ['equipe'], ctx()).map((e) => e.item.id)).toEqual(['b', 'a']);
  });
});

describe('rotina — contagem pelos planos do Estoque', () => {
  const planos = [{ id: 'p', nome: 'Semanal', frequencia: 'semanal', dia_semana: 6, dia_mes: null, todos: false, itens: ['x', 'y'], criado_em: '2026-09-01T00:00:00Z' }];
  it('sábado é dia do plano: vale, e só fica feita quando os itens foram contados hoje', () => {
    const naoContado = contagemDaLoja(planos, [
      { id: 'x', contaInventario: true, ultimaContagem: '2026-10-03T15:00:00Z' },
      { id: 'y', contaInventario: true, ultimaContagem: '2026-09-26T15:00:00Z' },
    ], HOJE);
    expect(naoContado).toMatchObject({ aplica: true, feito: false, pendentes: 1 });
    const contado = contagemDaLoja(planos, [
      { id: 'x', contaInventario: true, ultimaContagem: '2026-10-03T15:00:00Z' },
      { id: 'y', contaInventario: true, ultimaContagem: '2026-10-03T15:05:00Z' },
    ], HOJE);
    expect(contado).toMatchObject({ aplica: true, feito: true, pendentes: 0 });
  });
  it('outro dia e já contado: não vale', () => {
    const c = contagemDaLoja([{ ...planos[0], dia_semana: 1 }], [
      { id: 'x', contaInventario: true, ultimaContagem: '2026-09-28T15:00:00Z' },
      { id: 'y', contaInventario: true, ultimaContagem: '2026-09-28T15:00:00Z' },
    ], HOJE);
    expect(c.aplica).toBe(false);
  });
  it('item de contagem pelos planos só aparece quando o plano manda', () => {
    const i = item({ tipo: 'contagem', dias: null, dias_plano: true });
    expect(estadoDoItem(i, loja([i]), ctx('09:00', { contagem: { aplica: false, feito: false, pendentes: 0, planos: [], atrasoDias: 0 } }))).toBeNull();
    expect(estadoDoItem(i, loja([i]), ctx('09:00', { contagem: { aplica: true, feito: false, pendentes: 2, planos: ['Semanal'], atrasoDias: 0 } }))!.feito).toBe(false);
  });
});

describe('rotina — mais de uma pessoa e dias à frente', () => {
  it('junta os nomes como se fala', () => {
    expect(juntarNomes(['Ana'])).toBe('Ana');
    expect(juntarNomes(['Ana', 'Rafael'])).toBe('Ana e Rafael');
    expect(juntarNomes(['Ana', 'Bruno', 'Rafael'])).toBe('Ana, Bruno e Rafael');
  });
  it('marca com várias pessoas devolve a lista (para "quem fez" já vir marcado)', () => {
    const i = item({});
    const pessoas = [{ tipo: 'freelancer' as const, id: 'f1', nome: 'Josiane' }, { tipo: 'user' as const, id: 'u1', nome: 'Ana' }];
    const l = loja([i], { marcas: [{ item_id: 'i1', dia: HOJE, feito_em: '2026-10-03T18:10:00Z', pessoa_nome: 'Josiane e Ana', registrado_por: 'u', registrado_por_nome: 'Caixa', freelancer: true, pessoas }] });
    expect(estadoDoItem(i, l, ctx())).toMatchObject({ feito: true, quem: 'Josiane e Ana', pessoas });
  });
  it('tarefa agendada para frente não entra na rotina de hoje, só em "Próximos dias"', () => {
    const futura = item({ id: 'f', papel: 'equipe', dias: null, dia: '2026-10-10' });
    const hoje = item({ id: 'h', papel: 'equipe', dias: null, dia: HOJE });
    const l = loja([futura, hoje]);
    expect(rotinaDeHoje(l, ['equipe'], ctx()).map((e) => e.item.id)).toEqual(['h']);
    expect(agendados(l, ['equipe'], HOJE).map((i) => i.id)).toEqual(['f']);
    expect(agendados(l, ['supervisao'], HOJE)).toEqual([]);
  });
});
