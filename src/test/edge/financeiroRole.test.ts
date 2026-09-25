// supabase/functions/_shared/tenant-auth.ts: quem pode escrever no módulo Financeiro.
// Import por caminho montado em tempo de execução (mesmo padrão de fiscalValores.test.ts):
// o tsc do app não passa a checar código Deno.
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TENANT_AUTH_PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/_shared/tenant-auth.ts')).href;

type Mod = {
  isFinanceiroRole: (role?: string | null) => boolean;
  isManagerRole: (role?: string | null) => boolean;
  isContabilidadeRole: (role?: string | null) => boolean;
};

const load = () => import(/* @vite-ignore */ TENANT_AUTH_PATH) as Promise<Mod>;

describe('isFinanceiroRole', () => {
  it('aceita quem opera o Financeiro', async () => {
    const { isFinanceiroRole } = await load();
    for (const r of ['admin', 'manager', 'gerente', 'financeiro']) {
      expect(isFinanceiroRole(r)).toBe(true);
    }
  });

  it('recusa papel de PDV e vazio', async () => {
    const { isFinanceiroRole } = await load();
    for (const r of ['cashier', 'waiter', 'kitchen', 'tablet', 'customer', 'tasks_only', 'delivery_manager', '']) {
      expect(isFinanceiroRole(r)).toBe(false);
    }
    expect(isFinanceiroRole(null)).toBe(false);
    expect(isFinanceiroRole(undefined)).toBe(false);
  });

  it('não dá ao papel financeiro acesso de gerente (o PDV continua barrado)', async () => {
    const { isManagerRole } = await load();
    expect(isManagerRole('financeiro')).toBe(false);
  });
});

describe('isContabilidadeRole', () => {
  it('só o papel accountant, e ele não escreve como Financeiro nem como gerente', async () => {
    const { isContabilidadeRole, isFinanceiroRole, isManagerRole } = await load();
    expect(isContabilidadeRole('accountant')).toBe(true);
    for (const r of ['admin', 'manager', 'financeiro', 'cashier', '', null]) expect(isContabilidadeRole(r)).toBe(false);
    expect(isFinanceiroRole('accountant')).toBe(false);
    expect(isManagerRole('accountant')).toBe(false);
  });
});
