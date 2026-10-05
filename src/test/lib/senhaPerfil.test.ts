import { describe, it, expect } from 'vitest';
import { entraSoPorPin, validarTrocaDeSenha, SENHA_MINIMA } from '@/lib/senhaPerfil';

describe('entraSoPorPin', () => {
  it('e-mails sintéticos do login por matrícula/PIN', () => {
    expect(entraSoPorPin('user_0007_ab12cd34@erpos.local')).toBe(true);
    expect(entraSoPorPin('tablet1@totem.erpos.local')).toBe(true);
    expect(entraSoPorPin('kiosk-abc@kiosk.erpos.internal')).toBe(true);
    expect(entraSoPorPin('CAIXA.PAR@ERPOS.LOCAL')).toBe(true);
  });
  it('e-mail real tem senha', () => {
    expect(entraSoPorPin('dono@gmail.com')).toBe(false);
    expect(entraSoPorPin('x@erpos.com.br')).toBe(false);
    expect(entraSoPorPin('')).toBe(false);
    expect(entraSoPorPin(undefined)).toBe(false);
  });
});

describe('validarTrocaDeSenha', () => {
  it('aceita senha boa', () => {
    expect(validarTrocaDeSenha('antiga1', 'nova1234', 'nova1234')).toBe('');
  });
  it('pede cada campo', () => {
    expect(validarTrocaDeSenha('', 'nova1234', 'nova1234')).toMatch(/atual/);
    expect(validarTrocaDeSenha('a', '', '')).toMatch(/nova senha/);
  });
  it('mínimo de caracteres', () => {
    expect(validarTrocaDeSenha('antiga1', 'a'.repeat(SENHA_MINIMA - 1), 'a'.repeat(SENHA_MINIMA - 1))).toMatch(/pelo menos/);
  });
  it('confirmação diferente e senha igual à atual', () => {
    expect(validarTrocaDeSenha('antiga1', 'nova1234', 'nova12345')).toMatch(/não são iguais/);
    expect(validarTrocaDeSenha('mesma123', 'mesma123', 'mesma123')).toMatch(/diferente/);
  });
});
