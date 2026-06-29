import { useState, useMemo } from 'react';
import { useClientes, type ClienteCRM } from '@/hooks/useClientes';
import ClientePerfil from './components/ClientePerfil';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

type Filtro = 'todos' | 'frequente' | 'vip' | 'novo' | 'inativo' | 'aniversario';

function fmtData(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function diasSemVisita(ultima: string) {
  return Math.floor((Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24));
}
// Aniversário (dia/mês) a partir de 'YYYY-MM-DD'. Lê direto da string p/ evitar
// deslocamento de fuso (new Date('YYYY-MM-DD') é UTC e pode "pular" o dia).
function fmtAniversario(d: string | null): string {
  if (!d) return '—';
  const [, mes, dia] = d.slice(0, 10).split('-');
  return dia && mes ? `${dia}/${mes}` : '—';
}
// Abre o WhatsApp do cliente (mesmo padrão do ClientePerfil): wa.me/55<dígitos>.
function abrirWhatsApp(cliente: ClienteCRM) {
  const numero = (cliente.celular ?? '').replace(/\D/g, '');
  if (!numero) return;
  const msg = encodeURIComponent(
    `Olá, ${cliente.nome.split(' ')[0]}! Tudo bem? Sentimos sua falta por aqui. Venha nos visitar e aproveite nossas novidades! 😊`,
  );
  window.open(`https://wa.me/55${numero}?text=${msg}`, '_blank');
}

// Verifica se o cliente faz aniversário este mês, usando a data de nascimento real.
// Sem data de nascimento, não há como saber — não conta como aniversariante.
function aniversarioEsteMes(c: ClienteCRM): boolean {
  if (!c.dataNascimento) return false;
  // dataNascimento vem como 'YYYY-MM-DD' (coluna date). Lemos o mês direto da string
  // para evitar deslocamento de fuso (new Date('YYYY-MM-DD') é UTC e pode "pular" o mês).
  const mesNasc = Number(c.dataNascimento.slice(5, 7));
  if (!mesNasc) return false;
  return mesNasc === new Date().getMonth() + 1;
}

const TAG_STYLE: Record<string, string> = {
  vip: 'bg-amber-50 text-amber-700 border border-amber-200',
  frequente: 'bg-green-50 text-green-700 border border-green-200',
  novo: 'bg-sky-50 text-sky-700 border border-sky-200',
  inativo: 'bg-zinc-100 text-zinc-500 border border-zinc-200',
};

const FILTROS: { id: Filtro; label: string; icon?: string; count?: (c: ClienteCRM[]) => number }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'vip', label: 'VIP', icon: 'ri-vip-crown-line', count: (cs) => cs.filter((c) => c.tags.includes('vip')).length },
  { id: 'frequente', label: 'Frequentes', icon: 'ri-repeat-line', count: (cs) => cs.filter((c) => c.tags.includes('frequente')).length },
  { id: 'novo', label: 'Novos', icon: 'ri-user-add-line', count: (cs) => cs.filter((c) => c.tags.includes('novo')).length },
  { id: 'inativo', label: 'Inativos', icon: 'ri-user-unfollow-line', count: (cs) => cs.filter((c) => c.tags.includes('inativo') || diasSemVisita(c.ultimaVisita) > 30).length },
  { id: 'aniversario', label: 'Aniversário', icon: 'ri-cake-line', count: (cs) => cs.filter(aniversarioEsteMes).length },
];

