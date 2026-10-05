// Acesso por pessoa (2026-10-03): "o que essa pessoa faz?" → permissões. Regras puras do catálogo.
import { describe, it, expect } from 'vitest';
import { TRABALHOS, estadoTrabalho, alternarTrabalho, ajustesDaPessoa, KEYS_SO_DONO, FIN_VER, FIN_LANCAR } from '@/constants/trabalhos';
import { DEFAULT_PERMISSOES } from '@/hooks/usePermissoes';
import { FIN_KEYS } from '@/constants/permissoesAbas';

const t = (id: string) => TRABALHOS.find((x) => x.id === id)!;

describe('catálogo de trabalhos', () => {
  it('toda permissão citada existe no padrão do admin (nada de chave nova)', () => {
    const todas = new Set<string>(DEFAULT_PERMISSOES.admin);
    for (const tr of TRABALHOS) for (const k of tr.keys) expect(todas.has(k), `${tr.id}: ${k}`).toBe(true);
  });

  it('ver + lançar cobrem todas as abas do Financeiro, sem repetir', () => {
    expect([...FIN_VER, ...FIN_LANCAR].sort()).toEqual([...FIN_KEYS].sort());
  });

  it('trabalho de dinheiro e cadastro de pessoas é só do dono', () => {
    for (const tr of TRABALHOS.filter((x) => x.soDono)) for (const k of tr.keys) expect(KEYS_SO_DONO).toContain(k);
    for (const tr of TRABALHOS.filter((x) => !x.soDono)) for (const k of tr.keys) expect(KEYS_SO_DONO).not.toContain(k);
  });

  it('supervisão padrão: vende, mesas, cozinha, entregas, autoriza e confere o turno', () => {
    const sup = new Set<string>(DEFAULT_PERMISSOES.supervisao);
    const ligados = TRABALHOS.filter((x) => estadoTrabalho(x, sup) === 'on').map((x) => x.id);
    expect(ligados).toEqual(['vender', 'mesas', 'cozinha', 'entregas', 'autoriza', 'turno']);
  });
});

describe('ligar, desligar e ajuste da pessoa', () => {
  it('estado em parte quando só algumas permissões estão ligadas', () => {
    expect(estadoTrabalho(t('autoriza'), new Set(['pdv_desconto']))).toBe('parcial');
  });

  it('desligar não tira permissão que outro trabalho ligado usa', () => {
    const base = new Set<string>(DEFAULT_PERMISSOES.supervisao);
    const sem = alternarTrabalho(t('entregas'), base, false);
    expect(sem.has('gestor_entregas_acessar')).toBe(false);
    expect(sem.has('gestao_pedidos')).toBe(true); // "Confere o turno" continua ligado
  });

  it('ajuste = só a diferença do padrão do cargo', () => {
    const padrao = new Set<string>(DEFAULT_PERMISSOES.supervisao);
    let pessoa = alternarTrabalho(t('receber'), padrao, true);
    pessoa = alternarTrabalho(t('mesas'), pessoa, false);
    expect(ajustesDaPessoa(padrao, pessoa)).toEqual([
      { permission_key: 'estoque_receber', allowed: true },
      { permission_key: 'garcom_fechar_mesa', allowed: false },
      { permission_key: 'garcom_transferir_mesa', allowed: false },
    ]);
    expect(ajustesDaPessoa(padrao, padrao)).toEqual([]);
  });
});

import { conferirAcesso, type PedidoDeAcesso } from '../../../supabase/functions/_shared/acesso-pessoa';

