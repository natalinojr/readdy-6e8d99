// Ação rápida: carga de hoje de cada pessoa da equipe, só leitura. Mesmo cálculo da tela
// Tarefas › Carga (calcularCarga) e a mesma fonte de horas (fn_get_task_capacities). Desde 8f52205 a
// carga do dia é o TOTAL planejado, inclusive o que já foi concluído, com a parte feita na barra —
// por isso carrega também as concluídas. Alcance = fn_get_tasks (minhas pastas, compartilhadas, comigo).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useEuTarefas } from '@/pages/tarefas/hooks/useEuTarefas';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { CAPACIDADE_PADRAO, chaveDia, calcularCarga, type Capacidade, type ResultadoCarga } from '@/pages/tarefas/lib/carga';
import { formatarDuracao, formatarHoras } from '@/pages/tarefas/lib/tempo';
import { Fim, Opcao, OpcaoNeutra, Roteiro, useRoteiro, type AcaoProps } from '../kit';
import { COR_TAREFAS, OpcaoTarefa, carregarEquipe, carregarTarefas, type Pessoa } from './comum';

type Passo = 'carregando' | 'painel' | 'pessoa' | 'fim';

interface Linha { id: string; nome: string; minutos: number; feitos: number; capHoras: number; folga: boolean }

function corLinha(minutos: number, capHoras: number): { barra: string; texto: string } {
  if (capHoras <= 0) return minutos > 0 ? { barra: 'bg-red-500', texto: 'text-red-600' } : { barra: 'bg-zinc-200', texto: 'text-zinc-400' };
  const r = minutos / (capHoras * 60);
  if (r > 1) return { barra: 'bg-red-500', texto: 'text-red-600' };
  if (r > 0.8) return { barra: 'bg-amber-400', texto: 'text-amber-700' };
  return { barra: 'bg-emerald-500', texto: 'text-emerald-700' };
}

