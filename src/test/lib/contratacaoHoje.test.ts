import { describe, it, expect } from 'vitest';
import {
  contagensHoje, diaKeyBR, formatarDiaCurto, montarPrecisaDeVoce, proximoDiaComEntrevistas,
  type ConversaNeedsHuman, type SessaoAgendamento,
} from '../../pages/contratacao/hoje';
import type { Candidate, FichaCfg, Interview, Job } from '../../pages/contratacao/shared';

const ficha: FichaCfg = { required_fields: ['full_name', 'phone'], custom_fields: [] };

const iv = (over: Partial<Interview>): Interview => ({
  id: over.id ?? 'iv1', candidate_id: over.candidate_id ?? 'c1', company_id: null,
  scheduled_at: over.scheduled_at ?? '2026-09-21T15:00:00Z', duration_min: 30, format: 'presencial', location: null,
  interviewer: null, status: over.status ?? 'agendada', scores: {}, answers: {}, recommendation: null, notes: null,
  created_at: '2026-09-01T00:00:00Z',
});
const cand = (over: Partial<Candidate>): Candidate => ({
  id: over.id ?? 'c1', company_id: null, stage_id: null, full_name: over.full_name ?? 'Fulana', email: null,
  phone: over.phone ?? '41999999999', city: null, neighborhood: null, address: null, marital_status: null, decision: null,
  lat: null, lng: null, geo_label: null, geo_precision: null, birth_date: null, age: null, desired_role: null, summary: null,
  experiences: [], education: [], skills: [], languages: [], courses: [], availability: null, salary_expectation: null,
  driver_license: null, total_experience_months: null, strengths: [], concerns: [], rating: null, notes: null, file_path: null,
  file_name: null, file_type: null, raw_text: null, ai_processed: false,
  created_at: over.created_at ?? '2026-09-21T12:00:00Z',
});
const job = (id: string, title: string): Job => ({
  id, company_id: null, title, description: null, requirements: null, desirable: null, schedule: null, salary: null,
  benefits: null, contract_type: null, openings: 1, status: 'aberta', notes: null, opened_at: '2026-01-01', closed_at: null,
  created_at: '2026-01-01',
});

describe('diaKeyBR — corte por dia em horário de Brasília (AGENTS.md linha 75)', () => {
  it('23h30 de um dia em Brasília, mesmo com UTC já no dia seguinte, fica no dia de Brasília', () => {
    // 2026-09-21T02:30:00Z = 2026-09-20T23:30 em America/Sao_Paulo (UTC-3)
    expect(diaKeyBR('2026-09-21T02:30:00Z')).toBe('2026-09-20');
  });
  it('meio-dia UTC de um dia é meio-dia em Brasília no mesmo dia civil', () => {
    expect(diaKeyBR('2026-09-21T15:00:00Z')).toBe('2026-09-21');
  });
});

describe('formatarDiaCurto', () => {
  it('formata "seg 21/09" (21/09/2026 é uma segunda-feira)', () => {
    expect(formatarDiaCurto('2026-09-21')).toBe('seg 21/09');
  });
});

describe('proximoDiaComEntrevistas', () => {
  const agora = new Date('2026-09-21T15:00:00Z'); // 2026-09-21 12:00 em Brasília

  it('sem entrevista futura, devolve null', () => {
    expect(proximoDiaComEntrevistas([iv({ scheduled_at: '2026-09-21T15:00:00Z' })], agora)).toBeNull();
  });
  it('acha o primeiro dia futuro com entrevista e conta quantas tem', () => {
    const ivs = [
      iv({ id: 'a', scheduled_at: '2026-09-24T14:00:00Z' }),
      iv({ id: 'b', scheduled_at: '2026-09-24T15:00:00Z' }),
      iv({ id: 'c', scheduled_at: '2026-09-28T14:00:00Z' }),
    ];
    expect(proximoDiaComEntrevistas(ivs, agora)).toEqual({ diaKey: '2026-09-24', quantidade: 2 });
  });
  it('ignora entrevista cancelada ao contar', () => {
    const ivs = [iv({ id: 'a', scheduled_at: '2026-09-24T14:00:00Z', status: 'cancelada' })];
    expect(proximoDiaComEntrevistas(ivs, agora)).toBeNull();
  });
  it('não conta hoje nem dias passados como "próxima"', () => {
    const ivs = [iv({ id: 'a', scheduled_at: '2026-09-21T18:00:00Z' }), iv({ id: 'b', scheduled_at: '2026-09-19T14:00:00Z' })];
    expect(proximoDiaComEntrevistas(ivs, agora)).toBeNull();
  });
});

