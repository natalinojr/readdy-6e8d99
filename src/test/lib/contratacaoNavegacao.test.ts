import { describe, it, expect } from 'vitest';
import { destinoDeAbaAntiga, AREAS, AREA_CONFIG } from '../../pages/contratacao/navegacao';

describe('destinoDeAbaAntiga — mapa de compatibilidade das 9 abas antigas (RF-01)', () => {
  it('entrevistas → Entrevistas › Dia', () => {
    expect(destinoDeAbaAntiga('entrevistas')).toEqual({ area: 'entrevistas', subabaEntrevistas: 'dia' });
  });
  it('candidatos → Candidatos SEM forçar modo (o modo vem do localStorage contratacao_view)', () => {
    // Regressão: se voltar a devolver modoCandidatos aqui, quem tem contratacao_view='tabela'
    // gravado no aparelho passa a abrir sempre em Cards e perde a preferência em silêncio.
    expect(destinoDeAbaAntiga('candidatos')).toEqual({ area: 'candidatos' });
    expect(destinoDeAbaAntiga('candidatos').modoCandidatos).toBeUndefined();
  });
  it('vagas → Vagas', () => {
    expect(destinoDeAbaAntiga('vagas')).toEqual({ area: 'vagas' });
  });
  it('kanban → Candidatos, modo kanban', () => {
    expect(destinoDeAbaAntiga('kanban')).toEqual({ area: 'candidatos', modoCandidatos: 'kanban' });
  });
  it('agenda → Entrevistas › Calendário', () => {
    expect(destinoDeAbaAntiga('agenda')).toEqual({ area: 'entrevistas', subabaEntrevistas: 'calendario' });
  });
  it('agendamentos → Entrevistas › Conversas da IA', () => {
    expect(destinoDeAbaAntiga('agendamentos')).toEqual({ area: 'entrevistas', subabaEntrevistas: 'conversas' });
  });
  it('relatorios → Relatórios', () => {
    expect(destinoDeAbaAntiga('relatorios')).toEqual({ area: 'relatorios' });
  });
  it('links → Configurações › WhatsApp', () => {
    expect(destinoDeAbaAntiga('links')).toEqual({ area: 'config', secaoConfig: 'whatsapp' });
  });
  it('config → Configurações', () => {
    expect(destinoDeAbaAntiga('config')).toEqual({ area: 'config' });
  });
  it('valor inválido cai em Hoje', () => {
    expect(destinoDeAbaAntiga('nao-existe')).toEqual({ area: 'hoje' });
  });
  it('ausente (null) cai em Hoje', () => {
    expect(destinoDeAbaAntiga(null)).toEqual({ area: 'hoje' });
  });
});

describe('AREAS / AREA_CONFIG — a barra de 5 áreas + engrenagem (RF-01)', () => {
  it('AREAS tem exatamente 5 itens, sem a engrenagem', () => {
    expect(AREAS).toHaveLength(5);
    expect(AREAS.map((a) => a.id)).not.toContain('config');
  });
  it('a engrenagem é um item à parte, id "config"', () => {
    expect(AREA_CONFIG.id).toBe('config');
  });
});
