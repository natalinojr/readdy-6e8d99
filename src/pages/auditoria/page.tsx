import { useState, useMemo, useCallback } from 'react';
import { Shield, Search, Download, ChevronRight, Calendar, Lock, Filter, RotateCcw, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  tipoAcaoConfig, tiposParaFiltro,
  type EventoAuditoria, type SeveridadeAuditoria, type TipoAcao,
} from '../../constants/auditoria';
import { useAuditoria } from '../../contexts/AuditoriaContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateInput } from '@/lib/formatters';
import DetalheAuditoria from './components/DetalheAuditoria';
import AlertasCriticos from './components/AlertasCriticos';
import ResumoUsuarios from './components/ResumoUsuarios';
import ExportarPDFAuditoria from './components/ExportarPDFAuditoria';

const severidadeConfig: Record<SeveridadeAuditoria, { label: string; cls: string; dot: string }> = {
  info:    { label: 'Info',     cls: 'text-sky-600 bg-sky-50',     dot: 'bg-sky-400' },
  aviso:   { label: 'Aviso',   cls: 'text-amber-700 bg-amber-50', dot: 'bg-amber-400' },
  critico: { label: 'Crítico', cls: 'text-red-600 bg-red-50',     dot: 'bg-red-500' },
};

type PeriodoFiltro = 'hoje' | 'ontem' | 'semana' | 'mes' | 'custom' | 'todos';
type PainelLateral = 'detalhe' | 'alertas' | 'usuarios' | null;

function Avatar({ nome }: { nome: string }) {
  const iniciais = nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
  const cores = ['bg-amber-400', 'bg-emerald-400', 'bg-sky-400', 'bg-violet-400', 'bg-rose-400'];
  const cor = cores[nome.charCodeAt(0) % cores.length];
  return (
    <div className={`w-7 h-7 ${cor} flex-shrink-0 flex items-center justify-center rounded-full text-white text-[10px] font-bold`}>
      {iniciais}
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="flex flex-col h-full items-center justify-center bg-zinc-50">
      <div className="w-16 h-16 flex items-center justify-center bg-red-50 rounded-2xl mb-4">
        <Lock size={28} className="text-red-400" />
      </div>
      <h2 className="text-lg font-bold text-zinc-800 mb-1">Acesso Restrito</h2>
      <p className="text-sm text-zinc-500 text-center max-w-xs">
        O Log de Auditoria é acessível apenas para <strong>Admin</strong> e <strong>Gerente</strong>.
        Entre em contato com seu administrador.
      </p>
    </div>
  );
}

