// Em que pé está cada conta dos cartões da Hoje (2026-10-07). Lê só as contas dos cartões na tela
// (por bill_id do aviso; boleto por e-mail pela conta que ele virou ou pelo mesmo valor e vencimento;
// pedido do grupo pela conta do mesmo valor e fornecedor; "chegou a mercadoria?" pelas contas da compra).
// Também esconde na hora o cartão cuja conta JÁ FOI PAGA (o trigger do banco fecha a pendência; isto
// cobre o intervalo até a próxima leitura e qualquer aviso antigo).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  acharContaDoEmail, acharContaDoPedido, lerSituacoes, lerSituacoesDaCompra, type SituacaoConta,
} from '@/lib/situacaoConta';
import type { ItemHoje, PendHoje } from './organizar';

const billDe = (p: PendHoje) => (typeof p.payload?.bill_id === 'string' ? p.payload.bill_id : null);
/** Cartões que só existem por causa da conta: conta paga/cancelada = cartão sem razão de existir. */
const DA_CONTA = new Set(['boleto_faltando', 'fixa_chegou', 'pagamento_pendente', 'boleto_email']);
const fechada = (s: SituacaoConta) => s.paga || s.cancelada;

export interface SituacaoHoje {
  /** contas de cada cartão (chave do cartão) */
  porCartao: Map<string, SituacaoConta[]>;
  /** pedido do grupo que parece já pago (achado por valor + fornecedor, não pelo id) */
  provavel: Map<string, SituacaoConta>;
  /** pedido do grupo cuja conta (achada pelo CNPJ escrito no pedido) já foi paga: o cartão sai */
  grupoPago: Set<string>;
}

/** Tira o que já foi pago: cartão inteiro (conta da pendência paga) ou contas juntadas dentro dele. */
export function semOJaPago(itens: ItemHoje[], porCartao: Map<string, SituacaoConta[]>, grupoPago: Set<string> = new Set()): ItemHoje[] {
  const out: ItemHoje[] = [];
  for (const i of itens) {
    if (grupoPago.has(i.chave)) continue;
    const sits = porCartao.get(i.chave);
    if (!sits?.length) { out.push(i); continue; }
    const porId = new Map(sits.map((s) => [s.id, s]));
    if (i.tipo === 'pendencia' && DA_CONTA.has(i.principal.kind)) {
      // Pix ainda no Inter: a pendência lembra de recusar (senão paga duas vezes) — fica.
      if (sits.every(fechada) && !sits.some((s) => s.noInter)) continue;
      out.push(i); continue;
    }
    if (i.juntas.length) {
      const juntas = i.juntas.filter((j) => { const b = billDe(j); const s = b ? porId.get(b) : null; return !s || !fechada(s); });
      if (i.tipo === 'boletos_fornecedor' && !juntas.length) continue;
      if (juntas.length !== i.juntas.length) {
        const valor = i.tipo === 'boletos_fornecedor' ? Math.round(juntas.reduce((t, j) => t + Number(j.payload?.valor ?? 0), 0) * 100) / 100 : i.valor;
        out.push({ ...i, juntas, valor, titulo: i.tipo === 'boletos_fornecedor' && juntas.length === 1 ? `${i.fornecedor}: 1 conta sem boleto` : i.tipo === 'boletos_fornecedor' ? `${i.fornecedor}: ${juntas.length} contas sem boleto` : i.titulo });
        continue;
      }
    }
    out.push(i);
  }
  return out;
}

export function useSituacaoHoje(itens: ItemHoje[] | null, hoje: string, ligado: boolean): SituacaoHoje {
  const [porCartao, setPorCartao] = useState<Map<string, SituacaoConta[]>>(new Map());
  const [provavel, setProvavel] = useState<Map<string, SituacaoConta>>(new Map());
  const [grupoPago, setGrupoPago] = useState<Set<string>>(new Set());
  const quando = useRef(0);
  const assinatura = useMemo(() => (itens ?? []).map((i) => `${i.chave}:${i.juntas.length}`).join('|'), [itens]);
  const ultima = useRef('');
  const corrida = useRef(0);

  useEffect(() => {
    if (!ligado || !itens?.length) return;
    // Mesma lista e leitura recente: não lê de novo (a Hoje relê as pendências a cada minuto).
    if (assinatura === ultima.current && Date.now() - quando.current < 55000) return;
    ultima.current = assinatura;
    quando.current = Date.now();
    // Só a leitura mais nova vale (sem cancelar no cleanup: a lista é recriada a cada minuto e a
    // leitura que já começou seria jogada fora sem outra no lugar).
    const minha = ++corrida.current;
    (async () => {
      const ids = new Map<string, string[]>();
      for (const i of itens) {
        const bs = [i.principal, ...i.juntas].map(billDe).filter((b): b is string => !!b);
        if (bs.length) ids.set(i.chave, [...new Set(bs)]);
      }
      const extras: Array<Promise<void>> = [];
      const achados = new Map<string, SituacaoConta[]>();
      const provaveis = new Map<string, SituacaoConta>();
      const pagos = new Set<string>();
      for (const i of itens) {
        const p = i.principal;
        if (p.kind === 'boleto_email' && typeof p.payload?.mail_id === 'string') {
          extras.push(acharContaDoEmail(p.tenantId, p.payload.mail_id, hoje).then((s) => { if (s) achados.set(i.chave, [s]); }).catch(() => {}));
        } else if (p.kind === 'pagamento_grupo' && !billDe(p)) {
          extras.push(acharContaDoPedido(p.tenantId, `${p.titulo}\n${p.detalhe ?? ''}`, p.criadaEm, hoje).then((r) => {
            if (!r) return;
            // Pelo CNPJ: conta paga = cartão sem razão de existir (o trigger também fecha no banco);
            // Pix ainda no Inter fica (lembra de recusar). Só pelo nome: "Já foi pago — tirar daqui".
            if (r.porCnpj && r.situacao.paga && !r.situacao.noInter) pagos.add(i.chave);
            else provaveis.set(i.chave, r.situacao);
          }).catch(() => {}));
        } else if (p.kind === 'mercadoria_chegou' && p.payload?.tipo === 'compra' && typeof p.payload?.id === 'string') {
          extras.push(lerSituacoesDaCompra(p.tenantId, p.payload.id, hoje).then((ss) => { if (ss.length) achados.set(i.chave, ss); }).catch(() => {}));
        }
      }
      const [mapa] = await Promise.all([
        lerSituacoes([...ids.values()].flat(), hoje).catch(() => new Map<string, SituacaoConta>()),
        ...extras,
      ]);
      if (minha !== corrida.current) return;
      const novo = new Map<string, SituacaoConta[]>();
      for (const [chave, bs] of ids) {
        const ss = bs.map((b) => mapa.get(b)).filter((s): s is SituacaoConta => !!s);
        if (ss.length) novo.set(chave, ss);
      }
      for (const [chave, ss] of achados) novo.set(chave, ss);
      setPorCartao(novo);
      setProvavel(provaveis);
      setGrupoPago(pagos);
    })();
  }, [assinatura, itens, hoje, ligado]);

  return { porCartao, provavel, grupoPago };
}
