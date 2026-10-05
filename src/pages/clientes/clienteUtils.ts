// Utilitários comuns do CRM (abas Clientes e Funil, perfil do cliente):
// planilha CSV segura e link de WhatsApp com o mesmo critério em toda a tela.
import type { ClienteCRM } from '@/hooks/useClientes';

/** Uma célula de CSV. Põe aspas quando o texto tem separador, aspas ou quebra de
 *  linha (nome "Silva, Maria" deslocava as colunas do Público do Meta) e, com
 *  `formula`, impede que o Excel/Sheets execute texto começando com = + - @
 *  (o nome vem de formulário público). Telefone "+55…" passa `formula: false`. */
export function csvCelula(valor: unknown, sep: string, formula = true): string {
  let s = valor == null ? '' : String(valor);
  if (formula && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(sep) || s.includes('"') || /[\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Monta o CSV inteiro. `semFormula` lista as colunas (índice) que não recebem a trava de fórmula. */
export function montarCsv(linhas: unknown[][], sep: string, semFormula: number[] = []): string {
  return linhas.map((l) => l.map((v, i) => csvCelula(v, sep, !semFormula.includes(i))).join(sep)).join('\n');
}

/** Baixa o CSV com BOM (acentos certos no Excel). */
export function baixarCsv(csv: string, nome: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** Celular só com dígitos e com o 55 do Brasil (quem já veio com 55 não ganha outro).
 *  Devolve null quando não dá para mandar mensagem (menos de 10 dígitos). */
export function celularComDDI(celular: string | null | undefined): string | null {
  const d = (celular ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.length <= 11 ? `55${d}` : d;
}

/** Abre a conversa no WhatsApp com o texto pronto. false = sem celular válido. */
export function abrirWhatsApp(celular: string | null | undefined, texto: string): boolean {
  const numero = celularComDDI(celular);
  if (!numero) return false;
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer');
  return true;
}

/** Texto do aviso quando o cliente pediu para não receber mensagens (opt-out do CRM). */
export const AVISO_OPT_OUT = 'Pediu para não receber mensagens';

export function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

/** "hoje", "há 1 dia", "há 5 dias". */
export function haDias(dias: number): string {
  if (dias <= 0) return 'hoje';
  return `há ${dias} dia${dias === 1 ? '' : 's'}`;
}

// Aniversário lido direto da string 'YYYY-MM-DD' (new Date('YYYY-MM-DD') é UTC e pode "pular" o dia).
export function aniversarioEsteMes(c: ClienteCRM): boolean {
  if (!c.dataNascimento) return false;
  const mesNasc = Number(c.dataNascimento.slice(5, 7));
  return !!mesNasc && mesNasc === new Date().getMonth() + 1;
}

/** Dias até o próximo aniversário (0 = hoje); sem data vai para o fim da fila. */
export function diasAteAniversario(c: ClienteCRM): number {
  if (!c.dataNascimento) return 999;
  const mes = Number(c.dataNascimento.slice(5, 7));
  const dia = Number(c.dataNascimento.slice(8, 10));
  if (!mes || !dia) return 999;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  let prox = new Date(hoje.getFullYear(), mes - 1, dia);
  if (prox < hoje) prox = new Date(hoje.getFullYear() + 1, mes - 1, dia);
  return Math.round((prox.getTime() - hoje.getTime()) / 86400000);
}

/** Cliente comprador que sumiu há mais de 30 dias. Quem nunca comprou NÃO é inativo. */
export function isInativo(c: ClienteCRM): boolean {
  return c.totalVisitas > 0 && diasDesde(c.ultimaVisita) > 30;
}

/** Mensagem de WhatsApp contextual — o texto muda conforme a relação do cliente com a loja. */
export function mensagemWhatsApp(c: ClienteCRM): string {
  const nome = c.nome.split(' ')[0];
  // Parabéns só perto da data (até 7 dias antes ou depois), não no mês inteiro.
  const ate = diasAteAniversario(c);
  if (ate <= 7 || (ate >= 358 && ate < 999)) {
    return `Olá, ${nome}! \u{1F382} Passando para desejar um feliz aniversário! Queremos comemorar com você — venha nos visitar. \u{1F973}`;
  }
  if (c.totalVisitas === 0) {
    return `Olá, ${nome}! Que bom ter você na nossa lista. \u{1F60A} Ainda não teve a chance de experimentar nossos pratos? Venha nos conhecer, vamos adorar te receber!`;
  }
  if (isInativo(c)) {
    return `Olá, ${nome}! Sentimos sua falta por aqui. \u{1F49B} Já faz um tempinho desde sua última visita — preparamos novidades que você vai gostar. Que tal passar para conferir?`;
  }
  const daCasa = c.estagio ? ['recorrente', 'fiel', 'vip'].includes(c.estagio) : (c.tags.includes('vip') || c.tags.includes('frequente'));
  if (daCasa) {
    return `Olá, ${nome}! Obrigado por ser um cliente tão especial. \u{1F64C} Temos novidades no cardápio que combinam com o seu gosto — venha experimentar!`;
  }
  return `Olá, ${nome}! Tudo bem? Passando para lembrar que estamos com novidades por aqui. Venha nos visitar e aproveitar! \u{1F60A}`;
}

/** Estágios do Funil, na ordem da tela do Funil (atenção primeiro, depois a jornada).
 *  A aba Clientes filtra por eles: uma regra só para "quem é VIP", "quem está sumindo"… */
export const ESTAGIOS_FUNIL: { id: string; label: string; chip: string; ponto: string }[] = [
  { id: 'carrinho_abandonado', label: 'Carrinho abandonado', chip: 'bg-orange-50 text-orange-700 border-orange-200', ponto: 'bg-orange-500' },
  { id: 'nunca_comprou', label: 'Cadastrou, nunca pediu', chip: 'bg-zinc-50 text-zinc-600 border-zinc-200', ponto: 'bg-zinc-400' },
  { id: 'primeira_compra', label: 'Comprou 1 vez', chip: 'bg-sky-50 text-sky-700 border-sky-200', ponto: 'bg-sky-500' },
  { id: 'recorrente', label: 'Recorrente', chip: 'bg-green-50 text-green-700 border-green-200', ponto: 'bg-green-500' },
  { id: 'fiel', label: 'Fiel', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', ponto: 'bg-emerald-500' },
  { id: 'vip', label: 'VIP', chip: 'bg-amber-50 text-amber-700 border-amber-200', ponto: 'bg-amber-500' },
  { id: 'em_risco', label: 'Em risco', chip: 'bg-yellow-50 text-yellow-800 border-yellow-200', ponto: 'bg-yellow-500' },
  { id: 'perdido', label: 'Perdido', chip: 'bg-red-50 text-red-700 border-red-200', ponto: 'bg-red-500' },
];

export function estagioFunil(id: string | null | undefined) {
  return ESTAGIOS_FUNIL.find((e) => e.id === id) ?? null;
}
