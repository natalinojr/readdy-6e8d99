// Conta do acerto dos entregadores para a tela (Delivery › Entregadores › Quanto ganham).
// Espelha a função do banco `_acerto_motoboy_valor` (migração 20260927120000_acerto_entregadores.sql):
// o valor que vale de verdade é o que o banco congela quando o pedido vira "Entregue". Aqui é só a
// estimativa da tela, calculada com a regra que está no rascunho (ainda não salva).
import { MODOS_FAIXA_KM, type AcertoCfg } from './acertoCfg';
import type { FaixaEntrega } from './config';

const dinheiro = (n: number) => Math.round(n * 100) / 100;

/**
 * Quanto o entregador recebe por uma entrega.
 * `km` null = pedido sem distância registrada (no modo por faixa paga o valor "sem distância").
 */
export function valorEntregaAcerto(cfg: AcertoCfg, km: number | null | undefined, taxa: number): number {
  let v: number;
  if (MODOS_FAIXA_KM.includes(cfg.modo)) {
    const faixas = cfg.faixas.filter((f) => f.ate_km > 0).slice().sort((a, b) => a.ate_km - b.ate_km);
    if (km == null || !Number.isFinite(km)) {
      v = cfg.valor_entrega;
    } else {
      // primeira faixa que cobre a distância; além da última vale a maior
      const f = faixas.find((x) => x.ate_km >= km) ?? faixas[faixas.length - 1];
      v = f ? f.valor : cfg.valor_entrega;
    }
  } else if (cfg.modo === 'percentual_taxa') {
    v = (Number.isFinite(taxa) ? taxa : 0) * Math.min(cfg.percentual, 100) / 100;
  } else {
    // por_entrega e diaria_mais_entrega (a diária não depende da entrega; vale a mesma regra no diaria_mais_faixa_km)
    v = cfg.valor_entrega;
  }
  return dinheiro(Math.max(Number.isFinite(v) ? v : 0, 0));
}

export interface LinhaConta {
  faixa: FaixaEntrega;
  /** O que o entregador recebe numa entrega dessa faixa (usa o limite da faixa como distância). */
  entregador: number;
  /** Taxa do cliente menos o que o entregador recebe. */
  sobra: number;
}

/** Uma linha por faixa de entrega (já em ordem de distância): cliente paga × entregador recebe. */
export function contaPorFaixa(faixas: FaixaEntrega[], cfg: AcertoCfg): LinhaConta[] {
  return faixas.map((faixa) => {
    const entregador = valorEntregaAcerto(cfg, faixa.ate_km, faixa.taxa);
    return { faixa, entregador, sobra: dinheiro(faixa.taxa - entregador) };
  });
}

export interface PedidoConta { delivery_fee: number | string | null; delivery_distance_km: number | string | null }

/** Estimativa de um período: entregas, taxa que os clientes pagaram e o que os entregadores receberiam. */
export function resumoDoPeriodo(cfg: AcertoCfg, pedidos: PedidoConta[]): { entregas: number; taxa: number; entregador: number } {
  let taxa = 0;
  let entregador = 0;
  for (const p of pedidos) {
    const t = Number(p.delivery_fee ?? 0);
    const taxaPedido = Number.isFinite(t) && t > 0 ? t : 0;
    const km = p.delivery_distance_km == null || p.delivery_distance_km === '' ? null : Number(p.delivery_distance_km);
    taxa += taxaPedido;
    entregador += valorEntregaAcerto(cfg, km, taxaPedido);
  }
  return { entregas: pedidos.length, taxa: dinheiro(taxa), entregador: dinheiro(entregador) };
}