describe('quem pode dar o quê (conferirAcesso)', () => {
  const gerente = new Set<string>(DEFAULT_PERMISSOES.gerente);
  const sup = [...DEFAULT_PERMISSOES.supervisao];
  const base = (o: Partial<PedidoDeAcesso>): PedidoDeAcesso => ({
    editor: 'gerente', propria: false, keysDoEditor: gerente, papelAtual: 'supervisao', papelNovo: 'supervisao',
    keysAtuais: new Set(sup), keys: sup, padraoDoCargoNovo: sup, ...o,
  });

  it('gerente dá a supervisora o que ele tem (receber mercadoria)', () => {
    expect(conferirAcesso(base({ keys: [...sup, 'estoque_receber'] }))).toBeNull();
  });
  it('gerente não dá aprovar pagamento nem cadastro de pessoas', () => {
    expect(conferirAcesso(base({ keys: [...sup, 'pag_aprovar'] }))).toMatch(/só o Administrador/);
    expect(conferirAcesso(base({ keys: [...sup, 'usuarios_gerenciar'] }))).toMatch(/só para Supervisor/);
  });
  it('gerente não dá o que ele mesmo não tem', () => {
    expect(conferirAcesso(base({ keys: [...sup, 'cardapio_alterar_preco'] }))).toMatch(/ele mesmo tem/);
  });
  it('o que a pessoa já tinha (dado pelo dono) pode ficar quando o gerente salva', () => {
    expect(conferirAcesso(base({ keysAtuais: new Set([...sup, 'pag_aprovar']), keys: [...sup, 'pag_aprovar'] }))).toBeNull();
  });
  it('gerente não mexe em outro gerente nem promove a gerente', () => {
    expect(conferirAcesso(base({ papelAtual: 'gerente' }))).toMatch(/abaixo dele/);
    expect(conferirAcesso(base({ papelNovo: 'gerente' }))).toMatch(/não dá esse cargo/);
  });
  it('ninguém muda o próprio acesso; admin não tem ajuste; chave inventada é recusada', () => {
    expect(conferirAcesso(base({ propria: true }))).toMatch(/próprio/);
    expect(conferirAcesso(base({ editor: 'admin', papelAtual: 'admin' }))).toMatch(/tem tudo/);
    expect(conferirAcesso(base({ editor: 'admin', keys: ['inventada'] }))).toMatch(/desconhecida/);
  });
  it('o dono dá o que é só dele (aprovar pagamento) a quem quiser', () => {
    expect(conferirAcesso(base({ editor: 'admin', keys: [...sup, 'pag_aprovar'] }))).toBeNull();
    expect(conferirAcesso(base({ editor: 'supervisao' }))).toMatch(/Só o Administrador ou o supervisor/);
  });
});

describe('o que vai além do cargo tem que funcionar no cargo (revisão)', () => {
  const sup = [...DEFAULT_PERMISSOES.supervisao];
  const doDono = (o: Partial<PedidoDeAcesso>): PedidoDeAcesso => ({
    editor: 'admin', propria: false, keysDoEditor: new Set(DEFAULT_PERMISSOES.admin), papelAtual: 'supervisao', papelNovo: 'supervisao',
    keysAtuais: new Set(sup), keys: sup, padraoDoCargoNovo: sup, ...o,
  });
  it('financeiro só para Supervisor, Financeiro ou Contabilidade (nem o dono liga para a Líder)', () => {
    expect(conferirAcesso(doDono({ keys: [...sup, 'fin_entregadores'] }))).toMatch(/financeiro só funciona/);
    const ger = [...DEFAULT_PERMISSOES.gerente];
    expect(conferirAcesso(doDono({ papelAtual: 'gerente', papelNovo: 'gerente', keysAtuais: new Set(ger), padraoDoCargoNovo: ger, keys: [...ger, 'fin_visao'] }))).toBeNull();
  });
  it('a aba Permissões nunca se dá por pessoa', () => {
    const ger = [...DEFAULT_PERMISSOES.gerente];
    expect(conferirAcesso(doDono({ papelAtual: 'gerente', papelNovo: 'gerente', padraoDoCargoNovo: ger, keys: [...ger, 'cfg_permissoes'] }))).toMatch(/Permissões/);
  });
  it('cargo preso à área: entregas não ganha receber; financeiro só ajusta abas', () => {
    const ent = [...DEFAULT_PERMISSOES.gestor_entregas];
    expect(conferirAcesso(doDono({ papelAtual: 'gestor_entregas', papelNovo: 'gestor_entregas', padraoDoCargoNovo: ent, keys: [...ent, 'estoque_receber'] }))).toMatch(/preso/);
    const fin = [...DEFAULT_PERMISSOES.contabilidade];
    expect(conferirAcesso(doDono({ papelAtual: 'contabilidade', papelNovo: 'contabilidade', padraoDoCargoNovo: fin, keys: [...fin, 'fin_bancos'] }))).toBeNull();
    expect(conferirAcesso(doDono({ papelAtual: 'contabilidade', papelNovo: 'contabilidade', padraoDoCargoNovo: fin, keys: [...fin, 'estoque_receber'] }))).toMatch(/preso/);
  });
});
