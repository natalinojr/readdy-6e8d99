import { useState } from 'react';
import type { EventoAuditoria, SeveridadeAuditoria } from '@/constants/auditoria';
import { tipoAcaoConfig } from '@/constants/auditoria';

interface Props {
  eventos: EventoAuditoria[];
  periodo: string;
  onClose: () => void;
}

interface ResumoUsuario {
  nome: string;
  total: number;
  criticos: number;
  avisos: number;
}

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildResumoUsuarios(eventos: EventoAuditoria[]): ResumoUsuario[] {
  const mapa: Record<string, ResumoUsuario> = {};
  eventos.forEach((e) => {
    if (!mapa[e.usuario]) mapa[e.usuario] = { nome: e.usuario, total: 0, criticos: 0, avisos: 0 };
    mapa[e.usuario].total++;
    if (e.severidade === 'critico') mapa[e.usuario].criticos++;
    if (e.severidade === 'aviso') mapa[e.usuario].avisos++;
  });
  return Object.values(mapa).sort((a, b) => b.total - a.total).slice(0, 10);
}

function buildTopEventos(eventos: EventoAuditoria[]) {
  const mapa: Record<string, number> = {};
  eventos.forEach((e) => { mapa[e.tipo] = (mapa[e.tipo] ?? 0) + 1; });
  return Object.entries(mapa)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([tipo, count]) => ({ tipo, count, label: tipoAcaoConfig[tipo as keyof typeof tipoAcaoConfig]?.label ?? tipo }));
}

function buildAlertasDetectados(eventos: EventoAuditoria[]) {
  const alertas: string[] = [];

  // Cancelamentos por usuário
  const cancelPorUser: Record<string, number> = {};
  eventos.forEach((e) => {
    if (e.tipo === 'pedido_cancelado' || e.tipo === 'item_cancelado') {
      cancelPorUser[e.usuario] = (cancelPorUser[e.usuario] ?? 0) + 1;
    }
  });
  Object.entries(cancelPorUser).forEach(([u, n]) => {
    if (n >= 3) alertas.push(`${u} realizou ${n} cancelamentos no período`);
  });

  // Login falhos
  const loginFalhos = eventos.filter((e) => e.tipo === 'acesso_login_falhou').length;
  if (loginFalhos >= 3) alertas.push(`${loginFalhos} tentativas de login falhas detectadas`);

  // Estornos
  const estornos = eventos.filter((e) => e.tipo === 'estorno_realizado').length;
  if (estornos > 0) alertas.push(`${estornos} estorno(s) realizado(s) no período`);

  // Sangrias
  const sangrias = eventos.filter((e) => e.tipo === 'sangria').length;
  if (sangrias > 0) alertas.push(`${sangrias} sangria(s) de caixa registrada(s)`);

  return alertas;
}

const SEV_COLORS: Record<SeveridadeAuditoria, string> = {
  info: '#0ea5e9',
  aviso: '#f59e0b',
  critico: '#ef4444',
};

