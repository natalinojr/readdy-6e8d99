// CPF/CNPJ do consumidor na nota fiscal (NFC-e). Um único lugar para validar e
// formatar — usado no caixa, no delivery, no QR das mesas e na emissão manual.

export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/** Valida CPF (11 dígitos) ou CNPJ (14) pelo dígito verificador. */
export function isValidCpfCnpj(valor: string): boolean {
  const d = soDigitos(valor);
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const calc = (len: number) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const calc = (len: number) => {
      const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let s = 0;
      for (let i = 0; i < len; i++) s += Number(d[i]) * w[i];
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}

/** Máscara progressiva: vira CPF até 11 dígitos, CNPJ a partir do 12º. */
export function mascaraCpfCnpj(valor: string): string {
  const d = soDigitos(valor).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

/** 'CPF' | 'CNPJ' | null (enquanto o cliente ainda está digitando). */
export function tipoDoc(valor: string): 'CPF' | 'CNPJ' | null {
  const d = soDigitos(valor);
  if (d.length === 11) return 'CPF';
  if (d.length === 14) return 'CNPJ';
  return null;
}

/** Mensagem de erro para exibir abaixo do campo, ou null quando está ok/vazio. */
export function erroCpfCnpj(valor: string): string | null {
  const d = soDigitos(valor);
  if (d.length === 0) return null;
  if (d.length < 11) return 'Faltam dígitos';
  if (d.length > 11 && d.length < 14) return 'Faltam dígitos para CNPJ';
  return isValidCpfCnpj(d) ? null : `${d.length === 14 ? 'CNPJ' : 'CPF'} inválido, confira os dígitos`;
}
