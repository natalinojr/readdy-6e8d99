// NFC-e de pedido do iFood: presença, intermediador e destinatário — lógica pura, sem banco nem rede.
// Usado pela fiscal-write; testado em src/test/edge/ifoodValores.test.ts.
//
// Decisão da contadora (05/10/2026): venda pelo iFood sai como NÃO PRESENCIAL, com o iFood como intermediador.
// Regras da SEFAZ que limitam isso na NFC-e (modelo 65):
// - indPres só pode ser 1 (presencial), 4 (entrega a domicílio) ou 5 — outro valor = rejeição 717. "Não presencial"
//   na NFC-e é o 4. Retirada/consumo no local: o cliente pega na loja → 1.
// - indPres 4 exige o destinatário com endereço (rejeições 787/788; Ajuste SINIEF 09/2026, desde 03/08/2026, endereço
//   em toda operação não presencial). O iFood esconde o CPF; ele só vem quando o cliente pede CPF na nota.
// - indPres 2/3/4/9 exige indIntermed (rejeição 434). Intermediador = CNPJ do iFood + id da loja no iFood
//   (idCadIntTran = "identificação do vendedor no site do intermediador"; usamos o merchant id).

export const CNPJ_IFOOD = '14380200000121'; // iFood.com Agência de Restaurantes Online S.A. (vem como adquirente no Pix)

export interface EnderecoNota {
  Cep: string; Logradouro: string; Numero: string; Complemento?: string; Bairro: string;
  Municipio: string; CodMunicipio: number; Uf: string; CodPais: number;
}

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const txt = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export interface NotaIfood {
  indicadorPresenca: 1 | 4;
  /** Só com indPres 4 (o Brasil NFe recusa intermediador com indPres 1). */
  intermediador: { Cnpj: string; IdCadIntTran: string } | null;
  /** Destinatário com endereço (só na entrega com CPF). null = segue o CPF na nota, se houver, como nos outros canais. */
  cliente: { CpfCnpj: string; NmCliente: string; IndicadorIe: 9; Endereco: EnderecoNota } | null;
  /** Por que saiu presencial em vez de entrega (para o log). */
  motivoPresencial: string | null;
}

/**
 * `o` = linha de ifood_orders (order_type, merchant_id, address, customer_name).
 * `codMunicipio` = código IBGE do município do endereço (resolvido fora, pela rede); `cpf` = CPF/CNPJ já validado.
 *
 * Teste em homologação na SEFAZ-PR (05/10/2026, conta Brasil NFe da Paranaguá):
 * - entrega + CPF + endereço + intermediador → AUTORIZADA (indPres 4, infIntermed, dest/enderDest);
 * - entrega SEM CPF → rejeição 787: o Brasil NFe não manda o grupo dest sem documento;
 * - retirada (indPres 1) + intermediador → o Brasil NFe recusa ("só com indicador de presença 2, 3, 4 ou 9").
 * Por isso: entrega como não presencial só quando há CPF e endereço completo; senão presencial, sem intermediador
 * (como o delivery da loja), para a nota não travar.
 */
export function dadosNotaIfood(o: any, codMunicipio: number | null, cpf: string | null): NotaIfood {
  const presencial = (motivo: string | null): NotaIfood => ({ indicadorPresenca: 1, intermediador: null, cliente: null, motivoPresencial: motivo });
  if (String(o?.order_type ?? 'DELIVERY') !== 'DELIVERY') return presencial(null);
  if (!cpf) return presencial('entrega sem CPF do cliente (o iFood esconde o CPF; a nota de entrega exige o destinatário)');
  const a = o?.address ?? {};
  const cep = so(a.postalCode);
  const uf = txt(a.state, 2).toUpperCase();
  const faltando = [
    !txt(a.streetName, 60) && 'rua',
    !txt(a.neighborhood, 60) && 'bairro',
    !txt(a.city, 60) && 'cidade',
    uf.length !== 2 && 'UF',
    !codMunicipio && 'código do município',
  ].filter(Boolean);
  if (faltando.length) return presencial(`endereço de entrega sem ${faltando.join(', ')}`);
  return {
    indicadorPresenca: 4,
    intermediador: { Cnpj: CNPJ_IFOOD, IdCadIntTran: txt(o?.merchant_id, 60) },
    cliente: {
      CpfCnpj: cpf,
      NmCliente: txt(o?.customer_name, 60) || 'Cliente iFood',
      IndicadorIe: 9,
      Endereco: {
        Cep: cep.length === 8 ? cep : '',
        Logradouro: txt(a.streetName, 60),
        Numero: txt(a.streetNumber, 60) || 'S/N',
        ...(txt(a.complement, 60) ? { Complemento: txt(a.complement, 60) } : {}),
        Bairro: txt(a.neighborhood, 60),
        Municipio: txt(a.city, 60),
        CodMunicipio: codMunicipio as number,
        Uf: uf,
        CodPais: 1058,
      },
    },
    motivoPresencial: null,
  };
}
