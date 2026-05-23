/**
 * Parser de extratos bancários — suporte a OFX e CSV (multi-banco BR)
 *
 * Bancos suportados no CSV:
 *  - Banco do Brasil (Data;Histórico;Documento;Crédito;Débito;Saldo)
 *  - Itaú (Data;Valor;Identificador;Descrição)
 *  - Bradesco (Data;Histórico;Valor)
 *  - Nubank (date,title,amount)
 *  - Genérico (Data;Descrição;Valor ou Data;Descrição;Débito;Crédito)
 */

export interface OFXTransaction {
  id: string;
  date: string;         // YYYY-MM-DD
  amount: number;       // sempre positivo
  description: string;
  type: 'credit' | 'debit';
  checkNumber?: string;
  rawAmount?: number;   // valor original com sinal
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([^<\n\r]+)`, 'i'));
  return m?.[1]?.trim() ?? '';
}

function ofxDateToISO(raw: string): string {
  // Formatos: 20250315, 20250315120000, com offset de fuso horario no final
  const digits = raw.replace(/[^0-9]/g, '').substring(0, 8);
  if (digits.length < 8) return '';
  return `${digits.substring(0, 4)}-${digits.substring(4, 6)}-${digits.substring(6, 8)}`;
}

function parseBRNumber(str: string): number {
  if (!str) return 0;
  const cleaned = str.trim().replace(/\s/g, '');
  // Formato BR: 1.234,56 → 1234.56
  if (cleaned.includes(',') && cleaned.includes('.')) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  // Só vírgula: 1234,56 → 1234.56
  if (cleaned.includes(',')) {
    return parseFloat(cleaned.replace(',', '.')) || 0;
  }
  return parseFloat(cleaned) || 0;
}

function parseBRDate(str: string): string {
  if (!str) return '';
  const s = str.trim();
  // dd/mm/yyyy ou dd/mm/yy
  if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // yyyy-mm-dd (já no formato correto)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd-mm-yyyy
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [d, m, y] = s.split('-');
    return `${y}-${m}-${d}`;
  }
  return s;
}

function parseCSVLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

function detectSeparator(header: string): string {
  const semicolons = (header.match(/;/g) || []).length;
  const commas = (header.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

function generateId(date: string, amount: number, desc: string, idx: number): string {
  return `csv_${date}_${Math.abs(amount).toFixed(2)}_${idx}_${desc.substring(0, 8).replace(/\s/g, '')}`;
}

// ── OFX Parser ────────────────────────────────────────────────────────────────

export function parseOFX(content: string): OFXTransaction[] {
  const transactions: OFXTransaction[] = [];

  // Suporte a OFX SGML (sem fechamento de tags) e OFX XML
  const txRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;

  while ((match = txRegex.exec(content)) !== null) {
    const block = match[1];

    const amountStr = getTag(block, 'TRNAMT');
    const rawAmount = parseFloat(amountStr.replace(',', '.'));
    if (isNaN(rawAmount)) continue;

    const dateRaw = getTag(block, 'DTPOSTED') || getTag(block, 'DTUSER');
    const date = ofxDateToISO(dateRaw);
    if (!date) continue;

    const description = getTag(block, 'MEMO') || getTag(block, 'NAME') || 'Sem descrição';
    const fitid = getTag(block, 'FITID') || `ofx_${date}_${rawAmount}_${Math.random().toString(36).slice(2, 7)}`;
    const checkNum = getTag(block, 'CHECKNUM');

    transactions.push({
      id: fitid,
      date,
      amount: Math.abs(rawAmount),
      description,
      type: rawAmount >= 0 ? 'credit' : 'debit',
      rawAmount,
      checkNumber: checkNum || undefined,
    });
  }

  // Fallback: OFX SGML sem tags de fechamento (alguns bancos BR)
  if (transactions.length === 0) {
    const blocks = content.split(/<STMTTRN>/i).slice(1);
    for (const block of blocks) {
      const amountStr = getTag(block, 'TRNAMT');
      const rawAmount = parseFloat(amountStr.replace(',', '.'));
      if (isNaN(rawAmount)) continue;

      const dateRaw = getTag(block, 'DTPOSTED') || getTag(block, 'DTUSER');
      const date = ofxDateToISO(dateRaw);
      if (!date) continue;

      const description = getTag(block, 'MEMO') || getTag(block, 'NAME') || 'Sem descrição';
      const fitid = getTag(block, 'FITID') || `ofx_${date}_${rawAmount}_${Math.random().toString(36).slice(2, 7)}`;
      const checkNum = getTag(block, 'CHECKNUM');

      transactions.push({
        id: fitid,
        date,
        amount: Math.abs(rawAmount),
        description,
        type: rawAmount >= 0 ? 'credit' : 'debit',
        rawAmount,
        checkNumber: checkNum || undefined,
      });
    }
  }

  return transactions;
}

// ── CSV Parser (multi-banco BR) ───────────────────────────────────────────────

type BankFormat =
  | 'bb'        // Banco do Brasil: Data;Histórico;Documento;Crédito;Débito;Saldo
  | 'itau'      // Itaú: Data;Valor;Identificador;Descrição
  | 'bradesco'  // Bradesco: Data;Histórico;Valor
  | 'nubank'    // Nubank: date,title,amount
  | 'inter'     // Banco Inter: Data;Descrição;Valor
  | 'sicoob'    // Sicoob: Data;Histórico;Valor Crédito;Valor Débito
  | 'generic';  // Genérico: Data;Descrição;Valor ou Data;Descrição;Débito;Crédito

function detectBankFormat(header: string, sep: string): BankFormat {
  const h = header.toLowerCase();
  const cols = parseCSVLine(header, sep).map(c => c.toLowerCase().trim());

  if (cols.some(c => c.includes('histórico') || c.includes('historico')) && cols.some(c => c.includes('documento'))) return 'bb';
  if (cols.some(c => c.includes('identificador'))) return 'itau';
  if (h.includes('nubank') || (cols[0] === 'date' && cols[1] === 'title')) return 'nubank';
  if (cols.some(c => c.includes('sicoob'))) return 'sicoob';
  if (cols.length >= 4 && cols.some(c => c.includes('crédito') || c.includes('credito'))) return 'bb';
  return 'generic';
}

export function parseCSV(content: string): OFXTransaction[] {
  // Remover BOM e normalizar quebras de linha
  const cleaned = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const allLines = cleaned.split('\n');

  // Encontrar a primeira linha que parece ser cabeçalho (tem pelo menos 2 colunas com texto)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, allLines.length); i++) {
    const line = allLines[i].trim();
    if (!line) continue;
    const sep = detectSeparator(line);
    const cols = parseCSVLine(line, sep);
    if (cols.length >= 2 && cols.some(c => /[a-zA-ZÀ-ú]{3,}/.test(c))) {
      headerIdx = i;
      break;
    }
  }

  const lines = allLines.slice(headerIdx).filter(l => l.trim());
  if (lines.length < 2) return [];

  const sep = detectSeparator(lines[0]);
  const format = detectBankFormat(lines[0], sep);
  const dataLines = lines.slice(1);
  const transactions: OFXTransaction[] = [];

  for (let idx = 0; idx < dataLines.length; idx++) {
    const line = dataLines[idx].trim();
    if (!line) continue;

    const cols = parseCSVLine(line, sep);
    if (cols.length < 2) continue;

    try {
      let date = '';
      let description = '';
      let amount = 0;
      let type: 'credit' | 'debit' = 'credit';

      switch (format) {
        case 'bb': {
          // Data;Histórico;Documento;Crédito;Débito;Saldo
          date = parseBRDate(cols[0]);
          description = cols[1] || '';
          const credito = parseBRNumber(cols[3] || '0');
          const debito = parseBRNumber(cols[4] || '0');
          if (credito > 0) { amount = credito; type = 'credit'; }
          else if (debito > 0) { amount = debito; type = 'debit'; }
          else continue;
          break;
        }
        case 'itau': {
          // Data;Valor;Identificador;Descrição
          date = parseBRDate(cols[0]);
          const rawVal = parseBRNumber(cols[1]);
          amount = Math.abs(rawVal);
          type = rawVal >= 0 ? 'credit' : 'debit';
          description = cols[3] || cols[2] || '';
          break;
        }
        case 'nubank': {
          // date,title,amount
          date = parseBRDate(cols[0]);
          description = cols[1] || '';
          const rawVal = parseBRNumber(cols[2]);
          // Nubank: positivo = débito (gasto), negativo = crédito (estorno/pagamento)
          amount = Math.abs(rawVal);
          type = rawVal > 0 ? 'debit' : 'credit';
          break;
        }
        case 'sicoob': {
          // Data;Histórico;Valor Crédito;Valor Débito
          date = parseBRDate(cols[0]);
          description = cols[1] || '';
          const credito = parseBRNumber(cols[2] || '0');
          const debito = parseBRNumber(cols[3] || '0');
          if (credito > 0) { amount = credito; type = 'credit'; }
          else if (debito > 0) { amount = debito; type = 'debit'; }
          else continue;
          break;
        }
        case 'bradesco':
        case 'inter':
        case 'generic':
        default: {
          date = parseBRDate(cols[0]);
          description = cols[1] || '';

          if (cols.length >= 4) {
            // Formato: Data;Desc;Débito;Crédito
            const debito = parseBRNumber(cols[2] || '0');
            const credito = parseBRNumber(cols[3] || '0');
            if (credito > 0) { amount = credito; type = 'credit'; }
            else if (debito > 0) { amount = debito; type = 'debit'; }
            else continue;
          } else {
            // Formato: Data;Desc;Valor (positivo=crédito, negativo=débito)
            const rawVal = parseBRNumber(cols[2] || '0');
            amount = Math.abs(rawVal);
            type = rawVal >= 0 ? 'credit' : 'debit';
          }
          break;
        }
      }

      if (!date || amount === 0) continue;

      transactions.push({
        id: generateId(date, amount, description, idx),
        date,
        amount,
        description: description.trim(),
        type,
        rawAmount: type === 'debit' ? -amount : amount,
      });
    } catch {
      // Linha inválida — ignorar
    }
  }

  return transactions;
}

// ── Auto-match helpers ────────────────────────────────────────────────────────

export interface MatchCandidate {
  id: string;
  date: string;
  amount: number;
  description: string;
  source: 'bank_transaction' | 'cash_flow' | 'payment';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Tenta encontrar correspondências para uma transação importada.
 * Retorna candidatos ordenados por confiança.
 */
export function findMatches(
  tx: OFXTransaction,
  bankTransactions: Array<{ id: string; transaction_date: string; amount: number; description: string; type: string }>,
  cashFlows: Array<{ id: string; date: string; amount: number; description: string; type: string }>,
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  const TOLERANCE = 0.02; // R$ 0,02 de tolerância

  // Match em fin_bank_transactions
  for (const bt of bankTransactions) {
    const sameType = (tx.type === 'credit' && bt.type === 'credit') || (tx.type === 'debit' && bt.type === 'debit');
    const sameAmount = Math.abs(bt.amount - tx.amount) <= TOLERANCE;
    const sameDate = bt.transaction_date === tx.date;
    const nearDate = Math.abs(new Date(bt.transaction_date).getTime() - new Date(tx.date).getTime()) <= 3 * 86400000;

    if (sameType && sameAmount && sameDate) {
      candidates.push({ id: bt.id, date: bt.transaction_date, amount: bt.amount, description: bt.description, source: 'bank_transaction', confidence: 'high' });
    } else if (sameType && sameAmount && nearDate) {
      candidates.push({ id: bt.id, date: bt.transaction_date, amount: bt.amount, description: bt.description, source: 'bank_transaction', confidence: 'medium' });
    }
  }

  // Match em fin_cash_flow
  for (const cf of cashFlows) {
    const cfType = cf.type === 'income' ? 'credit' : 'debit';
    const sameType = cfType === tx.type;
    const sameAmount = Math.abs(cf.amount - tx.amount) <= TOLERANCE;
    const sameDate = cf.date === tx.date;
    const nearDate = Math.abs(new Date(cf.date).getTime() - new Date(tx.date).getTime()) <= 3 * 86400000;

    if (sameType && sameAmount && sameDate) {
      candidates.push({ id: cf.id, date: cf.date, amount: cf.amount, description: cf.description, source: 'cash_flow', confidence: 'high' });
    } else if (sameType && sameAmount && nearDate) {
      candidates.push({ id: cf.id, date: cf.date, amount: cf.amount, description: cf.description, source: 'cash_flow', confidence: 'medium' });
    }
  }

  // Ordenar: high > medium > low
  const order = { high: 0, medium: 1, low: 2 };
  return candidates.sort((a, b) => order[a.confidence] - order[b.confidence]).slice(0, 5);
}
