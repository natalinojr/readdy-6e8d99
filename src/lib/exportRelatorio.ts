import { getPeriodDates } from '@/lib/dateUtils';
import { montarCsv, type CelulaCsv } from '@/lib/consumoInsumos';

/** O que cada aba dos Relatórios entrega para o botão "Baixar" do topo. */
export interface ExportRelatorio {
  /** Início do nome do arquivo, sem acento nem espaço (ex.: "ranking-produtos"). */
  base: string;
  cabecalho: string[];
  linhas: CelulaCsv[][];
  /** Período realmente usado pela aba (quando ela troca o do topo). Padrão: o do topo. */
  periodo?: string;
}

/** Função que a aba registra; devolve null quando não há nada para baixar. */
export type ExportadorRelatorio = () => ExportRelatorio | null;

/** Dinheiro com 2 casas, para a planilha não mostrar 12,3400000001. */
export const reais = (v: number | null | undefined): number => Math.round((Number(v) || 0) * 100) / 100;

/** "2026-09-01_a_2026-09-30" (ou só o dia, quando início = fim). Datas em Brasília. */
export function periodoParaNomeArquivo(periodo: string): string {
  const { from, to } = getPeriodDates(periodo);
  const de = from.slice(0, 10);
  const ate = to.slice(0, 10);
  return de === ate ? de : `${de}_a_${ate}`;
}

export function nomeArquivoRelatorio(base: string, periodo: string): string {
  return `${base}_${periodoParaNomeArquivo(periodo)}.csv`;
}

/** CSV para o Excel brasileiro: `;`, vírgula decimal e BOM UTF-8 (acento certo). */
export function conteudoCsvRelatorio(r: Pick<ExportRelatorio, 'cabecalho' | 'linhas'>): string {
  return '\uFEFF' + montarCsv(r.cabecalho, r.linhas);
}

export function baixarCsvRelatorio(r: ExportRelatorio, periodoDoTopo: string): void {
  const blob = new Blob([conteudoCsvRelatorio(r)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivoRelatorio(r.base, r.periodo ?? periodoDoTopo);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
