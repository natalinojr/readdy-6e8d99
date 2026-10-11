import { describe, it, expect } from 'vitest';
import { categorizarRubrica, INSS_DESC_RE, parseExtratoDominio, type PdfWord } from '@/lib/dominioExtrato';

// Linha do PDF: pares [texto, x] na mesma altura y (como o pdf.js entrega).
const linha = (y: number, ...ws: [string, number][]): PdfWord[] => ws.map(([str, x]) => ({ str, x, y, page: 1 }));

// Extrato de 09/2026 da Thatielle (El Patron Paranaguá), refeito por OCR: o tipo vem COLADO no valor
// ("2,98P", "133,74P", "2.047,74P", "242,87D"). Antes a coluna não fechava: o INSS (R$ 242,87) virou parte da
// descrição do adicional noturno, o salário sumiu e a soma das rubricas dava 978,70 contra 3.209,45 de proventos.
// As linhas 1–5 são as que a leitura antiga gravou em hr_payroll; "DIAS NORMAIS" e "REFLEXO ADIC. NOTURNO" não
// foram gravadas e entram aqui para os proventos fecharem em 3.209,45.
function extratoOcr09(): PdfWord[] {
  return [
    ...linha(10, ['Empresa:', 6], ['36 - EP PAR MALL LTDA', 112]),
    ...linha(20, ['Competência:', 6], ['09/2026', 112]),
    ...linha(40, ['Empr.:', 6], ['1 THATIELLE RODRIGUES VIEIRA', 65], ['Situação:', 205], ['Trabalhando', 237], ['CPF:', 350], ['063.211.571-80', 367], ['Adm:', 463], ['02/09/2025', 527]),
    ...linha(50, ['Vínculo:', 6], ['Celetista', 70]),
    ...linha(60, ['Cargo:', 6], ['10 AUXILIAR DE COZINHA II', 65], ['Salário:', 468], ['2.047,74', 544]),
    ...linha(70, ['19', 32], ['DIFERENCA DE SALARIOS', 50], ['918,70', 200], ['918,70', 250], ['P', 260], ['221', 308], ['HORAS FALTAS - ATRASOS', 331], ['27:37', 485], ['257,08 D', 532]),
    ...linha(80, ['25', 32], ['ADICIONAL NOTURNO (INFOR)', 50], ['1:36', 200], ['2,98P', 256], ['998', 308], ['IN(S.S..', 331], ['8,23', 489], ['242,87 D', 532]),
    ...linha(90, ['216', 27], ['HORAS EXTRAS 60%', 50], ['8:59', 200], ['133,74P', 252], ['9750', 308], ['DESC. EMP. CRED. TRAB Nº 0153402', 331], ['469,65', 481], ['469,65 D', 532]),
    ...linha(100, ['250', 27], ['REFLEXO EXTRAS DSR.', 50], ['5,00', 200], ['26,75 P', 256]),
    ...linha(110, ['8374', 23], ['DIFERENCA 130 ALTERACAO SAL RE', 50], ['0,00', 200], ['33,25 P', 256]),
    ...linha(120, ['8781', 23], ['DIAS NORMAIS', 50], ['30,00', 195], ['2.047,74P', 245]),
    ...linha(130, ['854', 27], ['REFLEXO ADIC. NOTURNO DSR.', 50], ['0,00', 200], ['46,29 P', 260]),
    ...linha(140, ['ND:', 6], ['1', 29], ['Proventos:', 41], ['3.209,45', 104], ['Descontos:', 154], ['969,60', 221], ['Informativa:', 249], ['236,18', 319], ['Informativa Dedutora:', 361], ['0', 462], ['Líquido:', 489], ['2.239,85', 543]),
    ...linha(150, ['NF:', 6], ['1', 29], ['Base INSS:', 40], ['2.952,37', 104], ['Excedente INSS:', 129], ['0,00', 229], ['Base FGTS:', 252], ['2.952,37', 313], ['Valor FGTS:', 360], ['236,18', 443], ['Base IRRF:', 483], ['2.330,32', 543]),
    ...linha(160, ['Total Geral Proventos:', 112], ['3.209,45', 222], ['Total Geral Descontos:', 405], ['969,60', 521]),
    ...linha(170, ['Líquido Geral:', 434], ['2.239,85', 521]),
  ];
}

