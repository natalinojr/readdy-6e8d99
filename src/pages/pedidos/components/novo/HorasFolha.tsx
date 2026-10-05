import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { PedidoRecente } from '@/types/pdv';
import { ehCancelado } from '@/lib/pedidosRegras';
import Folha from '@/pages/estoque/components/inicio/Folha';
import { Vazio, Nota } from '@/pages/estoque/components/ui/EstoqueUi';

// "Pedidos por hora" (o antigo "Horários de pico" do PedidosMetricas), agora numa folha aberta pelo menu ⋯.

export interface HoraPedidos { hora: string; pedidos: number }

/**
 * Pedidos não cancelados por hora de criação (HH de `criadoEm`, já em Brasília). Pedido "pagos
 * juntos" conta cada pedido original. Vira a madrugada sem embaralhar: o turno que vai de 17h a 01h
 * aparece nessa ordem (17h … 23h, 0h, 1h) e as horas sem pedido entre a primeira e a última ficam
 * com zero, para a distância entre as barras ser verdadeira.
 */
export function pedidosPorHora(pedidos: PedidoRecente[]): HoraPedidos[] {
  const individuais = pedidos.flatMap((p) => (p.pedidosOriginais?.length ? p.pedidosOriginais : [p]));
  const porHora = new Map<number, number>();
  for (const p of individuais) {
    if (ehCancelado(p)) continue;
    const m = /^(\d{1,2}):/.exec(p.criadoEm ?? '');
    if (!m) continue;
    const h = Number(m[1]);
    if (h < 0 || h > 23) continue;
    porHora.set(h, (porHora.get(h) ?? 0) + 1);
  }
  if (porHora.size === 0) return [];

  // Começa na hora logo depois do maior buraco (circular): é onde o movimento "acorda".
  // Sem buraco nenhum (horas coladas, ou o dia todo), começa na menor hora.
  const horas = [...porHora.keys()].sort((a, b) => a - b);
  let inicio = horas[0];
  let maiorBuraco = 1;
  horas.forEach((h, i) => {
    const prox = horas[(i + 1) % horas.length];
    const buraco = horas.length === 1 ? 24 : (prox - h + 24) % 24;
    if (buraco > maiorBuraco) { maiorBuraco = buraco; inicio = prox; }
  });
  const ultimo = horas[(horas.indexOf(inicio) + horas.length - 1) % horas.length];
  const passos = ((ultimo - inicio + 24) % 24) + 1;
  return Array.from({ length: passos }, (_, k) => {
    const h = (inicio + k) % 24;
    return { hora: `${h}h`, pedidos: porHora.get(h) ?? 0 };
  });
}

export default function HorasFolha({ aberta, onFechar, pedidos }: { aberta: boolean; onFechar: () => void; pedidos: PedidoRecente[] }) {
  return (
    <Folha aberta={aberta} onFechar={onFechar} titulo="Pedidos por hora" subtitulo="Para ver a que horas a casa enche">
      <Conteudo pedidos={pedidos} />
    </Folha>
  );
}

function Conteudo({ pedidos }: { pedidos: PedidoRecente[] }) {
  const dados = pedidosPorHora(pedidos);
  if (dados.length === 0) {
    return (
      <div className="pb-3">
        <Vazio icone="ri-bar-chart-2-line" titulo="Sem pedidos para mostrar">
          Não há pedidos (fora os cancelados) neste período. Escolha outro dia ou turno.
        </Vazio>
      </div>
    );
  }
  // Empate: vale a primeira hora do movimento.
  const pico = dados.reduce((a, b) => (b.pedidos > a.pedidos ? b : a));
  const total = dados.reduce((s, d) => s + d.pedidos, 0);
  const plural = (n: number) => `${n} pedido${n === 1 ? '' : 's'}`;

  return (
    <div className="pb-3 space-y-3">
      <p className="text-sm text-zinc-700">
        Pico: <strong className="text-amber-600">{pico.hora}</strong> com <strong className="text-amber-600">{plural(pico.pedidos)}</strong>
      </p>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={dados} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
          <XAxis dataKey="hora" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
          <Tooltip
            formatter={(v) => [plural(Number(v)), 'Pedidos']}
            cursor={{ fill: '#fafafa' }}
            contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
          />
          <Bar dataKey="pedidos" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
      <Nota>{plural(total)} no período, sem contar os cancelados. A hora é a de quando o pedido foi feito.</Nota>
    </div>
  );
}