export default function AuditoriaPage() {
  const { user } = useAuth();
  const { eventos: todosEventos, loading, carregarComFiltros } = useAuditoria();

  const [busca, setBusca] = useState('');
  const [filtroGrupo, setFiltroGrupo] = useState('todos');
  const [filtroSev, setFiltroSev] = useState<'todas' | SeveridadeAuditoria>('todas');
  const [filtroUsuario, setFiltroUsuario] = useState('Todos');
  const [buscaUsuario, setBuscaUsuario] = useState('');
  const [periodo, setPeriodo] = useState<PeriodoFiltro>('hoje');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [eventoSelecionado, setEventoSelecionado] = useState<EventoAuditoria | null>(null);
  const [painelLateral, setPainelLateral] = useState<PainelLateral>(null);
  const [aplicandoFiltros, setAplicandoFiltros] = useState(false);
  const [mostrarGrafico, setMostrarGrafico] = useState(false);
  const [exportPDFOpen, setExportPDFOpen] = useState(false);

  const isAuthorized = user?.perfil === 'admin' || user?.perfil === 'gerente';

  const usuarios = useMemo(
    () => ['Todos', ...Array.from(new Set(todosEventos.map((e) => e.usuario)))],
    [todosEventos],
  );

  const usuariosFiltrados = useMemo(
    () => usuarios.filter((u) => u.toLowerCase().includes(buscaUsuario.toLowerCase())),
    [usuarios, buscaUsuario],
  );

  const grupoAtual = tiposParaFiltro.find((t) => t.id === filtroGrupo);

  const filtrados = useMemo(() => {
    return todosEventos.filter((ev) => {
      const matchBusca = !busca
        || ev.descricao.toLowerCase().includes(busca.toLowerCase())
        || ev.usuario.toLowerCase().includes(busca.toLowerCase())
        || ev.entidadeId.toLowerCase().includes(busca.toLowerCase());
      const matchGrupo = filtroGrupo === 'todos' || (grupoAtual?.tipos?.includes(ev.tipo) ?? true);
      const matchSev = filtroSev === 'todas' || ev.severidade === filtroSev;
      const matchUser = filtroUsuario === 'Todos' || ev.usuario === filtroUsuario;
      return matchBusca && matchGrupo && matchSev && matchUser;
    }).sort((a, b) => {
      const dateA = new Date(a.data.split('/').reverse().join('-'));
      const dateB = new Date(b.data.split('/').reverse().join('-'));
      if (dateA.getTime() !== dateB.getTime()) return dateB.getTime() - dateA.getTime();
      return b.hora.localeCompare(a.hora);
    });
  }, [todosEventos, busca, filtroGrupo, filtroSev, filtroUsuario, grupoAtual]);

  const stats = useMemo(() => ({
    total: filtrados.length,
    criticos: filtrados.filter((e) => e.severidade === 'critico').length,
    avisos: filtrados.filter((e) => e.severidade === 'aviso').length,
    info: filtrados.filter((e) => e.severidade === 'info').length,
  }), [filtrados]);

  const graficoHoras = useMemo(() => {
    const mapa: Record<string, { info: number; aviso: number; critico: number }> = {};
    filtrados.forEach((ev) => {
      const hora = ev.hora?.slice(0, 2) + 'h' || '??';
      if (!mapa[hora]) mapa[hora] = { info: 0, aviso: 0, critico: 0 };
      mapa[hora][ev.severidade] = (mapa[hora][ev.severidade] ?? 0) + 1;
    });
    return Object.entries(mapa)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hora, v]) => ({ hora, ...v }));
  }, [filtrados]);

  const alertasCount = useMemo(() => {
    // Contar alertas automáticos relevantes
    let count = 0;
    const cancelPorUsuario: Record<string, number> = {};
    filtrados.forEach((e) => {
      if (e.tipo === 'pedido_cancelado' || e.tipo === 'item_cancelado') {
        cancelPorUsuario[e.usuario] = (cancelPorUsuario[e.usuario] ?? 0) + 1;
      }
    });
    Object.values(cancelPorUsuario).forEach((n) => { if (n >= 3) count++; });
    count += filtrados.filter((e) => e.tipo === 'acesso_login_falhou').length >= 3 ? 1 : 0;
    return count + stats.criticos;
  }, [filtrados, stats.criticos]);

  const aplicarFiltrosServer = useCallback(async () => {
    setAplicandoFiltros(true);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    let inicio: string | undefined;
    let fim: string | undefined;
    switch (periodo) {
      case 'hoje':
        inicio = formatDateInput(hoje);
        break;
      case 'ontem': {
        const ontem = new Date(hoje);
        ontem.setDate(ontem.getDate() - 1);
        inicio = formatDateInput(ontem);
        fim = formatDateInput(ontem);
        break;
      }
      case 'semana': {
        const semanaAgo = new Date(hoje);
        semanaAgo.setDate(semanaAgo.getDate() - 7);
        inicio = formatDateInput(semanaAgo);
        break;
      }
      case 'mes': {
        const mesAgo = new Date(hoje);
        mesAgo.setMonth(mesAgo.getMonth() - 1);
        inicio = formatDateInput(mesAgo);
        break;
      }
      case 'custom':
        inicio = dataInicio || undefined;
        fim = dataFim || undefined;
        break;
      default:
        break;
    }
    await carregarComFiltros({
      dataInicio: inicio,
      dataFim: fim,
      tipo: filtroGrupo !== 'todos' && grupoAtual?.tipos?.[0] ? grupoAtual.tipos[0] as TipoAcao : undefined,
      severidade: filtroSev !== 'todas' ? filtroSev : undefined,
      usuario: filtroUsuario !== 'Todos' ? filtroUsuario : undefined,
      limit: 500,
    });
    setAplicandoFiltros(false);
  }, [periodo, dataInicio, dataFim, filtroGrupo, filtroSev, filtroUsuario, carregarComFiltros, grupoAtual]);

  const handleFiltrarUsuario = useCallback((usuario: string) => {
    setFiltroUsuario(usuario);
    setPainelLateral(null);
    setEventoSelecionado(null);
  }, []);

  const handleExport = () => {
    const header = ['ID', 'Data', 'Hora', 'Tipo', 'Severidade', 'Usuário', 'Perfil', 'Descrição', 'Entidade', 'IP'];
    const rows = filtrados.map((e) => [
      e.id, e.data, e.hora,
      tipoAcaoConfig[e.tipo]?.label ?? e.tipo,
      e.severidade, e.usuario, e.perfil,
      `"${e.descricao.replace(/"/g, '\'')}"`,
      `${e.entidade} ${e.entidadeId}`, e.ip,
    ]);
    const csv = [header, ...rows].map((r) => r.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const limparFiltros = useCallback(() => {
    setBusca('');
    setFiltroGrupo('todos');
    setFiltroSev('todas');
    setFiltroUsuario('Todos');
    setBuscaUsuario('');
    setPeriodo('hoje');
    setDataInicio('');
    setDataFim('');
    aplicarFiltrosServer();
  }, [aplicarFiltrosServer]);

  const togglePainel = (painel: PainelLateral) => {
    if (painelLateral === painel) {
      setPainelLateral(null);
    } else {
      setPainelLateral(painel);
      setEventoSelecionado(null);
    }
  };

  if (!isAuthorized) return <AccessDenied />;

  const periodoLabel = periodo === 'hoje' ? 'Hoje' : periodo === 'ontem' ? 'Ontem' : periodo === 'semana' ? 'Semana' : periodo === 'mes' ? 'Mês' : periodo === 'custom' ? `${dataInicio} a ${dataFim}` : 'Todos';

  const painelAberto = eventoSelecionado !== null || painelLateral !== null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 bg-white border-b border-zinc-100">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-red-50 rounded-lg">
              <Shield size={16} className="text-red-500" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Log de Auditoria</h1>
              <p className="text-xs text-zinc-400 hidden sm:block">Histórico completo de ações críticas do sistema</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {stats.criticos > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg whitespace-nowrap">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                {stats.criticos} crítico{stats.criticos > 1 ? 's' : ''}
              </span>
            )}
            {/* Botão Alertas */}
            <button
              onClick={() => togglePainel('alertas')}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap border ${painelLateral === 'alertas' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-zinc-100 border-zinc-200 text-zinc-600 hover:bg-zinc-200'}`}
            >
              <i className="ri-alarm-warning-line text-sm" />
              <span className="hidden sm:inline">Alertas</span>
              {alertasCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {alertasCount > 9 ? '9+' : alertasCount}
                </span>
              )}
            </button>
            {/* Botão Usuários */}
            <button
              onClick={() => togglePainel('usuarios')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap border ${painelLateral === 'usuarios' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-zinc-100 border-zinc-200 text-zinc-600 hover:bg-zinc-200'}`}
            >
              <Users size={13} />
              <span className="hidden sm:inline">Usuários</span>
            </button>
            <button
              onClick={() => setMostrarGrafico((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap border ${mostrarGrafico ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-zinc-100 border-zinc-200 text-zinc-600 hover:bg-zinc-200'}`}
            >
              <i className="ri-bar-chart-2-line text-sm" />
              <span className="hidden sm:inline">Gráfico</span>
            </button>
            <button
              onClick={aplicarFiltrosServer}
              disabled={aplicandoFiltros || loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 cursor-pointer transition-colors whitespace-nowrap"
            >
              {aplicandoFiltros || loading
                ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Filter size={13} />}
              <span className="hidden sm:inline">Aplicar Filtros</span>
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-100 text-zinc-700 text-xs font-semibold rounded-lg hover:bg-zinc-200 cursor-pointer transition-colors whitespace-nowrap"
            >
              <Download size={13} />
              <span className="hidden sm:inline">CSV</span>
            </button>
            <button
              onClick={() => setExportPDFOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-600 border border-red-200 text-xs font-semibold rounded-lg hover:bg-red-100 cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-file-pdf-line text-sm" />
              <span className="hidden sm:inline">PDF</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-4 md:p-6 pb-0 space-y-3 md:space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            {[
              { label: 'Eventos filtrados', value: stats.total,    cls: 'text-zinc-900' },
              { label: 'Críticos',          value: stats.criticos, cls: 'text-red-600' },
              { label: 'Avisos',            value: stats.avisos,   cls: 'text-amber-600' },
              { label: 'Informativos',      value: stats.info,     cls: 'text-sky-600' },
            ].map(({ label, value, cls }) => (
              <div key={label} className="bg-white border border-zinc-100 rounded-xl p-3 md:p-4">
                <p className={`text-xl md:text-2xl font-black ${cls}`}>{value}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Gráfico */}
          {mostrarGrafico && graficoHoras.length > 0 && (
            <div className="bg-white border border-zinc-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-bold text-zinc-700">Distribuição de Eventos por Hora</p>
                  <p className="text-[10px] text-zinc-400">Severidade empilhada — {filtrados.length} eventos no período</p>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-semibold">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400 inline-block" />Info</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />Aviso</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />Crítico</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={graficoHoras} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="hora" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} allowDecimals={false} width={20} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                    formatter={(v: number, name: string) => [v, name === 'info' ? 'Info' : name === 'aviso' ? 'Aviso' : 'Crítico']}
                  />
                  <Bar dataKey="info" stackId="a" fill="#38bdf8" radius={[0, 0, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="aviso" stackId="a" fill="#fbbf24" maxBarSize={28} />
                  <Bar dataKey="critico" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Filtro de período */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
              {([
                ['todos', 'Todos'],
                ['hoje', 'Hoje'],
                ['ontem', 'Ontem'],
                ['semana', 'Semana'],
                ['mes', 'Mês'],
                ['custom', 'Custom'],
              ] as [PeriodoFiltro, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setPeriodo(v)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${periodo === v ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  {l}
                </button>
              ))}
            </div>
            {periodo === 'custom' && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 bg-white border border-zinc-200 rounded-lg px-3 py-2">
                  <Calendar size={12} className="text-zinc-400" />
                  <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
                    className="text-xs bg-transparent text-zinc-700 focus:outline-none cursor-pointer" />
                </div>
                <span className="text-xs text-zinc-400">até</span>
                <div className="flex items-center gap-1.5 bg-white border border-zinc-200 rounded-lg px-3 py-2">
                  <Calendar size={12} className="text-zinc-400" />
                  <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
                    className="text-xs bg-transparent text-zinc-700 focus:outline-none cursor-pointer" />
                </div>
              </div>
            )}
          </div>

          {/* Filtros — grupos */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {tiposParaFiltro.map((t) => (
              <button key={t.id} onClick={() => setFiltroGrupo(t.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${filtroGrupo === t.id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Filtros — linha 2 */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 md:gap-3">
            <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2 flex-1 w-full sm:max-w-xs">
              <Search size={13} className="text-zinc-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por descrição, usuário..."
                className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none" />
            </div>
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
              {[['todas', 'Todas'], ['info', 'Info'], ['aviso', 'Aviso'], ['critico', 'Crítico']].map(([v, l]) => (
                <button key={v} onClick={() => setFiltroSev(v as typeof filtroSev)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${filtroSev === v ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  {l}
                </button>
              ))}
            </div>

            {/* Filtro de usuário com busca */}
            <div className="relative">
              <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2 min-w-[160px]">
                <i className="ri-user-line text-zinc-400 text-xs" />
                <input
                  value={filtroUsuario === 'Todos' ? buscaUsuario : filtroUsuario}
                  onChange={(e) => {
                    setBuscaUsuario(e.target.value);
                    if (filtroUsuario !== 'Todos') setFiltroUsuario('Todos');
                  }}
                  onFocus={() => setBuscaUsuario('')}
                  placeholder={filtroUsuario === 'Todos' ? 'Filtrar usuário...' : filtroUsuario}
                  className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none w-28"
                />
                {filtroUsuario !== 'Todos' && (
                  <button onClick={() => { setFiltroUsuario('Todos'); setBuscaUsuario(''); }}
                    className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
                    <i className="ri-close-line text-xs" />
                  </button>
                )}
              </div>
              {buscaUsuario && filtroUsuario === 'Todos' && (
                <div className="absolute top-full left-0 mt-1 w-full bg-white border border-zinc-200 rounded-lg overflow-hidden z-20 max-h-40 overflow-y-auto">
                  {usuariosFiltrados.slice(0, 8).map((u) => (
                    <button key={u} onClick={() => { setFiltroUsuario(u); setBuscaUsuario(''); }}
                      className="w-full text-left px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 cursor-pointer transition-colors">
                      {u}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={limparFiltros}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer transition-colors">
              <RotateCcw size={12} />Limpar
            </button>
            <span className="text-xs text-zinc-400 whitespace-nowrap sm:ml-auto">
              {filtrados.length} evento{filtrados.length !== 1 ? 's' : ''}
              {filtroUsuario !== 'Todos' && (
                <span className="ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold">
                  {filtroUsuario}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Conteúdo: tabela + painel lateral */}
        <div className="flex-1 overflow-hidden flex gap-0 p-4 md:p-6 pt-3 md:pt-4">
          {/* Tabela */}
          <div className={`flex-1 overflow-y-auto bg-white border border-zinc-100 rounded-xl ${painelAberto ? 'hidden md:block rounded-r-none border-r-0' : ''}`}>
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-100 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500 w-32">Data / Hora</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Ação</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500 hidden md:table-cell">Descrição</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500 w-36 hidden sm:table-cell">Usuário</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500 w-24 hidden sm:table-cell">Severidade</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500 w-28 hidden lg:table-cell">IP</th>
                  <th className="px-4 py-3 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {filtrados.map((ev) => {
                  const cfg = tipoAcaoConfig[ev.tipo];
                  const sev = severidadeConfig[ev.severidade];
                  const isSelected = eventoSelecionado?.id === ev.id;
                  if (!cfg) return null;
                  return (
                    <tr
                      key={ev.id}
                      onClick={() => {
                        setEventoSelecionado(isSelected ? null : ev);
                        setPainelLateral(isSelected ? null : 'detalhe');
                      }}
                      className={`hover:bg-zinc-50 cursor-pointer transition-colors ${isSelected ? 'bg-amber-50' : ''}`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="font-semibold text-zinc-700">{ev.hora}</p>
                        <p className="text-zinc-400">{ev.data}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1.5 w-fit px-2.5 py-1 rounded-full font-semibold whitespace-nowrap ${cfg.bg} ${cfg.cor}`}>
                          <i className={`${cfg.icone} text-sm`} />
                          <span className="hidden sm:inline">{cfg.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs hidden md:table-cell">
                        <p className="text-zinc-700 line-clamp-2 leading-relaxed">{ev.descricao}</p>
                        <p className="text-zinc-400 mt-0.5">{ev.entidade} {ev.entidadeId}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="flex items-center gap-2">
                          <Avatar nome={ev.usuario} />
                          <div className="min-w-0">
                            <p className="font-semibold text-zinc-700 truncate">{ev.usuario}</p>
                            <p className="text-zinc-400">{ev.perfil}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center hidden sm:table-cell">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${sev.dot}`} />
                          <span className={`text-[10px] font-bold ${sev.cls.split(' ')[0]}`}>{sev.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-zinc-400 hidden lg:table-cell">{ev.ip}</td>
                      <td className="px-4 py-3">
                        <div className={`w-5 h-5 flex items-center justify-center text-zinc-300 transition-transform ${isSelected ? 'rotate-90 text-amber-500' : ''}`}>
                          <ChevronRight size={13} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtrados.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
                  <Shield size={20} className="text-zinc-300" />
                </div>
                <p className="text-sm font-semibold text-zinc-500">Nenhum evento encontrado</p>
                <p className="text-xs text-zinc-400 mt-1">Tente ajustar os filtros ou o período</p>
              </div>
            )}
          </div>

          {/* Painel lateral */}
          {painelAberto && (
            <div className="w-full md:w-80 flex-shrink-0 border border-l-0 border-zinc-100 rounded-r-xl overflow-hidden flex flex-col">
              {/* Tabs do painel */}
              <div className="flex border-b border-zinc-100 bg-zinc-50">
                {eventoSelecionado && (
                  <button
                    onClick={() => setPainelLateral('detalhe')}
                    className={`flex-1 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${painelLateral === 'detalhe' ? 'bg-white text-zinc-900 border-b-2 border-amber-400' : 'text-zinc-500 hover:text-zinc-700'}`}
                  >
                    Detalhe
                  </button>
                )}
                <button
                  onClick={() => setPainelLateral('alertas')}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors cursor-pointer relative ${painelLateral === 'alertas' ? 'bg-white text-zinc-900 border-b-2 border-amber-400' : 'text-zinc-500 hover:text-zinc-700'}`}
                >
                  Alertas
                  {alertasCount > 0 && (
                    <span className="absolute top-1 right-2 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                      {alertasCount > 9 ? '9+' : alertasCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setPainelLateral('usuarios')}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${painelLateral === 'usuarios' ? 'bg-white text-zinc-900 border-b-2 border-amber-400' : 'text-zinc-500 hover:text-zinc-700'}`}
                >
                  Usuários
                </button>
                <button
                  onClick={() => { setPainelLateral(null); setEventoSelecionado(null); }}
                  className="px-3 py-2.5 text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors"
                >
                  <i className="ri-close-line text-sm" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {painelLateral === 'detalhe' && eventoSelecionado && (
                  <DetalheAuditoria
                    evento={eventoSelecionado}
                    onClose={() => { setEventoSelecionado(null); setPainelLateral(null); }}
                  />
                )}
                {painelLateral === 'alertas' && (
                  <div className="p-4">
                    <AlertasCriticos
                      eventos={filtrados}
                      onFiltrarUsuario={handleFiltrarUsuario}
                    />
                  </div>
                )}
                {painelLateral === 'usuarios' && (
                  <div className="p-4">
                    <ResumoUsuarios
                      eventos={filtrados}
                      usuarioSelecionado={filtroUsuario}
                      onSelecionar={handleFiltrarUsuario}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {exportPDFOpen && (
        <ExportarPDFAuditoria
          eventos={filtrados}
          periodo={periodoLabel}
          onClose={() => setExportPDFOpen(false)}
        />
      )}
    </div>
  );
}
