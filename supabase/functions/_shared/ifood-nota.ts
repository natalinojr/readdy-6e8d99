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
  /** iFood como intermediador — sempre (contadora 05/10; Brasil NFe aceita com indPres 1, 2, 3, 4 ou 9 desde 06/10). */
  intermediador: { Cnpj: string; IdCadIntTran: string };
  /** Destinatário com endereço (entrega). Sem CPF o Brasil NFe monta <dest> com <idEstrangeiro/> vazio. */
  cliente: { CpfCnpj?: string; NmCliente: string; IndicadorIe: 9; Endereco: EnderecoNota } | null;
  /** Por que a entrega saiu presencial (para o log). */
  motivoPresencial: string | null;
}

/**
 * `o` = linha de ifood_orders (order_type, merchant_id, address, customer_name).
 * `codMunicipio` = código IBGE do município do endereço (resolvido fora, pela rede); `cpf` = CPF/CNPJ já validado.
 *
 * Homologação SEFAZ-PR 05/10/2026 (conta Brasil NFe da Paranaguá): entrega + CPF + endereço + intermediador →
 * AUTORIZADA. Sem CPF → 787 e intermediador com indPres 1 → recusado pelo Brasil NFe. O Brasil NFe liberou os dois
 * (resposta do suporte em 05/10, no ar 06/10): <dest> com <idEstrangeiro/> vazio + nome + endereço quando
 * IndicadorPresenca = 4 sem CpfCnpj, e Intermediador com indPres 1. Atenção (Brasil NFe): idEstrangeiro vazio no
 * leiaute identifica comprador estrangeiro sem documento — validar com a contadora.
 * Regra: entrega com endereço completo → indPres 4 + intermediador + destinatário (com CPF se o cliente pediu);
 * retirada/consumo no local ou endereço incompleto → presencial + intermediador.
 */
export function dadosNotaIfood(o: any, codMunicipio: number | null, cpf: string | null): NotaIfood {
  const intermediador = { Cnpj: CNPJ_IFOOD, IdCadIntTran: txt(o?.merchant_id, 60) };
  const presencial = (motivo: string | null): NotaIfood => ({ indicadorPresenca: 1, intermediador, cliente: null, motivoPresencial: motivo });
  if (String(o?.order_type ?? 'DELIVERY') !== 'DELIVERY') return presencial(null);
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
    intermediador,
    cliente: {
      ...(cpf ? { CpfCnpj: cpf } : {}),
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
