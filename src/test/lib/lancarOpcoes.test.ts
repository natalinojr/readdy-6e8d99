// "O que aconteceu?" (2026-10-03): cada perfil vê só o que pode, na ordem fixa, e a mesma resposta
// leva quem lança direto à tela de lançar e quem não lança ao pedido para o dono aprovar.
// Perfis = matriz real da El Patron Paranaguá em 03/10 (permissions + padrão do papel).
import { describe, it, expect } from 'vitest';
import { acaoLiberada, type ContextoAcesso } from '@/components/feature/assistente/acoes/acesso';
import { OPCOES, caminhoUnico, filhosVisiveis, variante, temAlgumLancamento, type Opcao } from '@/components/feature/lancar/opcoes';
import { DEFAULT_PERMISSOES, type Papel, type PermissaoKey } from '@/hooks/usePermissoes';
import { FIN_KEYS } from '@/constants/permissoesAbas';
import { rotaForcada } from '@/lib/acessoRota';

const ctx = (perfil: Papel, ks: PermissaoKey[]): ContextoAcesso => {
  const set = new Set(ks);
  return { perfil, pode: (k) => set.has(k), modulo: () => false };
};
const padrao = (perfil: Papel, mais: PermissaoKey[] = [], menos: PermissaoKey[] = []) =>
  ctx(perfil, [...DEFAULT_PERMISSOES[perfil].filter((k) => !menos.includes(k)), ...mais]);

const FIN_FORA_GERENTE_PAR = FIN_KEYS.filter((k) => !['fin_compras', 'fin_freelancers', 'fin_guias', 'fin_ifood', 'fin_itens', 'fin_notas_entrada'].includes(k));
const gerentePar = padrao('gerente', ['pag_aprovar'], FIN_FORA_GERENTE_PAR);
const supervisaoPar = padrao('supervisao', ['estoque_receber', 'estoque_movimentar', 'pag_fornecedor', 'pag_freelancer', 'pag_reembolso']);
const caixaPar = padrao('caixa', ['estoque_receber', 'estoque_movimentar', 'pag_fornecedor']);

const ids = (lista: Opcao[] | undefined, c: ContextoAcesso) => filhosVisiveis(lista, c).map((o) => o.id);
const achar = (id: string, lista: Opcao[] = OPCOES): Opcao | undefined => {
  for (const o of lista) {
    if (o.id === id) return o;
    const f = achar(id, o.filhos ?? []);
    if (f) return f;
  }
  return undefined;
};
const destino = (id: string, c: ContextoAcesso) => {
  const unico = caminhoUnico(achar(id)!, c);
  const v = unico && variante(unico, c);
  return v ? ('rota' in v.destino ? v.destino.rota : v.destino.acao) : null;
};

