// Pix copia e cola (BR Code) lido na tela, só para mostrar e conferir antes de enviar.
// Quem vale é a Edge (supabase/functions/_shared/guias.ts › acharCopiaECola/lerCopia) — mesma regra.
function crc16(s: string): string {
  let crc = 0xffff;
  for (const b of new TextEncoder().encode(s)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function valido(s: string): boolean {
  if (!s.startsWith('000201') || s.length < 30) return false;
  const i = s.length - 8;
  return s.slice(i, i + 4) === '6304' && crc16(s.slice(0, i + 4)) === s.slice(i + 4).toUpperCase();
}

function tlv(s: string): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i + 4 <= s.length;) {
    const id = s.slice(i, i + 2);
    const n = Number(s.slice(i + 2, i + 4));
    if (!Number.isFinite(n)) break;
    m.set(id, s.slice(i + 4, i + 4 + n));
    i += 4 + n;
  }
  return m;
}

export interface PixLido { codigo: string; nome: string | null; chave: string | null; valor: number | null; dinamico: boolean }

/** Acha o copia e cola dentro do texto colado (pode vir com espaço, quebra de linha ou texto junto). */
export function lerPixCopia(texto: string): PixLido | null {
  // Só quebras de linha: o nome de quem recebe tem espaço ("Mercado Livre Casa") e entra no CRC
  const t = String(texto ?? '').replace(/\r?\n/g, '');
  for (let ini = t.indexOf('000201'); ini >= 0; ini = t.indexOf('000201', ini + 1)) {
    for (let fim = t.indexOf('6304', ini); fim >= 0; fim = t.indexOf('6304', fim + 1)) {
      const c = t.slice(ini, fim + 8);
      if (!valido(c)) continue;
      const top = tlv(c);
      const conta = tlv(top.get('26') ?? '');
      const v = top.get('54');
      return { codigo: c, nome: top.get('59') ?? null, chave: conta.get('01') ?? null, valor: v ? Number(v) : null, dinamico: !!conta.get('25') };
    }
  }
  return null;
}
