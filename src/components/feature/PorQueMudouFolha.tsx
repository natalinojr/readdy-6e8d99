import { useEffect, useMemo, useState } from 'react';
import Folha from '@/pages/estoque/components/inicio/Folha';
import { usePorQueMudou, type PeriodoPorQue } from '@/hooks/usePorQueMudou';
import { explicarVariacao, type TipoFrase } from '@/lib/porQueMudou';

// "Por que mudou?" (2026-10-05): folha que abre ao tocar na variação do Dashboard e do Comparar lojas. Frases por REGRA,
// sem IA, só com causa que o sistema já registra (regras em src/lib/porQueMudou.ts; fatos em fn_por_que_mudou).

const ICONE: Record<TipoFrase, string> = {
  canal: 'ri-store-3-line', hora: 'ri-time-line', abertura: 'ri-key-2-line', pausa: 'ri-pause-circle-line',
};

export interface PropsPorQue {
  aberta: boolean;
  onFechar: () => void;
  tenantId: string | undefined;
  /** nome da loja (Comparar lojas); no Dashboard fica de fora */
  nomeLoja?: string;
  periodo: PeriodoPorQue | null;
  /** "sex passada", "dom anterior"… */
  rotulo: string;
  umDia: boolean;
  atual: { faturamento: number; pedidos: number };
  anterior: { faturamento: number; pedidos: number };
  serieAtual: Record<string, number> | null;
  serieAnterior: Record<string, number> | null;
  horaCorte: number | null;
  /** iFood do período atual e do comparado; 'derivar' = anterior = total comparado − PDV comparado (Comparar lojas); null = ainda chegando */
  ifood: { atual: number; anterior: number | 'derivar' | null } | null;
  /** a tela ainda está buscando algo que a folha usa (série da semana, iFood): espera um pouco antes de avisar que faltou */
  aguardando?: boolean;
}

/** Quanto esperar o que a tela ainda busca antes de mostrar a folha com o aviso do que faltou. */
const ESPERA_MAX_MS = 8000;

export default function PorQueMudouFolha(p: PropsPorQue) {
  const { fatos, carregando, falhou } = usePorQueMudou(p.aberta, p.tenantId, p.periodo);
  const [desistiu, setDesistiu] = useState(false);
  useEffect(() => {
    setDesistiu(false);
    if (!p.aberta || !p.aguardando) return;
    const t = setTimeout(() => setDesistiu(true), ESPERA_MAX_MS);
    return () => clearTimeout(t);
  }, [p.aberta, p.aguardando]);

  const explicacao = useMemo(() => {
    if (!p.aberta || !p.periodo || carregando || (p.aguardando && !desistiu)) return null;
    let ifood: { atual: number; anterior: number | null } | null = null;
    if (p.ifood) {
      let ant: number | null;
      if (p.ifood.anterior === 'derivar') {
        const pdvAnt = fatos ? Object.values(fatos.canais.anterior).reduce((s, c) => s + c.valor, 0) : null;
        const d = pdvAnt === null ? null : Math.round((p.anterior.faturamento - pdvAnt) * 100) / 100;
        ant = d === null ? null : Math.abs(d) < 1 ? 0 : Math.max(0, d);
      } else ant = p.ifood.anterior;
      ifood = { atual: p.ifood.atual, anterior: ant };
    }
    return explicarVariacao({
      rotulo: p.rotulo, umDia: p.umDia, dia: p.periodo.d1, diaComparado: p.periodo.c1,
      atual: p.atual, anterior: p.anterior, serieAtual: p.serieAtual, serieAnterior: p.serieAnterior,
      horaCorte: p.horaCorte, ifood, fatos: falhou ? null : fatos,
    });
  }, [p.aberta, p.periodo, carregando, p.aguardando, desistiu, falhou, fatos, p.rotulo, p.umDia, p.atual, p.anterior, p.serieAtual, p.serieAnterior, p.horaCorte, p.ifood]);

  return (
    <Folha aberta={p.aberta} titulo="Por que mudou?" subtitulo={p.nomeLoja} onFechar={p.onFechar}
      rodape={<button type="button" onClick={p.onFechar} className="flex-1 text-sm font-bold px-4 py-2.5 rounded-xl bg-zinc-100 text-zinc-700 hover:bg-zinc-200 cursor-pointer">Fechar</button>}>
      {!explicacao ? (
        <div className="space-y-2 py-2" aria-busy>
          <div className="h-5 w-3/4 rounded bg-zinc-100 animate-pulse" />
          <div className="h-14 rounded-xl bg-zinc-100 animate-pulse" />
          <div className="h-14 rounded-xl bg-zinc-100 animate-pulse" />
        </div>
      ) : (
        <div className="pb-1">
          <p className="text-[15px] font-extrabold text-zinc-900 leading-snug">{explicacao.titulo}</p>
          <div className="mt-3 space-y-2.5">
            {explicacao.frases.map((f) => (
              <div key={f.tipo} className="flex gap-3 rounded-2xl bg-zinc-50 px-3.5 py-3">
                <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0"><i className={ICONE[f.tipo]} /></span>
                <p className="text-[13.5px] text-zinc-700 leading-relaxed">{f.texto}</p>
              </div>
            ))}
            {explicacao.semCausa && (
              <div className="flex gap-3 rounded-2xl bg-amber-50 px-3.5 py-3">
                <span className="w-8 h-8 rounded-xl bg-white text-amber-600 flex items-center justify-center flex-shrink-0"><i className="ri-search-line" /></span>
                <p className="text-[13.5px] text-amber-900 leading-relaxed">{explicacao.semCausa}</p>
              </div>
            )}
            {explicacao.frases.length === 0 && !explicacao.semCausa && (
              <p className="text-[13px] text-zinc-500">Não há o que explicar com os registros que o sistema tem.</p>
            )}
          </div>
          {explicacao.lacunas.length > 0 && (
            <p className="mt-3 text-xs text-red-600 leading-relaxed">Não deu para ler agora: {explicacao.lacunas.join(', ')}. As frases acima não levam isso em conta.</p>
          )}
          <p className="mt-4 text-[11.5px] text-zinc-400 leading-relaxed">
            Feito por regra, sem IA, só com o que o sistema registra: venda por canal e por hora, abertura do caixa e itens pausados no Cardápio.
            Se a causa não está nesses registros, a folha diz isso em vez de chutar. Dia = dia da loja (soma das sessões de caixa abertas nele).
          </p>
        </div>
      )}
    </Folha>
  );
}