export default function ExportarPDFAuditoria({ eventos, periodo, onClose }: Props) {
  const [gerando, setGerando] = useState(false);

  const stats = {
    total: eventos.length,
    criticos: eventos.filter((e) => e.severidade === 'critico').length,
    avisos: eventos.filter((e) => e.severidade === 'aviso').length,
    info: eventos.filter((e) => e.severidade === 'info').length,
  };

  const resumoUsuarios = buildResumoUsuarios(eventos);
  const topEventos = buildTopEventos(eventos);
  const alertas = buildAlertasDetectados(eventos);
  const eventosCriticos = eventos.filter((e) => e.severidade === 'critico').slice(0, 20);

  function gerarHTML(): string {
    const dataGeracao = new Date().toLocaleString('pt-BR');
    const periodoLabel = periodo === 'hoje' ? 'Hoje' : periodo === 'semana' ? 'Últimos 7 dias' : periodo === 'mes' ? 'Último mês' : periodo;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Auditoria — ${periodoLabel}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #18181b; background: #fff; padding: 32px; }
  h1 { font-size: 22px; font-weight: 900; color: #18181b; margin-bottom: 4px; }
  h2 { font-size: 14px; font-weight: 700; color: #3f3f46; margin: 24px 0 10px; border-bottom: 2px solid #f4f4f5; padding-bottom: 6px; }
  h3 { font-size: 12px; font-weight: 700; color: #52525b; margin-bottom: 8px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 3px solid #ef4444; }
  .header-left p { color: #71717a; font-size: 11px; margin-top: 4px; }
  .header-right { text-align: right; font-size: 11px; color: #71717a; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat-card { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 10px; padding: 14px; }
  .stat-card .value { font-size: 28px; font-weight: 900; }
  .stat-card .label { font-size: 10px; color: #71717a; margin-top: 2px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card.critico .value { color: #ef4444; }
  .stat-card.aviso .value { color: #f59e0b; }
  .stat-card.info .value { color: #0ea5e9; }
  .alertas-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 14px; margin-bottom: 24px; }
  .alertas-box h3 { color: #dc2626; }
  .alertas-box ul { list-style: none; }
  .alertas-box li { padding: 4px 0; color: #7f1d1d; font-size: 11px; }
  .alertas-box li::before { content: "⚠ "; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #f4f4f5; text-align: left; padding: 8px 10px; font-weight: 700; color: #52525b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
  td { padding: 7px 10px; border-bottom: 1px solid #f4f4f5; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
  .badge-critico { background: #fee2e2; color: #dc2626; }
  .badge-aviso { background: #fef3c7; color: #d97706; }
  .badge-info { background: #e0f2fe; color: #0284c7; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e4e4e7; font-size: 10px; color: #a1a1aa; text-align: center; }
  .no-alertas { color: #16a34a; font-size: 11px; font-weight: 600; }
  .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .bar-label { width: 140px; font-size: 10px; color: #52525b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-track { flex: 1; height: 8px; background: #f4f4f5; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; background: #ef4444; border-radius: 4px; }
  .bar-count { font-size: 10px; font-weight: 700; color: #3f3f46; width: 24px; text-align: right; }
  @media print {
    body { padding: 16px; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <h1>Relatório de Auditoria</h1>
    <p>Período: <strong>${periodoLabel}</strong> &nbsp;·&nbsp; Gerado em: ${dataGeracao}</p>
  </div>
  <div class="header-right">
    <p><strong>Sistema PDV</strong></p>
    <p>Log de Auditoria — Resumo Executivo</p>
  </div>
</div>

<div class="stats-grid">
  <div class="stat-card">
    <div class="value">${stats.total}</div>
    <div class="label">Total de eventos</div>
  </div>
  <div class="stat-card critico">
    <div class="value">${stats.criticos}</div>
    <div class="label">Críticos</div>
  </div>
  <div class="stat-card aviso">
    <div class="value">${stats.avisos}</div>
    <div class="label">Avisos</div>
  </div>
  <div class="stat-card info">
    <div class="value">${stats.info}</div>
    <div class="label">Informativos</div>
  </div>
</div>

<div class="alertas-box">
  <h3>Alertas Detectados no Período</h3>
  ${alertas.length === 0
    ? '<p class="no-alertas">✓ Nenhum alerta crítico detectado no período</p>'
    : `<ul>${alertas.map((a) => `<li>${a}</li>`).join('')}</ul>`
  }
</div>

<div class="two-col">
  <div>
    <h2>Top Tipos de Evento</h2>
    ${topEventos.map((t) => {
      const pct = stats.total > 0 ? Math.round((t.count / stats.total) * 100) : 0;
      return `<div class="bar-row">
        <div class="bar-label">${t.label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-count">${t.count}</div>
      </div>`;
    }).join('')}
  </div>
  <div>
    <h2>Atividade por Usuário</h2>
    <table>
      <thead><tr><th>Usuário</th><th>Total</th><th>Críticos</th><th>Avisos</th></tr></thead>
      <tbody>
        ${resumoUsuarios.map((u) => `
          <tr>
            <td><strong>${u.nome}</strong></td>
            <td>${u.total}</td>
            <td>${u.criticos > 0 ? `<span class="badge badge-critico">${u.criticos}</span>` : '—'}</td>
            <td>${u.avisos > 0 ? `<span class="badge badge-aviso">${u.avisos}</span>` : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</div>

${eventosCriticos.length > 0 ? `
<h2>Eventos Críticos do Período (últimos ${eventosCriticos.length})</h2>
<table>
  <thead>
    <tr>
      <th>Data/Hora</th>
      <th>Ação</th>
      <th>Descrição</th>
      <th>Usuário</th>
      <th>Severidade</th>
    </tr>
  </thead>
  <tbody>
    ${eventosCriticos.map((e) => `
      <tr>
        <td><strong>${e.hora}</strong><br>${e.data}</td>
        <td>${tipoAcaoConfig[e.tipo]?.label ?? e.tipo}</td>
        <td>${e.descricao}</td>
        <td>${e.usuario}<br><span style="color:#a1a1aa;font-size:10px">${e.perfil}</span></td>
        <td><span class="badge badge-${e.severidade}">${e.severidade}</span></td>
      </tr>
    `).join('')}
  </tbody>
</table>
` : ''}

<div class="footer">
  Relatório gerado automaticamente pelo sistema de auditoria &nbsp;·&nbsp; ${dataGeracao} &nbsp;·&nbsp; Confidencial — uso interno
</div>
</body>
</html>`;
  }

  async function handleGerar() {
    setGerando(true);
    try {
      const html = gerarHTML();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (win) {
        win.onload = () => {
          setTimeout(() => {
            win.print();
            URL.revokeObjectURL(url);
          }, 500);
        };
      }
    } finally {
      setGerando(false);
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-red-50 rounded-lg">
              <i className="ri-file-pdf-line text-red-500" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900">Exportar Relatório PDF</h2>
              <p className="text-xs text-zinc-400">Resumo executivo do período</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Preview do conteúdo */}
          <div className="bg-zinc-50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold text-zinc-700 mb-3">O relatório incluirá:</p>
            {[
              { icon: 'ri-bar-chart-2-line', label: 'Resumo estatístico', desc: `${stats.total} eventos — ${stats.criticos} críticos, ${stats.avisos} avisos` },
              { icon: 'ri-alarm-warning-line', label: 'Alertas detectados', desc: alertas.length > 0 ? `${alertas.length} alerta(s) identificado(s)` : 'Nenhum alerta crítico', color: alertas.length > 0 ? 'text-red-500' : 'text-green-500' },
              { icon: 'ri-user-line', label: 'Atividade por usuário', desc: `Top ${Math.min(resumoUsuarios.length, 10)} operadores` },
              { icon: 'ri-list-check-2', label: 'Top tipos de evento', desc: `${topEventos.length} categorias mais frequentes` },
              { icon: 'ri-error-warning-line', label: 'Eventos críticos detalhados', desc: eventosCriticos.length > 0 ? `${eventosCriticos.length} evento(s) crítico(s)` : 'Nenhum evento crítico' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3">
                <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                  <i className={`${item.icon} text-sm ${item.color ?? 'text-zinc-500'}`} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-700">{item.label}</p>
                  <p className="text-[10px] text-zinc-400">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
            <i className="ri-information-line text-amber-600 text-sm flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              O relatório será aberto em uma nova aba. Use <strong>Ctrl+P</strong> (ou o diálogo de impressão) para salvar como PDF.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 cursor-pointer transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleGerar}
              disabled={gerando || eventos.length === 0}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 cursor-pointer transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {gerando ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Gerando...</>
              ) : (
                <><i className="ri-file-pdf-line" /> Gerar PDF</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
