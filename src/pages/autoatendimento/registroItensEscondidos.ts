/**
 * Registro de diagnóstico: item que some (ou volta) no cardápio do tablet de autoatendimento.
 *
 * Por quê (2026-10-01): em Paranaguá um item de chope "sumia e voltava" no tablet durante o
 * dia sem ninguém mexer no cardápio, sem estoque ligado e sem falha de carga. Em vez de
 * adivinhar, o tablet grava em dev_error_events (fn `autoatendimento.itemEscondido`,
 * severity warning) cada item que deixa de aparecer, com o motivo que a própria tela usou
 * para esconder, e quando ele volta, quanto tempo ficou fora.
 *
 * O fingerprint junta por mensagem (nome do item + motivo) e o contexto é MESCLADO; por isso
 * cada ocorrência entra numa chave com data/hora (`em <data hora>`), e o histórico fica.
 *
 * O estado anterior fica no módulo (não no componente): o cardápio desmonta entre um cliente
 * e outro, e a troca que acontece nesse meio é pega na volta.
 */
import { useEffect, useRef } from 'react';
import type { ItemCardapioPublico } from '@/types/mesaCliente';
import type { Categoria, Combo, Item } from '@/types/cardapio';
import type { InsumoFaltando } from '@/hooks/useItensSemEstoque';
import { reportError } from '@/lib/errorReporter';
import { visivelAgora } from '@/lib/horarioExibicao';

const FN = 'autoatendimento.itemEscondido';
// Horário de exibição (2026-10-02) esconde de propósito — não é sumiço a investigar.
const FORA_DO_HORARIO = 'fora do horário de exibição';

interface Estado {
  tenantId: string;
  visiveis: Map<string, string>; // id → nome
  sumidos: Map<string, { nome: string; desde: number; motivo: string }>;
}
let estado: Estado | null = null;

function agoraLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

interface Entrada {
  tenantId: string | null;
  quem: string;
  visiveis: ItemCardapioPublico[];
  itensPublicos: ItemCardapioPublico[];
  itens: Item[];
  categorias: Categoria[];
  combos: Combo[];
  desabilitadosIds: string[];
  semEstoque: Map<string, InsumoFaltando[]>;
  pronto: boolean;
}

function vendeNoTablet(i: Item): boolean {
  const c = i.canais;
  return c == null || c.self_service === true || c.mesa_qr === true;
}

/** Mesmo raciocínio dos filtros de CardapioContext.itensPublicos + CardapioKiosk.itensDisponiveis. */
function motivo(id: string, e: Entrada): { curto: string; detalhe?: unknown } {
  if (e.desabilitadosIds.includes(id)) return { curto: 'estoque (item desabilitado)' };
  const faltando = e.semEstoque.get(id);
  if (faltando) return { curto: 'estoque (insumo zerado)', detalhe: faltando.map((f) => `${f.nome}=${f.estoque}${f.unidade}`) };
  if (e.itensPublicos.some((p) => p.id === id)) return { curto: 'motivo desconhecido (estava no cardápio público)' };
  const raw = e.itens.find((i) => i.id === id);
  if (!raw) {
    const combo = e.combos.find((c) => c.id === id);
    if (combo) return { curto: combo.ativo ? 'combo fora do cardápio público' : 'combo desligado' };
    return { curto: 'não veio no cardápio carregado' };
  }
  if (raw.status !== 'ativo') return { curto: 'desligado no cardápio' };
  if (raw.somenteDelivery) return { curto: 'marcado só delivery' };
  if (!vendeNoTablet(raw)) return { curto: 'canal autoatendimento desmarcado', detalhe: raw.canais };
  const cat = e.categorias.find((c) => c.id === raw.categoriaId);
  if (!cat) return { curto: 'categoria não veio no cardápio carregado' };
  if (!cat.ativo) return { curto: 'categoria desligada', detalhe: cat.nome };
  if (!visivelAgora([raw.horario, cat.horario], 'casa')) return { curto: FORA_DO_HORARIO };
  return { curto: 'fora do cardápio público sem motivo conhecido' };
}

export function useRegistroItensEscondidos(e: Entrada): void {
  // Quando o cardápio (itensPublicos) mudou pela última vez — diz se a troca veio de uma recarga.
  const ultimaCargaRef = useRef(Date.now());
  const pubRef = useRef(e.itensPublicos);
  if (pubRef.current !== e.itensPublicos) { pubRef.current = e.itensPublicos; ultimaCargaRef.current = Date.now(); }

  useEffect(() => {
    // Sem loja, carregando, com erro ou cardápio vazio (sessão caiu) já têm tela própria.
    if (!e.tenantId || !e.pronto || e.itensPublicos.length === 0) return;
    const agora = Date.now();
    const atuais = new Map(e.visiveis.map((i) => [i.id, i.nome]));

    if (!estado || estado.tenantId !== e.tenantId) {
      estado = { tenantId: e.tenantId, visiveis: atuais, sumidos: new Map() };
      // Já na primeira carga: item ligado e vendido no tablet que não aparece é anormal.
      for (const raw of e.itens) {
        if (atuais.has(raw.id) || raw.status !== 'ativo' || raw.somenteDelivery || !vendeNoTablet(raw)) continue;
        const cat = e.categorias.find((c) => c.id === raw.categoriaId);
        if (cat && !cat.ativo) continue;
        if (!visivelAgora([raw.horario, cat?.horario], 'casa')) continue;
        registrarSumico(raw.id, raw.nome, e, agora, true);
      }
      return;
    }

    for (const [id, nome] of estado.visiveis) {
      if (!atuais.has(id) && !estado.sumidos.has(id)) registrarSumico(id, nome, e, agora, false);
    }
    for (const [id, nome] of atuais) {
      const s = estado.sumidos.get(id);
      if (!s) continue;
      estado.sumidos.delete(id);
      reportError(`Tablet voltou a mostrar "${nome}"`, {
        fn: FN,
        severity: 'warning',
        tenant_id: e.tenantId,
        context: {
          [`em ${agoraLocal()}`]: {
            tablet: e.quem,
            ficouFora_s: Math.round((agora - s.desde) / 1000),
            motivoEra: s.motivo,
          },
        },
      });
    }
    estado.visiveis = atuais;

    function registrarSumico(id: string, nome: string, ent: Entrada, quando: number, naCarga: boolean) {
      const m = motivo(id, ent);
      if (m.curto === FORA_DO_HORARIO) return;
      estado!.sumidos.set(id, { nome, desde: quando, motivo: m.curto });
      reportError(`Tablet escondeu "${nome}": ${m.curto}`, {
        fn: FN,
        severity: 'warning',
        tenant_id: ent.tenantId,
        context: {
          [`em ${agoraLocal()}`]: {
            tablet: ent.quem,
            itemId: id,
            detalhe: m.detalhe ?? null,
            jaNaPrimeiraCarga: naCarga,
            cardapioPublico: ent.itensPublicos.length,
            itensCarregados: ent.itens.length,
            visiveis: ent.visiveis.length,
            segDesdeUltimaCarga: Math.round((quando - ultimaCargaRef.current) / 1000),
          },
        },
      });
    }
  }, [e.tenantId, e.quem, e.visiveis, e.itensPublicos, e.itens, e.categorias, e.combos, e.desabilitadosIds, e.semEstoque, e.pronto]);
}
