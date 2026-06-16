import { useState, useMemo } from 'react';
import { useClientePedidos, type ClienteCRM } from '@/hooks/useClientes';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

interface Props {
  cliente: ClienteCRM;
  onClose: () => void;
}

function fmtData(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function diasSemVisita(ultima: string) {
  return Math.floor((Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24));
}

const TAG_STYLE: Record<string, string> = {
  vip: 'bg-amber-50 text-amber-700 border border-amber-200',
  frequente: 'bg-green-50 text-green-700 border border-green-200',
  novo: 'bg-sky-50 text-sky-700 border border-sky-200',
  inativo: 'bg-zinc-100 text-zinc-500 border border-zinc-200',
};

const ORIGEM_LABEL: Record<string, string> = {
  cashier: 'Caixa',
  waiter: 'Garçom',
  table: 'Mesa QR',
  self_service: 'Kiosk',
  delivery: 'Delivery',
};

type Aba = 'historico' | 'frequencia';

export default function ClientePerfil({ cliente, onClose }: Props) {
  const dias = diasSemVisita(cliente.ultimaVisita);
  const { pedidos, loading: loadingPedidos } = useClientePedidos(cliente.id);
  const [aba, setAba] = useState<Aba>('historico');
  const [msgCopiada, setMsgCopiada] = useState(false);

  // Gráfico de frequência mensal de visitas
  const frequenciaMensal = useMemo(() => {
    const map = new Map<string, { visitas: number; gasto: number }>();
    pedidos.forEach((p) => {
      const key = p.data.slice(0, 7); // YYYY-MM
      const prev = map.get(key) ?? { visitas: 0, gasto: 0 };
      map.set(key, { visitas: prev.visitas + 1, gasto: prev.gasto + p.valor });
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([key, v]) => {
        const [ano, mes] = key.split('-');
        const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        return {
          mes: `${nomes[Number(mes) - 1]}/${ano.slice(2)}`,
          visitas: v.visitas,
          gasto: v.gasto,
        };
      });
  }, [pedidos]);

  // Mensagem WhatsApp pré-formatada
  const abrirWhatsApp = () => {
    if (!cliente.celular) return;
    const numero = cliente.celular.replace(/\D/g, '');
    const msg = encodeURIComponent(
      `Olá, ${cliente.nome.split(' ')[0]}! Tudo bem? Sentimos sua falta por aqui. Venha nos visitar e aproveite nossas novidades! 😊`
    );
    window.open(`https://wa.me/55${numero}?text=${msg}`, '_blank');
  };

  const copiarMensagem = () => {
    const msg = `Olá, ${cliente.nome.split(' ')[0]}! Tudo bem? Sentimos sua falta por aqui. Venha nos visitar e aproveite nossas novidades! 😊`;
    navigator.clipboard.writeText(msg).then(() => {
      setMsgCopiada(true);
      setTimeout(() => setMsgCopiada(false), 2000);
    });
  };

  const itensMaisComprados = useMemo(() => {
    const map = new Map<string, number>();
    pedidos.forEach((p) => {
      p.itens?.forEach((item) => {
        map.set(item, (map.get(item) ?? 0) + 1);
      });
    });
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
  }, [pedidos]);

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white border-l border-zinc-100 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
            <span className="text-base font-bold text-amber-700">{cliente.nome.charAt(0)}</span>
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-900">{cliente.nome}</p>
            <p className="text-xs text-zinc-400">{cliente.celular || 'Sem telefone'}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer transition-colors"
        >
          <i className="ri-close-line text-lg" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Tags */}
        <div className="px-6 pt-4 flex flex-wrap gap-1.5">
          {cliente.tags.map((tag) => (
            <span key={tag} className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${TAG_STYLE[tag] ?? 'bg-zinc-100 text-zinc-600'}`}>
              {tag}
            </span>
          ))}
          {dias > 30 && !cliente.tags.includes('inativo') && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-200">
              {dias}d sem visitar
            </span>
          )}
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-3 gap-3 px-6 pt-4">
          {[
            { label: 'Visitas', value: String(cliente.totalVisitas), icon: 'ri-map-pin-line', color: 'text-amber-600' },
            { label: 'Total gasto', value: fmtMoeda(cliente.valorTotal), icon: 'ri-money-dollar-circle-line', color: 'text-green-600' },
            { label: 'Ticket médio', value: fmtMoeda(cliente.ticketMedio), icon: 'ri-receipt-line', color: 'text-sky-600' },
          ].map((m) => (
            <div key={m.label} className="bg-zinc-50 rounded-xl p-3 text-center">
              <div className={`w-7 h-7 flex items-center justify-center mx-auto mb-1 ${m.color}`}>
                <i className={`${m.icon} text-lg`} />
              </div>
              <p className="text-xs font-bold text-zinc-800 leading-tight">{m.value}</p>
              <p className="text-[10px] text-zinc-400 mt-0.5">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Datas */}
        <div className="mx-6 mt-4 p-4 bg-zinc-50 rounded-xl space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-zinc-500">Primeira visita</span>
            <span className="font-semibold text-zinc-700">{fmtData(cliente.primeiraVisita)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-zinc-500">Última visita</span>
            <span className="font-semibold text-zinc-700">{fmtData(cliente.ultimaVisita)}</span>
          </div>
          {cliente.dataNascimento ? (
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Nascimento</span>
              <span className="font-semibold text-zinc-700">{String(cliente.dataNascimento).slice(0, 10).split('-').reverse().join('/')}</span>
            </div>
          ) : null}
          {cliente.genero ? (
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Gênero</span>
              <span className="font-semibold text-zinc-700 capitalize">{cliente.genero}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-xs">
            <span className="text-zinc-500">Dias desde última visita</span>
            <span className={`font-semibold ${dias > 30 ? 'text-red-500' : dias > 14 ? 'text-amber-500' : 'text-green-600'}`}>
              {dias} dias
            </span>
          </div>
        </div>

        {/* Ações rápidas */}
        <div className="px-6 mt-4">
          <p className="text-xs font-bold text-zinc-700 uppercase tracking-wider mb-2.5">Ações Rápidas</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={abrirWhatsApp}
              disabled={!cliente.celular}
              className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-xl text-xs font-semibold text-green-700 hover:bg-green-100 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <i className="ri-whatsapp-line text-base text-green-600" />
              Enviar WhatsApp
            </button>
            <button
              onClick={copiarMensagem}
              disabled={!cliente.celular}
              className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-600 hover:bg-zinc-100 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <i className={`${msgCopiada ? 'ri-check-line text-emerald-600' : 'ri-file-copy-line'} text-base`} />
              {msgCopiada ? 'Copiado!' : 'Copiar mensagem'}
            </button>
          </div>
          {!cliente.celular && (
            <p className="text-[10px] text-zinc-400 mt-1.5 text-center">Sem telefone cadastrado para este cliente</p>
          )}
        </div>

        {/* Itens mais comprados */}
        {itensMaisComprados.length > 0 && (
          <div className="px-6 mt-4">
            <p className="text-xs font-bold text-zinc-700 uppercase tracking-wider mb-2.5">Favoritos</p>
            <div className="flex flex-wrap gap-1.5">
              {itensMaisComprados.map(([item, qtd]) => (
                <span key={item} className="flex items-center gap-1 text-xs px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-full text-amber-700 font-medium">
                  {item}
                  <span className="text-[10px] bg-amber-200 text-amber-800 px-1 rounded-full font-bold">{qtd}x</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Abas: Histórico / Frequência */}
        <div className="px-6 mt-5">
          <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl mb-4">
            {([
              { id: 'historico', label: 'Histórico', icon: 'ri-file-list-3-line' },
              { id: 'frequencia', label: 'Frequência', icon: 'ri-bar-chart-line' },
            ] as { id: Aba; label: string; icon: string }[]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setAba(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-all ${
                  aba === tab.id ? 'bg-white text-zinc-800' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                <i className={`${tab.icon} text-sm`} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Aba Histórico */}
          {aba === 'historico' && (
            <div className="pb-6">
              <p className="text-xs font-bold text-zinc-700 uppercase tracking-wider mb-3">
                Histórico de Pedidos
                {!loadingPedidos && <span className="ml-1 text-zinc-400 font-normal">({pedidos.length})</span>}
              </p>

              {loadingPedidos ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : pedidos.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 text-xs">
                  Nenhum pedido encontrado para este cliente
                </div>
              ) : (
                <div className="space-y-2">
                  {pedidos.map((pedido) => (
                    <div key={pedido.id} className="bg-zinc-50 rounded-xl p-3">
                      <div className="flex justify-between items-center mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">{fmtData(pedido.data)}</span>
                          {pedido.mesa && pedido.mesa !== '—' && (
                            <span className="text-xs text-zinc-400">· {pedido.mesa}</span>
                          )}
                          {pedido.origem && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 rounded-full text-zinc-400">
                              {ORIGEM_LABEL[pedido.origem] ?? pedido.origem}
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-bold text-zinc-800">{fmtMoeda(pedido.valor)}</span>
                      </div>
                      {pedido.itens && pedido.itens.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {pedido.itens.slice(0, 5).map((item, i) => (
                            <span key={i} className="text-[11px] text-zinc-600 bg-white border border-zinc-200 px-2 py-0.5 rounded-full">
                              {item}
                            </span>
                          ))}
                          {pedido.itens.length > 5 && (
                            <span className="text-[11px] text-zinc-400 bg-white border border-zinc-200 px-2 py-0.5 rounded-full">
                              +{pedido.itens.length - 5}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Aba Frequência */}
          {aba === 'frequencia' && (
            <div className="pb-6">
              <p className="text-xs font-bold text-zinc-700 uppercase tracking-wider mb-3">
                Visitas por Mês (últimos 6 meses)
              </p>

              {loadingPedidos ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : frequenciaMensal.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 text-xs">
                  Sem dados de frequência disponíveis
                </div>
              ) : (
                <>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={frequenciaMensal} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                        <XAxis
                          dataKey="mes"
                          tick={{ fontSize: 10, fill: '#a1a1aa' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: '#a1a1aa' }}
                          axisLine={false}
                          tickLine={false}
                          width={20}
                          allowDecimals={false}
                        />
                        <Tooltip
                          formatter={(val: number) => [`${val} visita${val !== 1 ? 's' : ''}`, 'Frequência']}
                          contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                        />
                        <Bar dataKey="visitas" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={32} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Insights de frequência */}
                  <div className="mt-4 space-y-2">
                    {(() => {
                      const totalMeses = frequenciaMensal.length;
                      const mediaVisitas = totalMeses > 0
                        ? (frequenciaMensal.reduce((s, m) => s + m.visitas, 0) / totalMeses).toFixed(1)
                        : '0';
                      const melhorMes = frequenciaMensal.reduce((best, m) => m.visitas > best.visitas ? m : best, frequenciaMensal[0]);
                      const totalGastoMeses = frequenciaMensal.reduce((s, m) => s + m.gasto, 0);

                      return (
                        <>
                          <div className="flex items-center justify-between bg-amber-50 rounded-xl px-3 py-2.5">
                            <span className="text-xs text-amber-700 font-medium">Média de visitas/mês</span>
                            <span className="text-sm font-bold text-amber-800">{mediaVisitas}</span>
                          </div>
                          {melhorMes && (
                            <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-3 py-2.5">
                              <span className="text-xs text-zinc-600 font-medium">Mês mais frequente</span>
                              <span className="text-sm font-bold text-zinc-800">{melhorMes.mes} ({melhorMes.visitas}x)</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between bg-emerald-50 rounded-xl px-3 py-2.5">
                            <span className="text-xs text-emerald-700 font-medium">Gasto nos últimos 6 meses</span>
                            <span className="text-sm font-bold text-emerald-800">{fmtMoeda(totalGastoMeses)}</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
