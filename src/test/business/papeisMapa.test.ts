import { describe, it, expect } from 'vitest';
import { ROLE_MAP, ROLE_MAP_REVERSE } from '../../hooks/useUsuarios';
import { PAPEL_TO_DB_ROLE, DEFAULT_PERMISSOES } from '../../hooks/usePermissoes';
import { perfilConfig } from '../../constants/usuarios';
import { FIN_ABAS } from '../../constants/permissoesAbas';

describe('papel financeiro nos mapas', () => {
  it('traduz nos dois sentidos', () => {
    expect(ROLE_MAP['financeiro']).toBe('financeiro');
    expect(ROLE_MAP_REVERSE['financeiro']).toBe('financeiro');
    expect(PAPEL_TO_DB_ROLE['financeiro']).toBe('financeiro');
  });

  it('tem rótulo e cor próprios', () => {
    expect(perfilConfig['financeiro']).toBeTruthy();
    expect(perfilConfig['financeiro'].label).toBeTruthy();
  });

  it('nasce com todas as permissões do Financeiro e nada além', () => {
    const perms = DEFAULT_PERMISSOES['financeiro'];
    const finKeys = FIN_ABAS.map((a) => a.key);
    for (const k of finKeys) expect(perms).toContain(k);
    for (const k of perms) expect(k.startsWith('fin_')).toBe(true);
  });
});

describe('papel supervisão nos mapas', () => {
  it('traduz nos dois sentidos (supervisao ↔ supervisor)', () => {
    expect(ROLE_MAP['supervisor']).toBe('supervisao');
    expect(ROLE_MAP_REVERSE['supervisao']).toBe('supervisor');
    expect(PAPEL_TO_DB_ROLE['supervisao']).toBe('supervisor');
    expect(perfilConfig['supervisao'].label).toBe('Supervisão');
  });

  it('fica entre caixa e gerente', () => {
    const sup = DEFAULT_PERMISSOES['supervisao'];
    for (const k of DEFAULT_PERMISSOES['caixa']) expect(sup).toContain(k);
    for (const k of sup) expect(DEFAULT_PERMISSOES['gerente']).toContain(k);
    expect(sup).toContain('pdv_desconto');
    expect(sup).toContain('pdv_cancelar_pedido');
    expect(sup).not.toContain('configuracoes_editar');
    expect(sup).not.toContain('usuarios_gerenciar');
    expect(sup.some((k) => k.startsWith('fin_'))).toBe(false);
  });
});
