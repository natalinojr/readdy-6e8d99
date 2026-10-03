// "Aprendi com você" e porções da tela Hoje (2026-10-03): sugestões montadas a partir das decisões
// repetidas e a porção de hoje do trabalho acumulado — sem banco.
import { describe, it, expect } from 'vitest';
import { montarSugestoes, type RegraLancamento } from '@/pages/hoje/aprender';
import { organizarHoje, porcaoDe, type PendHoje } from '@/pages/hoje/organizar';

const lojas = new Map([['par', 'Paranaguá'], ['vila', 'Vila Leste']]);
const descarte = (tenant: string, forn: string, quem: string | null = 'u1') => ({ tenant_id: tenant, titulo: `Falta o boleto: ${forn} — R$ 10,00, vence 05/10`, resolvida_por: quem });
const regra = (o: Partial<RegraLancamento>): RegraLancamento => ({
  id: 'r1', tenant_id: 'par', counterpart_doc: '123', counterpart_label: null, supplier_name: 'FACEBOOK', launch_kind: 'despesa',
  dre_category_id: 'd1', merchandise_category_id: null, competence_rule: 'same', cost_center_id: null, match_count: 7, mode: 'suggest', ...o,
});

describe('montarSugestoes', () => {
  it('"Não era boleto" 2 vezes para o mesmo fornecedor vira sugestão; 1 vez ou decisão do sistema não', () => {
    const s = montarSugestoes([descarte('par', 'OESA'), descarte('par', 'OESA'), descarte('par', 'X'), descarte('vila', 'Y', null), descarte('vila', 'Y', null)], [], [], lojas);
    expect(s.map((x) => x.id)).toEqual(['sem_boleto:par:OESA']);
    expect(s[0].loja).toBe('Paranaguá');
    expect(s[0].alvo).toBe('OESA');
  });

  it('não pergunta de novo o que já foi aceito ou recusado', () => {
    const s = montarSugestoes([descarte('par', 'OESA'), descarte('par', 'oesa')], [regra({})],
      [{ tenant_id: 'par', chave: 'sem_boleto_fornecedor', alvo: 'OESA', ligada: false, origem: 'recusada' },
        { tenant_id: 'par', chave: 'regra_lancamento_auto', alvo: 'R1', ligada: true, origem: 'aprendida' }], lojas);
    expect(s).toHaveLength(0);
  });

  it('regra que só sugere e acertou 3+ vezes vira "lançar sozinho"; já automática ou com poucos acertos não', () => {
    const s = montarSugestoes([], [regra({ id: 'a', match_count: 3 }), regra({ id: 'b', match_count: 2 }), regra({ id: 'c', mode: 'auto', match_count: 9 })], [], lojas);
    expect(s.map((x) => x.id)).toEqual(['regra_auto:par:a']);
    expect(s[0].titulo).toContain('FACEBOOK');
  });
});

describe('porções', () => {
  it('porção de ~1/5 do começo do dia (mínimo 3); pequeno não vira porção', () => {
    expect(porcaoDe(14, 14)).toEqual({ meta: 3, feitos: 0, restante: 14, dias: 5, feita: false });
    expect(porcaoDe(22, 18)).toEqual({ meta: 5, feitos: 4, restante: 18, dias: 4, feita: false });
    expect(porcaoDe(22, 17)?.feita).toBe(true);
    expect(porcaoDe(5, 5)).toBeNull();
  });

  it('porção não muda o bloco: nota não lançada (boleto vencido) segue em "Agora" mesmo com a porção feita', () => {
    const p: PendHoje = { id: 'n1', tenantId: 'par', loja: 'P', kind: 'nota_nao_lancada', ref: 'pendentes', titulo: '17 notas', detalhe: null, rota: null,
      urgencia: 'alta', acaoRequerida: true, status: 'aberta', criadaEm: '2026-10-01T10:00:00Z', payload: { total: 17 } };
    const semAndar = organizarHoje([p], '2026-10-03', new Map([['n1', 17]]));
    expect(semAndar[0].bloco).toBe('agora');
    expect(semAndar[0].porcao?.meta).toBe(4);
    const andou = organizarHoje([p], '2026-10-03', new Map([['n1', 22]]));
    expect(andou[0].bloco).toBe('agora');
    expect(andou[0].porcao?.feita).toBe(true);
    // e o servidor, que não lê porções, conta o mesmo bloco
    expect(organizarHoje([p], '2026-10-03')[0].bloco).toBe('agora');
  });
});