describe('contagensHoje', () => {
  const agora = new Date('2026-09-21T15:00:00Z'); // 2026-09-21 12:00 em Brasília

  it('conta entrevistas de hoje e ignora as de outros dias e as canceladas', () => {
    const ivs = [
      iv({ id: 'a', scheduled_at: '2026-09-21T14:00:00Z' }),
      iv({ id: 'b', scheduled_at: '2026-09-21T02:30:00Z' }), // 20/09 em Brasília: não é hoje
      iv({ id: 'c', scheduled_at: '2026-09-21T18:00:00Z', status: 'cancelada' }),
    ];
    expect(contagensHoje(ivs, [], ficha, agora).entrevistasHoje).toBe(1);
  });

  it('dia vazio: preenche proximaComEntrevistas com a mesma conta de proximoDiaComEntrevistas', () => {
    const ivs = [iv({ id: 'a', scheduled_at: '2026-09-24T14:00:00Z' }), iv({ id: 'b', scheduled_at: '2026-09-24T15:00:00Z' })];
    expect(contagensHoje(ivs, [], ficha, agora).proximaComEntrevistas).toEqual({ diaKey: '2026-09-24', quantidade: 2 });
  });

  it('dia com entrevista: proximaComEntrevistas fica null (o atalho só serve para dia vazio)', () => {
    const ivs = [iv({ id: 'a', scheduled_at: '2026-09-21T14:00:00Z' })];
    expect(contagensHoje(ivs, [], ficha, agora).proximaComEntrevistas).toBeNull();
  });

  it('currículos novos: só os criados hoje, e quantos têm ficha incompleta', () => {
    const candidatos = [
      cand({ id: 'c1', created_at: '2026-09-21T12:00:00Z', phone: '' }), // hoje, incompleta (telefone vazio)
      cand({ id: 'c2', created_at: '2026-09-21T13:00:00Z', phone: '41999999999' }), // hoje, completa
      cand({ id: 'c3', created_at: '2026-09-20T12:00:00Z', phone: '' }), // ontem: não conta
    ];
    const r = contagensHoje([], candidatos, ficha, agora);
    expect(r.curriculosNovos).toBe(2);
    expect(r.curriculosComFichaIncompleta).toBe(1);
  });

  it('entrevistas passadas sem registro: agendada com horário já passado', () => {
    const ivs = [
      iv({ id: 'a', scheduled_at: '2026-09-20T14:00:00Z', status: 'agendada' }), // passou, sem registro
      iv({ id: 'b', scheduled_at: '2026-09-20T14:00:00Z', status: 'realizada' }), // passou, já registrada
      iv({ id: 'c', scheduled_at: '2026-09-22T14:00:00Z', status: 'agendada' }), // ainda não passou
    ];
    expect(contagensHoje(ivs, [], ficha, agora).entrevistasPassadasSemRegistro).toBe(1);
  });
});