export default function CargaEquipe({ onFechar, irPara }: AcaoProps) {
  // Sem loja também (2026-09-24): quem só tem o módulo Tarefas usa com tenant nulo.
  const eu = useEuTarefas();
  const tenantId = eu.tenantId;
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [carga, setCarga] = useState<ResultadoCarga | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [tarefas, setTarefas] = useState<TaskRow[]>([]);
  const [pessoa, setPessoa] = useState<Linha | null>(null);
  const hoje = new Date();
  const hojeChave = chaveDia(hoje);

  useEffect(() => {
    if (!eu.pronto) return;
    (async () => {
      const [{ tarefas: todas, erro }, { pessoas: equipe }] = await Promise.all([
        carregarTarefas(tenantId, true),
        carregarEquipe(tenantId, eu.id ? { id: eu.id, nome: eu.nome } : null),
      ]);
      if (erro) { r.bot(`Não consegui abrir as Tarefas: ${erro}`); setPasso('fim'); return; }
      setTarefas(todas);

      // Horas de todos os responsáveis (a concluída também é espalhada pela capacidade de quem fez).
      const responsaveis = [...new Set(todas.map((t) => t.assignee_id).filter((id): id is string => !!id))];
      let capacidades: Record<string, Capacidade> = {};
      if (responsaveis.length) {
        const { data } = await supabase.rpc('fn_get_task_capacities', { p_user_ids: responsaveis });
        capacidades = (data ?? {}) as Record<string, Capacidade>;
      }
      const capacidadeDe = (pessoaId: string): Capacidade => capacidades[pessoaId] ?? CAPACIDADE_PADRAO;
      const resultado = calcularCarga(todas, hoje, capacidadeDe);
      setCarga(resultado);
      // Pessoas: responsáveis de tarefa aberta + quem tem algo planejado hoje (mesmo já concluído).
      const ids = responsaveis.filter((id) => (resultado.porPessoa.get(id)?.get(hojeChave)?.length ?? 0) > 0
        || todas.some((t) => t.assignee_id === id && t.status_category !== 'done' && t.status_category !== 'cancelled'));

      const nomeDe = (id: string): string => equipe.find((p: Pessoa) => p.id === id)?.nome
        ?? todas.find((t) => t.assignee_id === id)?.assignee_name ?? 'Usuário';

      const ls: Linha[] = ids.map((id) => {
        const cap = capacidadeDe(id);
        const capHoras = cap[hoje.getDay()];
        const parcelas = resultado.porPessoa.get(id)?.get(hojeChave) ?? [];
        const minutos = parcelas.reduce((s, p) => s + p.minutos, 0);
        const feitos = parcelas.reduce((s, p) => s + p.feitos, 0);
        return { id, nome: nomeDe(id), minutos, feitos, capHoras, folga: capHoras === 0 };
      }).sort((a, b) => {
        const ra = a.capHoras > 0 ? a.minutos / (a.capHoras * 60) : a.minutos > 0 ? 2 : 0;
        const rb = b.capHoras > 0 ? b.minutos / (b.capHoras * 60) : b.minutos > 0 ? 2 : 0;
        return rb - ra;
      });
      setLinhas(ls);

      if (!ls.length) { r.bot('Nenhuma tarefa com responsável ainda.'); setPasso('fim'); return; }

      r.painel(<PainelCarga linhas={ls} carga={resultado} />);
      const pendencias: string[] = [];
      if (resultado.semEstimativa.length) pendencias.push(`${resultado.semEstimativa.length} tarefa${resultado.semEstimativa.length > 1 ? 's' : ''} sem estimativa`);
      if (resultado.semData.length) pendencias.push(`${resultado.semData.length} sem prazo`);
      if (resultado.atrasadas.length) pendencias.push(`${resultado.atrasadas.length} atrasada${resultado.atrasadas.length > 1 ? 's' : ''}`);
      if (pendencias.length) r.bot(pendencias.join(' · '));
      r.bot('Total planejado para hoje, com a parte já feita. Tarefas das suas pastas, das compartilhadas com você e as que estão com você.');
      setPasso('painel');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eu.pronto]);

  const verPessoa = (l: Linha) => {
    setPessoa(l);
    r.eu(l.nome);
    setPasso('pessoa');
  };

  const parcelasDoDia = pessoa && carga ? (carga.porPessoa.get(pessoa.id)?.get(hojeChave) ?? []).slice().sort((a, b) => b.minutos - a.minutos) : [];

  return (
    <Roteiro titulo="Carga da equipe hoje" icone="ri-bar-chart-horizontal-line" cor={COR_TAREFAS} baloes={r.baloes}
      carregando={passo === 'carregando'} onFechar={onFechar}>
      {passo === 'painel' && (
        <>
          {linhas.map((l) => <Opcao key={l.id} onClick={() => verPessoa(l)}>{l.nome}</Opcao>)}
          <Opcao onClick={() => irPara('/tarefas')}>Ver a semana na tela</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'pessoa' && pessoa && (
        <>
          {parcelasDoDia.length === 0 && <p className="text-xs text-zinc-400 px-1">Nenhuma tarefa dela hoje.</p>}
          {parcelasDoDia.map((p) => (
            <OpcaoTarefa key={p.task.id} t={p.task} onClick={() => irPara(`/tarefas?task=${p.task.id}`)}
              icone={p.concluida ? 'ri-checkbox-circle-line' : undefined}
              extra={`${formatarDuracao(p.minutos * 60)}${p.concluida ? ' · concluída' : p.feitos > 0 ? ` · ${formatarDuracao(p.feitos * 60)} feito` : ''}${p.atrasada ? ' · atrasada' : ''}`} />
          ))}
          <OpcaoNeutra onClick={() => setPasso('painel')}>Voltar</OpcaoNeutra>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Tarefas', onClick: () => irPara('/tarefas') }]} />}
    </Roteiro>
  );
}

function PainelCarga({ linhas, carga }: { linhas: Linha[]; carga: ResultadoCarga }) {
  void carga;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3 space-y-2.5">
      {linhas.map((l) => {
        const cor = corLinha(l.minutos, l.capHoras);
        const sobrecarregado = l.capHoras > 0 && l.minutos / (l.capHoras * 60) > 1;
        const pct = l.capHoras > 0 ? Math.min(100, (l.minutos / (l.capHoras * 60)) * 100) : l.minutos > 0 ? 100 : 0;
        const pctFeito = l.minutos > 0 ? (pct * Math.min(l.feitos, l.minutos)) / l.minutos : 0;
        return (
          <div key={l.id}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-zinc-800 truncate">{l.nome}</span>
              <span className={`text-xs font-medium ${cor.texto}`}>
                {l.folga && l.minutos <= 0 ? 'folga' : `${formatarHoras(l.minutos)} de ${l.capHoras}h${l.feitos >= 1 ? ` · ${formatarHoras(l.feitos)} feito` : ''}`}
                {sobrecarregado && ' · sobrecarregado'}
                {l.folga && l.minutos > 0 && ' · folga com carga'}
              </span>
            </div>
            {/* Barra clara = planejado; parte escura = já feito (igual à tela Carga). */}
            <div className="relative h-1.5 rounded-full bg-zinc-100 overflow-hidden mt-1">
              <div className={`absolute inset-y-0 left-0 rounded-full ${cor.barra} opacity-40`} style={{ width: `${pct}%` }} />
              <div className={`absolute inset-y-0 left-0 rounded-full ${cor.barra}`} style={{ width: `${pctFeito}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
