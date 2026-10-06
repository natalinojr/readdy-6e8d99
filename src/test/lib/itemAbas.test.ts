import { describe, it, expect } from 'vitest';
import { abaNova, ABAS_ITEM, itemComMesmoNome, validarItem } from '@/pages/cardapio/components/item/itemAbas';

describe('janela do item: abas', () => {
  it('tem as 6 abas na ordem do protótipo', () => {
    expect(ABAS_ITEM.map((a) => a.rotulo)).toEqual(['Básico', 'Como é feito', 'Opções', 'Promoções', 'Observações', 'Avançado']);
  });

  it('mapeia as 8 abas antigas para as novas (abaInicial / ?ficha=1)', () => {
    expect(abaNova('info')).toBe('basico');
    expect(abaNova('producao')).toBe('feito');
    expect(abaNova('ficha')).toBe('feito');
    expect(abaNova('opcoes')).toBe('opcoes');
    expect(abaNova('promocoes')).toBe('promocoes');
    expect(abaNova('observacoes')).toBe('observacoes');
    expect(abaNova('fiscal')).toBe('avancado');
    expect(abaNova('delivery')).toBe('avancado');
  });

  it('aceita os nomes novos e cai no Básico sem aba ou com nome desconhecido', () => {
    expect(abaNova('feito')).toBe('feito');
    expect(abaNova('avancado')).toBe('avancado');
    expect(abaNova(undefined)).toBe('basico');
    expect(abaNova('xyz')).toBe('basico');
  });
});

describe('janela do item: validação leva à aba do campo', () => {
  const ok = { nome: 'X-Burguer', preco: '29.9', erroHorario: null, opcoesSemQuantidade: [] as string[] };

  it('passa quando está tudo certo (preço zero é permitido)', () => {
    expect(validarItem(ok)).toBeNull();
    expect(validarItem({ ...ok, preco: '0' })).toBeNull();
  });

  it('falta nome ou preço → Básico', () => {
    expect(validarItem({ ...ok, nome: '  ' })).toMatchObject({ aba: 'basico', campo: 'item-nome' });
    expect(validarItem({ ...ok, preco: '' })).toMatchObject({ aba: 'basico', campo: 'item-preco', texto: 'Falta o preço do item.' });
  });

  it('horário incompleto → Básico, no editor de horário', () => {
    const e = validarItem({ ...ok, erroHorario: 'Preencha o início e o fim.' });
    expect(e).toMatchObject({ aba: 'basico', campo: 'item-horario-cardapio' });
    expect(e?.texto).toContain('Preencha o início e o fim.');
  });

  it('opção ligada ao estoque sem quantidade → Opções', () => {
    const e = validarItem({ ...ok, opcoesSemQuantidade: ['Bacon', 'Cheddar'] });
    expect(e).toEqual({ aba: 'opcoes', texto: 'Informe quanto sai do estoque em: Bacon, Cheddar.' });
  });
});

describe('janela do item: nome repetido', () => {
  const itens = [{ id: 'a', nome: 'Pão de Queijo' }, { id: 'b', nome: 'Coca-cola 600ml' }];

  it('acha sem diferenciar acento, maiúscula ou espaço a mais', () => {
    expect(itemComMesmoNome('pao  de queijo ', itens)?.id).toBe('a');
  });

  it('não acusa o próprio item nem nome vazio', () => {
    expect(itemComMesmoNome('Pão de Queijo', itens, 'a')).toBeNull();
    expect(itemComMesmoNome('   ', itens)).toBeNull();
    expect(itemComMesmoNome('Coxinha', itens)).toBeNull();
  });
});
