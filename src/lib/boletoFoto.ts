// Regras puras da "foto do boleto" no cartão "Falta o boleto" (2026-10-05): que código usar e se o boleto
// bate com a conta. Separadas do componente (src/components/feature/assistente/BoletoPorFoto.tsx) para teste.

export const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const ddmm = (ymd: string | null) => (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : '—');

export interface Candidata { bill_id: string; fornecedor: string; saldo: number; vencimento: string; bate_valor: boolean | null; bate_vencimento: boolean | null }
export interface Lido { beneficiario: string | null; valor: number | null; vencimento: string | null; linha_digitavel: string | null; pix_copia_e_cola: string | null }
export type Codigo = { linha: string } | { copia_e_cola: string };

/** Linha do boleto (a lida pela Edge) → Pix copia e cola → QR lido no próprio aparelho. */
export function codigoDoBoleto(lido: Lido, pixQr: string | null): Codigo | null {
  if (lido.linha_digitavel) return { linha: lido.linha_digitavel };
  if (lido.pix_copia_e_cola) return { copia_e_cola: lido.pix_copia_e_cola };
  if (pixQr && pixQr.trim().startsWith('000201')) return { copia_e_cola: pixQr.trim() };
  return null;
}

/** Valor igual E vencimento igual (os dois lidos e conferidos: null = o boleto não diz = não confere). */
export const bateCerto = (c: Candidata) => c.bate_valor === true && c.bate_vencimento === true;

// Palavras que não identificam ninguém: sufixos de empresa e ligações ("Comércio de Bebidas Silva LTDA ME").
const GENERICAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'ltda', 'me', 'epp', 'eireli', 'mei', 'sa', 'cia', 'comercio', 'comercial', 'industria', 'distribuidora', 'servicos']);

/** Palavras que identificam o nome: minúsculas, sem acento nem pontuação, sem sufixo LTDA/ME/SA e ligações. */
export function palavrasDoNome(nome: string | null | undefined): string[] {
  const t = String(nome ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\bs\s*[./]\s*a\b/g, ' sa ').replace(/[^a-z0-9]+/g, ' ');
  return t.split(' ').filter((w) => w && !GENERICAS.has(w));
}

/** Mesmo fornecedor, mesmo escrito diferente ("AMBEV S.A." = "Ambev")? Sem nome em qualquer lado = não dá para dizer (null). */
export function mesmoNome(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const pa = palavrasDoNome(a); const pb = palavrasDoNome(b);
  if (!pa.length || !pb.length) return null;
  const sb = new Set(pb);
  return pa.some((w) => sb.has(w));
}

/** Todas as candidatas são de UM fornecedor só (nome normalizado)? */
export const umFornecedorSo = (cands: Candidata[]) => new Set(cands.map((c) => palavrasDoNome(c.fornecedor).join(' ') || c.fornecedor.trim().toLowerCase())).size <= 1;

/** O beneficiário lido no boleto contradiz o fornecedor da conta? (nome não lido = não contradiz) */
export const beneficiarioContradiz = (c: Candidata, lido: Lido) => mesmoNome(lido.beneficiario, c.fornecedor) === false;

/**
 * Só grava SOZINHO (sem perguntar) quando não resta dúvida de que é aquela conta: valor E vencimento batem (os dois
 * lidos), as contas do cartão são de um fornecedor só e o beneficiário lido não contradiz o fornecedor. Em qualquer
 * outro caso (Pix ou concessionária sem vencimento, várias contas, vários fornecedores, beneficiário outro) devolve
 * null e a tela mostra a conta escolhida pedindo confirmação.
 */
export function contaParaGravarSozinho(cands: Candidata[], lido: Lido): Candidata | null {
  const certas = cands.filter(bateCerto);
  if (certas.length !== 1) return null;
  if (!umFornecedorSo(cands)) return null;
  if (beneficiarioContradiz(certas[0], lido)) return null;
  return certas[0];
}

/** Avisos que pedem confirmação mas não são divergência de valor (não mandam confirmar_valor ao servidor). */
export function avisosDeConfirmacao(c: Candidata, lido: Lido): string[] {
  const a: string[] = [];
  if (beneficiarioContradiz(c, lido)) a.push(`O boleto é de ${lido.beneficiario} e a conta é de ${c.fornecedor}.`);
  if (c.bate_vencimento === null) a.push('O boleto não diz o vencimento: confira se é desta conta.');
  return a;
}

/** O que difere entre o boleto e a conta, em palavras (vazio = bate). */
export function diferencas(c: Candidata, lido: Lido): string[] {
  const d: string[] = [];
  if (c.bate_valor === false) d.push(`O boleto é de ${brl(Number(lido.valor))} e a conta é de ${brl(c.saldo)}.`);
  else if (c.bate_valor === null) d.push('Não consegui ler o valor do boleto para conferir.');
  if (c.bate_vencimento === false) d.push(`O boleto vence em ${ddmm(lido.vencimento)} e a conta vence em ${ddmm(c.vencimento)}.`);
  return d;
}