describe('dominioExtrato › valor e tipo colados (PDF com OCR)', () => {
  const ext = parseExtratoDominio(extratoOcr09());
  const f = ext.funcionarios[0];

  it('lê as 10 rubricas e fecha com os totais, sem avisos', () => {
    expect(ext.competencia).toBe('2026-09');
    expect(ext.funcionarios).toHaveLength(1);
    expect(f.rubricas).toHaveLength(10);
    expect(f.avisos).toEqual([]);
    expect(ext.avisos).toEqual([]);
    const soma = (t: 'P' | 'D') => Math.round(f.rubricas.filter((r) => r.tipo === t).reduce((s, r) => s + r.valor, 0) * 100) / 100;
    expect(soma('P')).toBe(3209.45);
    expect(soma('D')).toBe(969.6);
  });

  it('o INSS (R$ 242,87) sai como rubrica própria, não dentro da descrição do adicional noturno', () => {
    const inss = f.rubricas.find((r) => r.codigo === '998')!;
    expect(inss).toMatchObject({ tipo: 'D', valor: 242.87, referencia: '8,23' });
    expect(categorizarRubrica(inss)).toBe('inss');
    const adic = f.rubricas.find((r) => r.codigo === '25')!;
    expect(adic).toMatchObject({ descricao: 'ADICIONAL NOTURNO (INFOR)', tipo: 'P', valor: 2.98, referencia: '1:36' });
  });

  it('hora extra e salário colados também entram (a linha só da esquerda não se perde)', () => {
    expect(f.rubricas.find((r) => r.codigo === '216')).toMatchObject({ descricao: 'HORAS EXTRAS 60%', tipo: 'P', valor: 133.74, referencia: '8:59' });
    expect(f.rubricas.find((r) => r.codigo === '8781')).toMatchObject({ descricao: 'DIAS NORMAIS', tipo: 'P', valor: 2047.74, referencia: '30,00' });
    expect(f.rubricas.find((r) => r.codigo === '9750')).toMatchObject({ tipo: 'D', valor: 469.65 });
  });

  it('descontos colados dos dois lados na mesma linha', () => {
    const e = parseExtratoDominio([
      ...linha(20, ['Competência:', 6], ['09/2026', 112]),
      ...linha(40, ['Empr.:', 6], ['1 FULANO', 65]),
      ...linha(70, ['25', 32], ['ADICIONAL NOTURNO (INFOR)', 50], ['1:36', 200], ['2,98P', 256], ['998', 308], ['INSS', 331], ['8,23', 489], ['242,87D', 532]),
      ...linha(80, ['220', 308], ['DIAS FALTAS.', 331], ['1,00', 489], ['64,93D', 532]),
      ...linha(90, ['Total Geral Proventos:', 112], ['2,98', 222]),
    ]);
    const r = e.funcionarios[0].rubricas;
    expect(r.map((x) => [x.codigo, x.tipo, x.valor])).toEqual([['25', 'P', 2.98], ['998', 'D', 242.87], ['220', 'D', 64.93]]);
  });
});

describe('dominioExtrato › leitura sem cola continua igual (Extrato do Domínio com texto)', () => {
  it('duas colunas, linha só da direita e linha só da esquerda', () => {
    const e = parseExtratoDominio([
      ...linha(20, ['Competência:', 0], ['08/2026', 105]),
      ...linha(40, ['Empr.:', 0], ['1 THATIELLE RODRIGUES VIEIRA', 59]),
      ...linha(70, ['9180', 18], ['SALDO DE SALARIO DIAS', 40], ['4,00', 193], ['234,13', 247], ['P', 270], ['51', 304], ['LIQUIDO RESCISAO', 322], ['0,00', 480], ['9,01 D', 531]),
      ...linha(80, ['8781', 18], ['DIAS NORMAIS', 40], ['30,00', 189], ['1.948,00', 241], ['P', 270]),
      ...linha(90, ['223', 300], ['HORAS FALTAS.', 322], ['38:11', 475], ['338,07 D', 524]),
      ...linha(100, ['Total Geral Proventos:', 112], ['2.182,13', 222]),
    ]);
    expect(e.funcionarios[0].rubricas.map((x) => [x.codigo, x.tipo, x.valor, x.referencia]))
      .toEqual([['9180', 'P', 234.13, '4,00'], ['51', 'D', 9.01, '0,00'], ['8781', 'P', 1948, '30,00'], ['223', 'D', 338.07, '38:11']]);
  });
});

describe('dominioExtrato › INSS na descrição da rubrica', () => {
  it.each(['I.N.S.S..', 'IN(S.S..', 'INSS', 'INSS SOBRE RESCISAO', 'INSS 13 SAL.RESCISAO.', 'INSS EMPREGADOR.'])('reconhece %s', (d) => {
    expect(INSS_DESC_RE.test(d)).toBe(true);
    expect(categorizarRubrica({ descricao: d, tipo: 'D' })).toBe('inss');
  });
  it.each(['HORAS FALTAS.', 'DESC. EMP. CRED. TRAB Nº 0153402', 'ADICIONAL NOTURNO (INFOR)', 'DIAS NORMAIS', 'ASSISTENCIA MEDICA', 'DESCONTO SALDO DE DIAS VR'])('não confunde %s', (d) => {
    expect(INSS_DESC_RE.test(d)).toBe(false);
  });
});
