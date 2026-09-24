// task-sobrecarga — avisa quando alguém está com carga acima do que cabe (2026-09-25).
// Chamada todo dia às 08h de Brasília pelo pg_cron (job "task-sobrecarga",
// fn_task_sobrecarga_tick) com x-internal-key. Usa a MESMA conta da tela
// Tarefas › Carga (../_shared/carga.ts): próximos 7 dias, o que falta ÷ horas
// disponíveis (horas por dia da semana + folgas). Acima de 110% (e pelo menos 1h
// a mais) avisa quem passou as tarefas pra pessoa — ou ela mesma, se ninguém
// passou. No máximo 1 aviso por semana por destinatário+pessoa.
// Corpo {"dry_run": true} só calcula e devolve (sem gravar nem mandar push).
// Secrets: ASSISTENTE_INTERNAL_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  CAPACIDADE_PADRAO, SEM_RESPONSAVEL, calcularCarga, chaveDia, diaLocal, ocupacaoRestante, somarDias,
  type Capacidade, type TarefaCarga,
} from '../_shared/carga.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const internalKey = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';

const LIMITE = 1.1;
const MINIMO_ACIMA = 60; // minutos

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Tarefa extends TarefaCarga {
  title: string;
  tenant_id: string | null;
  created_by: string | null;
}

interface Dados {
  tarefas: Tarefa[];
  capacidades: Record<string, number[]>;
  ausencias: Record<string, Record<string, number>>;
  nomes: Record<string, string>;
}

function horas(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return `${String(h).replace('.', ',')}h`;
}

Deno.serve(async (req: Request) => {
  if (!internalKey || req.headers.get('x-internal-key') !== internalKey) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // "Hoje" em Brasília. O runtime roda em UTC: as datas vêm todas como 'AAAA-MM-DD'
  // (o vencimento já convertido pelo banco), então a conta local fica consistente.
  const hojeStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const hoje = diaLocal(hojeStr);
  const ate = somarDias(hoje, 6);
  const segunda = somarDias(hoje, -((hoje.getDay() + 6) % 7));

  const { data, error } = await admin.rpc('fn_task_sobrecarga_dados', { p_ate: chaveDia(ate) });
  if (error) {
    console.error('[task-sobrecarga] rpc', error.message);
    return json({ error: error.message }, 500);
  }
  const dados = data as Dados;
  const capDe = (p: string): Capacidade =>
    (dados.capacidades?.[p]?.length === 7 ? dados.capacidades[p] : CAPACIDADE_PADRAO) as Capacidade;
  const excDe = (p: string, dia: string): number | undefined => {
    const h = dados.ausencias?.[p]?.[dia];
    return typeof h === 'number' ? h : h === undefined ? undefined : Number(h);
  };

  const carga = calcularCarga(dados.tarefas ?? [], hoje, capDe, excDe);
  const resultado: Array<Record<string, unknown>> = [];
  let avisados = 0;

  for (const pessoa of carga.porPessoa.keys()) {
    if (pessoa === SEM_RESPONSAVEL) continue;
    const { faltam, disponivel } = ocupacaoRestante(carga, pessoa, hoje, ate, capDe(pessoa), excDe);
    const acima = disponivel === 0 ? faltam >= MINIMO_ACIMA : faltam > disponivel * LIMITE && faltam - disponivel >= MINIMO_ACIMA;
    if (!acima) continue;

    // Tarefas da pessoa na janela: a mais pesada vira o link; quem passou vira destinatário.
    const porTarefa = new Map<string, { t: Tarefa; min: number }>();
    for (let d = hoje; d <= ate; d = somarDias(d, 1)) {
      for (const p of carga.porPessoa.get(pessoa)?.get(chaveDia(d)) ?? []) {
        const atual = porTarefa.get(p.task.id) ?? { t: p.task, min: 0 };
        atual.min += p.minutos - p.feitos;
        porTarefa.set(p.task.id, atual);
      }
    }
    const tarefas = [...porTarefa.values()].sort((a, b) => b.min - a.min);
    if (!tarefas.length) continue;
    const principal = tarefas[0].t;
    const quemPassou = [...new Set(tarefas.map((x) => x.t.created_by).filter((id): id is string => !!id && id !== pessoa))];
    const destinatarios = quemPassou.length ? quemPassou : [pessoa];
    const pct = disponivel > 0 ? Math.round((faltam / disponivel) * 100) : null;
    const nome = dados.nomes?.[pessoa] ?? 'Alguém';

    resultado.push({ pessoa, nome, faltam: Math.round(faltam), disponivel, pct, destinatarios, tarefa: principal.title });
    if (dryRun) continue;

    // Registro da semana: quem já foi avisado sobre essa pessoa não recebe de novo.
    const { data: novos, error: errAviso } = await admin.from('task_sobrecarga_avisos')
      .upsert(destinatarios.map((d) => ({ semana: chaveDia(segunda), destinatario: d, pessoa })),
        { onConflict: 'semana,destinatario,pessoa', ignoreDuplicates: true })
      .select('destinatario');
    if (errAviso) { console.error('[task-sobrecarga] registro', errAviso.message); continue; }
    const para = (novos ?? []).map((r: { destinatario: string }) => r.destinatario);
    if (!para.length) continue;

    await admin.from('task_notifications').insert(para.map((d) => ({
      tenant_id: principal.tenant_id, user_id: d, task_id: principal.id, type: 'overload', actor_id: null,
      payload: { pessoa, nome, pct, faltam: Math.round(faltam), disponivel, dias: 7, propria: d === pessoa },
    })));

    for (const d of para) {
      const propria = d === pessoa;
      try {
        const r = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({
            action: 'send',
            user_ids: [d],
            tenant_id: principal.tenant_id,
            payload: {
              titulo: propria ? '🔥 Seus próximos 7 dias estão cheios' : `🔥 ${nome} está sobrecarregado(a)`,
              corpo: `${horas(faltam)} de tarefas para ${horas(disponivel)} disponíveis${pct !== null ? ` (${pct}%)` : ''}. Veja na Carga.`,
              url: `/tarefas?task=${principal.id}`,
              task_id: principal.id,
              tag: `sobrecarga-${pessoa}`,
            },
          }),
        });
        if (!r.ok) console.error('[task-sobrecarga] send-push', r.status, await r.text());
      } catch (e) {
        console.error('[task-sobrecarga] push falhou', e instanceof Error ? e.message : e);
      }
    }
    avisados += para.length;
  }

  return json({ success: true, hoje: hojeStr, sobrecarregados: resultado.length, avisados, ...(dryRun ? { resultado } : {}) });
});
