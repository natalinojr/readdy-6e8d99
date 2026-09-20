// Painel dentro do CHAT (dono, 2026-09-20): os avisos que o assistente manda sozinho (fechamento de
// caixa, fechamento do turno) aparecem com a mesma cara das ações rápidas — número grande, barras e
// ranking — em vez de texto corrido. O servidor manda o texto (que vai para o WhatsApp/Telegram) e,
// junto, um marcador `[painel]{...}[/painel]` com os dados; no app o balão vira este painel.
// As peças são as mesmas de acoes/painel.tsx, para não existirem dois estilos de dashboard.
import { Painel, Kpis, Barras, Linhas, Ranking, Variacao } from './acoes/painel';

export interface DadosPainel {
  t: string;                                              // título
  s?: string;                                             // subtítulo (loja)
  r?: string;                                             // rodapé
  kpi?: { p: { l: string; v: string; var?: { a: number; b: number; r: string } }; o?: Array<{ l: string; v: string }> };
  b?: Array<{ t: string; c?: string; i: Array<{ l: string; v: number; d?: string }> }>;  // barras
  lin?: Array<{ t: string; i: Array<{ l: string; v?: string; d?: string; st?: 'ok' | 'alerta' | 'perigo' | 'neutro' }> }>; // linhas label → valor
  rk?: { t: string; i: Array<{ n: string; q: number; v?: number }> };                    // ranking
  al?: string[];                                                                         // alertas
}

/** Lê o marcador do texto da mensagem. Marcador inválido = sem painel (o balão mostra o texto). */
export function painelDoTexto(texto: string): DadosPainel | null {
  const m = texto.match(/\[painel\](\{[\s\S]*?\})\[\/painel\]/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]) as DadosPainel;
    return d && typeof d.t === 'string' ? d : null;
  } catch { return null; }
}

export default function PainelMensagem({ dados }: { dados: DadosPainel }) {
  return (
    <Painel titulo={dados.t} subtitulo={dados.s} rodape={dados.r}>
      {dados.kpi && (
        <Kpis
          principal={{
            label: dados.kpi.p.l,
            valor: dados.kpi.p.v,
            extra: dados.kpi.p.var ? <Variacao atual={dados.kpi.p.var.a} base={dados.kpi.p.var.b} rotulo={dados.kpi.p.var.r} /> : undefined,
          }}
          outros={(dados.kpi.o ?? []).map((k) => ({ label: k.l, valor: k.v }))}
        />
      )}
      {(dados.b ?? []).map((g) => (
        <Barras key={g.t} titulo={g.t} cor={g.c} itens={g.i.map((x) => ({ label: x.l, valor: x.v, detalhe: x.d }))} />
      ))}
      {(dados.lin ?? []).map((g) => (
        <Linhas key={g.t} titulo={g.t} itens={g.i.map((x) => ({ label: x.l, valor: x.v, detalhe: x.d, status: x.st }))} />
      ))}
      {dados.rk && <Ranking titulo={dados.rk.t} itens={dados.rk.i.map((x) => ({ nome: x.n, qtd: x.q, valor: Number(x.v ?? 0) }))} />}
      {(dados.al ?? []).map((a) => (
        <p key={a} className="text-xs font-semibold text-amber-700 bg-amber-50 rounded-xl px-3 py-2">⚠️ {a}</p>
      ))}
    </Painel>
  );
}
