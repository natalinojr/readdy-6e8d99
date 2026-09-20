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
