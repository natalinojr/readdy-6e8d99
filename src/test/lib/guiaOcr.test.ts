import { describe, it, expect } from 'vitest';
import { crc16Pix, linhaDaGuiaOcr, pixValido, resumirGuiaOcr, textoGuiaOcr } from '@/lib/guiaOcr';

// Trechos do que o Tesseract leu de guias reais "Imprimir como PDF" (sem texto), com os erros dele
const DAS = `Documento de Arrecadação
do Simples Nacional
Período de Apuração Data de Vencimento Número do Documento Pagar este documento até
Maio/2026 22/06/2026 07.20.26191.5810773-6
- 10/07/2026
Valor Total do Documento
2.070,49
Totais 1.936,12 115,01 19,36 2.070,49
85880000020 2 70490328261 2 91072026191 5 58107736936 8 AUTENTICAÇÃO MECÂNICA
Documento de Arrecadação do Simples Nacional Pague com o PIX
85880000020 2 7TO490328261 2 91072026191 5 58107736936 8 CNPJ: 60.871.619/0001-01
Pagar até: 10/07/2026 SERSAEO
Valor: 207049 [MAE`;

// INSS: 1º bloco com "O" no DV e a 2ª cópia com dígito trocado; o cabeçalho junta as datas (01/05 = período)
const DARF = `Documento de Arrecadação
de Receitas Federais
Período de Apuração Data de Vencimento Número do Documento Pagar este documento até
01/05/2026 19/06/2026 07.16.26191.5811848-0
= 10/07/2026
Valor Total do Documento
471,54
PA 05/2026 Vencimento 19/06/2026
85840000004 3 71540385261 O 91071626191 4 58118480451 3 AUTENTICAÇÃO MECÂNICA
85840000004 3 71540385261 O 91071626197 4 58118480451 3 CNPJ: 60.871.619/0001-01
Pagar até: 10/07/2026`;

const FGTS = `Digital |
Pagar este documento até
CPF/CNPJ do Empregador Nome/Razão Social do Empregador 10/07/2026
60.871.619 || EP PAR MALL LTDA
05/2026 1 170,08 0,00 0,00 18,06 188,14
Total da Guia: 188,14
Data de geração da Guia: 10/07/2026 às 09:10:35 - Página 1/1
00020101021226900014br.gov.bcb.pix2568pix-grcode.caixa.gov.br/api/v2/cobv/79bc2cclc89a45069013239b23e8dad5`;
const PIX_QR = '00020101021226900014br.gov.bcb.pix2568pix-qrcode.caixa.gov.br/api/v2/cobv/79bc2cc1c89a45069013239b23e8dad55204000053039865802BR5923CAIXA ECONOMICA FEDERAL6008Brasilia62070503***6304D53B';

describe('guiaOcr', () => {
  it('CRC do Pix: aceita o do QR, recusa com 1 caractere trocado', () => {
    expect(crc16Pix(PIX_QR.slice(0, -4))).toBe('D53B');
    expect(pixValido(PIX_QR)).toBe(PIX_QR);
    expect(pixValido(PIX_QR.replace('qrcode', 'grcode'))).toBeNull();
  });

  it('linha digitável: conserta "O" → 0 e ignora a cópia com dígito trocado (DV não fecha)', () => {
    expect(linhaDaGuiaOcr(DARF)).toBe('858400000043715403852610910716261914581184804513');
    expect(linhaDaGuiaOcr('85840000004 3 71540385261 0 91071626197 4 58118480451 3')).toBeNull();
  });

  it('linha com o DV colado no bloco ("910720261915") e letra no meio da outra cópia', () => {
    const lidoNoNavegador = `85880000020 2 70490328261 2 910720261915 58107736936 8 AUTENTICAÇÃO MECÂNICA
85880000020 2 7T0490328261 2 91072026191 5 58107736936 8 CNPJ: 60.871.619/0001-01 Eis Eles o`;
    expect(linhaDaGuiaOcr(lidoNoNavegador)).toBe('858800000202704903282612910720261915581077369368');
  });

  it('DAS: valor do código de barras, vencimento do canhoto (não o 22/06 original)', () => {
    const r = resumirGuiaOcr(DAS, null);
    expect(r).toMatchObject({ tipo: 'DAS', valor: '2.070,49', vencimento: '10/07/2026', numero: '07.20.26191.5810773-6', cnpj: '60.871.619/0001-01', competencia: '05/2026' });
    expect(r.linha).toBe('858800000202704903282612910720261915581077369368');
  });

  it('DARF INSS: vencimento 10/07 (não o período 01/05 do cabeçalho) e competência do PA', () => {
    expect(resumirGuiaOcr(DARF, null)).toMatchObject({ tipo: 'DARF', valor: '471,54', vencimento: '10/07/2026', competencia: '05/2026' });
  });

  it('FGTS: Pix só do QR (o do OCR vem errado), raiz do CNPJ, total da guia', () => {
    const r = resumirGuiaOcr(FGTS, PIX_QR);
    expect(r).toMatchObject({ tipo: 'FGTS', valor: '188,14', vencimento: '10/07/2026', cnpj: '60.871.619', competencia: '05/2026', pix: PIX_QR, linha: null });
    expect(resumirGuiaOcr(FGTS, null).pix).toBeNull();
  });

  it('texto para o servidor começa pelo resumo no formato do lerGuia', () => {
    const { texto } = textoGuiaOcr(DARF, null);
    expect(texto.split('\n').slice(0, 7)).toEqual([
      'Documento de Arrecadação de Receitas Federais',
      'CNPJ: 60.871.619/0001-01',
      'PA: 05/2026',
      'Número do Documento: 07.16.26191.5811848-0',
      'Pagar este documento até: 10/07/2026',
      'Valor Total do Documento: 471,54',
      'Linha digitável: 85840000004 3 71540385261 0 91071626191 4 58118480451 3',
    ]);
  });
});
