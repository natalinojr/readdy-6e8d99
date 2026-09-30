import { describe, it, expect } from 'vitest';
import { destinoDeAbaAntiga, AREAS, AREA_CONFIG, AREA_NUMEROS } from '../../pages/contratacao/navegacao';

describe('destinoDeAbaAntiga — valores de ?aba= atuais e antigos', () => {
  it('as áreas de hoje voltam para elas mesmas', () => {
    expect(destinoDeAbaAntiga('fila')).toEqual({ area: 'fila' });
    expect(destinoDeAbaAntiga('vagas')).toEqual({ area: 'vagas' });
    expect(destinoDeAbaAntiga('pessoas')).toEqual({ area: 'pessoas' });
    expect(destinoDeAbaAntiga('numeros')).toEqual({ area: 'numeros' });
    expect(destinoDeAbaAntiga('config')).toEqual({ area: 'config' });
  });
  it('hoje, entrevistas e agenda (links do assistente) → Minha fila', () => {
    expect(destinoDeAbaAntiga('hoje')).toEqual({ area: 'fila' });
    expect(destinoDeAbaAntiga('entrevistas')).toEqual({ area: 'fila' });
    expect(destinoDeAbaAntiga('agenda')).toEqual({ area: 'fila' });
  });
  it('candidatos → Pessoas; kanban → Vagas (o funil mora na vaga)', () => {
    expect(destinoDeAbaAntiga('candidatos')).toEqual({ area: 'pessoas' });
    expect(destinoDeAbaAntiga('kanban')).toEqual({ area: 'vagas' });
  });
  it('agendamentos → Vagas, nas conversas da IA', () => {
    expect(destinoDeAbaAntiga('agendamentos')).toEqual({ area: 'vagas', visaoVaga: 'conversas' });
  });
  it('relatorios → Números; links → Configurações › WhatsApp', () => {
    expect(destinoDeAbaAntiga('relatorios')).toEqual({ area: 'numeros' });
    expect(destinoDeAbaAntiga('links')).toEqual({ area: 'config', secaoConfig: 'whatsapp' });
  });
  it('valor inválido ou ausente cai na Minha fila', () => {
    expect(destinoDeAbaAntiga('nao-existe')).toEqual({ area: 'fila' });
    expect(destinoDeAbaAntiga(null)).toEqual({ area: 'fila' });
  });
});

describe('AREAS — 3 áreas na barra; Números e Configurações à parte', () => {
  it('AREAS tem exatamente Minha fila, Vagas e Pessoas', () => {
    expect(AREAS.map((a) => a.id)).toEqual(['fila', 'vagas', 'pessoas']);
  });
  it('Números e Configurações são itens à parte', () => {
    expect(AREA_NUMEROS.id).toBe('numeros');
    expect(AREA_CONFIG.id).toBe('config');
  });
});