describe('O que aconteceu? — por perfil', () => {
  it('dono vê as 6 respostas, sempre na mesma ordem', () => {
    expect(ids(OPCOES, padrao('admin'))).toEqual(['paguei', 'chegou', 'nota', 'pagar', 'bolso', 'emprestimo']);
  });

  it('empréstimo entre lojas: mandar exige movimentar o estoque; receber vale para quem recebe mercadoria', () => {
    expect(destino('emprestimo-mandar', padrao('admin'))).toBe('/receber/emprestimos?mandar=1');
    // Só recebe (estoque_receber): vai direto para a conferência
    expect(destino('emprestimo', padrao('caixa', ['estoque_receber']))).toBe('/receber/emprestimos?receber=1');
    expect(ids(achar('emprestimo')!.filhos, supervisaoPar)).toEqual(['emprestimo-mandar', 'emprestimo-chegou']);
  });

  it('supervisão (fica na loja): recebe, faz sangria e pede; nada do Financeiro', () => {
    const c = supervisaoPar;
    expect(ids(OPCOES, c)).toEqual(['paguei', 'chegou', 'nota', 'pagar', 'bolso', 'emprestimo']);
    expect(ids(achar('pagar')!.filhos, c)).toEqual(['pagar-fornecedor', 'pagar-freela']);
    expect(variante(achar('pagar-fornecedor')!, c)?.aprova).toBe(true);
    expect(destino('nota-boleto', c)).toBe('/receber?pedido=fornecedor');
    expect(destino('nota-cupom', c)).toBe('/receber?receber=cupom');
    // Freelancer pago: só tem a sangria (sem Conciliação) → vai direto
    expect(destino('paguei-freela', c)).toBe('/pdv/caixa?abrir=sangria&tipo=freelancer');
  });

  it('caixa da Paranaguá: sem reembolso, e "tenho que pagar" vai direto ao pedido de fornecedor', () => {
    const c = caixaPar;
    expect(ids(OPCOES, c)).toEqual(['paguei', 'chegou', 'nota', 'pagar', 'emprestimo']);
    expect(destino('pagar', c)).toBe('/receber?pedido=fornecedor');
    expect(destino('paguei-despesa', c)).toBe('/pdv/caixa?abrir=sangria&tipo=outro');
  });

  it('gerente da Paranaguá: sem Contas a Pagar, boleto vira pedido; nota vai para Notas de Entrada', () => {
    const c = gerentePar;
    expect(destino('nota-boleto', c)).toBe('/receber?pedido=fornecedor');
    expect(destino('nota-nfe', c)).toBe('/financeiro?tab=notas-entrada');
    expect(destino('nota-guia', c)).toBe('/financeiro?tab=guias');
    // Sem fin_despesas/fin_pagar: "despesa da conta da loja" some
    expect(ids(achar('paguei-despesa')!.filhos, c)).toEqual(['despesa-caixa', 'despesa-bolso']);
  });

  it('gerente com tudo liberado lança direto (sem pedido)', () => {
    const c = padrao('gerente');
    expect(destino('nota-boleto', c)).toBe('/financeiro?tab=pagar&abrir=nova');
    expect(destino('despesa-conta', c)).toBe('lancar-despesa');
    expect(variante(achar('pagar-fornecedor')!, c)?.aprova).toBeFalsy();
  });

  it('papel Financeiro: não recebe mercadoria nem pede reembolso; mercadoria vai para Compras', () => {
    const c = padrao('financeiro');
    expect(ids(OPCOES, c)).toEqual(['paguei', 'nota', 'pagar']);
    expect(destino('paguei-mercadoria', c)).toBe('/financeiro?tab=compras&abrir=nova');
    expect(destino('paguei-extrato', c)).toBe('/financeiro?tab=conciliacao&abrir=pendentes');
    expect(destino('pagar-mei', c)).toBe('/financeiro?tab=rh&sub=prestadores');
  });

  it('contabilidade: só a guia (o servidor recusa o resto do lançamento)', () => {
    const c = padrao('contabilidade');
    expect(ids(OPCOES, c)).toEqual(['nota', 'pagar']);
    expect(ids(achar('nota')!.filhos, c)).toEqual(['nota-guia']);
    expect(ids(achar('pagar')!.filhos, c)).toEqual(['pagar-imposto']);
  });

  it('freelancer a pagar, para quem não pede: RH › Freelancers pela aba rh (abre com fin_rh ou fin_freelancers)', () => {
    expect(destino('pagar-freela', padrao('financeiro'))).toBe('/financeiro?tab=rh&sub=freelancers');
  });

  it('empresa sem PDV (só Financeiro): sem Recebimentos nem sangria, nem para o Admin', () => {
    const c = { ...padrao('admin'), temPdv: false };
    expect(ids(OPCOES, c)).toEqual(['paguei', 'nota', 'pagar']);
    expect(destino('paguei-mercadoria', c)).toBe('/financeiro?tab=compras&abrir=nova');
    expect(ids(achar('paguei-despesa')!.filhos, c)).toEqual(['despesa-conta']);
    expect(destino('nota-boleto', c)).toBe('/financeiro?tab=pagar&abrir=nova');
  });

  it('garçom e cozinha (padrão): nenhuma resposta', () => {
    expect(temAlgumLancamento(padrao('garcom'))).toBe(false);
    expect(temAlgumLancamento(padrao('cozinha'))).toBe(false);
  });
});

describe('ação rápida ⚡ "Lançar" bate com as respostas', () => {
  const casos: [string, ContextoAcesso][] = [
    ['admin', padrao('admin')], ['gerente', padrao('gerente')], ['gerentePar', gerentePar],
    ['supervisao', padrao('supervisao')], ['supervisaoPar', supervisaoPar], ['caixa', padrao('caixa')], ['caixaPar', caixaPar],
    ['caixa sem sangria', padrao('caixa', [], ['pdv_sangria'])], ['caixa só aprova', ctx('caixa', ['pag_aprovar'])],
    ['garcom', padrao('garcom')], ['cozinha', padrao('cozinha')], ['financeiro', padrao('financeiro')], ['contabilidade', padrao('contabilidade')],
    ['tarefas', padrao('tarefas')], ['gestor_entregas', padrao('gestor_entregas')],
    ['caixa sem PDV', { ...caixaPar, temPdv: false }], ['gerente sem PDV', { ...padrao('gerente'), temPdv: false }],
  ];
  it.each(casos)('%s', (_n, c) => {
    expect(acaoLiberada('lancar', c)).toBe(!rotaForcada(c.perfil, '/lancar') && temAlgumLancamento(c));
  });
});