function exportarCSV(clientes: ClienteCRM[]) {
  const headers = ['Nome', 'Celular', 'Aniversário', 'Tags', 'Compras', 'Total Gasto (R$)', 'Ticket Médio (R$)', 'Primeira Compra', 'Última Compra', 'Dias sem Comprar'];
  const rows = clientes.map(c => [
    c.nome,
    c.celular || '',
    fmtAniversario(c.dataNascimento),
    c.tags.join(', '),
    c.totalVisitas,
    c.valorTotal.toFixed(2).replace('.', ','),
    c.ticketMedio.toFixed(2).replace('.', ','),
    c.totalVisitas === 0 ? '' : fmtData(c.primeiraVisita),
    c.totalVisitas === 0 ? '' : fmtData(c.ultimaVisita),
    c.totalVisitas === 0 ? '' : diasSemVisita(c.ultimaVisita),
  ]);
  const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `clientes_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Segmentação RFM simplificada ─────────────────────────────────────────────
type SegmentoRFM = 'Campeões' | 'Fiéis' | 'Em Risco' | 'Perdidos' | 'Novos';

function segmentarRFM(c: ClienteCRM): SegmentoRFM {
  const dias = diasSemVisita(c.ultimaVisita);
  if (dias <= 7 && c.totalVisitas >= 5) return 'Campeões';
  if (dias <= 30 && c.totalVisitas >= 3) return 'Fiéis';
  if (dias > 30 && dias <= 60 && c.totalVisitas >= 2) return 'Em Risco';
  if (dias > 60) return 'Perdidos';
  return 'Novos';
}

const RFM_STYLE: Record<SegmentoRFM, { color: string; bg: string; bar: string; desc: string }> = {
  'Campeões':  { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', bar: '#10b981', desc: 'Compram frequentemente e recentemente' },
  'Fiéis':     { color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     bar: '#f59e0b', desc: 'Compram regularmente, bom relacionamento' },
  'Em Risco':  { color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   bar: '#f97316', desc: 'Compraram antes, mas estão sumindo' },
  'Perdidos':  { color: 'text-red-700',     bg: 'bg-red-50 border-red-200',         bar: '#ef4444', desc: 'Não compram há mais de 60 dias' },
  'Novos':     { color: 'text-sky-700',     bg: 'bg-sky-50 border-sky-200',         bar: '#0ea5e9', desc: 'Primeira ou segunda compra recente' },
};

export default function ClientesPage() {
  const { clientes, loading, error } = useClientes();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [ordenar, setOrdenar] = useState<'visitas' | 'gasto' | 'recente'>('recente');
  const [selecionado, setSelecionado] = useState<ClienteCRM | null>(null);
  const [showRFM, setShowRFM] = useState(false);

  const lista = useMemo(() => {
    let l = [...clientes];

    if (busca.trim()) {
      const q = busca.toLowerCase();
      l = l.filter((c) =>
        c.nome.toLowerCase().includes(q) || (c.celular ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, ''))
      );
    }

    if (filtro !== 'todos') {
      l = l.filter((c) => {
        if (filtro === 'inativo') return c.tags.includes('inativo') || diasSemVisita(c.ultimaVisita) > 30;
        if (filtro === 'aniversario') return aniversarioEsteMes(c);
        return c.tags.includes(filtro);
      });
    }

    if (ordenar === 'visitas') l.sort((a, b) => b.totalVisitas - a.totalVisitas);
    else if (ordenar === 'gasto') l.sort((a, b) => b.valorTotal - a.valorTotal);
    else l.sort((a, b) => new Date(b.ultimaVisita).getTime() - new Date(a.ultimaVisita).getTime());

    return l;
  }, [clientes, busca, filtro, ordenar]);

  const totalGasto = clientes.reduce((acc, c) => acc + c.valorTotal, 0);
  const totalVisitas = clientes.reduce((acc, c) => acc + c.totalVisitas, 0);
  const mediaVisitas = clientes.length > 0 ? (totalVisitas / clientes.length).toFixed(1) : '0';
  const ticketMedioGeral = totalVisitas > 0 ? totalGasto / totalVisitas : 0;
  const aniversariantesCount = clientes.filter(aniversarioEsteMes).length;
  const inativos = clientes.filter(c => diasSemVisita(c.ultimaVisita) > 30).length;

  // RFM segmentation
  const rfmData = useMemo(() => {
    const grupos: Record<SegmentoRFM, { count: number; gasto: number }> = {
      'Campeões': { count: 0, gasto: 0 },
      'Fiéis':    { count: 0, gasto: 0 },
      'Em Risco': { count: 0, gasto: 0 },
      'Perdidos': { count: 0, gasto: 0 },
      'Novos':    { count: 0, gasto: 0 },
    };
    clientes.forEach(c => {
      const seg = segmentarRFM(c);
      grupos[seg].count++;
      grupos[seg].gasto += c.valorTotal;
    });
    return (Object.entries(grupos) as [SegmentoRFM, { count: number; gasto: number }][])
      .map(([seg, v]) => ({ seg, ...v, style: RFM_STYLE[seg] }))
      .filter(s => s.count > 0);
  }, [clientes]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 md:px-6 py-4 flex-shrink-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
              <i className="ri-user-line text-zinc-600 text-sm" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Clientes</h1>
              <p className="text-xs text-zinc-400">
                {loading ? 'Carregando...' : `${clientes.length} clientes cadastrados`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {aniversariantesCount > 0 && (
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                <i className="ri-cake-line text-amber-600 text-sm" />
                <span className="text-xs font-semibold text-amber-700">{aniversariantesCount} aniversariante{aniversariantesCount > 1 ? 's' : ''} este mês</span>
              </div>
            )}
            {inativos > 0 && (
              <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                <i className="ri-user-unfollow-line text-red-500 text-sm" />
                <span className="text-xs font-semibold text-red-600">{inativos} inativo{inativos > 1 ? 's' : ''}</span>
              </div>
            )}
            <button
              onClick={() => setShowRFM(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors border ${showRFM ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600'}`}
            >
              <i className="ri-pie-chart-2-line" /> Segmentação RFM
            </button>
            <button
              onClick={() => exportarCSV(lista)}
              disabled={lista.length === 0}
              className="flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-40"
            >
              <i className="ri-download-line" /> Exportar CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3 mb-4">
          {[
            { label: 'Total de clientes', value: String(clientes.length), icon: 'ri-user-line', color: 'text-amber-600 bg-amber-50' },
            { label: 'Gasto total', value: fmtMoeda(totalGasto), icon: 'ri-money-dollar-circle-line', color: 'text-green-600 bg-green-50' },
            { label: 'Compras por cliente', value: mediaVisitas, icon: 'ri-shopping-bag-3-line', color: 'text-sky-600 bg-sky-50' },
            { label: 'Ticket médio geral', value: fmtMoeda(ticketMedioGeral), icon: 'ri-receipt-line', color: 'text-zinc-600 bg-zinc-100' },
          ].map((s) => (
            <div key={s.label} className="bg-zinc-50 rounded-xl px-3 md:px-4 py-3 flex items-center gap-2 md:gap-3">
              <div className={`w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${s.color}`}>
                <i className={`${s.icon} text-sm md:text-base`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-800 truncate">{s.value}</p>
                <p className="text-[10px] md:text-[11px] text-zinc-400 leading-tight">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 md:gap-3">
          <div className="relative flex-1 w-full sm:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
            <input
              className="w-full pl-9 pr-4 py-2 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:border-amber-400 transition-colors"
              placeholder="Buscar por nome ou celular..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFiltro(f.id)}
                className={`px-2.5 md:px-3 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 flex items-center gap-1 ${filtro === f.id ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
              >
                {f.icon && <i className={`${f.icon} text-xs`} />}
                {f.label}
                {f.count && (
                  <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] ${filtro === f.id ? 'bg-white/30 text-white' : 'bg-zinc-200 text-zinc-600'}`}>
                    {f.count(clientes)}
                  </span>
                )}
              </button>
            ))}
          </div>
          <select
            className="border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-600 focus:outline-none cursor-pointer w-full sm:w-auto"
            value={ordenar}
            onChange={(e) => setOrdenar(e.target.value as typeof ordenar)}
          >
            <option value="recente">Mais recentes</option>
            <option value="visitas">Mais compras</option>
            <option value="gasto">Maior gasto</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Painel RFM */}
        {showRFM && clientes.length > 0 && (
          <div className="mb-4 bg-white border border-zinc-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-zinc-900">Segmentação RFM</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Recência · Frequência · Valor — classificação automática dos seus clientes</p>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg">
                <i className="ri-user-line text-zinc-500 text-xs" />
                <span className="text-xs font-semibold text-zinc-600">{clientes.length} clientes</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Gráfico de barras */}
              <div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={rfmData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="seg" tick={{ fontSize: 11, fill: '#52525b' }} axisLine={false} tickLine={false} width={72} />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        name === 'count' ? `${value} clientes` : fmtMoeda(value),
                        name === 'count' ? 'Clientes' : 'Gasto total',
                      ]}
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e4e4e7' }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
                      {rfmData.map((entry) => (
                        <Cell key={entry.seg} fill={entry.style.bar} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Cards de segmento */}
              <div className="space-y-2">
                {rfmData.map(seg => (
                  <div key={seg.seg} className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${seg.style.bg}`}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: seg.style.bar }} />
                      <div>
                        <p className={`text-xs font-bold ${seg.style.color}`}>{seg.seg}</p>
                        <p className="text-[10px] text-zinc-400">{seg.style.desc}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-black ${seg.style.color}`}>{seg.count}</p>
                      <p className="text-[10px] text-zinc-400">{fmtMoeda(seg.gasto)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Insight de retenção */}
            {rfmData.find(s => s.seg === 'Em Risco' || s.seg === 'Perdidos') && (
              <div className="mt-4 flex items-start gap-3 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
                <i className="ri-lightbulb-line text-orange-500 text-base flex-shrink-0 mt-0.5" />
                <div className="text-xs text-orange-800">
                  <strong>Oportunidade de retenção:</strong>{' '}
                  {(() => {
                    const emRisco = rfmData.find(s => s.seg === 'Em Risco');
                    const perdidos = rfmData.find(s => s.seg === 'Perdidos');
                    const total = (emRisco?.count ?? 0) + (perdidos?.count ?? 0);
                    const gasto = (emRisco?.gasto ?? 0) + (perdidos?.gasto ?? 0);
                    return `${total} cliente${total > 1 ? 's' : ''} em risco ou perdidos representam ${fmtMoeda(gasto)} em gasto histórico. Uma campanha de reativação pode recuperar parte desse valor.`;
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Banner aniversariantes */}
        {filtro === 'aniversario' && lista.length > 0 && (
          <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <i className="ri-cake-line text-amber-600 text-xl flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">{lista.length} cliente{lista.length > 1 ? 's' : ''} com aniversário este mês!</p>
              <p className="text-xs text-amber-600">Considere enviar uma mensagem especial ou oferecer um desconto de aniversário.</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
            {/* Contador de resultados */}
            {(busca || filtro !== 'todos') && (
              <div className="px-5 py-2.5 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
                <p className="text-xs text-zinc-500">
                  <span className="font-semibold text-zinc-700">{lista.length}</span> resultado{lista.length !== 1 ? 's' : ''} encontrado{lista.length !== 1 ? 's' : ''}
                  {clientes.length !== lista.length && ` de ${clientes.length} clientes`}
                </p>
                {(busca || filtro !== 'todos') && (
                  <button
                    onClick={() => { setBusca(''); setFiltro('todos'); }}
                    className="text-xs text-amber-600 hover:text-amber-700 cursor-pointer font-semibold"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            )}

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-100">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Tags</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider" title="Quantidade de vendas finalizadas (pagas) vinculadas ao cliente">Compras</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total gasto</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ticket médio</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Aniversário</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Última compra</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((cliente, idx) => {
                    const dias = diasSemVisita(cliente.ultimaVisita);
                    const isAniversario = aniversarioEsteMes(cliente);
                    return (
                      <tr
                        key={cliente.id}
                        onClick={() => setSelecionado(cliente)}
                        className={`border-b border-zinc-50 hover:bg-amber-50/40 cursor-pointer transition-colors ${isAniversario ? 'bg-amber-50/20' : idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/30'}`}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
                                <span className="text-sm font-bold text-amber-700">{cliente.nome.charAt(0)}</span>
                              </div>
                              {isAniversario && (
                                <div className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-amber-500 rounded-full">
                                  <i className="ri-cake-line text-white text-[8px]" />
                                </div>
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-zinc-800">{cliente.nome}</p>
                              <p className="text-xs text-zinc-400">{cliente.celular || '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {cliente.tags.map((tag) => (
                              <span key={tag} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${TAG_STYLE[tag] ?? ''}`}>
                                {tag}
                              </span>
                            ))}
                            {isAniversario && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                🎂 aniversário
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm font-bold text-zinc-800">{cliente.totalVisitas}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-bold text-zinc-800">{fmtMoeda(cliente.valorTotal)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm text-zinc-600">{fmtMoeda(cliente.ticketMedio)}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {cliente.dataNascimento ? (
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${isAniversario ? 'text-amber-600 font-bold' : 'text-zinc-600'}`}>
                              {isAniversario && <i className="ri-cake-line text-[11px]" />}
                              {fmtAniversario(cliente.dataNascimento)}
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {cliente.totalVisitas === 0 ? (
                            <span className="text-xs text-zinc-400 italic">Sem compras</span>
                          ) : (
                            <>
                              <p className="text-sm text-zinc-600">{fmtData(cliente.ultimaVisita)}</p>
                              <p className={`text-[11px] ${dias > 30 ? 'text-red-500' : dias > 14 ? 'text-amber-500' : 'text-green-600'}`}>
                                {dias === 0 ? 'hoje' : `há ${dias} dias`}
                              </p>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); abrirWhatsApp(cliente); }}
                            disabled={!cliente.celular}
                            title={cliente.celular ? 'Enviar mensagem no WhatsApp' : 'Cliente sem telefone'}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer transition-colors"
                          >
                            <i className="ri-whatsapp-line text-base" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {lista.length === 0 && !loading && (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-zinc-400 text-sm">
                        {clientes.length === 0 ? 'Nenhum cliente cadastrado ainda' : 'Nenhum cliente encontrado para os filtros selecionados'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-zinc-50">
              {lista.map((cliente) => {
                const dias = diasSemVisita(cliente.ultimaVisita);
                const isAniversario = aniversarioEsteMes(cliente);
                return (
                  <div
                    key={cliente.id}
                    onClick={() => setSelecionado(cliente)}
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-amber-50/40 cursor-pointer transition-colors ${isAniversario ? 'bg-amber-50/20' : ''}`}
                  >
                    <div className="relative">
                      <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
                        <span className="text-sm font-bold text-amber-700">{cliente.nome.charAt(0)}</span>
                      </div>
                      {isAniversario && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-amber-500 rounded-full">
                          <i className="ri-cake-line text-white text-[8px]" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-800">{cliente.nome}</p>
                        {cliente.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${TAG_STYLE[tag] ?? ''}`}>{tag}</span>
                        ))}
                      </div>
                      <p className="text-xs text-zinc-400">
                        {cliente.celular || '—'} · {cliente.totalVisitas} compra{cliente.totalVisitas === 1 ? '' : 's'}
                        {cliente.dataNascimento && <> · 🎂 {fmtAniversario(cliente.dataNascimento)}</>}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-zinc-800">{fmtMoeda(cliente.valorTotal)}</p>
                      {cliente.totalVisitas === 0 ? (
                        <p className="text-[10px] text-zinc-400 italic">Sem compras</p>
                      ) : (
                        <p className={`text-[10px] ${dias > 30 ? 'text-red-500' : dias > 14 ? 'text-amber-500' : 'text-green-600'}`}>
                          {dias === 0 ? 'hoje' : `há ${dias}d`}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); abrirWhatsApp(cliente); }}
                      disabled={!cliente.celular}
                      title={cliente.celular ? 'Enviar mensagem no WhatsApp' : 'Cliente sem telefone'}
                      className="flex items-center justify-center w-9 h-9 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-30 cursor-pointer transition-colors flex-shrink-0"
                    >
                      <i className="ri-whatsapp-line text-lg" />
                    </button>
                  </div>
                );
              })}
              {lista.length === 0 && (
                <div className="px-5 py-12 text-center text-zinc-400 text-sm">
                  {clientes.length === 0 ? 'Nenhum cliente cadastrado ainda' : 'Nenhum cliente encontrado'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {selecionado && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelecionado(null)} />
          <ClientePerfil cliente={selecionado} onClose={() => setSelecionado(null)} />
        </>
      )}
    </div>
  );
}