describe('montarPrecisaDeVoce', () => {
  const jobs = [job('j1', 'Atendente')];
  const candidates = [cand({ id: 'c1', full_name: 'Ana' }), cand({ id: 'c2', full_name: 'Bruna' })];
  const sess = (over: Partial<SessaoAgendamento>): SessaoAgendamento => ({
    id: over.id ?? 's1', candidate_id: over.candidate_id ?? 'c1', job_id: over.job_id ?? 'j1',
    status: over.status ?? 'aguardando_gestor', error: over.error ?? null,
    pending_request: over.pending_request ?? null, updated_at: over.updated_at ?? '2026-09-21T10:00:00Z',
  });
  const conversa = (over: Partial<ConversaNeedsHuman>): ConversaNeedsHuman => ({
    id: over.id ?? 'cv1', contact_name: over.contact_name ?? 'Carlos', contact_phone: over.contact_phone ?? '41988887777',
    candidate_ids: over.candidate_ids ?? [], last_message_at: over.last_message_at ?? '2026-09-21T09:00:00Z',
  });

  it('sem nenhuma fonte, lista vazia', () => {
    expect(montarPrecisaDeVoce({ sessoes: [], candidates: [], jobs: [], conversas: [] })).toEqual([]);
  });

  it('aguardando_gestor com data exata: pedidoDataHora preenchido, pedidoTextoLivre nulo', () => {
    const s = sess({ pending_request: { starts_at: '2026-09-22T14:00:00Z' } });
    const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
    expect(item).toEqual({
      tipo: 'aguardando_gestor', sessionId: 's1', candidateId: 'c1', candidateName: 'Ana', jobTitle: 'Atendente',
      pedidoDataHora: '2026-09-22T14:00:00Z', pedidoTextoLivre: null,
    });
  });

  it('aguardando_gestor sem data exata: pedidoTextoLivre preenchido, pedidoDataHora nulo', () => {
    const s = sess({ pending_request: { texto: 'semana que vem' } });
    const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
    expect((item as { pedidoDataHora: string | null }).pedidoDataHora).toBeNull();
    expect((item as { pedidoTextoLivre: string }).pedidoTextoLivre).toBe('semana que vem');
  });

  it('needs_human vira item com o nome da conversa e o candidato vinculado', () => {
    const c = conversa({ candidate_ids: ['c2'] });
    const [item] = montarPrecisaDeVoce({ sessoes: [], candidates, jobs: [], conversas: [c] });
    expect(item).toEqual({ tipo: 'needs_human', conversationId: 'cv1', nome: 'Carlos', candidateId: 'c2', atualizadoEm: '2026-09-21T09:00:00Z' });
  });

  it('sessão erro vira item com a mensagem', () => {
    const s = sess({ status: 'erro', error: 'número inválido' });
    const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
    expect(item).toEqual({ tipo: 'erro', sessionId: 's1', candidateId: 'c1', candidateName: 'Ana', jobTitle: 'Atendente', mensagem: 'número inválido' });
  });

  it('sessão erro sem mensagem cai no texto padrão', () => {
    const s = sess({ status: 'erro', error: null });
    const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
    expect((item as { mensagem: string }).mensagem).toBe('Falhou ao enviar.');
  });

  it('candidato removido não trava: usa o texto padrão', () => {
    const s = sess({ candidate_id: 'c-removido' });
    const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
    expect((item as { candidateName: string }).candidateName).toBe('Candidato removido');
  });

  it('vaga apagada não trava: jobTitle fica null', () => {
    const s = sess({ job_id: 'j-apagada' });
    const [item] = montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] });
    expect((item as { jobTitle: string | null }).jobTitle).toBeNull();
  });

  it('status fora das 3 chaves (ex.: "convidado") não vira item nenhum', () => {
    const s = sess({ status: 'convidado' });
    expect(montarPrecisaDeVoce({ sessoes: [s], candidates, jobs, conversas: [] })).toEqual([]);
  });

  it('ordem: aguardando_gestor, depois needs_human, depois erro; mais recente primeiro dentro do grupo', () => {
    const s1 = sess({ id: 's-velha', status: 'aguardando_gestor', updated_at: '2026-09-20T10:00:00Z' });
    const s2 = sess({ id: 's-nova', status: 'aguardando_gestor', updated_at: '2026-09-21T10:00:00Z' });
    const e1 = sess({ id: 'e1', status: 'erro', updated_at: '2026-09-21T11:00:00Z' });
    const c1 = conversa({ id: 'cv1' });
    const itens = montarPrecisaDeVoce({ sessoes: [s1, e1, s2], candidates, jobs, conversas: [c1] });
    expect(itens.map((i) => i.tipo)).toEqual(['aguardando_gestor', 'aguardando_gestor', 'needs_human', 'erro']);
    expect((itens[0] as { sessionId: string }).sessionId).toBe('s-nova');
  });
});
