// supabase/functions/_shared/guias.ts: classificação das guias do mês (DAS / DARF / FGTS).
// Import por caminho montado em tempo de execução (mesmo padrão de financeiroRole.test.ts).
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/_shared/guias.ts')).href;
type Guia = { tipo: string; titulo: string; encargo_folha: boolean };
const load = () => import(/* @vite-ignore */ PATH) as Promise<{ lerGuia: (t: string) => Guia | null }>;

const darf = (composicao: string) => `Documento de Arrecadação de Receitas Federais
CNPJ 60.871.619/0001-01  Período de Apuração agosto/2026  Pagar este documento até 19/09/2026
Número do Documento 07.20.26252.1234567-8
${composicao}
Valor Total do Documento 210,00`;

describe('lerGuia — encargo da folha', () => {
  it('DARF só de IRRF da folha (0561) é encargo da folha, não Impostos', async () => {
    const { lerGuia } = await load();
    const g = lerGuia(darf('0561 IRRF - RENDIMENTO DO TRABALHO ASSALARIADO 210,00'))!;
    expect(g.tipo).toBe('DARF');
    expect(g.encargo_folha).toBe(true);
    expect(g.titulo).toBe('DARF IRRF (folha)');
  });

  it('DARF do INSS continua encargo da folha com o mesmo título', async () => {
    const { lerGuia } = await load();
    const g = lerGuia(darf('1082 CONTR PREV DESCONTADA SEGURADO 210,00'))!;
    expect(g.encargo_folha).toBe(true);
    expect(g.titulo).toBe('DARF INSS (previdência)');
  });

  it('DARF de outro imposto continua Impostos', async () => {
    const { lerGuia } = await load();
    const g = lerGuia(darf('2089 IRPJ - LUCRO PRESUMIDO 210,00'))!;
    expect(g.encargo_folha).toBe(false);
    expect(g.titulo).toBe('DARF');
  });
});
